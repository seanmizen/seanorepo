#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
in="$IN_DIR/46.png"
out="$(out_file 46 image_grayscale .png)"
gen_tiny_image "$in" magenta
convert grayscale "$out" "$in"
pass 46_image_grayscale "$out"
