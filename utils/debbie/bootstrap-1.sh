#!/bin/bash
set -e

ISO=debian-12.10.0-amd64-netinst.iso
PRESEED=preseed-1.cfg
RAM=2048
CPUS=2

WORKDIR=working
IMGDIR=$WORKDIR/images
MNTDIR=$WORKDIR/mounts

KERNEL=$WORKDIR/linux
INITRD=$WORKDIR/initrd.gz
DISK=$WORKDIR/debbie.img

mkdir -p "$IMGDIR"
rm -rf "$MNTDIR"
mkdir -p "$MNTDIR"

# Download ISO if missing
if [ ! -f "$IMGDIR/$ISO" ]; then
  echo "ISO not found. Downloading..."
  curl -Lo "$IMGDIR/$ISO" "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/$ISO"
fi

# Extract kernel/initrd from ISO using xorriso
if [ ! -f "$KERNEL" ] || [ ! -f "$INITRD" ]; then
  echo "Extracting kernel and initrd..."
  xorriso -osirrox on -indev "$IMGDIR/$ISO" -extract /install.amd/vmlinuz "$KERNEL"
  xorriso -osirrox on -indev "$IMGDIR/$ISO" -extract /install.amd/initrd.gz "$INITRD"
fi

[ -f "$DISK" ] || qemu-img create -f qcow2 "$DISK" 20G

# Start Python HTTP server in background to serve preseed file
python3 -m http.server 8000 >/dev/null 2>&1 &
HTTP_PID=$!
trap "kill $HTTP_PID" EXIT

qemu-system-x86_64 \
  -D log.txt \
  -m $RAM \
  -smp cpus=$CPUS \
  -hda "$DISK" \
  -kernel "$KERNEL" \
  -initrd "$INITRD" \
  -vga std \
  -cdrom "$IMGDIR/$ISO" \
  -fsdev local,id=fsdev0,path=.,security_model=none \
  -device virtio-9p-pci,fsdev=fsdev0,mount_tag=hostshare \
  -netdev user,id=net0,hostfwd=tcp::2222-:22 \
  -device e1000,netdev=net0 \
  -append "auto=true priority=critical preseed/url=http://10.0.2.2:8000/$PRESEED" \
  -no-reboot \

  # -nographic \
  # -no-reboot \
