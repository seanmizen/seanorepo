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

[`future-spec.md`](./future-spec.md) is the opposite end: decisions about a
**fleet** of these machines that have been reasoned about but not built, and are
validated by nothing. Not a plan of record.

Deploys come from the `release` branch, never `main`. Promote with `yarn release`
from a clean `main`; debbie polls every two minutes.

## Remote SSH

From outside the home network, the only way in is **ngrok**: `ngrok tcp 22`
runs on the box. The `2025-10-08b` box runs it as `ngrok-custom.service`. The
`2026-09-17` generation does not provision it yet, so do not build a box that
must be reachable from off the LAN until #317 lands.

The Cloudflare SSH tunnel (`ssh.seanmizen.com`) that used to be documented here
is dead: no ingress config in the repository serves it. It is in `archive/`
only for history. Do not rebuild it.
