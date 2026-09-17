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

die() { echo "ERROR: $*" >&2; exit 1; }
log() { echo "[metal] $*"; }

#------------------------------------------------------------------------------
# Configuration comes from an untracked file, never from the repository.
#
# Parsed literally, NOT sourced. `. .env` runs the file as shell, which expands
# anything in it - and a sha512-crypt hash is full of '$'. Sourcing a correct
# .env therefore failed on the very first use with "line 12: $6: unbound
# variable", because the shell read $6 as a positional parameter. Quoting the
# value works but is a foot-gun in a file whose main value always contains '$'.
#
# Values are taken verbatim: no expansion, no command substitution, and an
# unrecognised key is an error rather than a setting that silently does
# nothing.
#------------------------------------------------------------------------------
[ -f "$ENV_FILE" ] || die "no $ENV_FILE. Copy .env.example to .env and fill it in."

read_env() {
    local line key val lineno=0
    while IFS= read -r line || [ -n "$line" ]; do
        lineno=$((lineno + 1))
        line="${line%$'\r'}"                       # tolerate CRLF
        case "$line" in '' | '#'*) continue ;; esac
        case "$line" in *=*) : ;; *) die "$ENV_FILE line $lineno: not KEY=VALUE: $line" ;; esac

        key="${line%%=*}"; val="${line#*=}"
        key="${key#"${key%%[![:space:]]*}"}"       # trim
        key="${key%"${key##*[![:space:]]}"}"
        key="${key#export }"

        # Strip one layer of surrounding quotes, so a .env written either way
        # behaves the same.
        case "$val" in
            \'*\') val="${val#\'}"; val="${val%\'}" ;;
            \"*\") val="${val#\"}"; val="${val%\"}" ;;
        esac

        case "$key" in
            DEPLOY_USER)      DEPLOY_USER="$val" ;;
            SERVER_NAME)      SERVER_NAME="$val" ;;
            PASSWORD_CRYPTED) PASSWORD_CRYPTED="$val" ;;
            WIFI_SSID)        WIFI_SSID="$val" ;;
            WIFI_PASS)        WIFI_PASS="$val" ;;
            WIFI_IFACE)       WIFI_IFACE="$val" ;;
            SSH_KEY)          SSH_KEY="$val" ;;
            *) die "$ENV_FILE line $lineno: unknown key '$key'. See .env.example." ;;
        esac
    done < "$ENV_FILE"
}
read_env

DEPLOY_USER="${DEPLOY_USER:-srv}"
SERVER_NAME="${SERVER_NAME:-debbie}"

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
lan_ip() {
    local dev
    case "$(uname -s)" in
        Darwin)
            dev="$(route -n get default 2> /dev/null | awk '/interface:/{print $2}')"
            [ -n "$dev" ] && ipconfig getifaddr "$dev" 2> /dev/null && return 0
            ;;
        *)
            dev="$(ip route show default 2> /dev/null | awk '/default/{print $5; exit}')"
            [ -n "$dev" ] && ip -4 -o addr show "$dev" 2> /dev/null \
                | awk '{split($4,a,"/"); print a[1]; exit}' && return 0
            ;;
    esac
    return 1
}

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

IFACE_ARG=""
if [ -n "${WIFI_IFACE:-}" ]; then
    IFACE_ARG=" netcfg/choose_interface=$WIFI_IFACE"
fi

cat <<EOF

  serving $HTTP_ROOT on http://$IP:$PORT  (verified reachable)

  At the installer boot menu, highlight "Install", press TAB (or 'e' under
  UEFI GRUB) to edit the kernel line, and append:

    auto=true priority=critical url=http://$IP:$PORT/preseed.cfg$IFACE_ARG \\
      netcfg/wireless_show_essids=manual \\
      netcfg/wireless_essid=$WIFI_SSID \\
      netcfg/wireless_security_type=wpa \\
      netcfg/wireless_wpa=$WIFI_PASS

  Notes, each of which has cost somebody an evening:
    - wireless_security_type=wpa is correct for WPA2. The select's values are
      'wep/open' and 'wpa'; there is no 'wpa2'.
    - wireless_show_essids=manual is a SEPARATE prompt from the ESSID. Without
      it the installer stops and offers a scanned list.
    - The passphrase is on the boot line and never in the repository.

  After the install the box powers off (the preseed ends in poweroff, so that
  "did it finish?" is answerable without watching). Power it back on, then:

    ssh -i $KEY $DEPLOY_USER@$SERVER_NAME.local
    curl -fsSL http://$IP:$PORT/postinstall.sh | sudo bash

  Ctrl-C to stop serving.

EOF

wait "$HTTP_PID"
