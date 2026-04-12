#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/21.mp4"
out="$(out_file 21 pad_aspect_16x9 .mp4)"
gen_tiny_video "$in" fuchsia 1
convert pad_aspect "$out" "$in"
pass 21_pad_aspect_16x9 "$out"
