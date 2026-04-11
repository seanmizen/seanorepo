#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/08.mp4"
out="$(out_file 08 trim_half_sec .mp4)"
gen_testsrc_video "$in" 1
convert trim "$out" "$in" -- start=0.2 duration=0.5
pass 08_trim_half_sec "$out"
