#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/25.wav"
out="$(out_file 25 audio_opus .opus)"
gen_tiny_audio "$in" 550 1
convert audio_opus "$out" "$in"
pass 25_audio_opus "$out"
