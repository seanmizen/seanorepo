#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
out="$(out_file 43 gif_from_images .gif)"
frames=()
for i in 1 2 3 4 5; do
    p="$IN_DIR/43_frame_${i}.png"
    hex="$(printf '%02x%02x%02x' $((i*40)) 200 $((i*20)))"
    ffmpeg -hide_banner -loglevel error -y \
        -f lavfi -i "color=c=0x${hex}:s=96x64:d=0.1" \
        -frames:v 1 "$p"
    frames+=("$p")
done
convert gif_from_images "$out" "${frames[@]}"
pass 43_gif_from_images "$out"
