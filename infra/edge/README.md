# The edge

How a visitor reaches the sites. Every app's production services join the Docker
network `edge` under a stable name. The edge routes to them by that name.

| Machine roles | Edge | The sites are at |
| ------------- | ---- | ---------------- |
| webserver + tunnel (asus) | cloudflared, today a host unit (#496 moves it here) | the public domains |
| webserver, no tunnel | Caddy (`--profile lan`) on port 80 | `http://<site>.<hostname>.local`, for example `http://seanmizen.surface.local` |
| no webserver | none | - |

`utils/debbie/2026-09-17/services/deploy.sh` starts the right profile after
`yarn prod:docker` (REQ-SERVER-016).

## Add a site to the LAN

Add a block to `Caddyfile`. That is all: `lan-names.sh` publishes every
`http://<site>.{$EDGE_HOST}.local` name in the file over mDNS.

## Names on the LAN

The names are mDNS names. macOS and iOS resolve them. On Linux,
`libnss-mdns`'s default `mdns4_minimal` resolves only one-label names such as
`surface.local`, so `seanmizen.surface.local` needs `mdns4` (not `_minimal`)
in `/etc/nsswitch.conf`, and the name in `/etc/mdns.allow`.

## Try it on one machine

```bash
docker network create edge 2>/dev/null
EDGE_HOST=$(hostname -s) PUBLISH_ADDR=127.0.0.1 docker compose --profile lan up -d
curl -H "Host: seanmizen.$(hostname -s).local" http://127.0.0.1/
```
