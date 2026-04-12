#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/12.mp4"
out="$(out_file 12 contact_sheet_3x3 .jpg)"
gen_testsrc_video "$in" 2
convert contact_sheet "$out" "$in" -- cols=3 rows=3
pass 12_contact_sheet_3x3 "$out"
