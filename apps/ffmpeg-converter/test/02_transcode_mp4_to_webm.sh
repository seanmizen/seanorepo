#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/02.mp4"
out="$(out_file 02 transcode_mp4_to_webm .webm)"
gen_tiny_video "$in" blue 1
convert transcode_webm "$out" "$in"
pass 02_transcode_mp4_to_webm "$out"
