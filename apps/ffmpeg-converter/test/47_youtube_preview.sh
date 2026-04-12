#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/47.mp4"
out="$(out_file 47 youtube_preview .gif)"
gen_testsrc_video "$in" 2
convert youtube_preview "$out" "$in" -- seconds=1
pass 47_youtube_preview "$out"
