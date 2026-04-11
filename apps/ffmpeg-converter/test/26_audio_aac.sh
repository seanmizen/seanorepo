#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/26.wav"
out="$(out_file 26 audio_aac .m4a)"
gen_tiny_audio "$in" 660 1
convert audio_aac "$out" "$in"
pass 26_audio_aac "$out"
