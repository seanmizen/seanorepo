#!/usr/bin/env bash
# Preview the GRUB theme in QEMU: OVMF boots a standalone GRUB with the theme
# and a menu like Debian's. No kernel, so a run takes seconds.
#
#   grub/preview.sh [--show] [--size WxH] [--scale N] [--palette NAME]
#
# Frames go to working/grub-run/frames/, as vm/run.sh does. The menu stays
# until the timeout (10 s), then GRUB stops (there is nothing to boot).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
WORK="$ROOT/working"
OUT="$WORK/grub-run"
SIZE=1280x800
SCALE=1
PALETTE=dataviz
DISPLAY_ARGS=(-display none)
while [ $# -gt 0 ]; do
    case "$1" in
        --show) DISPLAY_ARGS=(-display gtk) ;;
        --size) SIZE="$2"; shift ;;
        --scale) SCALE="$2"; shift ;;
        --palette) PALETTE="$2"; shift ;;
        *) echo "preview: unknown argument: $1" >&2; exit 1 ;;
    esac
    shift
done

command -v grub-mkstandalone > /dev/null || { echo "preview: sudo apt install grub-efi-amd64-bin grub-common" >&2; exit 1; }

# A new folder each run: the old frames and the old binary go with it.
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN="$WORK/grub-runs/$STAMP"
mkdir -p "$RUN/esp/EFI/BOOT" "$RUN/theme"
ln -sfn "grub-runs/$STAMP" "$OUT"

python3 "$HERE/make-theme.py" "$RUN/theme" --scale "$SCALE" --palette "$PALETTE"

# The same entries as Debian's menu on surface, with the bootmap kernel.
cat > "$RUN/grub.cfg" << EOF
insmod all_video
insmod gfxterm
insmod gfxmenu
insmod png
set gfxmode=$SIZE
terminal_output gfxterm
loadfont (memdisk)/boot/grub/themes/bootmap/bootmap.pf2
set theme=(memdisk)/boot/grub/themes/bootmap/theme.txt
set timeout=10
set timeout_style=menu
menuentry 'Debian GNU/Linux, with bootmap (6.12.113-bootmap)' { echo boot; }
menuentry 'Debian GNU/Linux' { echo boot; }
submenu 'Advanced options for Debian GNU/Linux' { menuentry 'x' { true; } }
menuentry 'UEFI Firmware Settings' { fwsetup; }
EOF

MAPS=("boot/grub/grub.cfg=$RUN/grub.cfg")
for f in "$RUN/theme"/*; do
    MAPS+=("boot/grub/themes/bootmap/$(basename "$f")=$f")
done
grub-mkstandalone --format=x86_64-efi --output="$RUN/esp/EFI/BOOT/BOOTX64.EFI" \
    --modules="part_gpt fat" "${MAPS[@]}"

cp /usr/share/OVMF/OVMF_VARS_4M.fd "$RUN/vars.fd"
if [ -w /dev/kvm ]; then ACCEL=kvm; else ACCEL=tcg; fi
qemu-system-x86_64 -machine q35 -accel "$ACCEL" -m 512 \
    -drive if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd \
    -drive if=pflash,format=raw,file="$RUN/vars.fd" \
    -drive "file=fat:rw:$RUN/esp,format=raw" \
    -qmp "unix:$RUN/qmp.sock,server,nowait" -no-reboot \
    "${DISPLAY_ARGS[@]}" &
QEMU_PID=$!
if [ "${DISPLAY_ARGS[1]}" = none ]; then
    (sleep 25; kill "$QEMU_PID" 2> /dev/null) &
fi
python3 "$ROOT/vm/capture.py" "$RUN/qmp.sock" "$RUN/frames" 0.25 2> /dev/null || true
wait "$QEMU_PID" 2> /dev/null || true
echo "preview: frames in $RUN/frames"
