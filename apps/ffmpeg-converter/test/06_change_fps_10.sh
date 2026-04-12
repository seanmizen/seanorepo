#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/06.mp4"
out="$(out_file 06 change_fps_10 .mp4)"
gen_testsrc_video "$in" 1
convert change_framerate "$out" "$in" -- fps=10
pass 06_change_fps_10 "$out"
