#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/30.wav"
out="$(out_file 30 audio_fade .wav)"
gen_tiny_audio "$in" 500 1
convert audio_fade "$out" "$in"
pass 30_audio_fade "$out"
