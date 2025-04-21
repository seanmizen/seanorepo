#!/bin/bash
set -e

# PXE netboot script with offline Debian DVD repo
# Connect client to Mac via Ethernet. Run this script. Then PXE boot the client.

IFACE="en8" # your Ethernet interface
STATIC_IP="192.168.88.1"
HTTP_PORT=8000
NETBOOT_URL="https://deb.debian.org/debian/dists/stable/main/installer-amd64/current/images/netboot/netboot.tar.gz"
DVD_ISO_PATH="./debian-12.10.0-amd64-DVD-1.iso"
DVD_MOUNT_DIR="./pxe/mount"

echo "[*] Creating directory structure..."
rm -rf pxe
mkdir -p pxe/ipxe config

echo "[*] Setting static IP on $IFACE..."
sudo ifconfig "$IFACE" inet "$STATIC_IP" netmask 255.255.255.0 alias

echo "[*] Downloading Debian netboot files..."
curl -L "$NETBOOT_URL" -o netboot.tar.gz
tar -xzf netboot.tar.gz
mv debian-installer/amd64/linux pxe/ipxe/vmlinuz
mv debian-installer/amd64/initrd.gz pxe/ipxe/initrd.gz
rm -rf debian-installer netboot.tar.gz

echo "[*] Downloading iPXE bootstrap..."
curl -Lo pxe/undionly.kpxe https://boot.ipxe.org/undionly.kpxe

echo "[*] Creating boot.ipxe..."
cat > pxe/boot.ipxe <<EOF
#!ipxe
kernel http://$STATIC_IP:$HTTP_PORT/ipxe/vmlinuz auto=true priority=critical preseed/url=http://$STATIC_IP:$HTTP_PORT/ipxe/preseed.cfg
initrd http://$STATIC_IP:$HTTP_PORT/ipxe/initrd.gz
boot
EOF

echo "[*] Creating preseed.cfg..."
cat > pxe/ipxe/preseed.cfg <<EOF
d-i debian-installer/locale string en_GB.UTF-8
d-i debian-installer/language string en
d-i debian-installer/country string GB
d-i keyboard-configuration/xkb-keymap select gb

d-i netcfg/choose_interface select wlan0
d-i netcfg/disable_dhcp boolean false
d-i netcfg/get_hostname string debbie2
d-i netcfg/get_domain string local
d-i netcfg/wireless_essid string mojodojo
d-i netcfg/wireless_passphrase string casahouse

d-i mirror/country string manual
d-i mirror/http/hostname string $STATIC_IP
d-i mirror/http/directory string /mount
d-i mirror/http/proxy string

d-i passwd/root-login boolean false
d-i passwd/user-fullname string Sean
d-i passwd/username string sean
d-i passwd/user-password password debbie
d-i passwd/user-password-again password debbie
d-i user-setup/allow-password-weak boolean true

d-i clock-setup/utc boolean true
d-i time/zone string Europe/London

d-i partman-auto/method string regular
d-i partman-auto/choose_recipe select atomic
d-i partman/confirm boolean true
d-i partman/confirm_nooverwrite boolean true

tasksel tasksel/first multiselect standard
d-i pkgsel/include string sudo openssh-server vim curl wget

d-i grub-installer/only_debian boolean true
d-i grub-installer/with_other_os boolean false

d-i finish-install/reboot_in_progress note
EOF

echo "[*] Writing dnsmasq config..."
cat > config/dnsmasq.conf <<EOF
interface=$IFACE
bind-interfaces
dhcp-range=192.168.88.100,192.168.88.150,12h
enable-tftp
tftp-root=$(pwd)/pxe
dhcp-match=set:ipxe,175
dhcp-boot=tag:ipxe,boot.ipxe
dhcp-boot=undionly.kpxe
EOF

echo "[*] Restarting dnsmasq..."
sudo pkill dnsmasq || true
sudo dnsmasq --conf-file="$(pwd)/config/dnsmasq.conf"

echo "[*] Extracting ISO contents to ./pxe/mount..."
if [[ -f "$DVD_ISO_PATH" ]]; then
  mkdir -p "$DVD_MOUNT_DIR"
  rm -rf "$DVD_MOUNT_DIR"/*
  7z x "$DVD_ISO_PATH" -o"$DVD_MOUNT_DIR" > /dev/null
else
  echo "ERROR: ISO not found at $DVD_ISO_PATH"
  exit 1
fi

echo "[*] Launching HTTP server from pxe/"
cd pxe
python3 -m http.server "$HTTP_PORT"
