#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/05.mp4"
out="$(out_file 05 h264_to_h265 .mp4)"
gen_tiny_video "$in" yellow 1
convert h264_to_h265 "$out" "$in"
pass 05_h264_to_h265 "$out"
