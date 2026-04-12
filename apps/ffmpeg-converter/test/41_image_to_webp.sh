#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
has_encoder libwebp || skip 41_image_to_webp "no 'libwebp' encoder"
in="$IN_DIR/41.png"
out="$(out_file 41 image_to_webp .webp)"
gen_tiny_image "$in" olive
convert image_to_webp "$out" "$in"
pass 41_image_to_webp "$out"
