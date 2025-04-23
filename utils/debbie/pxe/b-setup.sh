#!/bin/bash
set -e

# PXE netboot script with offline Debian DVD repo
# turn off DHCP on your router. otherwise dnsmasq we run here is overridden.
# make sure
# 1. that your client has direct access to the internet
# 2. that your ipxe server (the host running this script) is connected to your client
# Connect client to Mac via Ethernet. Run this script. Then PXE boot the client.

IFACE="en8"
STATIC_IP="192.168.88.1"
# by default, PXE setup on your client uses port 80. try to stick to it.
HTTP_PORT=80
NETBOOT_URL="https://deb.debian.org/debian/dists/stable/main/installer-amd64/current/images/netboot/netboot.tar.gz"

echo "[*] Enabling IP forwarding. This allows netboot."

sudo sysctl -w net.inet.ip.forwarding=1

# NAT disabled.
# # Write a working PF anchor rule (assumes static 192.168.88.0/24 PXE subnet)
# PXE_SUBNET="192.168.88.0/24"
# sudo mkdir -p /etc/pf.anchors
# sudo bash -c "echo 'nat on $INET_IF from $PXE_SUBNET to any -> ($INET_IF)' > /etc/pf.anchors/pxe-nat"

# # Write the top-level ruleset to include the anchor
# cat > nat-rules.conf <<EOF
# nat-anchor "pxe-nat"
# load anchor "pxe-nat" from "/etc/pf.anchors/pxe-nat"
# pass out all keep state
# EOF

# # Load it and enable PF
# sudo pfctl -f nat-rules.conf
# sudo pfctl -e

echo "[*] Cleaning root artifacts..."
sudo rm -rf pxe
sudo rm -f ldlinux.c32 libutil.c32 pxelinux.0 version.cfg boot.cat isolinux.bin pxelinux.cfg
echo "[*] Creating directory structure..."
mkdir -p pxe/ipxe config

echo "[*] Setting static IP on $IFACE..."
sudo ifconfig "$IFACE" inet "$STATIC_IP" netmask 255.255.255.0 alias

echo "[*] Downloading Debian netboot files..."
curl -L "$NETBOOT_URL" -o netboot.tar.gz
mkdir -p pxe/tmp-netboot
tar -xzf netboot.tar.gz -C pxe/tmp-netboot
mv pxe/tmp-netboot/debian-installer/amd64/linux pxe/ipxe/vmlinuz
mv pxe/tmp-netboot/debian-installer/amd64/initrd.gz pxe/ipxe/initrd.gz
rm -rf pxe/tmp-netboot netboot.tar.gz

echo "[*] Downloading iPXE bootstrap..."
curl -Lo pxe/undionly.kpxe https://boot.ipxe.org/undionly.kpxe

echo "[*] Creating boot.ipxe..."
cat > pxe/boot.ipxe <<EOF
#!ipxe
initrd http://$STATIC_IP:$HTTP_PORT/ipxe/initrd.gz
kernel http://$STATIC_IP:$HTTP_PORT/ipxe/vmlinuz auto=true priority=critical preseed/url=http://$STATIC_IP:$HTTP_PORT/ipxe/preseed.cfg
boot
EOF

# d-i mirror/http/hostname string deb.debian.org
# d-i mirror/http/directory string /debian
# d-i partman-auto/disk string /dev/sda

echo "[*] Creating preseed.cfg..."
cat > pxe/ipxe/preseed.cfg <<EOF
d-i debian-installer/locale string en_GB.UTF-8
d-i debian-installer/language string en
d-i debian-installer/country string GB
d-i keyboard-configuration/xkb-keymap select gb

d-i netcfg/choose_interface select auto
d-i netcfg/disable_dhcp boolean false
d-i netcfg/get_hostname string debbie2
d-i netcfg/get_domain string local

d-i mirror/country string manual
d-i mirror/http/hostname string deb.debian.org
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
# pxe-service=x86PC, "PXE Boot", undionly.kpxe
# pxe-service=x86PC, "PXE Boot", undionly.kpxe

echo "[*] Restarting dnsmasq..."
sudo pkill dnsmasq || true
sudo dnsmasq --conf-file="$(pwd)/config/dnsmasq.conf"

echo "[*] Launching HTTP server from pxe/"
cd pxe
python3 -m http.server "$HTTP_PORT"

# for some reason this is working now.
# set forwarding on:
# sudo sysctl -w net.inet.ip.forwarding=1
# get forwarding setting:
# sysctl net.inet.ip.forwarding
# I think I accidentally turned this on and it's allowing netboot to work via my ethernet + wifi
