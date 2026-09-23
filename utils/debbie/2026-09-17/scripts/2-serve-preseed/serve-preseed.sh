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
# No default - REQ-SERVER-014. A default name would install a second machine
# with the name of a live one.
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
# SSH key: the admin key, so every machine trusts the same key.
#------------------------------------------------------------------------------
mkdir -p "$WORK"
# The PUBLIC half of the admin key, committed beside the payload -
# REQ-SERVER-008. This step makes no key. A key made for each checkout would
# lock a new clone out of every machine that an older clone built, and the
# installer needs only the public half.
ADMIN_PUBKEY="${ADMIN_PUBKEY:-$GEN_DIR/payload/seanorepo-admin.pub}"

# SSH_KEY is accepted so that older <machine>.env files parse (read_env
# rejects an unknown key), but this step does not use it. The key it installs
# is the committed admin public key above.
[ -z "${SSH_KEY:-}" ] || warn "SSH_KEY is set in $ENV_FILE and ignored here. This step installs $ADMIN_PUBKEY. 3-provision reads SSH_KEY, to choose the private key to log in with."
[ -s "$ADMIN_PUBKEY" ] || die "no admin public key at $ADMIN_PUBKEY.
       Every machine this installs trusts that key and nothing else, so an
       install without it produces a machine nobody can log in to - sshd
       refuses passwords (REQ-SERVER-008). Create one and commit the .pub:
         ssh-keygen -t ed25519 -C sean-admin -f ~/.ssh/seanorepo-admin
         cp ~/.ssh/seanorepo-admin.pub $ADMIN_PUBKEY"

#------------------------------------------------------------------------------
# The served directory, with the same layout as the harness's
#------------------------------------------------------------------------------
HTTP_ROOT="$WORK/http"
mkdir -p "$HTTP_ROOT"
cp "$GEN_DIR/payload/preseed.cfg" "$HTTP_ROOT/preseed.cfg"

# No CONSOLE here: the target machine has no serial port (see write_overrides).
SSH_PUBKEY_FILE="$ADMIN_PUBKEY" write_overrides > "$HTTP_ROOT/overrides.cfg"

#------------------------------------------------------------------------------
# Which address the target fetches from. The harness's loopback address does
# not work here: the installer is on another machine.
#------------------------------------------------------------------------------
IP="${SERVE_IP:-$(lan_ip || true)}"
[ -n "$IP" ] || die "could not find this machine's LAN address. Set SERVE_IP=x.x.x.x and run again."

#------------------------------------------------------------------------------
# Serve
#------------------------------------------------------------------------------
( cd "$HTTP_ROOT" && exec python3 -m http.server "$PORT" --bind 0.0.0.0 > /dev/null 2>&1 ) &
HTTP_PID=$!
trap 'kill "$HTTP_PID" 2>/dev/null || true' EXIT
sleep 1
kill -0 "$HTTP_PID" 2> /dev/null || die "could not serve on :$PORT - is something already using it?"

# Prove that it is reachable on the LAN address, not only on loopback.
# Otherwise a macOS firewall prompt that nobody clicked shows up halfway
# through an install, as a hang.
curl -fsS --max-time 5 "http://$IP:$PORT/preseed.cfg" > /dev/null \
    || die "serving on :$PORT, but http://$IP:$PORT/preseed.cfg is not reachable. Allow incoming connections for python3 (System Settings > Network > Firewall) and run again."

PARAMS="$(installer_params "http://$IP:$PORT/preseed.cfg")"

cat <<EOF

  serving $HTTP_ROOT on http://$IP:$PORT  (verified reachable)

  If you built an ISO with build-iso.sh, there is nothing to type: the
  automated entry is the default and boots after 5 seconds. Boot the stick.

  Otherwise, at the installer GRUB menu highlight "Install", press 'e', put the
  cursor at the end of the "linux" line, move it back to just before " --- quiet"
  and insert:

    $PARAMS

  Then press Ctrl-X from inside the editor. Esc or Enter discards the edit,
  and that looks the same as params that do not work.

  Two things are necessary:
    - The params go BEFORE the '---'. After it, the installer copies them into
      the bootloader of the installed system, and the passphrase stays on
      its disk.
    - The wifi values are mandatory, not a convenience. priority=critical
      suppresses the prompt, so netcfg takes an empty passphrase and fails
      with "either too long or too short", which blames the password.

  After the install, the machine powers off. The preseed ends in poweroff, so
  you can tell that it finished without watching. Power it on, then:

    ./scripts/3-provision/provision.sh <machine>

  Ctrl-C to stop serving.

EOF

wait "$HTTP_PID"
