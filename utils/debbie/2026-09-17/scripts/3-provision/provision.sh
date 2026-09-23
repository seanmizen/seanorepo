#!/bin/bash
# provision.sh: connects to an installed target machine over SSH, configures it
# with setup-server-environment.sh, and checks the result with assert.sh.
#
# Where: your computer. It connects to <SERVER_NAME>.local.
# When:  after the step 2 install, when you power the target machine on again.
#        Run it again whenever the target's configuration or roles must change.
#
# What happens:
#   1. assert.sh checks what the installer produced (PHASE=firstboot).
#   2. It sends setup-server-environment.sh to the target, which runs it as root.
#   3. The target reboots. A new boot id proves that it did (REQ-SERVER-001).
#   4. assert.sh checks the configured target (PHASE=provisioned).
#
# Why:   one command runs the full sequence the same way every time. Step 1
#        exists because setup-server-environment.sh can repair an install
#        fault and so hide it (REQ-SERVER-004), for example a machine named
#        `192`.
#
# Usage:
#   ./provision.sh <machine>               steps 1 to 4
#   ./provision.sh <machine> --assert      step 4 only, no changes
#   ./provision.sh <machine> --no-reboot   steps 1 and 2 only
#   HOST=<ip> ./provision.sh <machine>     use <ip> if <name>.local does not resolve
#
# It connects by name first because the DHCP address changes on each boot
# (REQ-SERVER-004).
#
# Exit codes (the same as test-vm.sh, REQ-EMU-003):
#   0   every check passed
#   1   a check failed
#   3   the target did not come back, or came back without rebooting
set -euo pipefail
IFS=$'\n\t'

HERE="$(cd "$(dirname "$0")" && pwd)"     # this step's folder: its env files
SCRIPTS="$(dirname "$HERE")"
GEN_DIR="$(dirname "$SCRIPTS")"
WORK="$GEN_DIR/working"                          # shared by all three steps
# shellcheck source=../lib.sh
. "$SCRIPTS/lib.sh"

select_env "$HERE" "${1:-}"
shift
read_env SERVER_NAME DEPLOY_USER SSH_KEY ROLE_WEBSERVER ROLE_TUNNEL
DEPLOY_USER="${DEPLOY_USER:-srv}"
# No default - REQ-SERVER-014. With a default, a forgotten line would make a
# NEW machine claim the name of a live one, and this script would dial the
# live one.
SERVER_NAME="${SERVER_NAME:-}"
[ -n "$SERVER_NAME" ] || die "SERVER_NAME is not set in $ENV_FILE. It has no default - name every machine on purpose."
# The admin key - REQ-SERVER-008. A machine that this generation installs
# trusts it and nothing else. Set SSH_KEY in the env file to reach a machine
# that has a different key.
KEY="${SSH_KEY:-$HOME/.ssh/seanorepo-admin}"
SSH_WAIT="${SSH_WAIT:-300}"

#------------------------------------------------------------------------------
# Where to dial, in order of preference, not one pinned address.
#
# HOST is the FALLBACK, for when mDNS does not reach this machine. The name
# goes first, because it is the only handle that survives the reboot in the
# middle of this script: the DHCP lease can move, the name does not. Nothing
# here caches a resolved address, so each wait decides again from this list,
# and a machine that comes back on a different address is still found.
#
# The fallback matters. The assertion that `$SERVER_NAME.local resolves` asks
# the MACHINE'S OWN resolver, because QEMU's slirp carries no multicast. So no
# green run proves that your computer can hear the name. If mDNS does not cross
# a network, the supplied address saves the run. Every round tries every
# candidate, so the address is tried within seconds, not after the full
# SSH_WAIT.
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

[ -f "$KEY" ] || die "no SSH key at $KEY. Was this machine installed by this checkout's serve-preseed.sh?"

# A key with a passphrase cannot load in batch mode (below), so it works only
# when an ssh-agent holds it. Check that here. Without the check, the machine
# refuses the key on every attempt, and the wait reports that as a machine that
# does not answer.
if ! ssh-keygen -y -P '' -f "$KEY" > /dev/null 2>&1; then
    key_fp="$(ssh-keygen -lf "$KEY" 2> /dev/null | awk '{ print $2 }')"
    if [ -z "$key_fp" ] || ! ssh-add -l 2> /dev/null | grep -qF "$key_fp"; then
        die "$KEY has a passphrase, and no ssh-agent holds it. provision.sh runs ssh in batch mode, which cannot ask for a passphrase. Load the key into an agent, then run provision.sh again:
    eval \"\$(ssh-agent -s)\"
    ssh-add $KEY"
    fi
