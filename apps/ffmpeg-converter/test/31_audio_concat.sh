#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
a="$IN_DIR/31a.wav"; b="$IN_DIR/31b.wav"
out="$(out_file 31 audio_concat .wav)"
gen_tiny_audio "$a" 440 0.5
gen_tiny_audio "$b" 880 0.5
convert audio_concat "$out" "$a" "$b"
pass 31_audio_concat "$out"
