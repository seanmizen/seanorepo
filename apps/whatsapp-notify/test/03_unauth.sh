#!/usr/bin/env bash
# 03_unauth — request without a signature must be rejected with 401
set -euo pipefail

: "${RELAY_URL:=http://localhost:8765}"

BODY='{"message":"this should be rejected"}'

echo "POST $RELAY_URL/notify (no signature — expect 401)"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$RELAY_URL/notify" \
  -H "Content-Type: application/json" \
  -d "$BODY")

echo "Status: $HTTP_STATUS"
if [ "$HTTP_STATUS" -eq 401 ]; then
  echo "PASS — unauthenticated request correctly rejected"
else
  echo "FAIL — expected 401, got $HTTP_STATUS" >&2
  exit 1
fi
