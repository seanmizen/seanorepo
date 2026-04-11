#!/usr/bin/env bash
# 02_send_high — send a high-priority message (dry-run safe)
set -euo pipefail

: "${NOTIFY_SECRET:?set NOTIFY_SECRET}"
: "${RELAY_URL:=http://localhost:8765}"

BODY='{"message":"Deploy failed on carolinemizen.art.","title":"Deploy: carolinemizen.art","priority":"high","tags":["deploy","error"]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$NOTIFY_SECRET" | awk '{print $2}')"

echo "POST $RELAY_URL/notify (high priority)"
curl -sf -X POST "$RELAY_URL/notify" \
  -H "Content-Type: application/json" \
  -H "X-Notify-Signature: $SIG" \
  -d "$BODY"
echo
