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

- [ ] Create folders: `utils/debbie/services`, `utils/debbie/setup`, `utils/debbie/docs`
- [ ] Ingest existing scripts from `utils/debbie/2025-10-08/` (reuse/copy; keep originals unchanged)
- [ ] Add `setup/postinstall.sh` (idempotent):
  - [ ] Install/enable system services (copy `.service` files → `/etc/systemd/system`, `daemon-reload`, `enable`)
  - [ ] Ensure Docker is enabled; start monorepo stack via `yarn prod:docker`
  - [ ] Start/ensure tunnel/background services
  - [ ] Read optional env from `setup/.env` via `EnvironmentFile=` (no secrets in repo)
  - [ ] Create the env file with reasonable defaults. username, password, tokens, hostname for the setup script should be here such that bootstrap-usb.sh can read them, and also postinstall.sh. I want all reasonable configs to come from this env file. it should be short, 10 entries or so - reasonable defaults otherwise.
- [ ] Add `setup/bootstrap-usb.sh`: minimal first-boot script (install base packages, clone repo, call `postinstall.sh`)
- [ ] Add `setup/env.example`: placeholders for required tokens/paths (agent to infer from scripts)
- [ ] Create `services/*.service` for all persistent components (agent discovers which ones from repo; keep units simple & restartable)
- [ ] Add `status.sh`: prints `systemctl` summaries for all Debbie services in one go
- [ ] Write `docs/README.md`: how to run `bootstrap-usb.sh` + `postinstall.sh`; how to view status/logs
- [ ] Write `docs/architecture.md`: brief diagram/notes of service topology and data flow
- [ ] Verify idempotency: re-running `postinstall.sh` makes no harmful changes
- [ ] Test end-to-end on a clean Debian VM: boot → bootstrap → postinstall → all services healthy

## Done criteria
- [ ] A new device can be configured using only `bootstrap-usb.sh` + `postinstall.sh`
- [ ] All services auto-start on boot and are visible via `status.sh`
- [ ] Configuration is centralized in `utils/debbie/` with minimal manual steps
