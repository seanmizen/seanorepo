#!/usr/bin/env bash
# Where: apps/action/build.sh
# When: before `yarn workspace action start`, and in the dockerfile.
# Why: builds the two generated files of public/:
#   action.wasm  the game (game/, Zig, ReleaseFast)
#   boot.js      src/boot.ts with the swindowzig wasm loader
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPTIMIZE="${OPTIMIZE:-ReleaseFast}"

(cd "${DIR}/game" && zig build -Doptimize="${OPTIMIZE}")
cp "${DIR}/game/zig-out/bin/action.wasm" "${DIR}/public/action.wasm"
bun build "${DIR}/src/boot.ts" --outfile "${DIR}/public/boot.js" --target browser --minify
echo "action: public/action.wasm and public/boot.js are ready"
