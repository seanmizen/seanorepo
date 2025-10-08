#!/bin/bash

set -euo pipefail

ISO="debbie-dvd.iso"
DISK="/dev/disk4"

# # Download ISO if missing
# if [ ! -f "$ISO" ]; then
#   echo "ISO not found. Downloading..."
#   curl -Lo "$ISO" "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/$ISO"
# fi

# Ensure ISO exists
[[ -f "$ISO" ]] || { echo "ISO not found: $ISO"; exit 1; }

# Confirm target is a disk, not a partition
diskutil info "$DISK" > /dev/null || { echo "Disk not found: $DISK"; exit 1; }

echo "Unmounting $DISK..."
diskutil unmountDisk "$DISK"

echo "Writing ISO to $DISK using dd..."
sudo dd if="$ISO" of="$DISK" status=progress
# bs=4m 

echo "Syncing..."
sync

echo "Done. Eject with: diskutil eject $DISK"
