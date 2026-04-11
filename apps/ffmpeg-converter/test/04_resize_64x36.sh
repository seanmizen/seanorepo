#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/04.mp4"
out="$(out_file 04 resize_64x36 .mp4)"
gen_tiny_video "$in" red 1
convert resize "$out" "$in" -- width=64 height=36
pass 04_resize_64x36 "$out"