fi

# BatchMode, so a missing key fails at once and does not prompt for a password
# that does not exist: the account accepts keys only.
SSH_OPTS=(-i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=no
          -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR
          -o ConnectTimeout=5)

sshto() { ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$HOST" "$@"; }

# The error output of the last ssh in the wait, so that a refused key is not
# reported as a machine that does not answer.
SSH_ERR="$(mktemp)"
trap 'rm -f "$SSH_ERR"' EXIT

# stop_if_refused CANDIDATE: exit when the last ssh to CANDIDATE failed on
# authentication. The machine answered, so a longer wait does not help, and the
# advice about leases and mDNS does not apply.
stop_if_refused() {
    grep -q 'Permission denied' "$SSH_ERR" || return 0
    echo >&2
    echo "ERROR: $1 answered SSH, but refused the key $KEY." >&2
    echo "  * check the key by hand: ssh -i $KEY $DEPLOY_USER@$1" >&2
    echo "  * a key with a passphrase works only from an ssh-agent: ssh-add $KEY" >&2
    echo "  * the machine trusts payload/seanorepo-admin.pub. Check that $KEY is" >&2
    echo "    its private half, or set SSH_KEY in $ENV_FILE." >&2
    exit 3
}

#------------------------------------------------------------------------------
# Send payload/ and services/ as one tar, then run one script from it.
#
# The systemd units are files under services/, and they must travel with the
# script that installs them. The machine's own checkout tracks `release`
# (REQ-DEPLOY-001), so it does not have a unit that is on a feature branch.
#
# One tar and one connection. The remote temp directory is removed whether the
# script passes or fails.
#------------------------------------------------------------------------------
send_and_run() {
    local script="$1" envs="$2"
    tar czf - -C "$GEN_DIR" payload services \
        | sshto "d=\$(mktemp -d) \
            && tar xzf - -C \"\$d\" \
            && sudo $envs bash \"\$d/payload/$script\"; \
            rc=\$?; rm -rf \"\$d\"; exit \$rc"
}

#------------------------------------------------------------------------------
# The boot id.
#
# /proc/sys/kernel/random/boot_id is a random UUID that the kernel makes once
# for each boot. It changes on a boot and on nothing else. So it is the one
# thing a script can read to tell "the machine came back" apart from "the
# machine has not finished its shutdown".
#
# The script reads it over the SAME connection path as everything else, and
# the check uses the VALUE, never the candidate that answered. The machine can
# come back on a different address, so the address proves nothing. Two
# addresses that report the same boot id are one machine that did not reboot.
# One address that reports a new boot id is a machine that did.
#------------------------------------------------------------------------------
BOOT_ID_PATH=/proc/sys/kernel/random/boot_id

boot_id_of() { ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$1" "cat $BOOT_ID_PATH" 2> "$SSH_ERR"; }

# Try every candidate on every round, not the whole deadline on the first one.
# A name that does not resolve fails in milliseconds, and a dead address fails
# in ConnectTimeout. So the whole list costs a few seconds for each round. The
# fallback is then tried at once, not five minutes later, which is the same as
# never on a run that someone watches.
#
# With an argument, that argument is the boot id from BEFORE the reboot, and a
# candidate satisfies the wait only if it reports a DIFFERENT one. A connection
# that answers with the same boot id is the system before the reboot, which is
# up because a clean shutdown with Docker containers to stop takes longer than
# any fixed sleep. Polling continues. If that connection ended the wait, the
# PHASE=provisioned assertions would run against a machine that did not reboot:
# `lid close ignored` and `sleep.target masked` (REQ-SERVER-001) would go red on
# a machine that is fine, and a second run would appear to fix it.
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
                # No reboot to prove: any answer satisfies the wait.
                if ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$cand" true 2> "$SSH_ERR"; then
                    HOST="$cand"
                    log "up on $HOST"
                    return 0
                fi
                stop_if_refused "$cand"
                continue
            fi

            id="$(boot_id_of "$cand")" || { stop_if_refused "$cand"; continue; }
            if [ -z "$id" ]; then
                # It answered, but did not say which boot it is. That is no
                # proof either way, so keep waiting, and report it if the
                # deadline passes.
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
        # A different failure with a different fix. The machine was reachable
        # the whole time, so the mDNS and lease advice below does not apply.
        echo "ERROR: the machine answered SSH within ${SSH_WAIT}s, but never rebooted." >&2
        echo "       It kept reporting boot id $want_new_boot - the same boot this" >&2
        echo "       run started against." >&2
        echo >&2
        echo "The reboot request had no effect, or the machine takes longer than" >&2
        echo "${SSH_WAIT}s to shut down and come back. Either way, the" >&2
        echo "PHASE=provisioned assertions would prove nothing: the" >&2
        echo "REQ-SERVER-001 settings apply only after a new boot." >&2
        echo >&2
        echo "  * check that it can reboot: ssh -i $KEY $DEPLOY_USER@$HOST sudo systemctl reboot" >&2
        echo "  * something may block the shutdown: a container that does not" >&2
        echo "    stop, or a hung unmount. Look at: journalctl -b -u docker" >&2
        echo "  * if it is only slow, increase SSH_WAIT (it is ${SSH_WAIT}s)." >&2
        exit 3
    fi
    if [ "$saw_unreadable" = yes ]; then
        echo "ERROR: the machine answered SSH within ${SSH_WAIT}s, but $BOOT_ID_PATH" >&2
        echo "       could not be read, so the reboot could not be proved." >&2
        echo "       Every Linux lets any user read that file. If this machine does" >&2
        echo "       not, the wait has no signal to use." >&2
        exit 3
    fi

    # Name both, and say what to do about each. The address and the name fail
    # for different reasons, and the fix is different.
    echo "ERROR: nothing answered SSH as $DEPLOY_USER within ${SSH_WAIT}s. Tried:" >&2
    echo "  - $MDNS_NAME (mDNS)" >&2
    if [ -n "$HOST_FALLBACK" ] && [ "$HOST_FALLBACK" != "$MDNS_NAME" ]; then
        echo "  - $HOST_FALLBACK (HOST, as supplied)" >&2
    else
        echo "  - no fallback address: HOST was not set" >&2
    fi
    echo >&2
    echo "If the machine is on:" >&2
    echo "  * find its address in the router's DHCP lease table (the lease can" >&2
    echo "    move on every boot, so an address from an earlier run can be" >&2
    echo "    wrong), and run again with HOST=<that address>." >&2
    echo "  * if $MDNS_NAME never resolves from this machine, mDNS is not" >&2
    echo "    crossing the network (wifi client isolation, or two subnets)." >&2
    echo "    Check with: ping -c1 $MDNS_NAME" >&2
    echo "If it is not on, or the install did not finish, there is nothing to" >&2
    echo "reach. See scripts/README.md, 'Where this is likely to go wrong'." >&2
    exit 3
}

#------------------------------------------------------------------------------
# Provision
#------------------------------------------------------------------------------
FIRSTBOOT_RC=0
BOOT_ID_BEFORE=""

if [ "$MODE" != assert ]; then
    wait_for_ssh ""

    # Check what the installer produced, before setup-server-environment.sh
    # can repair it (REQ-SERVER-004). setup-server-environment.sh fixes the
    # hostname and installs mDNS. After it runs, those checks pass whether the
    # install was right or not. So a fault in the install shows only here.
    #
    # Only on a machine that setup-server-environment.sh has not configured.
    # It creates /etc/seanorepo/roles, so the directory marks a configured
    # machine. On such a machine the install is long past, and a failure here
    # says nothing about it.
    #
    # A failure does not stop the run. A repair run on a broken machine is a
    # valid use of this script. The exit code still goes red, so a repaired
    # machine does not pass for a clean install.
    if sshto "[ -d /etc/seanorepo/roles ]"; then
        log "already provisioned - skipping the first-boot checks"
    else
        log "asserting first boot (before configuration)"
        sshto "EXPECT_HOSTNAME='$SERVER_NAME' DEPLOY_USER='$DEPLOY_USER' PHASE=firstboot bash -s" \
            < "$GEN_DIR/payload/assert.sh" || FIRSTBOOT_RC=$?
    fi
    if [ "$FIRSTBOOT_RC" -ne 0 ]; then
        echo >&2
        echo "  ################################################################" >&2
        echo "  # THE INSTALL IS WRONG. THE PROVISIONING IS NOT AT FAULT." >&2
        echo "  #" >&2
        echo "  # setup-server-environment.sh repairs this machine next, and the" >&2
        echo "  # checks after it will probably pass. That is not a fix." >&2
        echo "  # Something in the preseed, the generated overrides.cfg or the" >&2
        echo "  # installer boot line does not take effect. See REQ-SERVER-004" >&2
        echo "  # and the notes in payload/preseed.cfg." >&2
        echo "  ################################################################" >&2
        echo >&2
    fi

    # Sent over SSH, not fetched by the machine from the HTTP server. So one
    # less thing must be running, and the machine gets the script in this
    # checkout, not a copy that was served earlier.
    # The toolchain first, then the server configuration. Both go the same way
    # and in this order everywhere, because the server script needs Docker,
    # Node and the checkout to be there.
    log "running setup-developer-environment.sh"
    send_and_run "setup-developer-environment.sh" "DEV_USER='$DEPLOY_USER'"

    log "running setup-server-environment.sh"
    # Roles from .env (REQ-SERVER-014). Passed even when empty, so the machine's
    # roles always match this file: a role that is not set here is OFF there.
    log "roles from $ENV_FILE: webserver=${ROLE_WEBSERVER:-unset} tunnel=${ROLE_TUNNEL:-unset}"
    send_and_run "setup-server-environment.sh" \
        "SERVER_NAME='$SERVER_NAME' DEPLOY_USER='$DEPLOY_USER' ROLE_WEBSERVER='${ROLE_WEBSERVER:-}' ROLE_TUNNEL='${ROLE_TUNNEL:-}'"

    if [ "$MODE" = noreboot ]; then
        log "setup done. Skipping the reboot and the assertions (--no-reboot)."
        log "REQ-SERVER-001 has effect only after a reboot."
        exit 0
    fi

    # The script asserts REQ-SERVER-001 after a reboot, because the logind
    # drop-in has effect only then. setup-server-environment.sh deliberately
    # does not restart logind: that would stop this SSH session mid-run.
    # Read the boot id BEFORE the reboot request. After this point, a live SSH
    # socket is no proof that the machine went down. Only a boot id different
    # from this one is.
    BOOT_ID_BEFORE="$(sshto "cat $BOOT_ID_PATH" 2> /dev/null || true)"
    if [ -n "$BOOT_ID_BEFORE" ]; then
        log "boot id before reboot: $BOOT_ID_BEFORE"
    else
        log "WARNING: could not read $BOOT_ID_PATH before the reboot."
        log "         The wait below cannot prove that the machine rebooted, so"
        log "         after a slow shutdown the PHASE=provisioned assertions can"
        log "         run against the system from before the reboot."
    fi

    log "rebooting to apply boot-time settings"
    sshto "sudo systemctl reboot" 2> /dev/null || true

    # Not necessary: the boot id decides whether the machine is back. The sleep
    # only saves a first polling round against a machine that is certainly up.
    sleep 10
fi

#------------------------------------------------------------------------------
# Assert - the same script the VM runs, with this machine's own expectations
#------------------------------------------------------------------------------
# BOOT_ID_BEFORE is empty in --assert mode (no reboot was asked for, so there is
# nothing to prove) and empty if the read above failed.
wait_for_ssh "$BOOT_ID_BEFORE"
log "asserting"
# `|| rc=$?`, not a bare call followed by `rc=$?`. Under `set -e`, a failing
# assertion would exit here before the script could capture the code, and the
# script would report nothing, not "an assertion failed".
rc=0
# EXPECT_ROLES, built the same way as in test-vm.sh. assert.sh reads it to
# check /etc/seanorepo/roles against the roles asked for, and an unset value
# means "no roles". Without it, every machine provisioned WITH a role would
# fail that check with a correct configuration.
EXPECT_ROLES="$( { [ "${ROLE_WEBSERVER:-}" = yes ] && echo webserver; [ "${ROLE_TUNNEL:-}" = yes ] && echo tunnel; true; } | tr '\n' ' ' | sed 's/ $//')"

sshto "EXPECT_HOSTNAME='$SERVER_NAME' DEPLOY_USER='$DEPLOY_USER' EXPECT_ROLES='$EXPECT_ROLES' PHASE=provisioned bash -s" \
    < "$GEN_DIR/payload/assert.sh" || rc=$?

# A green provisioned run after a red first-boot run is not a pass. The end
# state is correct and the install is wrong, and nobody sees the difference
# unless something reports it.
if [ "$rc" -eq 0 ] && [ "$FIRSTBOOT_RC" -ne 0 ]; then
    echo >&2
    log "FAIL - the machine is correct now, but the installer did not make it so."
    log "       setup-server-environment.sh repaired it. See the first-boot section above."
    rc=1
fi

if [ "$rc" -eq 0 ]; then
    log "PASS - $HOST satisfies every REQ-SERVER-*"
    echo
    echo "  ssh -i $KEY $DEPLOY_USER@$HOST"
    echo
fi
exit "$rc"
