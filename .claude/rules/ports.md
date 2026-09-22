---
paths:
  - "**/docker-compose*.yml"
  - "**/dockerfile"
  - "**/Dockerfile"
  - "apps/cloudflared/**"
  - "utils/fly-io/**"
  - "scripts/test-deployment.sh"
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
wifi. On a home server, `deploy.sh` sets it from the machine's roles:
loopback on the tunnel machine, `0.0.0.0` on a LAN-only webserver. Never write
a bare `"4000:4000"` or `"0.0.0.0:4000:4000"`.

## Home servers (Cloudflare tunnel): 4xxx

| Port | Service |
|---|---|
| 4000 | seanmizen.com |
| 4010 / 4011 | seanscards FE / BE. Local only. Not deployed. |
| 4020 / 4021 | carolinemizen.art FE / BE |
| 4030 / 4031 | planning-poker FE / BE |
| 4040 | RESERVED - the ngrok web inspector binds it |
| 4042 | minecraft.seanmizen.com |
| 4050 / 4051 | ffmpeg-converter (seansconverter.com). Local only. Not deployed. |
| 4060 / 4061 | inside.seanmizen.com FE / BE |
| 4120 | tcp-getter (host unit, reached at `seanmizen.com/tcp/*`) |

### Add a service

1. Take the next free `40x0` pair: `40x0` for the frontend, `40x1` for the
   backend.
2. Publish both ports with `${PUBLISH_ADDR:-127.0.0.1}` in the app's
   `docker-compose.yml`.
3. Add its hostname rules to `apps/cloudflared/config.yml`. Put the `/api/*`
   rule before the hostname's catch-all rule. Put a specific hostname above any
   wildcard that also matches it, such as `*.seanmizen.com`. The
   `http_status:404` rule stays last.

```yaml
  - hostname: new-service.com
    path: /api/*
    service: http://localhost:4071
  - hostname: new-service.com
    service: http://localhost:4070
```

4. Add the ports to `scripts/test-deployment.sh`.
5. Decide where its data lives. SQLite and uploads go in named Docker volumes,
   and those volumes exist only on the tunnel machine.

seanscards and ffmpeg-converter run locally only (`yarn cards`,
`yarn converter`). Root `prod:docker` excludes them, and the tunnel has no
hostname for them. Their ports stay reserved.

## Fly.io: 5xxx in the container, 6xxx on the host

One container, with an nginx gateway on 8080 routing by domain
(`utils/fly-io/nginx.conf`). The services listen on 5xxx inside it:
seanmizen.com 5000, seanscards 5010/5011, carolinemizen.art 5020/5021,
planning-poker 5030/5031, inside 5060/5061. `docker-compose.fly.yml` maps them
to 6xxx on the host for local testing. The converter is not in the Fly bundle.

Smoke test for both targets: `scripts/test-deployment.sh [cloudflared|flyio|both]`.
