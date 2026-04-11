#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
has_filter subtitles || skip 19_subtitles_burn_in "no 'subtitles' filter (needs libass)"
vid="$IN_DIR/19.mp4"; srt="$IN_DIR/19.srt"
out="$(out_file 19 subtitles_burn_in .mp4)"
gen_tiny_video "$vid" teal 1
gen_srt "$srt"
convert subtitles_burn "$out" "$vid" "$srt"
pass 19_subtitles_burn_in "$out"
