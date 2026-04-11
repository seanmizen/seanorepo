#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
has_encoder libaom-av1 || skip 50_image_to_avif "no 'libaom-av1' encoder"
in="$IN_DIR/50.png"
out="$(out_file 50 image_to_avif .avif)"
gen_tiny_image "$in" cyan
convert image_to_avif "$out" "$in"
pass 50_image_to_avif "$out"
