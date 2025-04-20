#!/bin/bash
set -e

# PXE VM launcher script using VirtualBox on macOS or Linux
# Assumes the PXE server is running locally on 192.168.88.1

VM_NAME="PXEClient"
ISO_BOOT_URL="http://192.168.88.1:8000/ipxe/boot.ipxe"
# Host-only interface name for PXE testing
NIC_HOSTONLY="vboxnet0"

# Check VBoxManage exists
if ! command -v VBoxManage >/dev/null; then
  echo "VBoxManage not found. Please install VirtualBox."
  exit 1
fi

# Delete existing VM if it exists
if VBoxManage list vms | grep -q "\"$VM_NAME\""; then
  echo "Removing existing VM: $VM_NAME"
  VBoxManage unregistervm "$VM_NAME" --delete
fi

# Create new VM
GRAPHICS="vmsvga"
VBoxManage createvm --name "$VM_NAME" --register
VBoxManage modifyvm "$VM_NAME" \
  --memory 1024 \
  --acpi on \
  --boot1 net \
  --nic1 hostonly \
  --nictype1 82540EM \
  --cableconnected1 on \
  --hostonlyadapter1 "$NIC_HOSTONLY" \
  --chipset piix3 \
  --ostype Debian_64 \
  --graphicscontroller $GRAPHICS

# Start the VM
echo "Starting VM '$VM_NAME'..."
VBoxManage startvm "$VM_NAME" --type gui
