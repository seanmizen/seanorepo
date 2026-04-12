#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/15.mp4"
out="$(out_file 15 crop_center .mp4)"
gen_testsrc_video "$in" 1
convert crop "$out" "$in" -- width=64 height=36 x=32 y=18
pass 15_crop_center_64x36 "$out"
