#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/29.wav"
out="$(out_file 29 audio_trim .wav)"
gen_tiny_audio "$in" 440 2
convert audio_trim "$out" "$in" -- start=0.2 duration=0.5
pass 29_audio_trim "$out"
