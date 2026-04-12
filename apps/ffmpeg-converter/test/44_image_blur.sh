#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/44.png"
out="$(out_file 44 image_blur .png)"
gen_tiny_png_with_text "$in" "BLURME"
convert blur "$out" "$in" -- sigma=4
pass 44_image_blur "$out"
