#!/usr/bin/env bash
# Bundle the JS of minecraft.seanmizen.com, and give the chunk worker files
# content-hashed names (C9). build.sh and the dockerfile both run this
# script, so the local build and the image have the same files.
#
# Usage:
#   ./apps/minecraft.seanmizen.com/bundle.sh <chunks.wasm> <output dir>
#
# The output directory gets:
#   chunks-<hash>.wasm        a copy of chunks.wasm
#   chunk-worker-<hash>.js    the bundle of backends/wasm/chunk-worker.ts
#   boot.js                   the bundle of src/boot.ts. It holds the two
#                             names above, so it loads only the chunk files
#                             of its own build.
#
# <hash> is the start of the SHA-256 of the file. A new build gives new
# names, so a browser cache cannot give an old chunks.wasm to a new
# app.wasm. The worker pool also checks the build id at start-up.
#
# Without chunks.wasm, boot.js has no chunk worker files, and the main thread
# runs the chunk jobs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WASM_BACKEND="${SCRIPT_DIR}/../../utils/swindowzig/backends/wasm"
CHUNKS_WASM="${1:?usage: bundle.sh <chunks.wasm> <output dir>}"
OUT_DIR="${2:?usage: bundle.sh <chunks.wasm> <output dir>}"

hash16() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -c1-16
  else
    shasum -a 256 "$1" | cut -c1-16
  fi
}

mkdir -p "${OUT_DIR}"
# Remove the chunk files of an older build.
rm -f "${OUT_DIR}"/chunks-*.wasm "${OUT_DIR}"/chunk-worker-*.js

defines=()
if [ -f "${CHUNKS_WASM}" ]; then
  chunks_name="chunks-$(hash16 "${CHUNKS_WASM}").wasm"
  cp "${CHUNKS_WASM}" "${OUT_DIR}/${chunks_name}"

  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp}"' EXIT
  bun build "${WASM_BACKEND}/chunk-worker.ts" \
    --outfile "${tmp}/chunk-worker.js" \
    --target browser \
    --minify
  worker_name="chunk-worker-$(hash16 "${tmp}/chunk-worker.js").js"
  mv "${tmp}/chunk-worker.js" "${OUT_DIR}/${worker_name}"

  defines=(
    --define "__CHUNKS_WASM_URL__=\"./${chunks_name}\""
    --define "__CHUNK_WORKER_URL__=\"./${worker_name}\""
  )
  echo "    chunk files: ${chunks_name} ${worker_name}"
else
  echo "    warning: ${CHUNKS_WASM} does not exist. boot.js starts no chunk workers."
fi

bun build "${SCRIPT_DIR}/src/boot.ts" \
  --outfile "${OUT_DIR}/boot.js" \
  --target browser \
  --minify \
  ${defines[@]+"${defines[@]}"}
