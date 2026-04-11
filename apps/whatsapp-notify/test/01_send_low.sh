#!/usr/bin/env bash
# 01_send_low — send a low-priority message (dry-run safe)
set -euo pipefail

: "${NOTIFY_SECRET:?set NOTIFY_SECRET}"
: "${RELAY_URL:=http://localhost:8765}"

BODY='{"message":"Background task finished.","title":"Test: low priority","priority":"low","tags":["test"]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$NOTIFY_SECRET" | awk '{print $2}')"

echo "POST $RELAY_URL/notify"
curl -sf -X POST "$RELAY_URL/notify" \
  -H "Content-Type: application/json" \
  -H "X-Notify-Signature: $SIG" \
  -d "$BODY"
echo
