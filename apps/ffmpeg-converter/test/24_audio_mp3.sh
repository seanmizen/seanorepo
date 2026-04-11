#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/24.wav"
out="$(out_file 24 audio_mp3 .mp3)"
gen_tiny_audio "$in" 440 1
convert audio_mp3 "$out" "$in"
pass 24_audio_mp3 "$out"
