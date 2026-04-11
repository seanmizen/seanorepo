#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/49.wav"
out="$(out_file 49 silence_trim .wav)"
# Prepend/append silence to a tone so the trimmer has something to chew on.
ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "anullsrc=r=16000:cl=mono" -t 0.3 -c:a pcm_s16le "$IN_DIR/49_sil.wav"
ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "sine=frequency=500:sample_rate=16000:duration=0.5" -c:a pcm_s16le "$IN_DIR/49_tone.wav"
ffmpeg -hide_banner -loglevel error -y \
    -i "$IN_DIR/49_sil.wav" -i "$IN_DIR/49_tone.wav" -i "$IN_DIR/49_sil.wav" \
    -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1" -c:a pcm_s16le "$in"
convert silence_trim "$out" "$in"
pass 49_silence_trim "$out"
