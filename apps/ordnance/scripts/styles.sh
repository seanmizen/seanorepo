#!/usr/bin/env bash
# Where: apps/ordnance/scripts/styles.sh
# When: `yarn workspace ordnance styles`.
# Why: one dev server for each playstyle (core/rules.zig), so each one has
#   its own address: 4111 supply_line, 4112 drone_war, 4113 blitz, 4114 fog,
#   4115 manoeuvre, 4116 frontier. Ctrl+C stops them all. Build the wasm
#   first (build.sh); each server serves the same public/ordnance.wasm.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${DIR}"
STYLES=(supply_line drone_war blitz fog manoeuvre frontier)
PIDS=()
trap 'kill "${PIDS[@]}" 2>/dev/null' EXIT INT TERM
for i in "${!STYLES[@]}"; do
    PORT=$((4111 + i)) ORDNANCE_STYLE="${STYLES[$i]}" yarn rsbuild dev --host "${HOST:-127.0.0.1}" > "/tmp/ordnance-${STYLES[$i]}.log" 2>&1 &
    PIDS+=("$!")
    echo "ordnance ${STYLES[$i]}: http://localhost:$((4111 + i))/"
done
wait
