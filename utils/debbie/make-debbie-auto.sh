#!/bin/bash
set -e

ISO_URL="https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-12.10.0-amd64-netinst.iso"
ISO_NAME="debian-12.10.0-amd64-netinst.iso"
WORKDIR="working"
IMGDIR=$WORKDIR/images
EXTRACT_DIR="$WORKDIR/iso_root"
PRESEED="preseed-1.cfg"
OUTPUT_ISO="debbie-auto.iso"

rm -f debbie-auto.iso
mkdir -p "$WORKDIR"
mkdir -p "$IMGDIR"

# Download ISO if needed
[ -f "$IMGDIR/$ISO_NAME" ] || curl -Lo "$IMGDIR/$ISO_NAME" "$ISO_URL"

# Clean extract dir
rm -rf "$EXTRACT_DIR"
mkdir "$EXTRACT_DIR"

# Extract ISO contents
bsdtar -C "$EXTRACT_DIR" -xf "$IMGDIR/$ISO_NAME"

# Make extracted files writable (macOS fix)
chmod -R u+w "$EXTRACT_DIR"

# Copy in preseed file
cp "$PRESEED" "$EXTRACT_DIR/preseed.cfg"

# Prepend GRUB entry
GRUB_CFG="$EXTRACT_DIR/boot/grub/grub.cfg"
TMPGRUB=$(mktemp)
cat > "$TMPGRUB" <<EOF
menuentry "DOTHIS" {
    set gfxpayload=keep
    linux /install.amd/vmlinuz auto=true priority=critical preseed/file=/cdrom/preseed.cfg findiso=/debbie-auto.iso quiet ---
    linux /install.amd/vmlinuz auto=true priority=critical preseed/file=/cdrom/preseed.cfg quiet ---
    initrd /install.amd/initrd.gz
}
EOF
# cat "$TMPGRUB" "$GRUB_CFG" > "${GRUB_CFG}.patched" && mv "${GRUB_CFG}.patched" "$GRUB_CFG"
cat "$GRUB_CFG" "$TMPGRUB" > "${GRUB_CFG}.patched" && mv "${GRUB_CFG}.patched" "$GRUB_CFG"
rm "$TMPGRUB"

# Add required installer marker files
mkdir -p "$EXTRACT_DIR/.disk"
echo "Debian Custom Auto Install CD" > "$EXTRACT_DIR/.disk/info"
touch "$EXTRACT_DIR/.disk/base_installable"
echo "full_cd" > "$EXTRACT_DIR/.disk/cd_type"

# Rebuild ISO (UEFI-only)
xorriso -as mkisofs \
  -o "$OUTPUT_ISO" \
  -V "Debian Custom Auto Install" \
  -e boot/grub/efi.img \
  -no-emul-boot \
  -isohybrid-gpt-basdat \
  "$EXTRACT_DIR"

echo "✅ Built $OUTPUT_ISO"
