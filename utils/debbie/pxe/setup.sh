#!/bin/bash
set -e

# PXE server setup script compatible with macOS and Debian Linux

IFACE="en8"  # set your wired interface (e.g., enx... on Linux, en8 on macOS)
STATIC_IP="192.168.88.1"
ISO_URL="https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-12.10.0-amd64-netinst.iso"
ISO_PATH="iso/debian-12.10.0-amd64-netinst.iso"

if [[ "$1" == "--info" ]]; then
  echo "PXE Boot Notes:"
  echo "- ✅ Direct Ethernet (host ↔ client): Works reliably. PXE server sees DHCP."
  echo "- ❌ Through router (host + client on LAN): Most routers intercept DHCP. PXE server won't see requests."
  echo "- Workaround: Disable router DHCP temporarily, or use proxyDHCP (advanced)."
  echo "- Recommendation: Use direct connection for installs."
  exit 0
fi

mkdir -p iso ipxe bin config

# Platform-specific IP setup
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Detected macOS. Setting static IP on $IFACE"
  sudo ifconfig "$IFACE" inet "$STATIC_IP" netmask 255.255.255.0 alias
else
  echo "Detected Linux. Adding static IP on $IFACE (without flushing existing IPs)"
  if ! ip addr show "$IFACE" | grep -q "$STATIC_IP"; then
    sudo ip addr add "$STATIC_IP/24" dev "$IFACE"
  else
    echo "Static IP $STATIC_IP already assigned to $IFACE"
  fi
  sudo ip link set "$IFACE" up
fi

# Download ISO if needed
if [ ! -f "$ISO_PATH" ]; then
  echo "Downloading Debian ISO..."
  wget -O "$ISO_PATH" "$ISO_URL"
fi

# Extract kernel/initrd from ISO
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Extracting with xorriso on macOS"
  xorriso -osirrox on -indev "$ISO_PATH" -extract /install.amd/vmlinuz ipxe/vmlinuz
  xorriso -osirrox on -indev "$ISO_PATH" -extract /install.amd/initrd.gz ipxe/initrd.gz
else
  TMPMNT=$(mktemp -d)
  if mount | grep -q "$ISO_PATH"; then
    echo "ISO already mounted, unmounting first"
    sudo umount "$ISO_PATH" || true
  fi
  sudo mount -o loop "$ISO_PATH" "$TMPMNT"
  sudo cp "$TMPMNT"/install.amd/vmlinuz ipxe/
  sudo cp "$TMPMNT"/install.amd/initrd.gz ipxe/
  sudo umount "$TMPMNT"
  rmdir "$TMPMNT"
fi

# Download iPXE binary
if [ ! -f bin/undionly.kpxe ]; then
  echo "Downloading undionly.kpxe..."
  wget -O bin/undionly.kpxe https://boot.ipxe.org/undionly.kpxe
fi

# Write dnsmasq.conf
cat > config/dnsmasq.conf <<EOF
interface=en8
bind-dynamic
port=0
dhcp-range=192.168.88.100,192.168.88.150,255.255.255.0,12h
dhcp-option=3,192.168.88.1
dhcp-option=6,192.168.88.1
enable-tftp
tftp-root=/Users/seanmizen/projects/seanorepo/utils/debbie/pxe/bin
dhcp-boot=undionly.kpxe
log-dhcp
EOF

echo "Written config/dnsmasq.conf"

# Write boot.ipxe
cat > ipxe/boot.ipxe <<EOF
#!ipxe
kernel http://$STATIC_IP:8000/ipxe/vmlinuz auto=true priority=critical preseed/url=http://$STATIC_IP:8000/ipxe/preseed-1.cfg
initrd http://$STATIC_IP:8000/ipxe/initrd.gz
boot
EOF

echo "Written ipxe/boot.ipxe"
echo "Run ./scripts/serve.sh to launch PXE services"

