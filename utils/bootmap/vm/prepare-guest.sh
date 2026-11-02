#!/usr/bin/env bash
# Make working/guest.qcow2 for vm/run.sh --full. Run it one time.
#
#   vm/prepare-guest.sh [--fresh]
#
# The guest is the Debian 13 cloud image (an overlay on the base image). Its
# first boot uses the stock Debian kernel. cloud-init then:
#   - adds the SSH key (working/id_ed25519),
#   - installs mnt-bootmap.mount: the host folder zig-out/bin, shared by 9p,
#   - installs bootmapd.service: the daemon from that folder, early in boot,
#   - turns cloud-init off for the next boots,
# and the guest powers off. Both units run only when the kernel command line
# has bootmap.daemon=1. So the daemon changes on the host, and the disk image
# does not.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
WORK="$ROOT/working"
BASE="$WORK/debian-13-genericcloud-amd64.qcow2"
DISK="$WORK/guest.qcow2"
SEED="$WORK/guest-seed"
KEY="$WORK/id_ed25519"
HTTP_PORT="${HTTP_PORT:-8462}"
TIMEOUT_S="${TIMEOUT_S:-1800}"

die() { echo "prepare-guest: $*" >&2; exit 1; }

[ -f "$BASE" ] || die "$BASE not found. Download it first (see README.md)."
if [ -f "$DISK" ] && [ "${1:-}" != "--fresh" ]; then
    echo "prepare-guest: $DISK exists. Use --fresh to make it again."
    exit 0
fi
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N '' -C bootmap-vm -f "$KEY"

mkdir -p "$SEED"
printf 'instance-id: bootmap-guest-%s\nlocal-hostname: bootmap\n' "$(date +%s)" > "$SEED/meta-data"
cat > "$SEED/user-data" << EOF
#cloud-config
ssh_authorized_keys:
  - $(cat "$KEY.pub")
write_files:
  - path: /etc/systemd/system/mnt-bootmap.mount
    content: |
      [Unit]
      Description=bootmap daemon folder from the host (9p)
      DefaultDependencies=no
      ConditionKernelCommandLine=bootmap.daemon=1
      [Mount]
      What=bootmap
      Where=/mnt/bootmap
      Type=9p
      Options=trans=virtio,version=9p2000.L,ro
  - path: /etc/systemd/system/bootmapd.service
    content: |
      [Unit]
      Description=bootmap: draw the boot as a live treemap
      DefaultDependencies=no
      ConditionKernelCommandLine=bootmap.daemon=1
      RequiresMountsFor=/mnt/bootmap
      Before=sysinit.target
      [Service]
      Type=simple
      ExecStart=/mnt/bootmap/bootmapd
      [Install]
      WantedBy=sysinit.target
runcmd:
  - [systemctl, daemon-reload]
  - [systemctl, enable, bootmapd.service]
  - [touch, /etc/cloud/cloud-init.disabled]
power_state:
  mode: poweroff
EOF

qemu-img create -q -f qcow2 -F qcow2 -b "$BASE" "$DISK" 8G
cp /usr/share/OVMF/OVMF_VARS_4M.fd "$WORK/guest-vars.fd"

python3 -m http.server --bind 127.0.0.1 --directory "$SEED" "$HTTP_PORT" > "$WORK/guest-seed-http.log" 2>&1 &
HTTP_PID=$!
trap 'kill "$HTTP_PID" 2> /dev/null || true' EXIT

if [ -w /dev/kvm ]; then ACCEL=kvm; CPU=host; else ACCEL=tcg; CPU=max; fi
echo "prepare-guest: first boot with the stock kernel (-accel $ACCEL). Serial log: $WORK/guest-prepare.log"
timeout "$TIMEOUT_S" qemu-system-x86_64 \
    -machine q35 -accel "$ACCEL" -cpu "$CPU" -smp 2 -m 2048 \
    -drive if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd \
    -drive if=pflash,format=raw,file="$WORK/guest-vars.fd" \
    -drive if=virtio,format=qcow2,file="$DISK" \
    -netdev user,id=n0 -device virtio-net-pci,netdev=n0 \
    -smbios "type=1,serial=ds=nocloud;s=http://10.0.2.2:$HTTP_PORT/" \
    -display none -serial "file:$WORK/guest-prepare.log" -monitor none \
    || die "the first boot did not power off. See $WORK/guest-prepare.log"
echo "prepare-guest: $DISK is ready"
