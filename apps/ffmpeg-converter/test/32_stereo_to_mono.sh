#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/32.wav"
out="$(out_file 32 stereo_to_mono .wav)"
# Make a stereo file by merging two tones.
ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "sine=frequency=440:sample_rate=16000:duration=1" \
    -f lavfi -i "sine=frequency=660:sample_rate=16000:duration=1" \
    -filter_complex "[0:a][1:a]amerge=inputs=2" -ac 2 -c:a pcm_s16le "$in"
convert stereo_to_mono "$out" "$in"
pass 32_stereo_to_mono "$out"
