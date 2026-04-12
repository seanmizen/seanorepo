#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
out="$(out_file 22 timelapse_from_images .mp4)"
frames=()
for i in 1 2 3 4 5 6 7 8; do
    p="$IN_DIR/22_frame_${i}.png"
    # Rotate colour hue by frame index — cheap way to get distinct frames.
    hex="$(printf '%02x%02x%02x' $((i*30 % 256)) $((i*45 % 256)) $((i*60 % 256)))"
    ffmpeg -hide_banner -loglevel error -y \
        -f lavfi -i "color=c=0x${hex}:s=96x64:d=0.1" \
        -frames:v 1 "$p"
    frames+=("$p")
done
convert timelapse "$out" "${frames[@]}"
pass 22_timelapse_from_images "$out"
