#!/usr/bin/env bash
# Local (host-side) build for minecraft.seanmizen.com.
# Mirrors what the Dockerfile does, but runs on your dev machine using the
# monorepo's pinned toolchains. Safe to re-run; each step is idempotent.
#
# Usage:
#   ./apps/minecraft.seanmizen.com/build.sh [--example=voxel|justabox|...]
#
# What it does:
#   1. cd into utils/swindowzig and run `zig build web` to produce app.wasm
#   2. Use `bun build` to bundle the swindowzig WASM bootstrap TS into one JS
#   3. Copy both artefacts into apps/minecraft.seanmizen.com/public/
#
# Neither step writes outside the repo. Skip any step that fails with a
# warning — the fallback boot.js + missing-app.wasm message in public/ will
# keep the static page functional so the deploy still works end-to-end.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SWINDOWZIG="${REPO_ROOT}/utils/swindowzig"
PUBLIC_DIR="${SCRIPT_DIR}/public"

EXAMPLE="${VOXEL_EXAMPLE:-voxel}"
for arg in "$@"; do
  case "$arg" in
    --example=*) EXAMPLE="${arg#--example=}" ;;
  esac
done

echo "==> minecraft.seanmizen.com build"
echo "    repo root  : ${REPO_ROOT}"
echo "    swindowzig : ${SWINDOWZIG}"
echo "    example    : ${EXAMPLE}"
echo "    output dir : ${PUBLIC_DIR}"

mkdir -p "${PUBLIC_DIR}"

# --- 1. Zig WASM build ------------------------------------------------------
if command -v zig >/dev/null 2>&1; then
  echo "==> zig build web -Dexample=${EXAMPLE} -Doptimize=ReleaseFast"
  if ( cd "${SWINDOWZIG}" && zig build web -Dexample="${EXAMPLE}" -Doptimize=ReleaseFast ); then
    if [ -f "${SWINDOWZIG}/zig-out/bin/app.wasm" ]; then
      cp "${SWINDOWZIG}/zig-out/bin/app.wasm" "${PUBLIC_DIR}/app.wasm"
      echo "    ✅ app.wasm → ${PUBLIC_DIR}/app.wasm"
    else
      echo "    ⚠️  zig build succeeded but no zig-out/bin/app.wasm produced — skipping copy"
    fi
  else
    echo "    ⚠️  zig build web -Dexample=${EXAMPLE} failed — keeping existing ${PUBLIC_DIR}/app.wasm (if any)"
    echo "       The voxel example currently fails to compile for wasm32-freestanding."
    echo "       See apps/minecraft.seanmizen.com/INVESTIGATION.md § Phase 2 for the delta."
  fi
else
  echo "    ⚠️  zig not found on PATH — skipping WASM build. Install Zig 0.15.2 to fix."
fi

# --- 2. Bun JS bundle -------------------------------------------------------
# Our src/boot.ts imports the swindowzig WebGPU bridge, event pump, and audio
# shim — bun resolves those relative imports and produces one self-contained
# boot.js at the production path.
if command -v bun >/dev/null 2>&1; then
  echo "==> bun build src/boot.ts → public/boot.js"
  if bun build "${SCRIPT_DIR}/src/boot.ts" \
      --outfile "${PUBLIC_DIR}/boot.js" \
      --target browser \
      --minify; then
    echo "    ✅ boot.js bundled"
  else
    echo "    ⚠️  bun build failed — keeping previously committed boot.js"
  fi
else
  echo "    ⚠️  bun not found on PATH — keeping previously committed boot.js"
fi

echo "==> done. Static output lives under: ${PUBLIC_DIR}"
echo "    Preview locally: npx serve -s ${PUBLIC_DIR} -l 4040"
