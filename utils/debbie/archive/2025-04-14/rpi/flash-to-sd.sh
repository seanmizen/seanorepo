#!/bin/bash
set -e

IMAGE=debian-pi2.img
DISK_ID=/dev/disk4  # Change if needed

diskutil unmountDisk "$DISK_ID"
# diskutil eraseDisk FAT32 BOOT MBRFormat "$DISK_ID"
sudo dd if="$IMAGE" of="${DISK_ID}" bs=4m conv=fsync
diskutil eject "$DISK_ID"

echo "✅ Image flashed to $DISK_ID"
