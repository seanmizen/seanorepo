# notify-ntfy skill

Send a push notification to Sean's phone via the ntfy relay.

---

## When to use ntfy (this skill)

Use ntfy for **low-friction, automated, or ambient notifications**:

- A long-running task finished (build, test, export, download).
- A background agent completed work and wants to surface a result.
- A cron/scheduled task wants to report status.
- Any event where the information is useful but not urgent enough to interrupt a conversation.
- Developer tooling alerts (CI status, deploys, errors from scripts).

**ntfy = fire-and-forget, low ceremony, immediate delivery.**

## When to use WhatsApp instead

Use WhatsApp when the notification requires a human response or is high-signal:

- Asking Sean a direct question.
- Something needs a decision or action from Sean (not just awareness).
- A message that would feel weird arriving silently on a lock screen.

**Heuristic:** if the notification could be written by a cron job, use ntfy. If it reads like a text message, use WhatsApp.

---

## How to invoke

Send a signed `POST /notify` to the ntfy relay.

### Relay URL

```
http://localhost:8080  (dev / dry-run)
https://ntfy.yourdomain.com/relay  (production — update when deployed)
```

### Request shape (identical to WhatsApp relay)

```jsonc
{
  "message":  "required — the notification body",
  "title":    "optional override title",
  "priority": 3,                           // 1(min) – 5(urgent), default 3
  "tags":     ["white_check_mark", "tada"] // emoji shortcodes, optional
}
```

### Signing

```bash
SECRET="$NOTIFY_SECRET"
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"
```

Header: `X-Notify-Signature: <SIG>`

### Full curl example

```bash
RELAY="${NOTIFY_RELAY_URL:-http://localhost:8080}"
SECRET="${NOTIFY_SECRET:-}"
BODY='{"message":"Task complete","title":"Done","priority":3,"tags":["white_check_mark"]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"

curl -s -o /dev/null -w "%{http_code}" -X POST "$RELAY/notify" \
  -H "Content-Type: application/json" \
  -H "X-Notify-Signature: $SIG" \
  -d "$BODY"
# → 204
```

### Python snippet

```python
import hashlib, hmac, json, os, urllib.request

def notify(message, title="", priority=3, tags=None):
    relay = os.environ.get("NOTIFY_RELAY_URL", "http://localhost:8080")
    secret = os.environ.get("NOTIFY_SECRET", "").encode()
    body = json.dumps({
        "message": message,
        "title": title,
        "priority": priority,
        "tags": tags or [],
    }).encode()
    sig = "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()
    req = urllib.request.Request(
        f"{relay}/notify",
        data=body,
        headers={"Content-Type": "application/json", "X-Notify-Signature": sig},
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return r.status  # 204 = success
```

---

## Priority guide

| Value | Label | Use for |
|---|---|---|
| 1 | min | Background info, no vibration |
| 2 | low | FYI, silent |
| 3 | default | Normal task completion |
| 4 | high | Something needs attention soon |
| 5 | urgent | Something broke, look now |

---

## Useful tag shortcodes

`white_check_mark` ✅ · `warning` ⚠️ · `rotating_light` 🚨 · `tada` 🎉  
`skull` 💀 · `hammer` 🔨 · `robot` 🤖 · `clock1` 🕐 · `mag` 🔍

---

## Environment variables expected

| Var | Purpose |
|---|---|
| `NOTIFY_RELAY_URL` | ntfy-relay base URL (no trailing slash) |
| `NOTIFY_SECRET` | HMAC shared secret (same secret as WhatsApp relay) |

---

## Relay source

`apps/ntfy-relay/` — Go HTTP server.  
Shared types: `apps/relay-shared/types.go`.  
See `apps/ntfy-relay/RESEARCH.md` for self-hosting plan and `README.md` for full API docs.
