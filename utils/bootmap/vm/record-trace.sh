#!/usr/bin/env bash
# Record one boot of the Debian 13 cloud image as a bootmap trace.
#
#   vm/record-trace.sh [out.json]     default: traces/debian13-cloud-<accel>.json
#
# Boot 1: cloud-init adds the SSH key, adds initcall_debug to the kernel
# command line, and reboots. Boot 2 is the boot that the trace records.
# collect-trace.py runs on the guest and prints the trace.
#
# Needs: qemu-system-x86_64, qemu-img, ovmf, python3, ssh, and
# working/debian-13-genericcloud-amd64.qcow2 (see README.md).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
WORK="$ROOT/working"
BASE="$WORK/debian-13-genericcloud-amd64.qcow2"
DISK="$WORK/record.qcow2"
SEED="$WORK/seed"
KEY="$WORK/id_ed25519"
HTTP_PORT="${HTTP_PORT:-8461}"
SSH_PORT="${SSH_PORT:-2261}"
TIMEOUT_S="${TIMEOUT_S:-1800}"

die() { echo "record-trace: $*" >&2; exit 1; }

[ -f "$BASE" ] || die "$BASE not found. Download it first (see README.md)."
command -v qemu-system-x86_64 > /dev/null || die "qemu-system-x86_64 not found. sudo apt install qemu-system-x86"
OVMF_CODE=/usr/share/OVMF/OVMF_CODE_4M.fd
OVMF_VARS=/usr/share/OVMF/OVMF_VARS_4M.fd
[ -f "$OVMF_CODE" ] || die "$OVMF_CODE not found. sudo apt install ovmf"

if [ -w /dev/kvm ]; then ACCEL=kvm; CPU=host; else ACCEL=tcg; CPU=max; fi
OUT="${1:-$ROOT/traces/debian13-cloud-$ACCEL.json}"

[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N '' -C bootmap-vm -f "$KEY"

mkdir -p "$SEED"
printf 'instance-id: bootmap-%s\nlocal-hostname: bootmap\n' "$(date +%s)" > "$SEED/meta-data"
cat > "$SEED/user-data" << EOF
#cloud-config
ssh_authorized_keys:
  - $(cat "$KEY.pub")
write_files:
  - path: /etc/default/grub.d/90-bootmap.cfg
    content: |
      GRUB_CMDLINE_LINUX_DEFAULT="\$GRUB_CMDLINE_LINUX_DEFAULT initcall_debug loglevel=4 log_buf_len=8M"
runcmd:
  - [update-grub]
power_state:
  mode: reboot
EOF

# A new overlay on each run, so boot 1 is a first boot again.
qemu-img create -q -f qcow2 -F qcow2 -b "$BASE" "$DISK" 8G
cp "$OVMF_VARS" "$WORK/record-vars.fd"

python3 -m http.server --bind 127.0.0.1 --directory "$SEED" "$HTTP_PORT" > "$WORK/seed-http.log" 2>&1 &
HTTP_PID=$!
QEMU_PID=""
cleanup() {
    kill "$HTTP_PID" 2> /dev/null || true
    [ -n "$QEMU_PID" ] && kill "$QEMU_PID" 2> /dev/null || true
}
trap cleanup EXIT

echo "record-trace: booting with -accel $ACCEL. Serial log: $WORK/record-serial.log"
qemu-system-x86_64 \
    -machine q35 -accel "$ACCEL" -cpu "$CPU" -smp 2 -m 2048 \
    -drive if=pflash,format=raw,readonly=on,file="$OVMF_CODE" \
    -drive if=pflash,format=raw,file="$WORK/record-vars.fd" \
    -drive if=virtio,format=qcow2,file="$DISK" \
    -netdev "user,id=n0,hostfwd=tcp:127.0.0.1:$SSH_PORT-:22" -device virtio-net-pci,netdev=n0 \
    -smbios "type=1,serial=ds=nocloud;s=http://10.0.2.2:$HTTP_PORT/" \
    -display none -serial "file:$WORK/record-serial.log" -monitor none &
QEMU_PID=$!

SSH=(ssh -i "$KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
    -o LogLevel=ERROR -o ConnectTimeout=5 -o BatchMode=yes debian@127.0.0.1)

# Wait for boot 2: SSH answers and the command line has initcall_debug.
deadline=$((SECONDS + TIMEOUT_S))
until "${SSH[@]}" 'grep -q initcall_debug /proc/cmdline' 2> /dev/null; do
    kill -0 "$QEMU_PID" 2> /dev/null || die "QEMU stopped. See $WORK/record-serial.log"
    [ "$SECONDS" -lt "$deadline" ] || die "no second boot after ${TIMEOUT_S}s. See $WORK/record-serial.log"
    sleep 10
done
echo "record-trace: boot 2 is up after ${SECONDS}s. Waiting for the boot to finish."
"${SSH[@]}" 'sudo systemctl is-system-running --wait' || true

mkdir -p "$(dirname "$OUT")"
"${SSH[@]}" 'sudo python3 -' < "$HERE/collect-trace.py" > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
"${SSH[@]}" 'sudo systemctl poweroff' || true
wait "$QEMU_PID" || true
QEMU_PID=""
echo "record-trace: wrote $OUT ($(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["boxes"]))' "$OUT") boxes)"
