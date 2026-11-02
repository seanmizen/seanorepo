#!/usr/bin/env bash
# Copy the Debian initramfs out of working/guest.qcow2 to working/initrd.img.
#
#   vm/fetch-initrd.sh
#
# vm/run.sh --full boots with it when it exists, so the boot has an initrd
# stage. Debian's initramfs-tools /init loads modules for the Debian kernel,
# and those loads fail with the bootmap kernel. That does no harm: the bootmap
# kernel has the virtio and ext4 drivers built in.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
WORK="$ROOT/working"

die() { echo "fetch-initrd: $*" >&2; exit 1; }
[ -f "$WORK/guest.qcow2" ] || die "$WORK/guest.qcow2 not found. Run vm/prepare-guest.sh"

BOOTMAP_RUN_S=600 "$HERE/run.sh" --full > "$WORK/fetch-initrd-run.log" 2>&1 &
RUN_PID=$!
PORT=""
for _ in $(seq 1 60); do
    PORT="$(grep -o 'ssh -p [0-9]*' "$WORK/fetch-initrd-run.log" 2> /dev/null | awk '{print $3}' || true)"
    [ -n "$PORT" ] && break
    sleep 1
done
[ -n "$PORT" ] || die "the guest did not start. See $WORK/fetch-initrd-run.log"

SSH=(ssh -p "$PORT" -i "$WORK/id_ed25519" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
    -o LogLevel=ERROR -o ConnectTimeout=5 -o BatchMode=yes debian@127.0.0.1)
until "${SSH[@]}" true 2> /dev/null; do
    kill -0 "$RUN_PID" 2> /dev/null || die "the guest stopped. See $WORK/run/serial.log"
    sleep 5
done
"${SSH[@]}" 'sudo cat "$(ls /boot/initrd.img-* | head -1)"' > "$WORK/initrd.img.tmp"
mv "$WORK/initrd.img.tmp" "$WORK/initrd.img"
"${SSH[@]}" 'sudo systemctl poweroff' || true
wait "$RUN_PID" || true
echo "fetch-initrd: $WORK/initrd.img ($(du -h "$WORK/initrd.img" | cut -f1))"
