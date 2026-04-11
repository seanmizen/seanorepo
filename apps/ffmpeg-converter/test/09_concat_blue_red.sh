#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
a="$IN_DIR/09a.mp4"; b="$IN_DIR/09b.mp4"
out="$(out_file 09 concat_blue_red .mp4)"
gen_tiny_video "$a" blue 1
gen_tiny_video "$b" red 1
convert concat "$out" "$a" "$b"
pass 09_concat_blue_red "$out"
