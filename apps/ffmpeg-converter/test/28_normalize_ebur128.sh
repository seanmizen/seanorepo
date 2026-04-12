#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/28.wav"
out="$(out_file 28 normalize_ebur128 .wav)"
gen_tiny_audio "$in" 330 2
convert normalize_audio "$out" "$in"
pass 28_normalize_ebur128 "$out"
