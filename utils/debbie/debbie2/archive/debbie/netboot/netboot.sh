#!/bin/bash

set -e

# Interfaces
PXE_IF=en8         # Ethernet to PXE client
INET_IF=en0        # Wi-Fi or internet uplink (check with ifconfig)

# Files to download
[[ -f netboot.xyz.iso ]] || curl -LO https://boot.netboot.xyz/ipxe/netboot.xyz.iso
[[ -f netboot.xyz.efi ]] || curl -LO https://boot.netboot.xyz/ipxe/netboot.xyz.efi
[[ -f netboot.xyz-snponly.efi ]] || curl -LO https://boot.netboot.xyz/ipxe/netboot.xyz-snponly.efi
[[ -f ipxe.efi ]] || curl -LO https://boot.netboot.xyz/ipxe/ipxe.efi

CHOSEN_EFI="netboot.xyz.efi"

# Kill any existing dnsmasq (early)
sudo pkill dnsmasq || true

# Clean and prepare working directory
sudo rm -rf working
mkdir -p working/{tftp,dnsmasq.d}
sudo cp "$CHOSEN_EFI" working/tftp/

# Set boot.ipxe to load netboot menu via internet (since client will get routed)
sudo tee working/tftp/boot.ipxe > /dev/null <<EOF
echo iPXE loaded OK
sleep 5
chain --autofree http://boot.netboot.xyz/ipxe/$CHOSEN_EFI
EOF

# Configure dnsmasq
sudo tee working/dnsmasq.d/pxe.conf > /dev/null <<EOF
interface=$PXE_IF
bind-interfaces
dhcp-range=192.168.2.50,192.168.2.150,12h
enable-tftp
tftp-root=$(pwd)/working/tftp
dhcp-boot=$CHOSEN_EFI,,192.168.2.1
pxe-service=X86PC, "Boot to $CHOSEN_EFI", $CHOSEN_EFI
EOF

# Configure static IP on PXE interface
sudo ifconfig "$PXE_IF" 192.168.2.1 netmask 255.255.255.0 up

# Enable IP forwarding
sudo sysctl -w net.inet.ip.forwarding=1

# Setup NAT from PXE_IF -> INET_IF
sudo pfctl -f - <<EOF
nat on $INET_IF from $PXE_IF:network to any -> ($INET_IF)
EOF
sudo pfctl -e || true

# Launch dnsmasq in foreground for logging/debugging
sudo dnsmasq --conf-dir=./working/dnsmasq.d --no-daemon
