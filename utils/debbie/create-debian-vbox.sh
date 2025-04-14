#!/bin/bash
set -e

VM_NAME="debian-auto"
DISK="${VM_NAME}.vdi"
PRESEED_ISO="preseed.iso"
DEBIAN_ISO="debian-12.10.0-amd64-netinst.iso"
# DEBIAN_ISO="debian-12.10.0-arm64-netinst.iso"
PRESEED_CFG="preseed-1.cfg"

# Clean up existing VM
VBoxManage unregistervm "$VM_NAME" --delete 2>/dev/null || true
rm -rf ~/VirtualBox\ VMs/debian-auto
rm -f "$DISK" "$PRESEED_ISO"

# Create VM
VBoxManage createvm --name "$VM_NAME" --register
VBoxManage modifyvm "$VM_NAME" --memory 2048 --cpus 2 --ostype Debian_64
VBoxManage createhd --filename "$DISK" --size 20000

# Storage controllers
VBoxManage storagectl "$VM_NAME" --name "SATA Controller" --add sata --controller IntelAhci
VBoxManage storageattach "$VM_NAME" --storagectl "SATA Controller" --port 0 --device 0 --type hdd --medium "$DISK"
VBoxManage storagectl "$VM_NAME" --name "IDE Controller" --add ide

# Debian ISO
VBoxManage storageattach "$VM_NAME" --storagectl "IDE Controller" --port 0 --device 0 --type dvddrive --medium "$DEBIAN_ISO"

# Preseed ISO
# genisoimage -output "$PRESEED_ISO" -volid cidata -joliet -rock "$PRESEED_CFG"
mkisofs -output "$PRESEED_ISO" -volid cidata -joliet -rock "$PRESEED_CFG"
VBoxManage storageattach "$VM_NAME" --storagectl "IDE Controller" --port 1 --device 0 --type dvddrive --medium "$PRESEED_ISO"

# Boot order
VBoxManage modifyvm "$VM_NAME" --boot1 dvd --boot2 disk --boot3 none --boot4 none

# Start VM
VBoxManage startvm "$VM_NAME"
# open -a VirtualBox
