#!/usr/bin/env bash
# Boot the bootmap kernel in QEMU with OVMF (UEFI), so the kernel draws on
# the GOP framebuffer.
#
#   vm/run.sh --kernel-only [--show]
#   BOOTMAP_ARGS="bootmap.fill=spiral bootmap.warn_ms=100" vm/run.sh --kernel-only
#
# --kernel-only  bzImage + an initramfs with tinyinit only. tinyinit copies
#                /proc/bootmap to working/run/bootmap.txt and powers off.
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
DISPLAY_ARGS=(-display none)
for a in "$@"; do
    case "$a" in
        --kernel-only) MODE=kernel ;;
        --show) DISPLAY_ARGS=(-display gtk) ;;
        *) die "unknown argument: $a" ;;
    esac
done
[ "$MODE" = kernel ] || die "usage: vm/run.sh --kernel-only [--show]"
[ -f "$KERNEL" ] || die "$KERNEL not found. Run kernel/fetch-and-build.sh"
[ -x "$GEN_CPIO" ] || make -s -C "$WORK/linux" usr/gen_init_cpio

(cd "$ROOT" && zig build)

# A new run directory. Old frames would mix with new ones, so each run
# gets a fresh name and run/ points at it.
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$WORK/runs/$STAMP"
mkdir -p "$OUT"
ln -sfn "runs/$STAMP" "$RUN"

# The initramfs: tinyinit as /init, and the directories it mounts on.
cat > "$OUT/initramfs.list" << EOF
dir /dev 0755 0 0
nod /dev/console 0600 0 0 c 5 1
dir /proc 0755 0 0
file /init $ROOT/zig-out/bin/tinyinit 0755 0 0
EOF
"$GEN_CPIO" "$OUT/initramfs.list" > "$OUT/initramfs.cpio"

cp /usr/share/OVMF/OVMF_VARS_4M.fd "$OUT/vars.fd"
if [ -w /dev/kvm ]; then ACCEL=kvm; CPU=host; else ACCEL=tcg; CPU=max; fi

qemu-system-x86_64 \
    -machine q35 -accel "$ACCEL" -cpu "$CPU" -smp 2 -m 1024 \
    -drive if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd \
    -drive if=pflash,format=raw,file="$OUT/vars.fd" \
    -kernel "$KERNEL" -initrd "$OUT/initramfs.cpio" \
    -append "console=ttyS0 loglevel=6 bootmap.stages=$STAGES $EXTRA" \
    -serial "file:$OUT/serial.log" -serial "file:$OUT/bootmap.txt" \
    -qmp "unix:$OUT/qmp.sock,server,nowait" -no-reboot \
    "${DISPLAY_ARGS[@]}" &
QEMU_PID=$!

python3 "$HERE/capture.py" "$OUT/qmp.sock" "$OUT/frames" 0.1 || true
wait "$QEMU_PID" || true
echo "run: $(grep -c . "$OUT/bootmap.txt" 2> /dev/null || echo 0) lines in $OUT/bootmap.txt"
grep -m1 'bootmap:' "$OUT/serial.log" || echo "run: no bootmap line in the kernel log"
