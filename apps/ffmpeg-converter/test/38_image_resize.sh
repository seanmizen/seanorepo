#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/38.png"
out="$(out_file 38 image_resize .png)"
gen_tiny_image "$in" teal
convert image_resize "$out" "$in" -- width=48 height=27
pass 38_image_resize "$out"
