#!/bin/bash
# provision.sh - bring a freshly installed box up to debbie, then assert it.
#
# The metal counterpart to the second half of vm/test-vm.sh: run postinstall,
# reboot so the boot-time settings apply, wait for the box to come back, and
# run the same assertions the VM runs.
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
# Exit codes mirror the VM harness - REQ-EMU-003:
#   0   every assertion passed
#   1   an assertion failed
#   3   the box never became reachable over SSH
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
HOST="${HOST:-$SERVER_NAME.local}"
SSH_WAIT="${SSH_WAIT:-300}"

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

die_code() { local c=$1; shift; echo "ERROR: $*" >&2; exit "$c"; }

wait_for_ssh() {
    local deadline=$(( $(date +%s) + SSH_WAIT ))
    log "waiting for $DEPLOY_USER@$HOST"
    while [ "$(date +%s)" -lt "$deadline" ]; do
        if sshto true 2> /dev/null; then log "up"; return 0; fi
        sleep 5
    done
    die_code 3 "$HOST did not come up on SSH within ${SSH_WAIT}s. If the box is on, mDNS may not have settled - set HOST=<ip> and retry."
}

#------------------------------------------------------------------------------
# Provision
#------------------------------------------------------------------------------
if [ "$MODE" != assert ]; then
    wait_for_ssh

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
    log "rebooting to apply boot-time settings"
    sshto "sudo systemctl reboot" 2> /dev/null || true
    sleep 10
fi

#------------------------------------------------------------------------------
# Assert - the same script the VM runs, with this box's own expectations
#------------------------------------------------------------------------------
wait_for_ssh
log "asserting"
# `|| rc=$?`, not a bare call followed by `rc=$?`: under `set -e` a failing
# assertion would exit here before the code could be captured, and the script
# would report nothing at all rather than "an assertion failed".
rc=0
sshto "EXPECT_HOSTNAME='$SERVER_NAME' DEPLOY_USER='$DEPLOY_USER' bash -s" \
    < "$GEN_DIR/vm/assert.sh" || rc=$?

if [ "$rc" -eq 0 ]; then
    log "PASS - $HOST satisfies every REQ-SERVER-*"
    echo
    echo "  ssh -i $KEY $DEPLOY_USER@$HOST"
    echo
fi
exit "$rc"
