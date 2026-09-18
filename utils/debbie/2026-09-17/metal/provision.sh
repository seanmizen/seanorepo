#!/bin/bash
# provision.sh - bring a freshly installed box up to debbie, then assert it.
#
# The metal counterpart to the second half of vm/test-vm.sh: assert what the
# installer produced, run postinstall, reboot so the boot-time settings apply,
# wait for the box to come back, and run the same assertions the VM runs.
#
# There are TWO assertion runs, and that is deliberate - REQ-SERVER-004, #285.
# The first (PHASE=firstboot) happens before postinstall.sh touches anything,
# so it says whether the INSTALL was right. The second (PHASE=provisioned)
# says whether the box is right. Only the first can catch a fault that
# postinstall.sh silently repairs, which is how the box ran as `192` for a
# whole generation with every check green.
#
# It exists because doing this by hand meant retyping the hostname, the deploy
# user and the key path, and the runbook had them wrong for any SERVER_NAME
# other than the default - the first real install used a different one, so the
# documented provision step could not connect and the documented assert step
# failed a check that was passing. Everything here comes from .env.
#
#   ./provision.sh              postinstall, reboot, wait, assert
#   ./provision.sh --assert     assert only, against a box already provisioned
#   ./provision.sh --no-reboot  postinstall only, no reboot and no assert
#
# The box is dialled BY NAME, and the address is only ever a fallback - #284.
# A DHCP lease does not survive a reboot: the first real box took .182, then
# .183, then .184, one per boot. A run started with HOST=<ip> kept dialling the
# address it began with, so the post-reboot wait could not succeed even though
# the box was up - it had simply moved. $SERVER_NAME.local is the one handle
# that is stable across a moving lease, and since #285 it works from first boot.
#
# The post-reboot wait is satisfied by a NEW BOOT ID, not by a live socket -
# #295. See wait_for_ssh.
#
# Exit codes mirror the VM harness - REQ-EMU-003:
#   0   every assertion passed
#   1   an assertion failed
#   3   the box never came back (or came back still on the pre-reboot boot)
set -euo pipefail
IFS=$'\n\t'

HERE="$(cd "$(dirname "$0")" && pwd)"
GEN_DIR="$(dirname "$HERE")"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

WORK="$HERE/work"
ENV_FILE="${ENV_FILE:-$HERE/.env}"

read_env
DEPLOY_USER="${DEPLOY_USER:-srv}"
SERVER_NAME="${SERVER_NAME:-debbie}"
KEY="${SSH_KEY:-$WORK/id_ed25519}"
SSH_WAIT="${SSH_WAIT:-300}"

#------------------------------------------------------------------------------
# Where to dial - #284. In order of preference, not one pinned address.
#
# HOST is no longer "the host"; it is the FALLBACK, for the case where mDNS does
# not reach this machine. The name goes first because it is the only handle that
# survives the reboot in the middle of this script: the lease moves, the name
# does not. Nothing here caches a resolved address, so each wait re-decides from
# this list and a box that came back on a different address is still found.
#
# The fallback matters more than it looks. #285's assertion that
# `$SERVER_NAME.local resolves` asks the BOX'S OWN resolver, because QEMU's
# slirp carries no multicast - so "the laptop can hear it" is not something any
# green run has proved. If mDNS turns out not to cross this particular network,
# the supplied address is what saves the run, and it is tried within seconds
# rather than after the full SSH_WAIT: every round tries every candidate.
#------------------------------------------------------------------------------
MDNS_NAME="$SERVER_NAME.local"
HOST_FALLBACK="${HOST:-}"

CANDIDATES=("$MDNS_NAME")
if [ -n "$HOST_FALLBACK" ] && [ "$HOST_FALLBACK" != "$MDNS_NAME" ]; then
    CANDIDATES+=("$HOST_FALLBACK")
fi

# Whichever candidate last answered. wait_for_ssh sets it; sshto reads it.
HOST="${CANDIDATES[0]}"

