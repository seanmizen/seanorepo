qemu-system-aarch64 -cpu host -M virt,accel=hvf -m 4G \
  -drive file=/opt/homebrew/share/qemu/edk2-aarch64-code.fd,if=pflash,format=raw,readonly=on \
  -kernel netboot.xyz-arm64.efi \
  -serial stdio \
  -device virtio-gpu-pci \
  -device nec-usb-xhci -device usb-kbd \
  -netdev user,id=net0 -device virtio-net-pci,netdev=net0
