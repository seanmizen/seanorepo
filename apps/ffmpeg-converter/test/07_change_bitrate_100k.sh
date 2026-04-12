#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/07.mp4"
out="$(out_file 07 change_bitrate_100k .mp4)"
gen_tiny_video "$in" purple 1
convert change_bitrate "$out" "$in" -- bitrate=100k
pass 07_change_bitrate_100k "$out"
