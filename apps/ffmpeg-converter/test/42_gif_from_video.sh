#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/42.mp4"
out="$(out_file 42 gif_from_video .gif)"
gen_testsrc_video "$in" 1
convert gif_from_video "$out" "$in"
pass 42_gif_from_video "$out"
