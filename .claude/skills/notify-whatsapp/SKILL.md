# notify-whatsapp

Use this skill when the user asks to be **texted, notified, or pinged on WhatsApp** when
a task finishes. Common trigger phrases:

- "text me when this is done"
- "send me a WhatsApp when the build completes"
- "ping me on WhatsApp with the result"
- "notify me when it finishes"
- "let me know on WhatsApp"

---

## What to do

After completing the requested task, call the local HTTP relay at
`http://localhost:8765/notify` with a signed JSON body. The relay forwards the
message to the user's WhatsApp via the Meta Cloud API.

**If the relay isn't running**, tell the user: start it with
`cd apps/whatsapp-notify && NOTIFY_SECRET=<secret> go run .`

**If `NOTIFY_SECRET` is not in your environment**, ask the user for it or tell
them to export it before re-running the skill.

---

## Request format

**Endpoint**: `POST http://localhost:8765/notify`
**Header**: `X-Notify-Signature: sha256=<hmac-sha256-hex-of-body>`
**Content-Type**: `application/json`

### JSON body

```json
{
  "message": "string (required)",
  "title":   "string (optional — shown as first line on WhatsApp)",
  "priority": "low | normal | high (optional, default: normal)",
  "tags":    ["string", "..."] 
}
```

### Response (success)

```json
{ "ok": true, "id": "<meta-message-id>" }
```

### Response (error)

```json
{ "ok": false, "error": "description" }
```

---

## How to sign and call the relay (shell)

```bash
SECRET="${NOTIFY_SECRET}"
BODY='{"message":"Task done!","title":"Claude finished","priority":"normal"}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"

curl -s -X POST http://localhost:8765/notify \
  -H "Content-Type: application/json" \
  -H "X-Notify-Signature: $SIG" \
  -d "$BODY"
```

## How to sign and call the relay (Python)

```python
import hmac, hashlib, json, os, urllib.request

secret = os.environ["NOTIFY_SECRET"].encode()
payload = {"message": "Task done!", "title": "Claude finished", "priority": "normal"}
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

> **Note**: JSON serialisation must produce the same byte sequence that was signed.
> Use `separators=(',', ':')` in Python to avoid whitespace differences.
> In shell, sign the literal string you pass to curl.

---

## Priority guide

| Priority | When to use |
|----------|-------------|
| `low`    | Background / informational — task done, no urgency |
| `normal` | Default — task finished |
| `high`   | Error, failure, or time-sensitive outcome |

## Title convention

```
"Build: <project>"
"Test: <suite>"
"Deploy: <project>"
"Task: <short description>"
```

---

## Rate limit

The relay enforces **1 request per 5 seconds**. If a workflow sends multiple
notifications in quick succession, batch them into one message or add a 5-second
gap between calls.

---

## Troubleshooting

| Status | Cause | Fix |
|--------|-------|-----|
| `401 Unauthorized` | Wrong or missing `X-Notify-Signature` | Check `NOTIFY_SECRET` matches the relay |
| `429 Too Many Requests` | Rate limit | Wait ≥5 seconds and retry |
| `503 Service Unavailable` | Meta API unreachable, or relay in dry-run mode with a real call attempted | Check relay logs; ensure `META_PHONE_ID`, `META_TOKEN`, `META_TO_NUMBER` are set |
| Connection refused | Relay not running | `cd apps/whatsapp-notify && NOTIFY_SECRET=<s> go run .` |

---

## Dry-run mode (no WhatsApp credentials)

If the relay starts without `META_PHONE_ID` / `META_TOKEN` / `META_TO_NUMBER`, it
enters **dry-run mode**: requests are authenticated and rate-limited normally, but
instead of calling WhatsApp the relay logs what it would send and returns
`{ "ok": true, "id": "dry-run-id" }`. Safe to test the full signing flow without
any Meta account.
