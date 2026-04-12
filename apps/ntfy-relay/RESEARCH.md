# ntfy Self-Host Research

> **Cost summary up front: $0.** You run it on your own hardware.  
> You must not pay for anything. ntfy.sh offers a paid "Pro" tier but it is irrelevant — you are self-hosting.

---

## What is ntfy?

ntfy (pronounced "notify") is an **open-source, self-hostable push-notification server** ([github.com/binwiederhier/ntfy](https://github.com/binwiederhier/ntfy)).

You publish a message with a plain HTTP POST:

```bash
curl -d "Build failed" ntfy.sh/my-topic
```

Any subscribed device (phone app, browser, CLI) receives it instantly. Topics are free-form strings — no registration required for public use.

The project is dual-licensed (Apache 2 / GPL). The public hosted version at ntfy.sh is free for casual use. **You are self-hosting, so none of ntfy.sh's limits apply.**

---

## Self-Host Options

### Option 1 — Docker (recommended for home server)

```bash
docker run \
  -p 80:80 \
  -v /var/cache/ntfy:/var/cache/ntfy \
  binwiederhier/ntfy \
  serve --cache-file /var/cache/ntfy/cache.db
```

- Image: `binwiederhier/ntfy` (official, multi-arch: amd64, arm64, armv7, armv6)
- The cache DB persists notifications so clients can catch up after being offline.
- Add `-d --restart unless-stopped` for a persistent service.

### Option 2 — Static binary

Pre-built binaries available for every architecture at  
`https://github.com/binwiederhier/ntfy/releases` (current: v2.21.0).

```bash
# Mac mini (amd64)
wget https://github.com/binwiederhier/ntfy/releases/download/v2.21.0/ntfy_2.21.0_linux_amd64.tar.gz

# Raspberry Pi 4 (arm64)
wget https://github.com/binwiederhier/ntfy/releases/download/v2.21.0/ntfy_2.21.0_linux_arm64.tar.gz
```

Extract, put binary on `$PATH`, done.

### Option 3 — systemd unit (binary + systemd)

```ini
# /etc/systemd/system/ntfy.service
[Unit]
Description=ntfy notification server
After=network.target

[Service]
ExecStart=/usr/local/bin/ntfy serve
Restart=on-failure
User=ntfy

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ntfy
```

---

## Resource Requirements

| Resource | Minimum | Notes |
|---|---|---|
| RAM | ~50–128 MiB | Kubernetes example shows 128 Mi limit; idle is ~30–50 MiB |
| CPU | Negligible | Pure I/O work; 0.1 vCPU is plenty |
| Disk | ~100 MiB | For the notification cache DB; grows with message volume |
| Network | Any | Works on a 10 Mbps uplink |

**Hardware fit:**
- **Mac mini (M-series or Intel)**: trivial. ntfy is invisible on any modern Mac mini.
- **Raspberry Pi 4 (2 GB+)**: arm64 binary works perfectly. Community reports <2% CPU at idle.
- **Raspberry Pi Zero 2 W**: armv7 binary works; tighter but feasible.

---

## Networking: How to Reach Your Home Server

### Path A — Cloudflare Tunnel (recommended, free, zero port-forwarding)

Cloudflare Tunnel creates an outbound-only encrypted tunnel from your home server to Cloudflare's edge. No ports opened, no firewall rules, no DynDNS.

```
phone → Cloudflare edge → encrypted tunnel → your Mac mini → ntfy
```

1. Install `cloudflared` on your home server (already in `apps/cloudflared/`).
2. Run `cloudflared tunnel create ntfy` and add a route for your ntfy subdomain.
3. Point your DNS record (e.g. `ntfy.yourdomain.com`) at the tunnel.
4. **TLS is fully handled by Cloudflare** — no certificate management needed.

Cost: **free** on the Cloudflare Zero Trust free plan.

### Path B — Port forwarding + Dynamic DNS

1. Forward port 443 (or 80) on your router to the server's IP.
2. Use a free DynDNS provider (DuckDNS, No-IP) to track your changing home IP.
3. Obtain a TLS cert (see below).

Downsides: exposes your home IP, requires router access, cert renewal overhead.

---

## TLS

| Method | Effort | Cost |
|---|---|---|
| **Cloudflare Tunnel** | Near-zero — Cloudflare terminates TLS | Free |
| **Caddy + Let's Encrypt** | ~10 min config | Free |
| **nginx + certbot** | ~20 min config | Free |
| ntfy built-in HTTPS | Add `cert-file` + `key-file` to `server.yml` | Free (certs from certbot) |

If you use Cloudflare Tunnel, stop here — you already have TLS.

If you port-forward, Caddy is the easiest:

```
ntfy.yourdomain.com {
    reverse_proxy localhost:80
}
```

Caddy auto-provisions and renews Let's Encrypt certs.

---

## Authentication

ntfy supports three complementary auth mechanisms:

### 1. Access tokens (simplest for Claude / scripts)

```bash
ntfy token add --label "claude-relay" myuser
# → tk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Use in request:
curl -H "Authorization: Bearer tk_xxx..." -d "msg" https://ntfy.yourdomain.com/my-topic
```

Tokens follow the format `tk_<32 random chars>`. They can have optional expiry dates.

### 2. Basic Auth (username + password)

```bash
ntfy user add myuser        # interactive password prompt
ntfy access myuser my-topic read-write
```

Request header: `Authorization: Basic <base64(user:pass)>`

### 3. ACL (per-topic permissions)

Control who can publish/subscribe to each topic:

```bash
ntfy access myuser 'alerts*' write-only   # allow publish only
ntfy access '*'    'alerts*' deny         # block anonymous read
```

For a private home server, set `auth-default-access: deny-all` in `server.yml` so unauthenticated traffic is blocked.

---

## iOS Push Notifications

This is the most important gotcha.

**The problem:** iOS heavily restricts background activity. The ntfy iOS app cannot maintain a persistent connection in the background. Without help, notifications arrive 20–30 minutes late (or longer) when the app is backgrounded.

**The solution:** configure `upstream-base-url` in `server.yml`:

```yaml
upstream-base-url: "https://ntfy.sh"
```

How it works:
1. When a message arrives at your self-hosted server, it forwards a *poll request* (just the message ID, no content) to `ntfy.sh` via Firebase/APNs.
2. ntfy.sh pings the iOS app via APNs — this wakes the app immediately.
3. The app fetches the full message from **your** server (no content leaves your server).

**Cost: free.** You are using ntfy.sh only as an APNs relay, not as a messaging service. This is by design and explicitly supported.

**Android:** uses Firebase Cloud Messaging (FCM) for instant delivery. FCM is the default on official Android builds. Battery cost is minimal (~0–1% per 17 hours per the ntfy FAQ).

---

## Summary: The Zero-Cost Stack

```
Mac mini / Raspberry Pi 4
  └── Docker: binwiederhier/ntfy
        └── server.yml:
              upstream-base-url: "https://ntfy.sh"   # iOS instant push
              auth-default-access: deny-all            # locked down
  └── cloudflared tunnel → ntfy.yourdomain.com        # free TLS + routing
```

Total cost: **$0** (assuming you already own the hardware and have a Cloudflare account).

The only external dependency is ntfy.sh acting as an APNs relay — and even that is a free, officially supported use case.

---

## References

- Official docs: https://docs.ntfy.sh
- Install: https://docs.ntfy.sh/install/
- Config reference: https://docs.ntfy.sh/config/
- Publishing API: https://docs.ntfy.sh/publish/
- GitHub: https://github.com/binwiederhier/ntfy
