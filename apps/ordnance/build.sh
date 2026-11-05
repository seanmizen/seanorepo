#!/usr/bin/env bash
# Where: apps/ordnance/build.sh
# When: before the dev server or the RSBuild build (package.json runs it).
#   After a change to game/, run it again and reload the page.
# Why: builds the game (game/, Zig) to public/ordnance.wasm. The build also
#   copies the swindowzig wasm loader to game/zig-out/swindowzig-wasm/, and
#   src/boot.ts imports it from there.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPTIMIZE="${OPTIMIZE:-ReleaseFast}"

(cd "${DIR}/game" && zig build -Doptimize="${OPTIMIZE}")
cp "${DIR}/game/zig-out/bin/ordnance.wasm" "${DIR}/public/ordnance.wasm"
echo "ordnance: public/ordnance.wasm is ready"
