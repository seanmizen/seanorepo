# ntfy-relay

A thin Go HTTP relay that accepts a signed `POST /notify` request and forwards it to a self-hosted (or public) ntfy topic.

> **NOT DEPLOYED.** No Docker image, no systemd unit, no Cloudflare Tunnel config exists yet.  
> See `RESEARCH.md` for the full self-hosting plan. Deploy only when the home-server ntfy instance is running.

---

## Architecture

```
Claude / script
  └── POST /notify  (HMAC-signed, shared body shape)
        └── ntfy-relay (this binary)
              └── POST https://ntfy.yourdomain.com/<topic>
                    └── ntfy server → phone push
```

The request/response types are defined in `../relay-shared/types.go` and are **identical** to the WhatsApp relay — same body, same signature scheme, same rate limit.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NTFY_URL` | No | *(dry-run mode)* | Full ntfy topic URL, e.g. `https://ntfy.yourdomain.com/alerts` |
| `NOTIFY_SECRET` | Recommended | *(no sig check)* | HMAC-SHA256 shared secret; if unset, signature verification is skipped |
| `ADDR` | No | `:8080` | `host:port` to listen on |
| `DRY_RUN` | No | `0` | Set to `1` to log-only without forwarding (also auto-enabled when `NTFY_URL` is unset) |

---

## Running Locally

```bash
cd apps/ntfy-relay
go run .
# → NTFY_URL not set — running in dry-run mode
# → ntfy-relay listening on :8080 → https://ntfy.sh/placeholder-topic (dry_run=true)
```

With a real ntfy instance:

```bash
NTFY_URL=https://ntfy.yourdomain.com/alerts \
NOTIFY_SECRET=my-secret \
go run .
```

---

## Sending a Notification

```bash
SECRET=my-secret
BODY='{"message":"deploy finished","title":"CI","priority":3,"tags":["white_check_mark"]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"

curl -X POST http://localhost:8080/notify \
  -H "Content-Type: application/json" \
  -H "X-Notify-Signature: $SIG" \
  -d "$BODY"
# → HTTP 204
```

---

## Request Body

```jsonc
{
  "message":  "something happened",   // required
  "title":    "Alert",                 // optional
  "priority": 4,                       // 1–5 (ntfy scale), 0 = default (3)
  "tags":     ["warning", "tada"]     // emoji shortcodes forwarded as Tags header
}
```

### Priority values

| Value | ntfy label | Behaviour |
|---|---|---|
| 1 | min | Silent, below fold |
| 2 | low | Silent, collapsed |
| 3 | default | Standard vibration |
| 4 | high | Long vibration + pop-over |
| 5 | urgent | Sustained vibration + pop-over |

---

## Signature Scheme

`X-Notify-Signature: sha256=<hex>`  
Computed as: `HMAC-SHA256(NOTIFY_SECRET, raw_request_body)`

Same scheme as the WhatsApp relay — any client that can sign for one can sign for both.

---

## Rate Limit

1 request per 5 seconds (global). Returns `HTTP 429` when exceeded.

---

## Unit Tests

```bash
cd apps/ntfy-relay
go test ./...
```

8 tests covering: happy path, bad signature, missing signature, rate limit, header forwarding, invalid JSON, no-secret mode, and out-of-range priority.

---

## Shell Tests

Start the server (dry-run is fine), then:

```bash
cd apps/ntfy-relay
NOTIFY_SECRET=test-secret bash test/01_send_low.sh
NOTIFY_SECRET=test-secret bash test/02_send_high.sh
NOTIFY_SECRET=test-secret bash test/03_dry_run.sh
bash test/04_bad_signature.sh
```

Or override the target:

```bash
RELAY_URL=http://myserver:8080 NOTIFY_SECRET=prod-secret bash test/01_send_low.sh
```

---

## Shared Types

`../relay-shared/types.go` defines `NotifyRequest` and `NotifyResponse`.  
**Both this relay and the WhatsApp relay import the same file.** Merge reconciliation note: if the WhatsApp branch also creates `relay-shared/`, accept whichever version arrives first — the struct fields are identical.

---

## File Tree

```
apps/ntfy-relay/
├── go.mod            # module ntfy-relay, replace relay-shared => ../relay-shared
├── main.go           # env wiring, HTTP server
├── handler.go        # POST /notify handler, HMAC, rate limit, ntfy forwarding
├── handler_test.go   # 8 unit tests
├── RESEARCH.md       # self-hosting plan, networking, iOS push, cost = $0
├── README.md         # this file
└── test/
    ├── 01_send_low.sh
    ├── 02_send_high.sh
    ├── 03_dry_run.sh
    └── 04_bad_signature.sh

apps/relay-shared/
├── go.mod            # module relay-shared
└── types.go          # NotifyRequest, NotifyResponse
```
