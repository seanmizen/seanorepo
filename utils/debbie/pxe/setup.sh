#!/bin/bash
set -e

# PXE server setup script compatible with macOS and Debian Linux

# https://wiki.debian.org/PXEBootInstall
# "Note: If your system supports iPXE, then using netboot.xyz is likely to be much simpler."
# https://netboot.xyz/


IFACE="en8"  # set your wired interface (e.g., enx... on Linux, en8 on macOS)
STATIC_IP="192.168.88.1"
ISO_URL="https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-12.10.0-amd64-netinst.iso"
ISO_PATH="iso/debian-12.10.0-amd64-netinst.iso"

mkdir -p iso ipxe config

# Set static IP
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Detected macOS. Setting static IP on $IFACE"
  sudo ifconfig "$IFACE" inet "$STATIC_IP" netmask 255.255.255.0 alias
else
  echo "Detected Linux. Adding static IP on $IFACE"
  sudo ip addr add "$STATIC_IP/24" dev "$IFACE"
  sudo ip link set "$IFACE" up
fi

# Download netinst ISO if needed
if [ ! -f "$ISO_PATH" ]; then
  echo "Downloading netboot tarball..."
  wget -O "$ISO_PATH" "$ISO_URL"
fi

# Extract kernel/initrd
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Extracting with xorriso on macOS"
  xorriso -osirrox on -indev "$ISO_PATH" -extract /install.amd/vmlinuz ipxe/vmlinuz
  xorriso -osirrox on -indev "$ISO_PATH" -extract /install.amd/initrd.gz ipxe/initrd.gz
else
  TMPMNT=$(mktemp -d)
  sudo mount -o loop "$ISO_PATH" "$TMPMNT"
  sudo cp "$TMPMNT"/install.amd/vmlinuz ipxe/
  sudo cp "$TMPMNT"/install.amd/initrd.gz ipxe/
  sudo umount "$TMPMNT"
  rmdir "$TMPMNT"
fi

# echo "Extracting kernel and initrd from netboot.tar.gz..."
# mkdir -p tmp-netboot
# tar -xzf "$ISO_PATH" -C tmp-netboot

# cp tmp-netboot/debian-installer/amd64/linux ipxe/vmlinuz
# cp tmp-netboot/debian-installer/amd64/initrd.gz ipxe/initrd.gz
# rm -rf tmp-netboot

# Download iPXE binary
if [ ! -f undionly.kpxe ]; then
  wget -O undionly.kpxe https://boot.ipxe.org/undionly.kpxe
fi

# dnsmasq config
cat > config/dnsmasq.conf <<EOF
interface=$IFACE
bind-dynamic
port=0
dhcp-range=192.168.88.100,192.168.88.150,255.255.255.0,12h
dhcp-option=3,$STATIC_IP
dhcp-option=6,$STATIC_IP
enable-tftp
tftp-root=$(pwd)
tftp-no-fail
tftp-max=30
dhcp-match=set:ipxe,175
dhcp-boot=tag:ipxe,boot.ipxe
dhcp-boot=undionly.kpxe
log-dhcp
log-queries
log-async
EOF

cat > ipxe/preseed-wifi.cfg <<EOF
### Locale
d-i debian-installer/locale string en_GB
d-i debian-installer/country string GB
d-i debian-installer/language string en
d-i keyboard-configuration/xkb-keymap select gb
d-i console-setup/ask_detect boolean false
d-i console-setup/layoutcode string gb

### Wi-Fi
d-i netcfg/choose_interface select wlan0
d-i netcfg/wireless_essid string mojodojo
d-i netcfg/wireless_passphrase string casahouse
d-i netcfg/get_hostname string debbie2
d-i netcfg/get_domain string local

### Installation stuff. important
d-i anna/choose_modules string network-console
d-i cdrom-detect/try-usb boolean false
d-i cdrom-detect/try-floppy boolean false
d-i cdrom-detect/try-harddisk boolean false
d-i cdrom-detect/try-mount boolean false
d-i cdrom-detect/load_cdrom_modules boolean false


### Mirrors (netinst!)
d-i apt-setup/use_mirror boolean true
d-i mirror/country string manual
d-i mirror/http/hostname string deb.debian.org
d-i mirror/http/directory string /debian
d-i mirror/http/proxy string

### User setup
d-i passwd/root-login boolean false
d-i passwd/make-user boolean true
d-i passwd/user-fullname string Sean
d-i passwd/username string sean
d-i passwd/user-password password debbie
d-i passwd/user-password-again password debbie
d-i user-setup/allow-password-weak boolean true
d-i user-setup/encrypt-home boolean false
d-i passwd/user-default-groups string audio cdrom video sudo

### Clock
d-i clock-setup/utc boolean true
d-i time/zone string Europe/London
d-i clock-setup/ntp boolean true
d-i clock-setup/ntp-server string pool.ntp.org

### Partitioning
d-i partman-auto/method string regular
d-i partman-auto/choose_recipe select atomic
d-i partman-partitioning/confirm_write_new_label boolean true
d-i partman/choose_partition select finish
d-i partman/confirm boolean true
d-i partman/confirm_nooverwrite boolean true
d-i partman-efi/non_efi_system boolean true
d-i partman-partitioning/choose_label string gpt
d-i partman-partitioning/default_label string gpt

### Packages
tasksel tasksel/first multiselect standard
d-i pkgsel/include string openssh-server sudo vim curl wget
d-i pkgsel/upgrade select none
popularity-contest popularity-contest/participate boolean false
d-i pkgsel/updatedb boolean false

### Bootloader
d-i grub-installer/only_debian boolean true
d-i grub-installer/with_other_os boolean false
d-i grub-installer/bootdev string default
d-i grub-installer/force-efi-extra-removable boolean false
d-i grub-installer/make_active boolean true

### Final commands
d-i finish-install/reboot_in_progress note
d-i debian-installer/exit/poweroff boolean false
d-i preseed/late_command string \
  wget http://$STATIC_IP:8000/ipxe/postinstall.sh -O /target/tmp/postinstall.sh; \
  chmod +x /target/tmp/postinstall.sh; \
  in-target /tmp/postinstall.sh
d-i finish-install/keep-consoles boolean true
EOF

# boot.ipxe
# kernel http://$STATIC_IP:8000/ipxe/vmlinuz auto=true priority=critical preseed/url=http://$STATIC_IP:8000/ipxe/preseed-wifi.cfg
cat > boot.ipxe <<EOF
#!ipxe
kernel http://192.168.88.1:8000/ipxe/vmlinuz auto=true priority=critical \
  preseed/url=http://192.168.88.1:8000/ipxe/preseed-wifi.cfg \
  netcfg/get_ipaddress=dhcp \
  cdrom-detect/load_media=false \
  cdrom-detect/try-usb=false \
  cdrom-detect/try-harddisk=false \
  cdrom-detect/try-floppy=false \
  mirror/protocol=http
initrd http://$STATIC_IP:8000/ipxe/initrd.gz
boot
EOF

echo "Setup complete. Run ./scripts/serve.sh to start services."
