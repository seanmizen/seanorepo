# whatsapp-notify

> ⚠️ **NOT DEPLOYED. NOT WIRED INTO ANY DEPLOYMENT PIPELINE. THIS IS CODE ONLY.**
> There is no Dockerfile, no systemd unit, no fly.toml, no Cloudflare Worker, no GH Action.
> To use it: run it manually (see below).

HTTP relay that accepts a signed `POST /notify` and forwards the message to your
WhatsApp number via the Meta WhatsApp Cloud API.

The inbound schema is shared with the `ntfy` relay via `apps/relay-shared/types.go`
so both relays accept identical payloads.

---

## Quick start (dry run — no Meta account needed)

```bash
cd apps/whatsapp-notify
NOTIFY_SECRET=my-dev-secret go run .
# Logs: "whatsapp-notify listening on :8765 (dryRun=true)"
```

In dry-run mode requests are fully authenticated and rate-limited, but instead of
calling WhatsApp the server logs what it would send and returns
`{ "ok": true, "id": "dry-run-id" }`.

---

## Quick start (live)

```bash
export NOTIFY_SECRET=<your-shared-secret>
export META_PHONE_ID=<Meta phone number ID from the API dashboard>
export META_TOKEN=<Meta permanent access token>
export META_TO_NUMBER=<recipient WhatsApp number, e.g. +447700900000>
export PORT=8765          # optional, default 8765

cd apps/whatsapp-notify
go run .
```

---

## Environment variables

| Variable          | Required | Default | Description |
|-------------------|----------|---------|-------------|
| `NOTIFY_SECRET`   | **yes**  | —       | Shared HMAC secret. Requests without a valid `X-Notify-Signature` are rejected. |
| `META_PHONE_ID`   | no¹      | —       | Meta phone number ID from the Cloud API dashboard. |
| `META_TOKEN`      | no¹      | —       | Meta permanent (or long-lived) access token. |
| `META_TO_NUMBER`  | no¹      | —       | Recipient WhatsApp number in E.164 format (`+447700900000`). |
| `PORT`            | no       | `8765`  | TCP port to listen on. |

¹ All three Meta vars must be set together. If any one is missing the server boots in
**dry-run mode** and logs messages instead of sending them.

---

## API

### `POST /notify`

**Headers**

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `X-Notify-Signature` | `sha256=<hmac-sha256-hex>` — HMAC of the raw request body |

**Body**

```json
{
  "message":  "string (required)",
  "title":    "string (optional)",
  "priority": "low | normal | high (optional, default: normal)",
  "tags":     ["string"] 
}
```

**Response — 200 OK**

```json
{ "ok": true, "id": "<Meta message ID>" }
```

**Response — error**

```json
{ "ok": false, "error": "description" }
```

| Status | Meaning |
|--------|---------|
| 400    | Missing / invalid body |
| 401    | Missing or invalid `X-Notify-Signature` |
| 404    | Wrong path or method |
| 429    | Rate limit exceeded (1 req / 5 s) |
| 503    | Meta API call failed |

---

## Signing requests

### Shell (curl)

```bash
SECRET="${NOTIFY_SECRET}"
BODY='{"message":"Build done!","title":"seanmizen.com","priority":"normal"}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"

curl -s -X POST http://localhost:8765/notify \
  -H "Content-Type: application/json" \
  -H "X-Notify-Signature: $SIG" \
  -d "$BODY"
```

### Python

```python
import hmac, hashlib, json, os, urllib.request

secret = os.environ["NOTIFY_SECRET"].encode()
payload = {"message": "Build done!", "title": "seanmizen.com", "priority": "normal"}
body = json.dumps(payload, separators=(',', ':')).encode()
sig = "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()

req = urllib.request.Request(
    "http://localhost:8765/notify",
    data=body,
    headers={"Content-Type": "application/json", "X-Notify-Signature": sig},
    method="POST",
)
with urllib.request.urlopen(req) as r:
    print(r.read().decode())
```

> Use `json.dumps(..., separators=(',', ':'))` to avoid whitespace in the body —
> the signature is over the exact bytes sent, so serialisation must be consistent.

---

## Running tests

```bash
cd apps/whatsapp-notify
go test ./...
# All tests run without any env vars or network — dry-run mode is exercised.
```

---

## Project layout

```
apps/
  relay-shared/
    go.mod          # module: github.com/seanmizen/relay-shared
    types.go        # NotifyRequest, NotifyResponse, ErrorResponse, Priority
  whatsapp-notify/
    go.mod          # module: github.com/seanmizen/whatsapp-notify
    main.go         # server startup, env loading, graceful shutdown
    handler.go      # POST /notify routing + request lifecycle
    auth.go         # HMAC validation, rate limiting
    whatsapp.go     # Meta Cloud API client + dry-run mode
    auth_test.go
    handler_test.go
    whatsapp_test.go
    test/
      01_send_low.sh
      02_send_high.sh
      03_unauth.sh
    README.md       # this file
.claude/skills/
  notify-whatsapp/
    SKILL.md        # Claude skill definition
```

---

## Meta WhatsApp Cloud API notes

- Free tier: unlimited messages to verified numbers during development; production
  requires business verification.
- API version pinned to `v20.0` in `whatsapp.go`.
- The relay sends plain-text messages only (type `"text"`). Templates are not used.
- `META_PHONE_ID` is the numeric ID shown in the Meta for Developers dashboard under
  your WhatsApp app → API Setup, **not** the display phone number.
- `META_TOKEN` should be a System User token with `whatsapp_business_messaging`
  permission. Avoid using temporary tokens (they expire in ~1h).
