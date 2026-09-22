---
paths:
  - "**/docker-compose*.yml"
  - "**/dockerfile"
  - "**/Dockerfile"
  - "apps/cloudflared/**"
  - "utils/fly-io/**"
  - "scripts/test-deployment.sh"
  - "docs/DEPLOYMENT-TESTING.md"
---

# Ports

## Every published port names its host address (#309)

```yaml
ports:
  - "${PUBLISH_ADDR:-127.0.0.1}:4000:4000"
```

Unset, it binds loopback: the Cloudflare tunnel reaches `localhost:4xxx`, and
nothing else on the LAN should. Each workspace's `start:docker` sets
`PUBLISH_ADDR=0.0.0.0`, so a dev server is reachable from another device on the
wifi. On a home server, `deploy.sh` sets it from the machine's roles (#329):
loopback on the tunnel machine, `0.0.0.0` on a LAN-only webserver. Never write
a bare `"4000:4000"` or `"0.0.0.0:4000:4000"`.

## Home servers (Cloudflare tunnel): 4xxx

| Port | Service |
|---|---|
| 4000 | seanmizen.com |
| 4010 / 4011 | seanscards FE / BE |
| 4020 / 4021 | carolinemizen.art FE / BE |
| 4030 / 4031 | planning-poker FE / BE |
| 4040 | RESERVED - the ngrok web inspector binds it |
| 4042 | minecraft.seanmizen.com |
| 4050 / 4051 | seansconverter.com (apps/converter) FE / BE |
| 4060 / 4061 | inside.seanmizen.com FE / BE |
| 4120 | tcp-getter (host unit, reached at `seanmizen.com/tcp/*`) |

A new service gets the next free `40x0` pair, and a hostname in
`apps/cloudflared/config.yml`.

## Fly.io: 5xxx in the container, 6xxx on the host

One container, with an nginx gateway on 8080 routing by domain
(`utils/fly-io/nginx.conf`). The services listen on 5xxx inside it:
seanmizen.com 5000, seanscards 5010/5011, carolinemizen.art 5020/5021,
planning-poker 5030/5031, inside 5060/5061. `docker-compose.fly.yml` maps them
to 6xxx on the host for local testing. The converter is not in the Fly bundle.

Smoke test for both targets: `scripts/test-deployment.sh [cloudflared|flyio|both]`.
