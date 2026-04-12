#!/usr/bin/env bash
# 01 — send a low-priority (priority=1) message, expect HTTP 204
set -euo pipefail

RELAY="${RELAY_URL:-http://localhost:8080}"
SECRET="${NOTIFY_SECRET:-test-secret}"

BODY='{"message":"low-priority smoke test","title":"Test 01","priority":1,"tags":["white_check_mark"]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$RELAY/notify" \
  -H "Content-Type: application/json" \
  -H "X-Notify-Signature: $SIG" \
  -d "$BODY")

if [[ "$STATUS" == "204" ]]; then
  echo "PASS: 01_send_low → 204"
else
  echo "FAIL: 01_send_low → expected 204, got $STATUS"
  exit 1
fi
