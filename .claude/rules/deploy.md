---
paths:
  - "utils/debbie/**"
  - "apps/cloudflared/**"
  - "scripts/promote-release.sh"
  - "**/docker-compose*.yml"
---

# Deployment

Production is the home server **asus** (`ROLE_WEBSERVER` and `ROLE_TUNNEL`).
**surface** is a second machine with no roles: it tracks `release` and serves
nothing. Both run the `utils/debbie/2026-09-17` generation. The names `debbie`
and `trixie2` are retired.

The flow:

1. Merge to `main`. Nothing deploys.
2. `yarn release` (runs `scripts/promote-release.sh`) fast-forwards
   `origin/release` to `main`. Run it only when Sean asks.
3. On every machine, `custom-release-poll.timer` checks `origin/release`
   every two minutes. When it has moved, the checkout moves and
   `custom-deploy.service` runs `utils/debbie/2026-09-17/services/deploy.sh`.
   That script runs `yarn prod:docker`, and restarts cloudflared only if
   `apps/cloudflared/config.yml` changed.

```bash
ssh srv@asus.local journalctl -u custom-release-poll.service -u custom-deploy.service -f
ssh srv@asus.local ~/projects/seanorepo/utils/debbie/2026-09-17/services/deploy.sh --force
```

Provisioning, roles, moving the tunnel between machines, and ngrok are all in
`utils/debbie/2026-09-17/README.md`. Read it before you change anything under
`utils/debbie/`.

Things that are not in git and live only on the machine: `.env` files, the
Cloudflare tunnel credential in `apps/cloudflared/credentials/`, the ngrok
authtoken, and the SQLite/upload Docker volumes. Never `git clean` a server
checkout.
