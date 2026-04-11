#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
has_filter drawtext || skip 48_meme_overlay "no 'drawtext' filter (needs libfreetype)"
in="$IN_DIR/48.png"
out="$(out_file 48 meme_overlay .jpg)"
gen_tiny_image "$in" navy
convert meme_overlay "$out" "$in" -- top="ME WRITING" bottom="FFMPEG TESTS"
pass 48_meme_overlay "$out"
