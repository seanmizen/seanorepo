#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/45.png"
out="$(out_file 45 image_sharpen .png)"
gen_tiny_png_with_text "$in" "SHARP"
convert sharpen "$out" "$in"
pass 45_image_sharpen "$out"