MODE=full
case "${1:-}" in
    --assert)    MODE=assert ;;
    --no-reboot) MODE=noreboot ;;
    '')          : ;;
    *) die "unknown option '$1' (expected --assert or --no-reboot)" ;;
esac

[ -f "$KEY" ] || die "no SSH key at $KEY. Was this box installed by this checkout's serve-preseed.sh?"

# BatchMode so a missing key fails immediately instead of prompting for a
# password that does not exist - the account is key-only.
SSH_OPTS=(-i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=no
          -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR
          -o ConnectTimeout=5)

sshto() { ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$HOST" "$@"; }

#------------------------------------------------------------------------------
# The boot id - #295.
#
# /proc/sys/kernel/random/boot_id is a random UUID the kernel generates once per
# boot. It changes on a boot and on nothing else, which makes it the one thing a
# script can read to tell "the box came back" apart from "the box has not
# finished going down yet".
#
# It is read over the SAME connection path as everything else, and the check is
# keyed on the VALUE, never on which candidate answered. That is the part that
# has to compose with #284: the box may legitimately come back on a different
# address than the one it left on, and the address is therefore evidence of
# nothing. Two different addresses reporting the same boot id is the same
# machine that never rebooted; the same address reporting a new boot id is a
# box that did.
#------------------------------------------------------------------------------
BOOT_ID_PATH=/proc/sys/kernel/random/boot_id

boot_id_of() { ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$1" "cat $BOOT_ID_PATH" 2> /dev/null; }

# Try every candidate on every round rather than exhausting the deadline on the
# first one. A name that does not resolve fails in milliseconds and a dead
# address fails in ConnectTimeout, so the whole list costs a few seconds per
# round - the difference between "the fallback was tried" and "the fallback was
# tried five minutes later", which is the same as never on a run someone is
# watching.
#
# With an argument, that argument is the boot id seen BEFORE the reboot, and a
# candidate only satisfies the wait if it reports a DIFFERENT one. A connection
# that answers with the same boot id is the pre-reboot system - still up,
# because a clean shutdown with Docker containers to stop takes longer than any
# fixed sleep is willing to admit - and polling continues. Before #295 that
# connection ended the wait, and the PHASE=provisioned assertions then ran
# against a box that had not rebooted: `lid close ignored` and `sleep.target
# masked` (REQ-SERVER-001) went red on a box that was fine, which teaches
# everyone that a re-run is the fix.
wait_for_ssh() {
    local want_new_boot="${1:-}"
    local deadline=$(( $(date +%s) + SSH_WAIT )) cand id
    local saw_old_boot=no saw_unreadable=no
    log "waiting for $DEPLOY_USER@$MDNS_NAME${CANDIDATES[1]+, falling back to ${CANDIDATES[1]}}"
    if [ -n "$want_new_boot" ]; then
        log "requiring a boot id other than $want_new_boot"
    fi

    while [ "$(date +%s)" -lt "$deadline" ]; do
        for cand in "${CANDIDATES[@]}"; do
            if [ -z "$want_new_boot" ]; then
                # No reboot to prove: any answer will do, as before #295.
                if ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$cand" true 2> /dev/null; then
                    HOST="$cand"
                    log "up on $HOST"
                    return 0
                fi
                continue
            fi

            id="$(boot_id_of "$cand")" || continue
            if [ -z "$id" ]; then
                # Answered, but would not say which boot it is. Cannot be
                # treated as proof either way, so keep waiting and say so if
                # the deadline runs out.
                saw_unreadable=yes
                continue
            fi
            if [ "$id" = "$want_new_boot" ]; then
                saw_old_boot=yes
                continue
            fi
            HOST="$cand"
            log "up on $HOST (boot id $id)"
            return 0
        done
        sleep 5
    done

    echo >&2
    if [ "$saw_old_boot" = yes ]; then
        # A different failure with a different fix: the box was reachable the
        # whole time, so none of the mDNS/lease advice below applies.
        echo "ERROR: the box answered SSH within ${SSH_WAIT}s, but never rebooted." >&2
        echo "       It kept reporting boot id $want_new_boot - the same boot this" >&2
        echo "       run started against." >&2
        echo >&2
        echo "The reboot request did not take effect, or the box is taking longer" >&2
        echo "than ${SSH_WAIT}s to shut down and come back. Either way the" >&2
        echo "PHASE=provisioned assertions would have been meaningless: the" >&2
        echo "REQ-SERVER-001 settings only apply on a fresh boot." >&2
        echo >&2
        echo "  * check it can reboot at all: ssh -i $KEY $DEPLOY_USER@$HOST sudo systemctl reboot" >&2
        echo "  * something may be blocking shutdown - a container that will not" >&2
        echo "    stop, or a hung unmount. Look at: journalctl -b -u docker" >&2
        echo "  * if it is simply slow, raise SSH_WAIT (currently ${SSH_WAIT}s)." >&2
        exit 3
    fi
    if [ "$saw_unreadable" = yes ]; then
        echo "ERROR: the box answered SSH within ${SSH_WAIT}s, but $BOOT_ID_PATH" >&2
        echo "       could not be read, so the reboot could not be proved." >&2
        echo "       That file is world-readable on every Linux; if this box is" >&2
        echo "       not, the wait has no signal to work with." >&2
        exit 3
    fi

    # Name both, and say what to do about each - the address and the name fail
    # for unrelated reasons and the fix differs.
    echo "ERROR: nothing answered SSH as $DEPLOY_USER within ${SSH_WAIT}s. Tried:" >&2
    echo "  - $MDNS_NAME (mDNS)" >&2
    if [ -n "$HOST_FALLBACK" ] && [ "$HOST_FALLBACK" != "$MDNS_NAME" ]; then
        echo "  - $HOST_FALLBACK (HOST, as supplied)" >&2
    else
        echo "  - no fallback address: HOST was not set" >&2
    fi
    echo >&2
    echo "If the box is on:" >&2
    echo "  * find its current address in the router's DHCP lease table - the" >&2
    echo "    lease moves on every boot, so an address from an earlier run is" >&2
    echo "    probably stale - and re-run with HOST=<that address>." >&2
    echo "  * if $MDNS_NAME never resolves from this machine, mDNS is not" >&2
    echo "    crossing the network (wifi client isolation, or two subnets)." >&2
    echo "    Check with: ping -c1 $MDNS_NAME" >&2
    echo "If it is not on, or never finished installing, there is nothing to" >&2
    echo "reach - see metal/README.md, 'Where this is likely to go wrong'." >&2
    exit 3
}

#------------------------------------------------------------------------------
# Provision
#------------------------------------------------------------------------------
FIRSTBOOT_RC=0
BOOT_ID_BEFORE=""

if [ "$MODE" != assert ]; then
    wait_for_ssh ""

    # REQ-SERVER-004, #285. Assert what the INSTALLER produced, before
    # postinstall.sh has a chance to repair it.
    #
    # This is the only moment the distinction is observable. postinstall.sh
    # fixes the hostname and installs mDNS, so every assertion that runs after
    # it passes whether the install was right or not - which is how a box that
    # came up as `192` went unnoticed. The result is recorded and reported at
    # the end rather than aborting here, because a repair run is a legitimate
    # reason to be pointed at a box that is already wrong; the exit code still
    # goes red so it cannot be mistaken for a clean install.
    log "asserting first boot (before postinstall)"
    sshto "EXPECT_HOSTNAME='$SERVER_NAME' DEPLOY_USER='$DEPLOY_USER' PHASE=firstboot bash -s" \
        < "$GEN_DIR/vm/assert.sh" || FIRSTBOOT_RC=$?
    if [ "$FIRSTBOOT_RC" -ne 0 ]; then
        echo >&2
        echo "  ################################################################" >&2
        echo "  # THE INSTALL IS WRONG, NOT THE PROVISIONING." >&2
        echo "  #" >&2
        echo "  # postinstall.sh will now repair this box and the assertions" >&2
        echo "  # after it will very likely pass. Do not read that as a fix." >&2
        echo "  # Something in the preseed, the generated overrides.cfg or the" >&2
        echo "  # installer boot line is not taking effect - see REQ-SERVER-004" >&2
        echo "  # and the notes in preseed/preseed.cfg." >&2
        echo "  ################################################################" >&2
        echo >&2
    fi

    # Streamed over stdin rather than fetched by the box from the HTTP server:
    # one less thing that has to still be running, and it provisions the script
    # in this checkout rather than whatever was served earlier.
    log "running postinstall.sh"
    sshto "sudo SERVER_NAME='$SERVER_NAME' DEPLOY_USER='$DEPLOY_USER' bash -s" \
        < "$GEN_DIR/scripts/postinstall.sh"

    if [ "$MODE" = noreboot ]; then
        log "postinstall done; skipping reboot and assertions (--no-reboot)"
        log "REQ-SERVER-001 only takes effect after a reboot"
        exit 0
    fi

    # REQ-SERVER-001 is asserted after a reboot because that is when the logind
    # drop-in takes effect. postinstall.sh deliberately does not restart logind:
    # doing so would kill this SSH session mid-run.
    # Read the boot id BEFORE asking for the reboot - #295. Nothing after this
    # point may treat a live SSH socket as proof the box went down; only a boot
    # id different from this one is.
    BOOT_ID_BEFORE="$(sshto "cat $BOOT_ID_PATH" 2> /dev/null || true)"
    if [ -n "$BOOT_ID_BEFORE" ]; then
        log "boot id before reboot: $BOOT_ID_BEFORE"
    else
        log "WARNING: could not read $BOOT_ID_PATH before the reboot."
        log "         The wait below cannot prove the box rebooted, so a slow"
        log "         shutdown may let the PHASE=provisioned assertions run"
        log "         against the pre-reboot system. See #295."
    fi

    log "rebooting to apply boot-time settings"
    sshto "sudo systemctl reboot" 2> /dev/null || true

    # Not load-bearing any more: the boot id decides whether the box is back.
    # It only saves a first polling round against a box that is certainly
    # still up.
    sleep 10
fi

#------------------------------------------------------------------------------
# Assert - the same script the VM runs, with this box's own expectations
#------------------------------------------------------------------------------
# BOOT_ID_BEFORE is empty in --assert mode (no reboot was asked for, so there is
# nothing to prove) and empty if the read above failed.
wait_for_ssh "$BOOT_ID_BEFORE"
log "asserting"
# `|| rc=$?`, not a bare call followed by `rc=$?`: under `set -e` a failing
# assertion would exit here before the code could be captured, and the script
# would report nothing at all rather than "an assertion failed".
rc=0
sshto "EXPECT_HOSTNAME='$SERVER_NAME' DEPLOY_USER='$DEPLOY_USER' PHASE=provisioned bash -s" \
    < "$GEN_DIR/vm/assert.sh" || rc=$?

# A green provisioned run on top of a red first-boot run is not a pass. It is
# the #285 shape exactly: correct end state, wrong install, and the difference
# invisible unless something says so out loud.
if [ "$rc" -eq 0 ] && [ "$FIRSTBOOT_RC" -ne 0 ]; then
    echo >&2
    log "FAIL - the box is correct NOW, but the installer did not make it so."
    log "       postinstall.sh repaired it. See the first-boot section above."
    rc=1
fi

if [ "$rc" -eq 0 ]; then
    log "PASS - $HOST satisfies every REQ-SERVER-*"
    echo
    echo "  ssh -i $KEY $DEPLOY_USER@$HOST"
    echo
fi
exit "$rc"
