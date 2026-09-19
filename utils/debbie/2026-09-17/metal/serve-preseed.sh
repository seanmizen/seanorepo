#!/bin/bash
# serve-preseed.sh - serve the preseed to a real machine, and print the boot
# line that fetches it.
#
# This is the metal counterpart to vm/test-vm.sh. It deliberately does the same
# thing the harness does - generate overrides.cfg with the shared script, serve
# the directory over HTTP - so that what installs on hardware is what was
# proven in the VM.
#
# It does NOT write to a USB stick. The stick is a plain `dd` of an unmodified
# Debian netinst ISO; there is no remaster step and nothing to build. The
# December 2025 attempt died hand-writing a cpio archive to embed a preseed,
# and over HTTP an edit costs nothing and needs no rewrite of the stick.
#
#   ./serve-preseed.sh          serve, print the boot line, wait
#
# Ctrl-C to stop. Re-running after editing the preseed is free - the installer
# re-fetches on the next attempt.
set -euo pipefail
IFS=$'\n\t'

HERE="$(cd "$(dirname "$0")" && pwd)"
GEN_DIR="$(dirname "$HERE")"
WORK="$HERE/work"
ENV_FILE="${ENV_FILE:-$HERE/.env}"
PORT="${PORT:-8000}"

# shellcheck source=lib.sh
. "$HERE/lib.sh"

read_env

DEPLOY_USER="${DEPLOY_USER:-srv}"
# No default - #329: a forgotten name used to install a second "debbie".
SERVER_NAME="${SERVER_NAME:-}"
[ -n "$SERVER_NAME" ] || die "SERVER_NAME is not set in $ENV_FILE. It has no default - name every box on purpose."

[ -n "${PASSWORD_CRYPTED:-}" ] \
    || die "PASSWORD_CRYPTED is not set in $ENV_FILE. Generate one with: openssl passwd -6"
[ -n "${WIFI_SSID:-}" ] || die "WIFI_SSID is not set in $ENV_FILE"
[ -n "${WIFI_PASS:-}" ] || die "WIFI_PASS is not set in $ENV_FILE"

# A hash, not a password. Catches the obvious paste mistake before it becomes
# an account nobody can log into.
case "$PASSWORD_CRYPTED" in
    '$6$'*) : ;;
    *) die "PASSWORD_CRYPTED does not look like a sha512-crypt hash (should start with \$6\$). Generate one with: openssl passwd -6" ;;
esac

#------------------------------------------------------------------------------
# SSH key. Reuse the deploy key if it exists, so reinstalling the box does not
# invalidate anything that already trusts it.
#------------------------------------------------------------------------------
mkdir -p "$WORK"
KEY="${SSH_KEY:-$WORK/id_ed25519}"
if [ ! -f "$KEY.pub" ]; then
    log "generating deploy key $KEY"
    ssh-keygen -t ed25519 -N '' -C "debbie-$SERVER_NAME" -f "$KEY" > /dev/null
fi

#------------------------------------------------------------------------------
# The served directory - identical in shape to the harness's
#------------------------------------------------------------------------------
HTTP_ROOT="$WORK/http"
mkdir -p "$HTTP_ROOT"
cp "$GEN_DIR/preseed/preseed.cfg" "$HTTP_ROOT/preseed.cfg"
cp "$GEN_DIR/scripts/postinstall.sh" "$HTTP_ROOT/postinstall.sh"

# CONSOLE is deliberately not exported: on a laptop, pointing the kernel
# console at a serial port that does not exist is a black screen for the whole
# install. The VM harness sets it; metal must not.
DEPLOY_USER="$DEPLOY_USER" \
SERVER_NAME="$SERVER_NAME" \
SSH_PUBKEY_FILE="$KEY.pub" \
PASSWORD_CRYPTED="$PASSWORD_CRYPTED" \
    "$GEN_DIR/scripts/write-overrides.sh" > "$HTTP_ROOT/overrides.cfg"

#------------------------------------------------------------------------------
# Which address the target should fetch from. The loopback address the harness
# uses is no good here - the installer is on another machine.
#------------------------------------------------------------------------------
IP="${SERVE_IP:-$(lan_ip || true)}"
[ -n "$IP" ] || die "could not work out this machine's LAN address. Set SERVE_IP=x.x.x.x and re-run."

#------------------------------------------------------------------------------
# Serve
#------------------------------------------------------------------------------
( cd "$HTTP_ROOT" && exec python3 -m http.server "$PORT" --bind 0.0.0.0 > /dev/null 2>&1 ) &
HTTP_PID=$!
trap 'kill "$HTTP_PID" 2>/dev/null || true' EXIT
sleep 1
kill -0 "$HTTP_PID" 2> /dev/null || die "could not serve on :$PORT - is something already using it?"

# Prove it is actually reachable on the LAN address, not just on loopback. A
# macOS firewall prompt that nobody clicked is otherwise discovered halfway
# through an install, as a hang.
curl -fsS --max-time 5 "http://$IP:$PORT/preseed.cfg" > /dev/null \
    || die "serving on :$PORT but http://$IP:$PORT/preseed.cfg is not reachable. Allow incoming connections for python3 (System Settings > Network > Firewall) and re-run."

PARAMS="$(installer_params "http://$IP:$PORT/preseed.cfg")"

cat <<EOF

  serving $HTTP_ROOT on http://$IP:$PORT  (verified reachable)

  If you built an ISO with build-iso.sh, there is nothing to type: the
  automated entry is the default and boots after 5 seconds. Just boot it.

  Otherwise, at the installer GRUB menu highlight "Install", press 'e', put the
  cursor at the end of the "linux" line, move it back to just before " --- quiet"
  and insert:

    $PARAMS

  Then Ctrl-X - from inside the editor. Esc or Enter discards the edit, which
  looks identical to the params never having worked.

  Two things that are load-bearing:
    - The params go BEFORE the '---'. After it they are copied into the
      installed system's bootloader, persisting the passphrase on its disk.
    - The wifi values are mandatory, not a convenience. priority=critical
      suppresses the prompt, so netcfg takes an empty passphrase and fails
      with "either too long or too short" - which blames the password.

  After the install the box powers off (the preseed ends in poweroff, so that
  "did it finish?" is answerable without watching). Power it back on, then:

    ssh -i $KEY $DEPLOY_USER@$SERVER_NAME.local
    curl -fsSL http://$IP:$PORT/postinstall.sh | sudo bash

  Ctrl-C to stop serving.

EOF

wait "$HTTP_PID"
