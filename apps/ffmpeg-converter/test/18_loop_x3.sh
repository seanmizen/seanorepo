#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/18.mp4"
out="$(out_file 18 loop_x3 .mp4)"
gen_tiny_video "$in" orange 1
convert loop "$out" "$in" -- count=3
pass 18_loop_x3 "$out"
