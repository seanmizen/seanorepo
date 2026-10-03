---
paths:
  - "**/docker-compose*.yml"
  - "**/dockerfile"
  - "**/Dockerfile"
  - "apps/cloudflared/**"
  - "scripts/test-deployment.sh"
  - "infra/edge/**"
---

# Ports

## Every published port names its host address (REQ-SERVER-002)

```yaml
ports:
  - "${PUBLISH_ADDR:-127.0.0.1}:4000:4000"
```

Unset, it binds loopback: the Cloudflare tunnel reaches `localhost:4xxx`, and
nothing else on the LAN should. Each workspace's `start:docker` sets
`PUBLISH_ADDR=0.0.0.0`, so a dev server is reachable from another device on the
wifi. On a home server, `deploy.sh` publishes every app on loopback. Never
write a bare `"4000:4000"` or `"0.0.0.0:4000:4000"`.

## The LAN reaches the sites through the edge (REQ-SERVER-016)

`infra/edge` is Caddy on port 80. It runs only on a webserver without the
tunnel role, and serves each site at `http://<site>.<hostname>.local`. It
reaches the apps over the shared Docker network `edge`, by alias. It does not
use their host ports. See `infra/edge/README.md`.

## Home servers (Cloudflare tunnel): 4xxx

| Port | Service |
|---|---|
| 4000 | seanmizen.com |
| 4010 / 4011 | seanscards FE / BE. Local only. Not deployed. |
| 4020 / 4021 | carolinemizen.art FE / BE |
| 4030 / 4031 | planning-poker FE / BE |
| 4040 | RESERVED - the ngrok web inspector binds it |
| 4042 | minecraft.seanmizen.com |
| 4050 / 4051 | seansconverter.com FE / BE (apps/ffmpeg-converter) |
| 4060 / 4061 | inside.seanmizen.com FE / BE |
| 4120 | tcp-getter (host unit, reached at `seanmizen.com/tcp/*`) |

### Add a service

1. Take the next free `40x0` pair: `40x0` for the frontend, `40x1` for the
   backend.
2. Publish both ports with `${PUBLISH_ADDR:-127.0.0.1}` in the app's
   `docker-compose.yml`.
3. Add its hostname rules to `apps/cloudflared/config.yml`. Put the `/api/*`
   rule before the hostname's catch-all rule. List every hostname: there is no
   `*.seanmizen.com` wildcard, so an unlisted subdomain gets the 404. The
   `http_status:404` rule stays last.

```yaml
  - hostname: new-service.com
    path: /api/*
    service: http://localhost:4071
  - hostname: new-service.com
    service: http://localhost:4070
```

4. Put each prod service on the `edge` network with an alias, and add a
   `http://<site>.{$EDGE_HOST}.local` block to `infra/edge/Caddyfile`. The
   LAN names script reads its names from that file.
5. Add the ports to `scripts/test-deployment.sh`.
6. Decide where its data lives. SQLite and uploads go in named Docker volumes,
   and those volumes exist only on the tunnel machine.

seanscards runs locally only (`yarn cards`). Root `prod:docker` excludes it,
and the tunnel has no hostname for it. Its ports stay reserved.

Smoke test: `scripts/test-deployment.sh`.
