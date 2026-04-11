#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/03.mp4"
out="$(out_file 03 transcode_mp4_to_mkv .mkv)"
gen_tiny_video "$in" green 1
convert transcode_mkv "$out" "$in"
pass 03_transcode_mp4_to_mkv "$out"
