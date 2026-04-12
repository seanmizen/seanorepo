#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/33.wav"
out="$(out_file 33 audio_bitrate_96k .mp3)"
gen_tiny_audio "$in" 440 1
convert audio_bitrate "$out" "$in" -- bitrate=96k
pass 33_audio_bitrate_96k "$out"
