#!/bin/bash
# 
# Bootstrap script to create a bootable Debian installer USB drive.
# This script formats the specified USB drive as FAT32 for compatibility (your old laptop might need it).
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
ENV_FILE=".env"

# Load environment variables (for WIFI_SSID and WIFI_PASS)
if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs)
else
  echo ".env file not found. Please create one with WIFI_SSID and WIFI_PASS."
  exit 1
fi

if [ -z "$WIFI_SSID" ] || [ -z "$WIFI_PASS" ]; then
  echo "Missing WIFI_SSID or WIFI_PASS in .env file."
  exit 1
fi

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

# Replace placeholders in preseed using .env values
RENDERED_PRESEED="$WORKDIR/preseed-rendered.cfg"
mkdir -p "$WORKDIR"
sed "s|{{WIFI_SSID}}|$WIFI_SSID|g; s|{{WIFI_PASS}}|$WIFI_PASS|g" "$PRESEED" > "$RENDERED_PRESEED"

# Inject preseed into initrd
echo "Injecting preseed into initrd..."
INITRD="$ISODIR/install.amd/initrd.gz"
gunzip "$INITRD"
cpio_dir=$WORKDIR/initrd
mkdir -p "$cpio_dir"
cd "$cpio_dir"
# cpio -id --no-absolute-filenames --no-preserve-owner 2>/dev/null
cpio -id < ../iso/install.amd/initrd
cp "../preseed-rendered.cfg" ./preseed.cfg
find . | cpio -o -H newc | gzip > "../iso/install.amd/initrd.gz"
cd - >/dev/null

# Prepare USB drive with FAT32
echo "Using USB drive: /dev/$USB_DRIVE"
echo "WARNING: This will erase all data on /dev/$USB_DRIVE"
read -p "Press Enter to continue or Ctrl+C to cancel..."

echo "Partitioning and formatting USB drive as FAT32..."
diskutil unmountDisk "/dev/$USB_DRIVE"
sudo diskutil partitionDisk "/dev/$USB_DRIVE" 1 MBR FAT32 DEBIAN 100%

# Find the partition identifier (should be ${USB_DRIVE}s1)
PARTITION="${USB_DRIVE}s1"

# Mount the partition
echo "Mounting partition..."
MOUNT_POINT="/Volumes/DEBIAN"
if [ ! -d "$MOUNT_POINT" ]; then
  # If auto-mount didn't work, mount manually
  sudo mkdir -p "$MOUNT_POINT"
  sudo mount -t msdos "/dev/$PARTITION" "$MOUNT_POINT" 2>/dev/null || true
fi

# Wait a moment for the mount to complete
sleep 2

# Copy ISO contents to FAT32 partition
echo "Copying installer files to USB drive..."
sudo rsync -av --progress "$ISODIR/" "$MOUNT_POINT/"

# Make bootable - ensure boot flag is set
echo "Setting boot flag..."
sudo fdisk -e "/dev/$USB_DRIVE" > /dev/null 2>&1 <<EOF
f 1
write
quit
EOF

# Sync and unmount
echo "Finalizing USB drive..."
sync
diskutil unmount "/dev/$PARTITION"
diskutil eject "/dev/$USB_DRIVE"

echo "Bootable USB installer created on /dev/$USB_DRIVE (FAT32)"
echo "The USB drive can now be removed. Use it to boot and install Debian."
