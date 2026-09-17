# REQ-SERVER — What a provisioned debbie must be

The properties `scripts/postinstall.sh` establishes on a freshly installed host,
each one paired with a check in `utils/debbie/2026-09-17/vm/assert.sh`.

Only what this generation actually provisions is here. The deploy poller, the
Cloudflare tunnel and the network failover watchdog are not yet requirements —
they arrive under `REQ-DEPLOY-*` and `REQ-NETWORK-*` when that code is rebuilt.

Introduced in #259.

---

## REQ-SERVER-001 — A closed lid does not take the server down

- **Status:** active
- **Source:** sean
- **Origin:** #259
- **Type:** constraint
- **Priority:** P0
- **Statement:** While the operating system is running, the host shall ignore
  lid-close and idle events rather than suspending.
- **Rationale:** debbie is a laptop serving from a shelf with the lid shut.
  Default logind suspends on lid close, which takes every hosted site offline
  until somebody physically opens it — and the machine looks healthy the whole
  time, because it is simply asleep.

  The setting is written as a drop-in under
  `/etc/systemd/logind.conf.d/` rather than edited into `logind.conf`, which is
  package-owned and can be reverted or conflicted by an upgrade. `postinstall.sh`
  deliberately does not restart `systemd-logind` afterwards: doing so terminates
  the calling session and would kill the provisioning run over SSH. The drop-in
  is read at next boot, which is why this is asserted only after a reboot.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "lid-close drop-in present"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "lid close ignored"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "sleep.target masked"
- **Relations:** none

## REQ-SERVER-002 — Only four ports are reachable

- **Status:** active
- **Source:** sean
- **Origin:** #259
- **Type:** constraint
- **Priority:** P1
- **Statement:** The host shall accept inbound connections on exactly ports
  22/tcp, 80/tcp, 443/tcp and 5353/udp, and refuse every other port.
- **Rationale:** Everything public arrives through the Cloudflare tunnel, which
  is an outbound connection. An open application port would therefore be a
  second, unaudited way in that nothing is watching — the app ports in the
  4000–4061 range are deliberately closed even on the LAN.

  The count is asserted as well as the membership. Checking only that the four
  are present would let a fifth be added silently, which is the exact shape of
  drift this is meant to catch.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "ufw active"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "no other ports open"
- **Relations:** none

## REQ-SERVER-003 — The deploy user can deploy without a password

- **Status:** active
- **Source:** sean
- **Origin:** #259
- **Type:** functional
- **Priority:** P1
- **Statement:** The host shall provide a deploy user holding both `sudo` and
  `docker` group membership.
- **Rationale:** Deployment runs unattended from a systemd timer, so any step
  that prompts for a password is a deploy that hangs forever rather than one
  that fails visibly.

  The previous generation's preseed created a user named `sean` on a host named
  `debbie2`, while every systemd unit, the sudoers drop-in and all the docs
  assumed `srv` on `debbie`. Nothing reconciled the username, so following those
  files end to end produced a box on which none of the units could start. Naming
  the user in a requirement is what stops the two halves drifting apart again.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "user srv exists"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "srv in sudo"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "srv in docker"
- **Relations:** none

## REQ-SERVER-004 — The host is reachable by name on the local network

- **Status:** active
- **Source:** sean
- **Origin:** #259
- **Type:** functional
- **Priority:** P2
- **Statement:** The host shall answer to its own hostname over mDNS on the
  local network.
- **Rationale:** Every runbook step reaches the box as `debbie.local`, because
  its LAN address has moved more than once and a written-down IP goes stale
  silently. mDNS keeps the name working across an address change.

  Worth knowing when diagnosing: where a host has two interfaces on one subnet,
  `debbie.local` may resolve to either address, so it is not a safe way to reach
  one specific interface — use the explicit IP for that.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "hostname is debbie"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "avahi-daemon active"
- **Relations:** none
