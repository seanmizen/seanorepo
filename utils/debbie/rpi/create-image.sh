#!/bin/bash
set -e

USE_PRESEED=false
[[ "$1" == "--preseed" ]] && USE_PRESEED=true

rm -rf debian-pi2-image
mkdir -p debian-pi2-image

download_if_missing() {
  local url=$1 dest=$2
  [ -f "$dest" ] || wget -O "$dest" "$url"
}

download_if_missing http://ftp.debian.org/debian/dists/stable/main/installer-armhf/current/images/netboot/vmlinuz \
  debian-pi2-image/vmlinuz
download_if_missing http://ftp.debian.org/debian/dists/stable/main/installer-armhf/current/images/netboot/initrd.gz \
  debian-pi2-image/initrd.gz
download_if_missing http://ftp.debian.org/debian/dists/stable/main/installer-armhf/current/images/device-tree/bcm2836-rpi-2-b.dtb \
  debian-pi2-image/bcm2836-rpi-2-b.dtb

download_if_missing https://raw.githubusercontent.com/raspberrypi/firmware/master/boot/bootcode.bin \
  debian-pi2-image/bootcode.bin
download_if_missing https://raw.githubusercontent.com/raspberrypi/firmware/master/boot/start.elf \
  debian-pi2-image/start.elf
download_if_missing https://raw.githubusercontent.com/raspberrypi/firmware/master/boot/fixup.dat \
  debian-pi2-image/fixup.dat

[[ "$USE_PRESEED" == true ]] && cp preseed-rpi.cfg debian-pi2-image/preseed.cfg

cat > debian-pi2-image/config.txt <<EOF
kernel=vmlinuz
initramfs initrd.gz followkernel
device_tree=bcm2836-rpi-2-b.dtb
enable_uart=1
EOF

BOOT_ARGS="console=serial0,115200 console=tty1 root=/dev/ram0 rw"
[[ "$USE_PRESEED" == true ]] && BOOT_ARGS+=" preseed/file=/hd-media/preseed.cfg auto=true priority=critical"

echo "$BOOT_ARGS" > debian-pi2-image/cmdline.txt

echo "✅ Boot partition staged at: ./debian-pi2-image"

IMAGE=debian-pi2.img
SIZE_MB=2048
BOOT_MB=256

dd if=/dev/zero of="$IMAGE" bs=1m count=$SIZE_MB

DEV=$(hdiutil attach -imagekey diskimage-class=CRawDiskImage -nomount "$IMAGE" | awk 'NR==1 {print $1}')
diskutil partitionDisk "$DEV" MBR FAT32 BOOT ${BOOT_MB}Mi Free UNUSED R

diskutil mount "${DEV}s1"
cp -R debian-pi2-image/* /Volumes/BOOT
sync
diskutil unmount "${DEV}s1"
hdiutil detach "$DEV"

echo "✅ Image ready: $IMAGE"
