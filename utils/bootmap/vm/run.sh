#!/usr/bin/env bash
# Boot the bootmap kernel in QEMU with OVMF (UEFI), so the kernel draws on
# the GOP framebuffer.
#
#   vm/run.sh --kernel-only [--show]
#   vm/run.sh --full [--show] [--fresh]
#   BOOTMAP_ARGS="bootmap.fill=spiral bootmap.warn_ms=100" vm/run.sh --kernel-only
#
# --kernel-only  bzImage + an initramfs with tinyinit only. tinyinit copies
#                /proc/bootmap to working/run/bootmap.txt and powers off.
# --full         bzImage boots working/live.qcow2, an overlay on
#                working/guest.qcow2 (vm/prepare-guest.sh). The overlay stays
#                from run to run, so the daemon keeps the unit times of the
#                last boot. --fresh makes a new overlay. With working/initrd.img
#                (vm/fetch-initrd.sh), the boot has an initrd stage.
#                bootmapd runs from zig-out/bin (9p).
#                The run stops after BOOTMAP_RUN_S seconds (default 240),
#                or with --show when you close the window. The run prints
#                the SSH command for the guest (the first free port from 2263).
# --show         show the QEMU window (WSLg or X11). Without it, the screen
#                is only captured to working/run/frames/.
#
# Output in working/run/: serial.log (kernel log), bootmap.txt, frames/.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
WORK="$ROOT/working"
RUN="$WORK/run"
KERNEL="$WORK/linux/arch/x86/boot/bzImage"
GEN_CPIO="$WORK/linux/usr/gen_init_cpio"
STAGES="${BOOTMAP_STAGES:-0,0,30,10,60}"
EXTRA="${BOOTMAP_ARGS:-}"  # more kernel parameters, for example bootmap.fill=spiral

die() { echo "run: $*" >&2; exit 1; }

MODE=""
FRESH=0
DISPLAY_ARGS=(-display none)
for a in "$@"; do
    case "$a" in
        --kernel-only) MODE=kernel ;;
        --full) MODE=full ;;
        --fresh) FRESH=1 ;;
        --show) DISPLAY_ARGS=(-display gtk) ;;
        *) die "unknown argument: $a" ;;
    esac
done
[ -n "$MODE" ] || die "usage: vm/run.sh --kernel-only|--full [--show]"
[ "$MODE" != full ] || [ -f "$WORK/guest.qcow2" ] || die "$WORK/guest.qcow2 not found. Run vm/prepare-guest.sh"
[ -f "$KERNEL" ] || die "$KERNEL not found. Run kernel/fetch-and-build.sh"
[ -x "$GEN_CPIO" ] || make -s -C "$WORK/linux" usr/gen_init_cpio

(cd "$ROOT" && zig build)

# A new run directory. Old frames would mix with new ones, so each run
# gets a fresh name and run/ points at it.
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$WORK/runs/$STAMP"
mkdir -p "$OUT"
ln -sfn "runs/$STAMP" "$RUN"

# --full keeps the UEFI variables between runs (bootmapd saves the
# initcall times in one). --kernel-only starts from empty variables.
if [ "$MODE" = full ]; then
    if [ "$FRESH" = 1 ] || [ ! -f "$WORK/live-vars.fd" ]; then
        cp /usr/share/OVMF/OVMF_VARS_4M.fd "$WORK/live-vars.fd"
    fi
    VARS="$WORK/live-vars.fd"
else
    cp /usr/share/OVMF/OVMF_VARS_4M.fd "$OUT/vars.fd"
    VARS="$OUT/vars.fd"
fi
if [ -w /dev/kvm ]; then ACCEL=kvm; CPU=host; else ACCEL=tcg; CPU=max; fi
COMMON=(
    -machine q35 -accel "$ACCEL" -cpu "$CPU" -smp 2
    -drive if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd
    -drive if=pflash,format=raw,file="$VARS"
    -kernel "$KERNEL"
    -serial "file:$OUT/serial.log"
    -qmp "unix:$OUT/qmp.sock,server,nowait" -no-reboot
)

