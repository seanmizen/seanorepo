#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/34.wav"
out="$(out_file 34 time_stretch .wav)"
gen_tiny_audio "$in" 440 1
convert time_stretch "$out" "$in" -- factor=1.5
pass 34_time_stretch "$out"
