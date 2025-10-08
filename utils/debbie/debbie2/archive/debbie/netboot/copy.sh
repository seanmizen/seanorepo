#!/bin/bash
# https://boot.netboot.xyz/ipxe/netboot.xyz.iso

if [[ ! -f "netboot.xyz.iso" ]]; then
  curl https://boot.netboot.xyz/ipxe/netboot.xyz.iso --output netboot.xyz.iso
fi
if [[ ! -f "netboot.xyz.efi" ]]; then
  curl https://boot.netboot.xyz/ipxe/netboot.xyz.efi --output netboot.xyz.efi
fi
if [[ ! -f "netboot.xyz-snponly.efi" ]]; then
  curl -LO https://boot.netboot.xyz/ipxe/netboot.xyz-snponly.efi
fi
if [[ ! -f "ipxe.efi" ]]; then
  curl -LO https://boot.netboot.xyz/ipxe/ipxe.efi
fi

sudo rm -rf working

CHOSEN_EFI="netboot.xyz-snponly.efi"

sudo mkdir -p ./working/tftp
sudo cp $CHOSEN_EFI ./working/tftp

sudo mkdir -p ./working/dnsmasq.d
sudo tee ./working/dnsmasq.d/pxe.conf > /dev/null <<EOF
interface=en8
bind-interfaces
dhcp-range=192.168.2.50,192.168.2.150,12h
enable-tftp
tftp-root=$(pwd)/working/tftp
dhcp-boot=$CHOSEN_EFI,,192.168.2.1
pxe-service=X86PC, "Boot to netboot.xyz", $CHOSEN_EFI
EOF

echo "chain --autofree tftp://192.168.2.1/$CHOSEN_EFI" | sudo tee ./working/tftp/boot.ipxe > /dev/null

sudo pkill dnsmasq || true

sudo ifconfig en8 192.168.2.1 netmask 255.255.255.0

sudo dnsmasq --conf-dir=./working/dnsmasq.d --no-daemon
