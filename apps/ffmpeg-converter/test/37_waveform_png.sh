#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/37.wav"
out="$(out_file 37 waveform .png)"
gen_tiny_audio "$in" 440 1
convert waveform_png "$out" "$in"
pass 37_waveform_png "$out"
