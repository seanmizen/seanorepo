# debbie

Provisioning for the Debian home server. Each attempt lives in its own dated
directory; the dates record when work started, **not** which one is live.

| Directory | What it is |
|---|---|
| `2026-09-17/` | **Current, and what production runs** (asus, surface). Installs Debian 13, provisions it, and asserts the result, on metal or in a VM. See its [README](./2026-09-17/README.md). |
| `archive/` | Retired generations, one dated folder each. Do not edit. |
| `archive/2025-12-27/` | A generic rewrite plus the first real QEMU attempt. |
| `archive/2025-10-08b/` | The generation production ran until September 2026: the first deploy poller, Cloudflare tunnel unit and failover watchdog. |
| `archive/2025-10-08/` | The first 2025-10 attempt. |
| `archive/2025-04-14/` | PXE, netboot, cobbler and Raspberry Pi experiments. |

Requirements are in [`2026-09-17/requirements/`](./2026-09-17/requirements/) and
are validated by CI on every PR — `REQ-EMU-*` constrain the VM harness,
`REQ-SERVER-*` describe what a provisioned host must be. Each generation owns its
`requirements/`, and a new generation starts by copying the previous one's.

[`future-spec.md`](./future-spec.md) is the opposite end: decisions about a
**fleet** of these machines that have been reasoned about but not built, and are
validated by nothing. Not a plan of record.

Deploys come from the `release` branch, never `main`. Promote with `yarn release`
from a clean `main`; debbie polls every two minutes.

## Remote SSH

From outside the home network, the only way in is **ngrok**: `ngrok tcp 22`
runs on the machine. The `2025-10-08b` machine runs it as `ngrok-custom.service`; the
`2026-09-17` generation provisions it as `custom-ngrok.service` (#317). How to
set it up and find the address is in [its README](./2026-09-17/README.md#remote-ssh-ngrok).

The Cloudflare SSH tunnel (`ssh.seanmizen.com`) that used to be documented here
is dead: no ingress config in the repository serves it. It is in `archive/`
only for history. Do not rebuild it.
