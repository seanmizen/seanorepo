#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/23.mp4"
out="$(out_file 23 extract_audio .wav)"
gen_tiny_video "$in" lime 1
convert extract_audio "$out" "$in"
pass 23_extract_audio_wav "$out"
