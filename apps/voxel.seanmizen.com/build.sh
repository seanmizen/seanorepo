#!/usr/bin/env bash
# Local (host-side) build for voxel.seanmizen.com.
# Mirrors what the Dockerfile does, but runs on your dev machine using the
# monorepo's pinned toolchains. Safe to re-run; each step is idempotent.
#
# Usage:
#   ./apps/voxel.seanmizen.com/build.sh [--example=voxel|justabox|...]
#
# SWINDOWZIG_FORK=<path>: build against a local swindowzig checkout, not the
# pinned release (zig build --fork). Unset: the pinned release.
#
# What it does:
#   1. Run `zig build` in this directory. build.zig builds the example of
#      the swindowzig release that build.zig.zon pins: app.wasm and
#      chunks.wasm (the chunk worker). It also installs the web backend of
#      that release to zig-out/swindowzig.
#   2. Run bundle.sh: RSBuild (rsbuild.config.ts) makes boot.js and the
#      chunk worker bundle, and the chunk files get content-hashed names (C9)
#   3. Copy the artefacts into apps/voxel.seanmizen.com/public/
#
# Neither step writes outside the repo. Skip any step that fails with a
# warning — the fallback boot.js + missing-app.wasm message in public/ will
# keep the static page functional so the deploy still works end-to-end.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIG_OUT="${SCRIPT_DIR}/zig-out"
PUBLIC_DIR="${SCRIPT_DIR}/public"

EXAMPLE="${VOXEL_EXAMPLE:-voxel}"
for arg in "$@"; do
  case "$arg" in
    --example=*) EXAMPLE="${arg#--example=}" ;;
  esac
done

echo "==> voxel.seanmizen.com build"
echo "    swindowzig : ${SWINDOWZIG_FORK:-the release in build.zig.zon}"
echo "    example    : ${EXAMPLE}"
echo "    output dir : ${PUBLIC_DIR}"

mkdir -p "${PUBLIC_DIR}"

# --- 1. Zig WASM build ------------------------------------------------------
if command -v zig >/dev/null 2>&1; then
  ZIG_ARGS=(-Dexample="${EXAMPLE}" -Doptimize=ReleaseFast)
  if [ -n "${SWINDOWZIG_FORK:-}" ]; then
    ZIG_ARGS+=("--fork=$(cd "${SWINDOWZIG_FORK}" && pwd)")
  fi
  echo "==> zig build ${ZIG_ARGS[*]}"
  if ( cd "${SCRIPT_DIR}" && zig build "${ZIG_ARGS[@]}" ); then
    if [ -f "${ZIG_OUT}/bin/app.wasm" ]; then
      cp "${ZIG_OUT}/bin/app.wasm" "${PUBLIC_DIR}/app.wasm"
      echo "    ✅ app.wasm → ${PUBLIC_DIR}/app.wasm"
    else
      echo "    ⚠️  zig build succeeded but no zig-out/bin/app.wasm produced — skipping copy"
    fi
  else
    echo "    ⚠️  zig build -Dexample=${EXAMPLE} failed — keeping existing ${PUBLIC_DIR}/app.wasm (if any)"
    echo "       Read the zig errors above. Run the same command in ${SCRIPT_DIR} to see them again."
  fi
else
  echo "    ⚠️  zig not found on PATH — skipping WASM build. Install the Zig version in build.zig.zon (minimum_zig_version)."
fi

# --- 2. JS bundle (RSBuild) -------------------------------------------------
# bundle.sh bundles src/boot.ts (with the swindowzig wasm loader,
# zig-out/swindowzig/backends/wasm/loader.ts) and the chunk worker
# (backends/wasm/chunk-worker.ts).
# It copies chunks.wasm. The chunk files get content-hashed names, and
# boot.js holds the names (C9).
if command -v yarn >/dev/null 2>&1; then
  echo "==> bundle.sh → public/boot.js, public/chunks-*.wasm, public/chunk-worker-*.js"
  if bash "${SCRIPT_DIR}/bundle.sh" "${ZIG_OUT}/bin/chunks.wasm" "${PUBLIC_DIR}"; then
    echo "    ✅ boot.js and the chunk worker files bundled"
  else
    echo "    ⚠️  bundle.sh failed — keeping previously committed boot.js"
  fi
else
  echo "    ⚠️  yarn not found on PATH — keeping the existing boot.js"
fi

echo "==> done. Static output lives under: ${PUBLIC_DIR}"
echo "    Preview locally: npx serve -s ${PUBLIC_DIR} -l 4040"
