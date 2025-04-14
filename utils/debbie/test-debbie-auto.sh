#!/bin/bash
set -e

ISO="debbie-auto.iso"
WORKDIR="working/mounts"
DISK_IMG="$WORKDIR/hda.img"
DISK_SIZE="20G"

mkdir -p "$WORKDIR"

# Create disk image if missing
rm -f "$DISK_IMG"
[ -f "$DISK_IMG" ] || qemu-img create -f qcow2 "$DISK_IMG" "$DISK_SIZE"

# Run QEMU without hardware accel
qemu-system-x86_64 \
  -m 2048 \
  -smp 2 \
  -cdrom "$ISO" \
  -boot d \
  -hda "$DISK_IMG" \
  -netdev user,id=net0 -device e1000,netdev=net0 \
  -display default,show-cursor=on
