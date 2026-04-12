#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/36.wav"
out="$(out_file 36 spectrogram .png)"
gen_tiny_audio "$in" 440 1
convert spectrogram "$out" "$in"
pass 36_spectrogram_png "$out"
