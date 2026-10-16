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
#      and chunks.wasm (the chunk worker)
#   2. Run bundle.sh: `bun build` makes boot.js and the chunk worker bundle,
#      and the chunk files get content-hashed names (C9)
#   3. Copy the artefacts into apps/minecraft.seanmizen.com/public/
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
  echo "    ⚠️  zig not found on PATH — skipping WASM build. Install the Zig version in utils/swindowzig/build.zig.zon."
fi

# --- 2. Bun JS bundle -------------------------------------------------------
# bundle.sh bundles src/boot.ts (with the swindowzig wasm loader,
# backends/wasm/loader.ts) and the chunk worker (backends/wasm/chunk-worker.ts).
# It copies chunks.wasm. The chunk files get content-hashed names, and
# boot.js holds the names (C9).
if command -v bun >/dev/null 2>&1; then
  echo "==> bundle.sh → public/boot.js, public/chunks-*.wasm, public/chunk-worker-*.js"
  if bash "${SCRIPT_DIR}/bundle.sh" "${SWINDOWZIG}/zig-out/bin/chunks.wasm" "${PUBLIC_DIR}"; then
    echo "    ✅ boot.js and the chunk worker files bundled"
  else
    echo "    ⚠️  bundle.sh failed — keeping previously committed boot.js"
  fi
else
  echo "    ⚠️  bun not found on PATH — keeping previously committed boot.js"
fi

echo "==> done. Static output lives under: ${PUBLIC_DIR}"
echo "    Preview locally: npx serve -s ${PUBLIC_DIR} -l 4040"
