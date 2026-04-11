#!/usr/bin/env bash
# First test: the server is alive and knows about its ops.
set -euo pipefail
source "$(dirname "$0")/_lib.sh"

resp="$(curl -sS "$SERVER/health")"
grep -q '"status":"ok"' <<<"$resp"
ops="$(printf '%s' "$resp" | sed -n 's/.*"ops":\([0-9]*\).*/\1/p')"
if [[ "${ops:-0}" -lt 30 ]]; then
    echo "expected >=30 ops registered, got $ops" >&2
    exit 1
fi
printf '  \033[32mPASS\033[0m 01_health_check                          %10d ops   /health\n' "$ops"
