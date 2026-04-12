#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/40.jpg"
out="$(out_file 40 jpg_to_png .png)"
ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=coral:s=128x72:d=0.1" -frames:v 1 -q:v 5 "$in"
convert image_to_png "$out" "$in"
pass 40_jpg_to_png "$out"
