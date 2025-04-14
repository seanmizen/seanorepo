#!/bin/bash
set -e

WORKDIR=working
IMGDIR=$WORKDIR/images
MNTDIR=$WORKDIR/mounts

# INSTALL_ISO=people.debian-amd64-image
INSTALL_ISO=debian-12.10.0-amd64-netinst.iso      # installer ISO (read-only)
WRITE_DISK=$IMGDIR/debbie-prebuilt.qcow2          # writable disk to install Debian onto

RAM=2048
CPUS=2

rm -rf "$WORKDIR"
mkdir -p "$IMGDIR"
mkdir -p "$MNTDIR"

# Download prebuilt ISO if missing
if [ ! -f "$IMGDIR/$INSTALL_ISO" ]; then
  echo "ISO not found. Downloading..."
  curl -Lo "$IMGDIR/$INSTALL_ISO" "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/$INSTALL_ISO"
fi

# create a writable image for installation
qemu-img create -f qcow2 "$WRITE_DISK" 20G

qemu-system-x86_64 \
  -m $RAM \
  -smp cpus=$CPUS \
  -vga std \
  -cdrom "$IMGDIR/$INSTALL_ISO" \
  -hda "$WRITE_DISK" \
  -netdev user,id=net0,hostfwd=tcp::2222-:22 \
  -device e1000,netdev=net0 \
  -no-reboot
