#!/usr/bin/env bash
# 03 — verify dry-run mode: server started without NTFY_URL should still return 204
#      (nothing is sent to ntfy; relay just logs [dry-run])
#
# Usage: start the server with no NTFY_URL before running this test:
#   go run . &
#   bash test/03_dry_run.sh
#   kill %1
set -euo pipefail

RELAY="${RELAY_URL:-http://localhost:8080}"
SECRET="${NOTIFY_SECRET:-test-secret}"

BODY='{"message":"dry run smoke test","title":"Dry Run","priority":3}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$RELAY/notify" \
  -H "Content-Type: application/json" \
  -H "X-Notify-Signature: $SIG" \
  -d "$BODY")

if [[ "$STATUS" == "204" ]]; then
  echo "PASS: 03_dry_run → 204 (message logged, not sent)"
else
  echo "FAIL: 03_dry_run → expected 204, got $STATUS"
  exit 1
fi
