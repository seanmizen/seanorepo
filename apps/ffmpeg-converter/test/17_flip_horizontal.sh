#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/17.mp4"
out="$(out_file 17 flip_horizontal .mp4)"
gen_testsrc_video "$in" 1
convert flip "$out" "$in" -- direction=h
pass 17_flip_horizontal "$out"
