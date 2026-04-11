#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/14.mp4"
out="$(out_file 14 reverse .mp4)"
gen_testsrc_video "$in" 1
convert reverse "$out" "$in"
pass 14_reverse "$out"
