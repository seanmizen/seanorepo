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

## REQ-SERVER-005 — A wifi-only host keeps its network across a reboot

- **Status:** active
- **Source:** sean
- **Origin:** #264
- **Type:** functional
- **Priority:** P1
- **Statement:** Where the host's only network path is wireless, the installed
  system shall reassociate and obtain an address unattended at boot, without a
  keyboard or display attached.
- **Rationale:** debbie serves from a shelf with the lid shut, so a network that
  needs a human to come back is the same outage as no network at all. On wifi
  this is not free the way DHCP over ethernet is: the credentials have to be
  persisted into the installed system, not merely used by the installer.

  `netcfg` does persist them — it writes a `wpa-ssid`/`wpa-psk` stanza into
  `/etc/network/interfaces` and installs `wpasupplicant` into the target. That
  is **ifupdown**, not NetworkManager, and this requirement is satisfied by it.

  Recorded here because the obvious next step is a trap. Production debbie's
  `net-failover.sh` drives wifi through `nmcli`, so it is tempting to add
  `network-manager` to the package list and be done. Installing it alongside
  the stanza `netcfg` wrote gives the worst of both: NetworkManager's ifupdown
  plugin marks an interface listed in `/etc/network/interfaces` as unmanaged,
  so `nmcli` does not drive the wifi and neither half is in charge. Migrating
  means removing the stanza and writing an NM connection profile in one step —
  and if that step is wrong, the result is a headless box with no network and
  no way in. It is therefore deliberately **not** coupled to installing the
  machine, and lands with `REQ-NETWORK-*`.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "wifi config persisted"
    (skipped where the host has no wireless interface, which is every VM run —
    QEMU has no 802.11 device the installer would drive)
- **Relations:** none


## REQ-SERVER-006 — Security updates apply without anyone logging in

- **Status:** proposed
- **Source:** sean
- **Origin:** #273
- **Type:** functional
- **Priority:** P1
- **Statement:** The host shall install security updates unattended.
- **Rationale:** Nobody logs into this box for months at a time. An unpatched
  internet-facing host that is also never looked at is the worst combination of
  the two, and "I will run apt upgrade when I next SSH in" has empirically
  meant sixteen months — see #136, where cloudflared's self-update failed
  silently for that long with nothing reporting it.

  Reboots are deliberately **not** automatic. This host serves from a shelf,
  and an unattended reboot that fails to bring wifi back up is an outage nobody
  is watching for.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "unattended-upgrades enabled"
- **Relations:** none

## REQ-SERVER-007 — Logs cannot fill the disk

- **Status:** proposed
- **Source:** sean
- **Origin:** #273
- **Type:** constraint
- **Priority:** P2
- **Statement:** The host shall bound the on-disk size of its journal.
- **Rationale:** An uncapped journal on a host nobody inspects eventually fills
  the disk, and a full disk takes down every site at once with a cause that
  presents as anything but disk space — containers failing to start, SQLite
  write errors, a tunnel that will not come up.

  Separate from `REQ-SERVER-006` because they fail independently: a fully
  patched host can still fill its disk, and a capped journal does nothing about
  an unpatched OpenSSH.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "journald size capped"
- **Relations:** none

## REQ-SERVER-008 — SSH accepts keys and nothing else

- **Status:** proposed
- **Source:** sean
- **Origin:** #273
- **Type:** constraint
- **Priority:** P0
- **Statement:** The host shall accept SSH authentication by public key only.
- **Rationale:** Port 22 is open on the LAN by `REQ-SERVER-002`, and the deploy
  account has passwordless sudo by `REQ-SERVER-003`. Those two together mean a
  guessed password is complete control of the host, so the password path should
  not exist rather than merely be hard to use.

  This mostly ratifies the current state, and that is the point: it is
  currently true by accident. The account has a password hash,
  `PasswordAuthentication` sits at its default, and nothing asserts either.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "password auth disabled"
- **Relations:**
  - depends-on REQ-SERVER-002
  - depends-on REQ-SERVER-003

## REQ-SERVER-009 — Repeated failed authentication is throttled

- **Status:** proposed
- **Source:** sean
- **Origin:** #273
- **Type:** functional
- **Priority:** P2
- **Statement:** When a client fails authentication repeatedly, the host shall
  refuse further attempts from that address for a period.
- **Rationale:** Secondary to `REQ-SERVER-008` and deliberately ranked below
  it: removing the password mechanism matters more than rate-limiting attacks
  against it. What this adds once keys are the only path is a bound on log
  volume and on the CPU spent rejecting a scanner, which is why it sits next to
  `REQ-SERVER-007` rather than replacing anything.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "fail2ban active"
- **Relations:** refines REQ-SERVER-008

## REQ-SERVER-010 — The interactive shell is the one described in the repository

- **Status:** proposed
- **Source:** sean
- **Origin:** #273
- **Type:** quality
- **Priority:** P3
- **Statement:** The host shall give the deploy user the configured interactive
  shell and prompt.
- **Rationale:** Most of what is done on this box is done by hand over SSH,
  usually while something is broken. A shell with history search, completion
  and a prompt showing the git branch is the difference between diagnosing a
  bad deploy and mistyping a `git checkout` on the wrong branch.

  At P3 because it is genuinely cosmetic against everything else here, and
  recorded at all because the previous generation's postinstall re-appended its
  prompt block on every run while its own documentation claimed idempotency — a
  claim nobody checked, because nothing asserted it.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "deploy user shell is zsh"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "shell config is idempotent"
- **Relations:** none
