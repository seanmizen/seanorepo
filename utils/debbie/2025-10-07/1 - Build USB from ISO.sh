#!/bin/bash
# 
# Bootstrap script to create a bootable Debian installer USB drive
#
# Usage: ./bootstrap-1.sh [diskN]
#
# CLI Arguments:
#   diskN - The disk identifier for the target USB drive (e.g., disk4)
#           If not provided, defaults to 'disk4'
#           The script will write to /dev/diskN and /dev/rdiskN
#
# Example:
#   ./bootstrap-1.sh disk5
#   ./bootstrap-1.sh        # Uses default: disk4
#
set -e

ISO=debian-13.1.0-amd64-netinst.iso
PRESEED=preseed-1.cfg
WORKDIR=working
IMGDIR=$WORKDIR/images
ISODIR=$WORKDIR/iso
OUTPUT_ISO=debbie.iso
USB_DRIVE=${1:-disk4}  # Default to disk4 if no argument provided

# clean up any bad perms from previous runs
# sudo mkdir -p "$WORKDIR"
# sudo chown -R "$USER" "$WORKDIR"
rm -rf "$ISODIR"

mkdir -p "$IMGDIR" "$ISODIR"

# Download ISO if missing
if [ ! -f "$IMGDIR/$ISO" ]; then
  echo "ISO not found. Downloading..."
  curl -Lo "$IMGDIR/$ISO" "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/$ISO"
fi

# Extract ISO contents
echo "Extracting ISO..."
# 7z x "$IMGDIR/$ISO" -o"$ISODIR" >/dev/null
xorriso -osirrox on -indev "$IMGDIR/$ISO" -extract / "$ISODIR"
chmod -R u+rw "$ISODIR"

# Inject preseed into initrd
echo "Injecting preseed into initrd..."
INITRD="$ISODIR/install.amd/initrd.gz"
gunzip "$INITRD"
cpio_dir=$WORKDIR/initrd
mkdir -p "$cpio_dir"
cd "$cpio_dir"
# cpio -id --no-absolute-filenames --no-preserve-owner 2>/dev/null
cpio -id < ../iso/install.amd/initrd
cp "../../$PRESEED" ./preseed.cfg
find . | cpio -o -H newc | gzip > "../iso/install.amd/initrd.gz"
cd - >/dev/null

# Rebuild ISO
echo "Rebuilding ISO..."
xorriso -as mkisofs -o "$OUTPUT_ISO" \
  -c isolinux/boot.cat \
  -b isolinux/isolinux.bin \
  -no-emul-boot -boot-load-size 4 -boot-info-table \
  "$ISODIR"

# Confirm USB drive
echo "Using USB drive: /dev/$USB_DRIVE"

diskutil unmountDisk "/dev/$USB_DRIVE"
sudo dd if="$OUTPUT_ISO" of="/dev/r$USB_DRIVE" bs=1m status=progress
diskutil eject "/dev/$USB_DRIVE"

echo "USB installer written to /dev/$USB_DRIVE"
