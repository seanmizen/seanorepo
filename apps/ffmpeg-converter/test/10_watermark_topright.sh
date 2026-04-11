#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
vid="$IN_DIR/10.mp4"; logo="$IN_DIR/10_logo.png"
out="$(out_file 10 watermark_topright .mp4)"
gen_tiny_video "$vid" navy 1
gen_tiny_png_with_text "$logo" "(C)"
convert watermark "$out" "$vid" "$logo"
pass 10_watermark_topright "$out"
