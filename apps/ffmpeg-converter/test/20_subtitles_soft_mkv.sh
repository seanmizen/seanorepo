#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
vid="$IN_DIR/20.mp4"; srt="$IN_DIR/20.srt"
out="$(out_file 20 subtitles_soft .mkv)"
gen_tiny_video "$vid" maroon 1
gen_srt "$srt"
convert subtitles_soft "$out" "$vid" "$srt"
pass 20_subtitles_soft_mkv "$out"
