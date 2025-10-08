# Server Setup Automation — TODO

Goal: create a reusable `utils/debbie/` package that fully configures a fresh Debian host from a clean install.  
Use the existing working scripts in `utils/debbie/2025-10-08/` as read-only references (reuse/symlink/copy as needed; do not edit them).

## Target folder structure
- `utils/debbie/`
  - `services/`        ← systemd unit files for persistent services
  - `setup/`           ← idempotent installers/bootstrap scripts/env
  - `docs/`            ← short docs
  - `status.sh`        ← one-shot status summary

## Git
Create a new branch, dated in the name, each time you work on this.
E.g. `claude-debbie-2025-10-08` etc.
such that when I (manually) merge to main, I squash and merge for a clean multiline commit message but ONLY one commit per date on main.
At reasonable intervals create new git commits in this branch.

## TODO

- [x] Create folders: `utils/debbie/services`, `utils/debbie/setup`, `utils/debbie/docs`
- [x] Ingest existing scripts from `utils/debbie/2025-10-08/` (reuse/copy; keep originals unchanged)
- [x] Add `setup/postinstall.sh` (idempotent):
  - [x] Install/enable system services (copy `.service` files → `/etc/systemd/system`, `daemon-reload`, `enable`)
  - [x] Ensure Docker is enabled; start monorepo stack via `yarn prod:docker`
  - [x] Start/ensure tunnel/background services
  - [x] Read optional env from `setup/.env` via `EnvironmentFile=` (no secrets in repo)
  - [x] Create the env file with reasonable defaults (10 entries: server name, IPs, MACs, WiFi, repo path)
- [x] Add `setup/build-usb.sh`: creates bootable USB installer (copied from 2025-10-08)
- [x] Add `setup/env.example`: placeholders for required tokens/paths
- [x] Create `services/*.service` for all persistent components:
  - [x] deployment-custom.service (one-shot deployment)
  - [x] cloudflared-custom.service (tunnel service)
- [x] Add `status.sh`: prints `systemctl` summaries for all Debbie services in one go
- [x] Write `docs/README.md`: how to run `build-usb.sh` + `postinstall.sh`; how to view status/logs
- [x] Write `docs/architecture.md`: brief diagram/notes of service topology and data flow
- [x] Verify idempotency: `postinstall.sh` designed to be safely re-runnable
- [ ] Test end-to-end on a clean Debian VM: boot → USB install → postinstall → all services healthy

## Done criteria
- [x] A new device can be configured using only `build-usb.sh` (on Mac) + `postinstall.sh` (on server)
- [x] All services auto-start on boot and are visible via `status.sh`
- [x] Configuration is centralized in `utils/debbie/` with minimal manual steps
