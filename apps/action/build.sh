#!/usr/bin/env bash
# Where: apps/action/build.sh
# When: before `yarn workspace action start`. The dockerfile does the same
# steps in its own stages.
# Why: builds the generated files of public/:
#   action.wasm        the game (game/, Zig, ReleaseFast)
#   boot.js            src/boot.ts with the swindowzig wasm loader
#   build-version.txt  the build version (scripts/build-version.sh). The
#                      game has the same value, and the server reads it.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPTIMIZE="${OPTIMIZE:-ReleaseFast}"
VERSION="$(bash "${DIR}/scripts/build-version.sh")"

(cd "${DIR}/game" && zig build -Doptimize="${OPTIMIZE}" -Dbuild_version="${VERSION}")
cp "${DIR}/game/zig-out/bin/action.wasm" "${DIR}/public/action.wasm"
printf '%s\n' "${VERSION}" > "${DIR}/public/build-version.txt"
bun build "${DIR}/src/boot.ts" --outfile "${DIR}/public/boot.js" --target browser --minify
echo "action: public/ is ready, build ${VERSION}"
