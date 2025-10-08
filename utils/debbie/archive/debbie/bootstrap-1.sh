#!/bin/bash
set -e

ISO=debian-12.10.0-amd64-netinst.iso
PRESEED=preseed-1.cfg
WORKDIR=working
IMGDIR=$WORKDIR/images
ISODIR=$WORKDIR/iso
OUTPUT_ISO=debbie.iso
USB_DRIVE=$1  # e.g., disk4

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
if [ -z "$USB_DRIVE" ]; then
  echo "No USB drive specified. Usage: $0 <diskN>"
  exit 1
fi

diskutil unmountDisk "/dev/$USB_DRIVE"
sudo dd if="$OUTPUT_ISO" of="/dev/r$USB_DRIVE" bs=1m status=progress
diskutil eject "/dev/$USB_DRIVE"

echo "USB installer written to /dev/$USB_DRIVE"
