#!/bin/bash
set -e

IFACE="en8"
STATIC_IP="192.168.88.1"
NETBOOT_URL="https://deb.debian.org/debian/dists/stable/main/installer-amd64/current/images/netboot/netboot.tar.gz"

mkdir -p pxe/ipxe ipxe config
cd pxe

echo "Setting static IP..."
sudo ifconfig "$IFACE" inet "$STATIC_IP" netmask 255.255.255.0 alias

echo "Downloading netboot kernel/initrd..."
curl -LO "$NETBOOT_URL"
tar -xzf netboot.tar.gz
rm netboot.tar.gz

mv debian-installer/amd64/linux ipxe/vmlinuz
mv debian-installer/amd64/initrd.gz ipxe/initrd.gz
rm -rf debian-installer

echo "Downloading undionly.kpxe (iPXE bootloader)..."
curl -Lo undionly.kpxe https://boot.ipxe.org/undionly.kpxe

echo "Creating boot.ipxe..."
touch boot.ipxe
cat > boot.ipxe <<EOF
#!ipxe
kernel http://$STATIC_IP:8000/ipxe/vmlinuz auto=true priority=critical preseed/url=http://$STATIC_IP:8000/ipxe/preseed.cfg
initrd http://$STATIC_IP:8000/ipxe/initrd.gz
boot
EOF

# deb.debian.org -> 151.101.38.132

echo "Creating minimal working preseed.cfg..."
touch ipxe/preseed.cfg
cat > ipxe/preseed.cfg <<EOF
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
d-i mirror/http/hostname string 151.101.2.132
d-i mirror/http/directory string /debian
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

echo "Writing dnsmasq.conf..."
cat > ../config/dnsmasq.conf <<EOF
interface=$IFACE
bind-interfaces
dhcp-range=192.168.88.100,192.168.88.150,12h
enable-tftp
tftp-root=$(pwd)
dhcp-match=set:ipxe,175
dhcp-boot=tag:ipxe,boot.ipxe
dhcp-boot=undionly.kpxe
EOF

echo "Restarting dnsmasq..."
sudo pkill dnsmasq || true
sudo dnsmasq --conf-file="$(pwd)/../config/dnsmasq.conf"

echo "Starting HTTP server..."
python3 -m http.server 8000
