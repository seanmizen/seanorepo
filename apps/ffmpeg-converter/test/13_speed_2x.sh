#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/13.mp4"
out="$(out_file 13 speed_2x .mp4)"
gen_testsrc_video "$in" 1
convert speed "$out" "$in" -- factor=2.0
pass 13_speed_2x "$out"
