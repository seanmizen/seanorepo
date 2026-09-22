#!/bin/bash
# serve-preseed.sh: serves the preseed over HTTP while a target machine
# installs Debian from the step 1 USB stick.
#
# Where: your computer, on the same network as the target machine. Step 2 of 3.
# When:  start it first. Then boot the target machine from the USB stick. Keep
#        it running until the install ends and the target powers off.
# Why:   the installer downloads its answers (the preseed) from this server.
#        So a preseed edit needs no new USB stick. It builds the files with
#        the same script as test-vm.sh, so the hardware installs what the VM
#        tested.
#
# Usage:
#   ./serve-preseed.sh <machine>   serve, print the boot line, wait. Ctrl-C stops.
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
PORT="${PORT:-8000}"
read_env SERVER_NAME DEPLOY_USER PASSWORD_CRYPTED WIFI_SSID WIFI_PASS WIFI_IFACE PORT SERVE_IP SSH_KEY

DEPLOY_USER="${DEPLOY_USER:-srv}"
# No default - #329: a forgotten name used to install a second "debbie".
SERVER_NAME="${SERVER_NAME:-}"
[ -n "$SERVER_NAME" ] || die "SERVER_NAME is not set in $ENV_FILE. It has no default - name every machine on purpose."

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
# SSH key. Reuse the deploy key if it exists, so reinstalling the machine does not
# invalidate anything that already trusts it.
#------------------------------------------------------------------------------
mkdir -p "$WORK"
# The admin key's PUBLIC half, committed beside the payload - #369. Nothing is
# generated here any more: a per-checkout keypair meant a fresh clone orphaned
# every machine built from the old one, and the installer only ever needed the
# public half.
ADMIN_PUBKEY="${ADMIN_PUBKEY:-$GEN_DIR/payload/seanorepo-admin.pub}"

# SSH_KEY is still accepted so existing <machine>.env files keep parsing -
# read_env rejects an unknown key - but this step no longer uses it. The key it
# installs is the committed admin public key above.
[ -z "${SSH_KEY:-}" ] || warn "SSH_KEY is set in $ENV_FILE and ignored here since #369. This step installs $ADMIN_PUBKEY. 3-provision still reads SSH_KEY, to choose which private key to log in with."
[ -s "$ADMIN_PUBKEY" ] || die "no admin public key at $ADMIN_PUBKEY.
       Every machine this installs trusts that key and nothing else, so an
       install without it produces a machine nobody can log in to - sshd
       refuses passwords (REQ-SERVER-008). Create one and commit the .pub:
         ssh-keygen -t ed25519 -C sean-admin -f ~/.ssh/seanorepo-admin
         cp ~/.ssh/seanorepo-admin.pub $ADMIN_PUBKEY"

#------------------------------------------------------------------------------
# The served directory - identical in shape to the harness's
#------------------------------------------------------------------------------
HTTP_ROOT="$WORK/http"
mkdir -p "$HTTP_ROOT"
cp "$GEN_DIR/payload/preseed.cfg" "$HTTP_ROOT/preseed.cfg"

# No CONSOLE here: the target machine has no serial port (see write_overrides).
SSH_PUBKEY_FILE="$ADMIN_PUBKEY" write_overrides > "$HTTP_ROOT/overrides.cfg"

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

  After the install the machine powers off (the preseed ends in poweroff, so that
  "did it finish?" is answerable without watching). Power it back on, then:

    ./scripts/3-provision/provision.sh <machine>

  Ctrl-C to stop serving.

EOF

wait "$HTTP_PID"
