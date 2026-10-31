#!/usr/bin/env bash
# Where: apps/action/build.sh
# When: before `yarn workspace action start`. The dockerfile does the same
# steps in its own stages.
# Why: builds the generated files of public/:
#   action.wasm        the game (game/, Zig, ReleaseFast)
#   boot.js            src/boot.ts with the swindowzig wasm loader (from
#                      game/zig-out/swindowzig, which zig build installs).
#                      RSBuild bundles it (rsbuild.config.ts).
#   build-version.txt  the build version (scripts/build-version.sh). The
#                      game has the same value, and the server reads it.
#
# SWINDOWZIG_FORK=<path>: build against a local swindowzig checkout, not the
# pinned release (zig build --fork). Unset: the pinned release.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPTIMIZE="${OPTIMIZE:-ReleaseFast}"
VERSION="$(bash "${DIR}/scripts/build-version.sh")"

ZIG_ARGS=(-Doptimize="${OPTIMIZE}" -Dbuild_version="${VERSION}")
if [ -n "${SWINDOWZIG_FORK:-}" ]; then
    FORK="$(cd "${SWINDOWZIG_FORK}" && pwd)"
    ZIG_ARGS+=("--fork=${FORK}")
    echo "action: swindowzig from ${FORK}"
fi

(cd "${DIR}/game" && zig build "${ZIG_ARGS[@]}")
cp "${DIR}/game/zig-out/bin/action.wasm" "${DIR}/public/action.wasm"
printf '%s\n' "${VERSION}" > "${DIR}/public/build-version.txt"
(cd "${DIR}" && yarn rsbuild build)
echo "action: public/ is ready, build ${VERSION}"
