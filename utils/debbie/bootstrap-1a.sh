#!/bin/bash
set -e

RAM=2048
CPUS=2
PRESEED=preseed-1.cfg
WORKDIR=working
IMGDIR=$WORKDIR/images
MNTDIR=$WORKDIR/mounts

rm -rf "$WORKDIR"
mkdir -p "$IMGDIR"
mkdir -p "$MNTDIR"

# Parse target architecture
for arg in "$@"; do
  case $arg in
    --target)
      TARGET_ARCH="$2"
      shift 2
      ;;
    --target=*)
      TARGET_ARCH="${arg#*=}"
      shift
      ;;
  esac
done

# Default to host architecture if not specified
if [ -z "$TARGET_ARCH" ]; then
  case $(uname -m) in
    x86_64) TARGET_ARCH=amd64 ;;
    arm64|aarch64) TARGET_ARCH=arm64 ;;
    *) echo "Unsupported host arch"; exit 1 ;;
  esac
fi

# Per-architecture config
if [ "$TARGET_ARCH" = "amd64" ]; then
  QEMU_BIN="qemu-system-x86_64"
  ISO_NAME=debian-12.10.0-amd64-netinst.iso
  KERNEL=$WORKDIR/linux
  INITRD=$WORKDIR/initrd.gz
  DISK=$WORKDIR/debbie-amd64.img
  CPU_FLAGS="-enable-kvm -cpu host"
  MACHINE_FLAGS=""
elif [ "$TARGET_ARCH" = "arm64" ]; then
  QEMU_BIN="qemu-system-aarch64"
  ISO_NAME=debian-12.10.0-arm64-netinst.iso
  KERNEL=$WORKDIR/linux-arm64
  INITRD=$WORKDIR/initrd-arm64.gz
  DISK=$WORKDIR/debbie-arm64.img
  CPU_FLAGS="-cpu cortex-a72"
  MACHINE_FLAGS="-M virt"
else
  echo "Unsupported target: $TARGET_ARCH"
  exit 1
fi

ISO_PATH="$IMGDIR/$ISO_NAME"

# Download ISO if missing
if [ ! -f "$ISO_PATH" ]; then
  echo "ISO not found. Downloading..."
  curl -Lo "$ISO_PATH" "https://cdimage.debian.org/debian-cd/current/${TARGET_ARCH}/iso-cd/$ISO_NAME"
fi

# Extract kernel/initrd
if [ ! -f "$KERNEL" ] || [ ! -f "$INITRD" ]; then
  echo "Extracting kernel and initrd..."
  INSTALL_DIR="/install.$TARGET_ARCH"
  [ "$TARGET_ARCH" = "arm64" ] && INSTALL_DIR="/install.a64"
  xorriso -osirrox on -indev "$ISO_PATH" \
    -extract "$INSTALL_DIR/vmlinuz" "$KERNEL" \
    -extract "$INSTALL_DIR/initrd.gz" "$INITRD"
fi

[ -f "$DISK" ] || qemu-img create -f qcow2 "$DISK" 20G

# Start Python HTTP server for preseed
python3 -m http.server 8000 >/dev/null 2>&1 &
HTTP_PID=$!
trap "kill $HTTP_PID" EXIT

APPEND_STRING="auto=true priority=critical interface=auto locale=en_GB keyboard-configuration/xkb-keymap=gb hostname=debbie domain=local preseed/url=http://10.0.2.2:8000/$PRESEED"

if [ "$TARGET_ARCH" = "arm64" ]; then
  $QEMU_BIN \
    -m $RAM \
    -smp cpus=$CPUS \
    -drive file="$DISK",format=qcow2,if=virtio \
    $CPU_FLAGS \
    $MACHINE_FLAGS \
    -kernel "$KERNEL" \
    -initrd "$INITRD" \
    -append "console=ttyAMA0,115200 $APPEND_STRING" \
    -device virtio-gpu-pci \
    -vga std \
    -fsdev local,id=fsdev0,path=.,security_model=none \
    -device virtio-9p-pci,fsdev=fsdev0,mount_tag=hostshare \
    -netdev user,id=net0,hostfwd=tcp::2222-:22 \
else
  $QEMU_BIN \
    -m $RAM \
    -smp cpus=$CPUS \
    -hda "$DISK" \
    -kernel "$KERNEL" \
    -initrd "$INITRD" \
    $CPU_FLAGS \
    $MACHINE_FLAGS \
    -vga std \
    -append "$APPEND_STRING" \
    -cdrom "$ISO_PATH" \
    -fsdev local,id=fsdev0,path=.,security_model=none \
    -device virtio-9p-pci,fsdev=fsdev0,mount_tag=hostshare \
    -netdev user,id=net0,hostfwd=tcp::2222-:22 \
    -device e1000,netdev=net0
fi
