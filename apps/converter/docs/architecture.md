# Architecture: Converter

## Overview

A Go backend (streaming ffmpeg jobs via worker pool) + React frontend, served via a Cloudflare Tunnel from a home server.

```
┌─────────────────────────────────────────────────────────────┐
│                     INTERNET / USERS                        │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS (cloudflared tunnel)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    HOME SERVER / VPS                        │
│                                                             │
│   ┌──────────────┐      ┌─────────────────────────────┐   │
│   │  cloudflared │─────▶│  nginx / Caddy (localhost)  │   │
│   │  (tunnel)    │      │  :443 → :4040 / :4041       │   │
│   └──────────────┘      └──────────┬──────────────────┘   │
│                                    │                        │
│                    ┌───────────────┴───────────────┐       │
│                    │                               │       │
│             ┌──────▼──────┐             ┌──────────▼─────┐ │
│             │  FE (React) │             │ BE (Go, :4041) │ │
│             │   :4040     │             │                │ │
│             └─────────────┘             │ ┌────────────┐ │ │
│                                         │ │ Job Queue  │ │ │
│                                         │ │ (chan, 256)│ │ │
│                                         │ └─────┬──────┘ │ │
│                                         │       │        │ │
│                                         │ ┌─────▼──────┐ │ │
│                                         │ │Worker Pool │ │ │
│                                         │ │(4 gorout.) │ │ │
│                                         │ └─────┬──────┘ │ │
│                                         │       │        │ │
│                                         │ ┌─────▼──────┐ │ │
│                                         │ │   ffmpeg   │ │ │
│                                         │ │ (exec.Cmd) │ │ │
│                                         │ └────────────┘ │ │
│                                         └────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Request Lifecycle

1. **Upload** → `POST /api/jobs` (multipart). Upload streams directly to a temp file (no full-RAM buffer). Returns `{ id }`.
2. **Subscribe** → `GET /api/jobs/{id}/events` (SSE). Client opens an event stream; backend polls job state every 400 ms and sends JSON events.
3. **Conversion** → A worker picks the job from the Go channel, spawns `ffmpeg` via `exec.Command`, reads stderr for `out_time_us=` progress lines, calls the progress callback.
4. **Download** → `GET /api/jobs/{id}/download`. `http.ServeContent` streams the output file with correct `Content-Disposition`.
5. **Cleanup** → TempStore sweeps files older than 1 hour every 15 minutes.

## Serving the World from a Home Server

### Reverse Proxy / Cloudflare Tunnel (recommended)

**Do NOT port-forward 80/443 from your router** — Cloudflare Tunnel is strictly better:

- No open ports on your router.
- Cloudflare terminates TLS (free HTTPS, automatic renewal).
- DDoS protection and rate limiting at the edge for free.
- Your ISP's dynamic IP doesn't matter.

```
# On the home server, after creating a tunnel in the Cloudflare dashboard:
cloudflared tunnel run converter-tunnel
```

Add a CNAME in Cloudflare DNS: `converter.yourdomain.com → <tunnel-id>.cfargotunnel.com`

Then create `~/.cloudflared/config.yml`:
```yaml
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: converter.yourdomain.com
    service: http://localhost:4040
  - hostname: api.converter.yourdomain.com
    service: http://localhost:4041
  - service: http_status:404
```

Alternatively, run both FE and BE behind a single nginx reverse proxy on :4040 and use `/api` path prefix:
```nginx
server {
    listen 4040;
    location /api { proxy_pass http://localhost:4041; }
    location /    { root /app/frontend/dist; try_files $uri /index.html; }
}
```

### TLS (if using nginx directly)

```bash
# Caddy is simplest — auto HTTPS with Let's Encrypt
caddy reverse-proxy --from converter.yourdomain.com --to localhost:4041
```

### Rate Limiting per IP

In nginx:
```nginx
limit_req_zone $binary_remote_addr zone=converter:10m rate=5r/m;
location /api/jobs {
    limit_req zone=converter burst=3 nodelay;
}
```

Or in Caddy:
```
rate_limit {remote_host} 5r/m
```

The Go backend also enforces `MAX_UPLOAD_MB=500` via `http.MaxBytesReader`.

### Disk Quota / Temp File Cleanup

The `TempStore` deletes files after `FILE_TTL` (default 1h). For extra safety, add a cron:
```bash
# Delete converter temp files older than 2 hours
0 * * * * find /tmp/converter -mmin +120 -delete
```

Set `TEMP_DIR` to a dedicated partition with a disk quota (e.g. 20 GB) to prevent runaway jobs from filling root.

## Binary Targets

The Go binary is statically compiled (`CGO_ENABLED=0`). Cross-compile for arm64:

```bash
# From your Mac, targeting a Raspberry Pi / Apple Silicon server
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o converter-be-arm64 .

# Or let Docker buildx cross-compile:
docker buildx build --platform linux/arm64 -t converter-be:arm64 .
```

The runtime Docker image (`alpine:3.20`) installs ffmpeg via `apk`, which has arm64 packages. No CGO means no native compilation issues.

**Assumption**: Home server is arm64 (Apple Silicon Mac mini or Pi 4+). If x86_64, change `--platform linux/amd64`.

## Systemd Unit (non-Docker)

If you prefer running the Go binary directly:

```ini
# /etc/systemd/system/converter-be.service
[Unit]
Description=Converter backend
After=network.target

[Service]
ExecStart=/usr/local/bin/converter-be
Environment=PORT=4041
Environment=WORKERS=4
Environment=MAX_UPLOAD_MB=500
Environment=TEMP_DIR=/var/tmp/converter
Restart=always
RestartSec=5
User=converter
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now converter-be
```

## Docker Compose (recommended for monorepo)

```bash
# Dev (hot reload)
yarn workspace converter start:docker

# Production
yarn workspace converter prod:docker
```

## Horizontal Scaling

The current design is single-node (in-memory job queue and state). To scale horizontally:

1. **Replace `job.Queue` with Redis** — use `go-redis` to store job state; the job channel becomes a Redis stream or list.
2. **Shared temp storage** — mount an NFS volume or use S3/R2 for input/output files.
3. **Multiple backend replicas** — each pulls from Redis, writes to shared storage.
4. **Sticky SSE** — route SSE connections by job ID to the worker holding it, or have all workers publish to a Redis pub/sub channel.

For a personal/small-team tool, single-node on a Mac Mini M2 (8 cores) handles ~30 concurrent conversions comfortably.