if [ "$MODE" = kernel ]; then
    # The initramfs: tinyinit as /init, and the directories it mounts on.
    printf '%s\n' 'dir /dev 0755 0 0' 'nod /dev/console 0600 0 0 c 5 1' 'dir /proc 0755 0 0' \
        "file /init $ROOT/zig-out/bin/tinyinit 0755 0 0" > "$OUT/initramfs.list"
    "$GEN_CPIO" "$OUT/initramfs.list" > "$OUT/initramfs.cpio"
    qemu-system-x86_64 "${COMMON[@]}" -m 1024 \
        -initrd "$OUT/initramfs.cpio" \
        -append "console=ttyS0 loglevel=6 bootmap.stages=$STAGES $EXTRA" \
        -serial "file:$OUT/bootmap.txt" \
        "${DISPLAY_ARGS[@]}" &
    QEMU_PID=$!
else
    # With Debian's initrd, the boot has an initrd stage. Without it, the
    # kernel mounts the root itself.
    INITRD=()
    if [ -f "$WORK/initrd.img" ]; then
        INITRD=(-initrd "$WORK/initrd.img")
        STAGES="${BOOTMAP_STAGES:-0,0,30,10,60}"
    else
        STAGES="${BOOTMAP_STAGES:-0,0,30,0,70}"
        echo "run: no $WORK/initrd.img, so no initrd stage (vm/fetch-initrd.sh makes it)"
    fi
    # The first free port for SSH to the guest.
    SSH_PORT=2263
    while ss -ltn "sport = :$SSH_PORT" 2> /dev/null | grep -q LISTEN; do
        SSH_PORT=$((SSH_PORT + 1))
        [ "$SSH_PORT" -lt 2300 ] || die "no free port from 2263 to 2299 for SSH"
    done
    echo "run: SSH to the guest: ssh -p $SSH_PORT -i $WORK/id_ed25519 debian@127.0.0.1"
    # An overlay, so a run never changes guest.qcow2. It stays between runs.
    if [ "$FRESH" = 1 ] || [ ! -f "$WORK/live.qcow2" ]; then
        qemu-img create -q -f qcow2 -F qcow2 -b "$WORK/guest.qcow2" "$WORK/live.qcow2"
    fi
    qemu-system-x86_64 "${COMMON[@]}" -m 2048 \
        -drive if=virtio,format=qcow2,file="$WORK/live.qcow2" "${INITRD[@]}" \
        -append "root=/dev/vda1 rw console=ttyS0 loglevel=5 bootmap.daemon=1 bootmap.stages=$STAGES $EXTRA" \
        -virtfs "local,path=$ROOT/zig-out/bin,mount_tag=bootmap,security_model=none,readonly=on" \
        -netdev "user,id=n0,hostfwd=tcp:127.0.0.1:$SSH_PORT-:22" -device virtio-net-pci,netdev=n0 \
        "${DISPLAY_ARGS[@]}" &
    QEMU_PID=$!
    if [ "${DISPLAY_ARGS[1]}" = none ]; then
        (sleep "${BOOTMAP_RUN_S:-240}"; kill "$QEMU_PID" 2> /dev/null) &
    fi
fi

# QEMU stops at once when an argument is wrong. Say so, and stop here.
sleep 1
kill -0 "$QEMU_PID" 2> /dev/null || { wait "$QEMU_PID" || true; die "QEMU did not start. Its error is above."; }

python3 "$HERE/capture.py" "$OUT/qmp.sock" "$OUT/frames" 0.1 || true
wait "$QEMU_PID" || true
if [ "$MODE" = full ]; then
    echo "run: frames in $OUT/frames, kernel log in $OUT/serial.log"
    exit 0
fi
echo "run: $(grep -c . "$OUT/bootmap.txt" 2> /dev/null || echo 0) lines in $OUT/bootmap.txt"
grep -m1 'bootmap:' "$OUT/serial.log" || echo "run: no bootmap line in the kernel log"
