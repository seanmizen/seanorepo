#!/usr/bin/env bash
# 02 — send a high-priority (priority=5) message with tags, expect HTTP 204
set -euo pipefail

RELAY="${RELAY_URL:-http://localhost:8080}"
SECRET="${NOTIFY_SECRET:-test-secret}"

BODY='{"message":"urgent: something broke","title":"ALERT","priority":5,"tags":["rotating_light","skull"]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$RELAY/notify" \
  -H "Content-Type: application/json" \
  -H "X-Notify-Signature: $SIG" \
  -d "$BODY")

if [[ "$STATUS" == "204" ]]; then
  echo "PASS: 02_send_high → 204"
else
  echo "FAIL: 02_send_high → expected 204, got $STATUS"
  exit 1
fi
