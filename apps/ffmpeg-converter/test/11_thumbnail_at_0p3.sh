#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/11.mp4"
out="$(out_file 11 thumbnail_at_0p3 .jpg)"
gen_testsrc_video "$in" 1
convert thumbnail "$out" "$in" -- timestamp=00:00:00.3
pass 11_thumbnail_at_0p3 "$out"
