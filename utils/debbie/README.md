# debbie

Provisioning for the Debian home server. Each attempt lives in its own dated
directory; the dates record when work started, **not** which one is live.

| Directory | What it is |
|---|---|
| `2026-09-17/` | Current. A VM harness that installs Debian 13 and asserts the result. See its [README](./2026-09-17/README.md). |
| `2025-12-27/` | A generic rewrite plus the first real QEMU attempt. Superseded by `2026-09-17/`. |
| `2025-10-08b/` | **What production runs today.** The deploy poller, Cloudflare tunnel and network failover watchdog all live here. |
| `2025-10-08/` | Reference only. Do not edit. |
| `archive/` | Historical PXE, netboot, cobbler and Raspberry Pi experiments. Do not edit. |

Requirements are in [`requirements/`](./requirements/) and are validated by CI on
every PR — `REQ-EMU-*` constrain the VM harness, `REQ-SERVER-*` describe what a
provisioned host must be.

Deploys come from the `release` branch, never `main`. Promote with `yarn release`
from a clean `main`; debbie polls every two minutes.

## Cloudflare SSH tunnel

Reaching the box over SSH without opening a port. Kept here because it is not
recorded anywhere else in the repo.

```bash
cloudflared tunnel create warp-ssh-tunnel
nano ~/.cloudflared/ssh-config.yml
```

```yaml
tunnel: <NEW_TUNNEL_UUID>
credentials-file: /home/srv/.cloudflared/<NEW_TUNNEL_UUID>.json
warp-routing: true

ingress:
  - hostname: ssh.seanmizen.com
    service: ssh://localhost:22
    originRequest:
      noTLSVerify: true
  - service: http_status:404
```
