#!/usr/bin/env bash
# Where: apps/action/scripts/build-version.sh
# When: build.sh runs it, and `yarn workspace action prod:docker` gives its
#       output to the dockerfile as the build argument BUILD_VERSION.
# Why: prints the build version of the game. The client gets it at build
#      time (game/build.zig -Dbuild_version). The server reads it from
#      public/build-version.txt (server/session.ts). The value is:
#   1. BUILD_VERSION, when the environment sets it.
#   2. Else the 12-character hash of the last commit that changed
#      apps/action or utils/swindowzig: the inputs of the docker image. A
#      commit to another app does not change the version, so a release of
#      it does not restart the game server. "-dirty" follows the hash when
#      those directories have changes that are not committed.
#   3. Else "dev": no git, or not a checkout.
set -euo pipefail

if [ -n "${BUILD_VERSION:-}" ]; then
    echo "${BUILD_VERSION}"
    exit 0
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(git -C "${DIR}" rev-parse --show-toplevel 2> /dev/null || true)"
if [ -z "${ROOT}" ]; then
    echo dev
    exit 0
fi
PATHS=(apps/action utils/swindowzig)
VERSION="$(git -C "${ROOT}" log -1 --format=%h --abbrev=12 -- "${PATHS[@]}" 2> /dev/null || true)"
if [ -z "${VERSION}" ]; then
    echo dev
    exit 0
fi
if [ -n "$(git -C "${ROOT}" status --porcelain -- "${PATHS[@]}" 2> /dev/null)" ]; then
    VERSION="${VERSION}-dirty"
fi
echo "${VERSION}"
