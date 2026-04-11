#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/39.png"
out="$(out_file 39 image_to_jpg .jpg)"
gen_tiny_image "$in" gold
convert image_to_jpg "$out" "$in"
pass 39_image_to_jpg "$out"
