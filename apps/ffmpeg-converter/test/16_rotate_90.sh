#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/16.mp4"
out="$(out_file 16 rotate_90 .mp4)"
gen_testsrc_video "$in" 1
convert rotate "$out" "$in" -- degrees=90
pass 16_rotate_90 "$out"
