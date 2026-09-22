#!/bin/bash
# build-iso.sh: copies the Debian netinst ISO and adds one target machine's
# boot line to the copy, ready to write to a USB stick.
#
# The boot line is the settings the installer reads the moment it starts:
# wifi, hostname, and the address of the preseed server that step 2 runs.
#
# Where: your computer. Step 1 of 3.
# When:  once per target machine, and again if its boot line changes. A
#        preseed edit needs no new ISO, because step 2 serves the preseed.
# Why:   typing the 200-character boot line at the boot menu failed three
#        times on the first hardware install. We know the values in
#        advance, so a file holds them.
#
# What happens:
#   1. It writes working/debbie-<name>.iso and checks the result.
#   2. It prints the commands to write the ISO to a USB stick.
#   3. You write the stick, start step 2, and boot the target from the stick.
#
# Usage:
#   ./build-iso.sh <machine>                  build the ISO
#   ./build-iso.sh <machine> --show-cmdline   print the boot line and stop
#
# The ISO contains the wifi passphrase in plaintext. working/ is gitignored.
set -euo pipefail
IFS=$'\n\t'

HERE="$(cd "$(dirname "$0")" && pwd)"     # this step's folder: its env files
SCRIPTS="$(dirname "$HERE")"
GEN_DIR="$(dirname "$SCRIPTS")"
WORK="$GEN_DIR/working"                          # shared by all three steps
# shellcheck source=../lib.sh
. "$SCRIPTS/lib.sh"

select_env "$HERE" "${1:-.env}"
shift
PORT="${PORT:-8000}"
read_env SERVER_NAME DEPLOY_USER WIFI_SSID WIFI_PASS WIFI_IFACE PORT SERVE_IP ISO
[ -z "${SERVER_NAME:-}" ] || warn "SERVER_NAME is set in $ENV_FILE and ignored here since #376. One USB installs any machine; step 2 names it. Delete the line, or move this file to $HERE/.env and drop the machine argument."
DEPLOY_USER="${DEPLOY_USER:-srv}"
# No SERVER_NAME here since #376. One USB installs any machine: the name is set
# by step 2, which serves the preseed, and repaired by step 3. The installer
# calls itself debbie-installer for the few minutes it runs.
PORT="${PORT:-8000}"

[ -n "${WIFI_SSID:-}" ] || die "WIFI_SSID is not set in $ENV_FILE"
[ -n "${WIFI_PASS:-}" ] || die "WIFI_PASS is not set in $ENV_FILE"

# netcfg rejects a WPA passphrase outside 8-64 characters, and does it with a
# message that blames the passphrase. Catch it here, where the cause is obvious.
case "${#WIFI_PASS}" in
    [0-7]) die "WIFI_PASS is ${#WIFI_PASS} characters; WPA requires at least 8" ;;
esac
[ "${#WIFI_PASS}" -le 64 ] || die "WIFI_PASS is ${#WIFI_PASS} characters; WPA allows at most 64"

command -v xorriso > /dev/null || die "xorriso not found. macOS: brew install xorriso. Debian: sudo apt install xorriso"

IP="${SERVE_IP:-$(lan_ip || true)}"
[ -n "$IP" ] || die "could not work out this machine's LAN address. Set SERVE_IP in $ENV_FILE."

URL="http://$IP:$PORT/preseed.cfg"
PARAMS="$(installer_params "$URL")"

if [ "${1:-}" = --show-cmdline ]; then
    printf '%s\n' "$PARAMS"
    exit 0
fi

#------------------------------------------------------------------------------
# Source ISO
#------------------------------------------------------------------------------
ISO="${ISO:-}"
if [ -z "$ISO" ]; then
    for c in "$WORK"/debian-*-amd64-netinst.iso "$HOME"/Downloads/debian-*-amd64-netinst.iso; do
        [ -f "$c" ] && { ISO="$c"; break; }
    done
fi
[ -n "$ISO" ] && [ -f "$ISO" ] \
    || die "no source ISO found. Set ISO=/path/to/debian-13.7.0-amd64-netinst.iso in $ENV_FILE."

mkdir -p "$WORK"
OUT="$WORK/debbie-installer.iso"

log "source : $ISO"
log "output : $OUT"
log "url    : $URL"

#------------------------------------------------------------------------------
# Rewrite the two boot menus.
#
# A new entry is prepended and made the default, so it wins without deleting
# anything: every stock entry stays reachable for a manual install.
#
# The params go before '---'. The stock entries put "vga=788 --- quiet" on the
# linux line, so the substitution targets that exact separator.
#------------------------------------------------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

xorriso -osirrox on -indev "$ISO" \
    -extract /boot/grub/grub.cfg "$TMP/grub.cfg" \
    -extract /isolinux/txt.cfg "$TMP/txt.cfg" \
    -extract /md5sum.txt "$TMP/md5sum.txt" > /dev/null 2>&1 \
    || die "could not read the boot configuration out of $ISO - is it a Debian netinst image?"
chmod u+w "$TMP/grub.cfg" "$TMP/txt.cfg" "$TMP/md5sum.txt"

