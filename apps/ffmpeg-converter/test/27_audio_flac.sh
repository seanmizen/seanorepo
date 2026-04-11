#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/27.wav"
out="$(out_file 27 audio_flac .flac)"
gen_tiny_audio "$in" 770 1
convert audio_flac "$out" "$in"
pass 27_audio_flac "$out"
