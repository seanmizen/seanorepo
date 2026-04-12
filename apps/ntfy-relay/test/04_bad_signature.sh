#!/usr/bin/env bash
# 04 — wrong HMAC signature must return HTTP 403
set -euo pipefail

RELAY="${RELAY_URL:-http://localhost:8080}"

BODY='{"message":"should be rejected","priority":3}'
BAD_SIG="sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$RELAY/notify" \
  -H "Content-Type: application/json" \
  -H "X-Notify-Signature: $BAD_SIG" \
  -d "$BODY")

if [[ "$STATUS" == "403" ]]; then
  echo "PASS: 04_bad_signature → 403"
else
  echo "FAIL: 04_bad_signature → expected 403, got $STATUS"
  exit 1
fi