# --- UEFI: GRUB ---------------------------------------------------------------
{
    printf 'set default=0\nset timeout=5\n\n'
    printf "menuentry 'Install debbie - automated, no keystrokes' {\n"
    printf '    set background_color=black\n'
    printf '    linux    /install.amd/vmlinuz %s vga=788 --- quiet\n' "$PARAMS"
    printf '    initrd   /install.amd/initrd.gz\n'
    printf '}\n\n'
    cat "$TMP/grub.cfg"
} > "$TMP/grub.cfg.new"
mv "$TMP/grub.cfg.new" "$TMP/grub.cfg"

# --- BIOS: isolinux -----------------------------------------------------------
# Kept in step so the ISO behaves the same if it is ever booted on a CSM-only
# machine. debbie is UEFI, so this path is untested there but must not be a
# silently different install.
{
    printf 'default debbieauto\n\n'
    printf 'label debbieauto\n'
    printf '\tmenu label ^Install debbie - automated\n'
    printf '\tmenu default\n'
    printf '\tkernel /install.amd/vmlinuz\n'
    printf '\tappend %s vga=788 initrd=/install.amd/initrd.gz --- quiet\n\n' "$PARAMS"
    cat "$TMP/txt.cfg"
} > "$TMP/txt.cfg.new"
mv "$TMP/txt.cfg.new" "$TMP/txt.cfg"

# --- md5sum.txt ---------------------------------------------------------------
# The ISO ships checksums for its own contents, used by the "Check disc for
# defects" menu entry. Leaving them stale would make that entry report
# corruption on a perfectly good disc.
md5_of() {
    if command -v md5sum > /dev/null; then md5sum "$1" | awk '{print $1}';
    else md5 -q "$1"; fi
}
for f in grub.cfg txt.cfg; do
    case "$f" in
        grub.cfg) path="./boot/grub/grub.cfg" ;;
        txt.cfg)  path="./isolinux/txt.cfg" ;;
    esac
    new="$(md5_of "$TMP/$f")"
    # Replace the whole line for this path, whatever its old digest was.
    awk -v p="$path" -v d="$new" '
        { if (substr($0, index($0, "./")) == p) print d "  " p; else print }
    ' "$TMP/md5sum.txt" > "$TMP/md5sum.new" && mv "$TMP/md5sum.new" "$TMP/md5sum.txt"
done

#------------------------------------------------------------------------------
# Rebuild.
#
# `-boot_image any replay` is what makes this work: it reproduces the source
# image's own boot arrangement - the isohybrid MBR, the El Torito catalogue and
# the EFI boot image - rather than trying to describe it again by hand. Without
# it the result is a data ISO that no firmware will boot.
#------------------------------------------------------------------------------
rm -f "$OUT"
xorriso -indev "$ISO" -outdev "$OUT" \
    -boot_image any replay \
    -volid "DEBBIE_INSTALL" \
    -map "$TMP/grub.cfg" /boot/grub/grub.cfg \
    -map "$TMP/txt.cfg" /isolinux/txt.cfg \
    -map "$TMP/md5sum.txt" /md5sum.txt \
    > "$WORK/build-iso.log" 2>&1 \
    || { tail -20 "$WORK/build-iso.log" >&2; die "xorriso failed; see $WORK/build-iso.log"; }

#------------------------------------------------------------------------------
# Prove the result carries what it should, rather than trusting the build.
#------------------------------------------------------------------------------
V="$(mktemp -d)"; trap 'rm -rf "$TMP" "$V"' EXIT
xorriso -osirrox on -indev "$OUT" -extract /boot/grub/grub.cfg "$V/g" > /dev/null 2>&1 \
    || die "built ISO is unreadable"
grep -q "url=$URL" "$V/g" || die "built ISO does not carry the preseed URL"
grep -q "netcfg/wireless_wpa=" "$V/g" || die "built ISO does not carry the wifi passphrase"
grep -q "^set default=0" "$V/g" || die "built ISO does not default to the automated entry"
# The params must precede the separator, or they land on the target's cmdline.
grep -qE "url=[^ ]+ .*--- quiet" "$V/g" || die "params are not before the '---' separator"
xorriso -indev "$OUT" -report_el_torito plain 2>/dev/null | grep -qi "El Torito" \
    || die "built ISO has no El Torito boot catalogue - it would not boot"

SIZE="$(du -h "$OUT" | awk '{print $1}')"
cat <<EOF

  built $OUT ($SIZE)

  Verified: default entry present, preseed URL and wifi params baked in before
  the '---' separator, El Torito catalogue intact.

  Write it, being certain of the disk number - dd takes the whole device:

    diskutil list
    diskutil unmountDisk force /dev/diskN
    sudo dd if=$OUT of=/dev/rdiskN bs=4m

  Then start the preseed server, plug the stick into the target and boot it.
  No keystrokes: the automated entry is the default and boots after 5 seconds.

    2-serve-preseed/serve-preseed.sh <machine>

  This ISO contains your wifi passphrase in plaintext. working/ is gitignored;
  treat the stick as a credential.

EOF
