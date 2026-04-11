#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/35.wav"
out="$(out_file 35 pitch_shift .wav)"
gen_tiny_audio "$in" 440 1
convert pitch_shift "$out" "$in"
pass 35_pitch_shift "$out"
