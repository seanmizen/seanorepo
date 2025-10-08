#!/bin/bash
set -e

# Cobbler-based PXE server setup for Debian
# Compatible with Debian Linux and macOS (Apple Silicon)

ISO_URL="https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-12.10.0-amd64-netinst.iso"
ISO_PATH="iso/debian-12.10.0-amd64-netinst.iso"
DISTRO_NAME="debian12"
PRESEED=""

while [[ "$1" != "" ]]; do
  case $1 in
    -p | --preseed ) shift
      PRESEED=$1
      ;;
  esac
  shift
done

if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Detected macOS. Cobbler is not natively supported on macOS."
  echo "Please run this script on a Debian-based Linux system."
  exit 1
fi

if ! command -v apt >/dev/null 2>&1; then
  echo "Error: apt not found. This script requires Debian or Ubuntu."
  exit 1
fi

echo "Installing Cobbler and dependencies..."
sudo apt update
sudo apt install -y cobbler cobbler-web dnsmasq tftpd-hpa apache2 curl xorriso

# Start and enable services
sudo systemctl enable cobblerd --now
sudo systemctl restart cobblerd

# Configure Cobbler DHCP management
echo "Enabling DHCP in Cobbler..."
sudo sed -i 's/manage_dhcp: 0/manage_dhcp: 1/' /etc/cobbler/settings

# Download ISO if needed
mkdir -p iso
if [ ! -f "$ISO_PATH" ]; then
  echo "Downloading Debian ISO..."
  wget -O "$ISO_PATH" "$ISO_URL"
fi

# Mount ISO and import into Cobbler
TMPMNT=$(mktemp -d)
sudo mount -o loop "$ISO_PATH" "$TMPMNT"

echo "Importing distro into Cobbler..."
sudo cobbler import --path="$TMPMNT" --name="$DISTRO_NAME" --arch=x86_64

sudo umount "$TMPMNT"
rmdir "$TMPMNT"

# Apply preseed if provided
if [ -n "$PRESEED" ]; then
  echo "Applying preseed: $PRESEED"
  sudo cobbler profile edit --name "$DISTRO_NAME"-x86_64 \
    --kickstart="$PRESEED"
fi

# Sync Cobbler config
sudo cobbler sync

# Show access info
echo "Cobbler PXE setup complete."
echo "Boot clients and select the '$DISTRO_NAME-x86_64' profile."
if [ -n "$PRESEED" ]; then
  echo "Preseed used: $PRESEED"
else
  echo "No preseed file used."
fi
