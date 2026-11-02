#!/usr/bin/env bash
# REQ-BOOTMAP-001: the Zig layout and the C layout give byte-identical
# rectangles. For each trace and each size, this script compares
# `bootmap rects` (Zig) with test/layout_parity.c (kernel/bootmap_layout.c).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/zig-out/parity"
mkdir -p "$OUT"

(cd "$ROOT" && zig build)
cc -O2 -Wall -Wextra -Werror -o "$OUT/layout_parity" \
    "$ROOT/test/layout_parity.c" "$ROOT/kernel/bootmap_layout.c"

fails=0
checks=0
for trace in "$ROOT"/traces/*.json; do
    # size:pad:labels:font
    for case in 1280x800:1,1,1:all:4x6 1920x1080:1,1,1:all:6x8 3840x2160:6,3,2:none:4x6 \
        800x600:1,1,1:areas:4x6 640x480:0,0,0:all:4x6 1024x768:12,6,4:all:6x8 \
        333x777:1,1,1:all:4x6 8192x64:6,3,2:all:4x6 1280x800:20,10,5:none:4x6; do
        IFS=: read -r size pad labels font <<< "$case"
        name="$(basename "$trace" .json)-$size-${pad//,/-}-$labels-$font"
        opts=(--size "$size" "pad=$pad" "labels=$labels" "font=$font")
        "$ROOT/zig-out/bin/bootmap" plan "$trace" "${opts[@]}" > "$OUT/$name.plan"
        "$ROOT/zig-out/bin/bootmap" rects "$trace" "${opts[@]}" > "$OUT/$name.zig"
        "$OUT/layout_parity" < "$OUT/$name.plan" > "$OUT/$name.c"
        checks=$((checks + 1))
        if ! cmp -s "$OUT/$name.zig" "$OUT/$name.c"; then
            echo "layout-parity: FAIL $name"
            diff "$OUT/$name.zig" "$OUT/$name.c" | head -5
            fails=$((fails + 1))
        fi
    done
done
[ "$checks" -gt 0 ] || { echo "layout-parity: no traces in $ROOT/traces"; exit 1; }
[ "$fails" -eq 0 ] || { echo "layout-parity: $fails of $checks checks failed"; exit 1; }
echo "layout-parity: $checks of $checks checks pass"
