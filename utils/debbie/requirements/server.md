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
  22/tcp, 80/tcp, 443/tcp and 5353/udp, and refuse every other port, including
  every port published by a container.
- **Rationale:** Everything public arrives through the Cloudflare tunnel, which
  is an outbound connection. An open application port would therefore be a
  second, unaudited way in that nothing is watching — the app ports in the
  4000–4061 range are deliberately closed even on the LAN.

  The count is asserted as well as the membership. Checking only that the four
  are present would let a fifth be added silently, which is the exact shape of
  drift this is meant to catch.

  **"Including every port published by a container" is the part `#300` added,
  and it is a correction rather than an extension.** This requirement was
  already meant to cover them; the host did not do it, and nothing noticed
  because the only thing asserted was `ufw status`. Docker writes its own
  chains into the `nat` and `filter` tables, and a container published with
  `-p 4000:4000` gets a DNAT rule that is consulted *before* ufw's — so the port
  answered from the LAN while `ufw status` said, correctly for ufw and falsely
  for the host, that nothing but the four was open. The requirement claimed
  something the box did not do, and the test agreed with the requirement instead
  of with the box.

  **How it is met.** `scripts/postinstall.sh` writes `/etc/docker/daemon.json`
  with `{"ip": "127.0.0.1"}`, which is dockerd's `--ip`, "Host IP for port
  publishing". A published port then binds `127.0.0.1` and no other address, so
  it is never offered to the LAN and there is no packet to filter. This was
  preferred over a LAN-deny rule in `DOCKER-USER` because it removes the class
  rather than filtering it: no rule has to survive a reboot and no chain
  ordering has to be right. It costs nothing, because every ingress rule in
  `apps/cloudflared/config.yml` already reaches its origin as
  `http://localhost:4xxx` and `cloudflared` runs as a host process — loopback is
  the only address the tunnel has ever used.

  **What this does not guarantee, stated because the assertions are built
  around it.** `ip` is a *default*. A compose file that names a host address
  explicitly — `"0.0.0.0:4001:4001"` — walks straight past it, measured on
  docker 28.5.2 and reachable from another host. No `apps/*/docker-compose.yml`
  does that today; `#309` is the ticket for making them say so rather than rely
  on the default. Until then, the checks below are what would catch it, which is
  why they read listening sockets, the `nat` chain and a deliberately published
  probe port rather than the daemon's configuration.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "ufw active"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "ufw allows no port beyond
    the four"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "docker publishes to
    loopback by default"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "nothing outside the four
    ports listens on a non-loopback address"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "no docker DNAT rule reaches
    a non-loopback address"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "a deliberately published
    port binds loopback and nothing else"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "that port refuses a
    connection to the host's own routable address"
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
  local network from its first boot after installation, with no provisioning
  step having been run.
- **Rationale:** Every runbook step reaches the box as `debbie.local`, because
  its LAN address has moved more than once and a written-down IP goes stale
  silently. mDNS keeps the name working across an address change.

  "From its first boot" is the part #285 added, and it is not a refinement —
  it is the requirement. `postinstall.sh` is itself a runbook step, so it is
  reached as `debbie.local` like every other one. Installing mDNS *from*
  `postinstall.sh` made the name start working only after the step that needed
  it, and the hostname it would have advertised was wrong as well: netcfg
  preferred a reverse-DNS answer over the preseeded name, split
  `192.168.1.182` at its first dot, and installed the box as `192`. Both halves
  are one fault, because avahi advertises the system hostname — fixing either
  alone leaves the box unreachable by name.

  Worth knowing when diagnosing: where a host has two interfaces on one subnet,
  `debbie.local` may resolve to either address, so it is not a safe way to reach
  one specific interface — use the explicit IP for that.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "hostname is debbie"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "static hostname is debbie"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "127.0.1.1 maps to debbie"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "avahi-daemon active"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "debbie.local resolves"
  - Test — `utils/debbie/2026-09-17/vm/test-vm.sh` › the `PHASE=firstboot` run,
    which asserts all of the above before `postinstall.sh` executes and so
    distinguishes "the preseed set it" from "postinstall repaired it"
  - Inspection — `utils/debbie/2026-09-17/README.md` § "What it does not",
    which records that a VM cannot reproduce the reverse-DNS hostname fault
    and cannot prove mDNS reachability from another host
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

## REQ-SERVER-011 — Our systemd units live apart from the distribution's

- **Status:** active
- **Source:** sean
- **Origin:** #292
- **Type:** constraint
- **Priority:** P2
- **Statement:** The host shall hold every systemd unit this repository
  introduces in `/usr/local/lib/systemd/system`.
- **Rationale:** Units put in `/etc/systemd/system` are mixed in with dbus
  aliases, mask symlinks and `.wants/` directories, and `systemd-analyze
  unit-paths` shows 156 more in `/usr/lib/systemd/system`. Finding one's own
  service then depends on a naming trick — the previous generation put `custom`
  in every filename for exactly this reason.

  `/usr/local/lib/systemd/system` is already in the search path, carries FHS
  `/usr/local` semantics (software the distribution's package manager does not
  own), and is empty on a fresh install. Units placed there are, by
  construction, the only things in that directory, so a plain `ls` answers
  "what did we install?" with no convention to remember.

  This does not make the naming convention redundant — see
  `REQ-SERVER-013`. The directory answers the question only while looking at
  the filesystem, and most of the time one is looking at `systemctl` output
  instead.

  `/etc/systemd/system` keeps its proper role — enable symlinks, masks and
  drop-ins — and nothing here changes that.

  systemd does not recurse into subdirectories of the search path, so a
  per-project folder is not available; only `<unit>.d/` drop-ins and
  `<target>.wants/` have meaning. This requirement is the nearest thing that
  works.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "no repo units in /etc/systemd/system"
  - Inspection — every unit installed by `2026-09-17/` resolves to
    `/usr/local/lib/systemd/system` under `systemctl cat`
- **Relations:** none

## REQ-SERVER-012 — A packaged unit is changed by drop-in, never by shadowing

- **Status:** active
- **Source:** sean
- **Origin:** #292
- **Type:** constraint
- **Priority:** P1
- **Statement:** Where a unit shipped by a package needs different settings,
  the host shall override it with a drop-in rather than a replacement unit file.
- **Rationale:** `/usr/local/lib/systemd/system` takes precedence over
  `/usr/lib/systemd/system`, so a file named after a packaged unit silently
  wins and the package's own version is never read. That is a trap rather than
  a feature: the override is invisible in the package's directory, survives the
  package being upgraded, and leaves no clue for whoever is debugging why a
  documented default does not apply.

  It is not hypothetical. `cloudflared` is to be installed from Cloudflare's
  apt repository, which ships `cloudflared.service`; a unit of the same name in
  the higher-precedence directory would quietly displace it.

  A drop-in states only what differs, layers onto whatever the package ships,
  and appears in `systemctl cat` where somebody will actually find it. The
  distinction this draws is between introducing a service, which
  `REQ-SERVER-011` governs, and adjusting somebody else's, which this does.
- **Verification:**
  - Inspection — no filename in `/usr/local/lib/systemd/system` matches a unit
    present in `/usr/lib/systemd/system`
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "no shadowed package units"
- **Relations:** depends-on REQ-SERVER-011

## REQ-SERVER-013 — Our units are identifiable in systemctl output

- **Status:** active
- **Source:** sean
- **Origin:** #292
- **Type:** constraint
- **Priority:** P2
- **Statement:** The host shall name every unit this repository introduces with
  a `custom-` prefix.
- **Rationale:** `REQ-SERVER-011` separates our units on disk, and that is
  where the separation stops. `systemctl list-units` and `systemctl status`
  present every unit from all three search paths in one flat list with no
  indication of which directory any of them came from, so the tidy directory is
  invisible in precisely the place one usually looks.

  A prefix restores it there: `systemctl list-units 'custom-*'` is the whole
  stack and nothing else. A suffix — which the previous generation used, as
  `cloudflared-custom.service` — globs equally well but sorts each unit next to
  unrelated ones, so a listing never groups them.

  The word is deliberately kept from the previous generation rather than
  replaced with a project name. It is already the habit, it already appears in
  the units production runs today, and `custom-` reads correctly for anything
  locally added regardless of which project adds it.

  Note that this does not apply to a packaged unit adjusted by drop-in, which
  keeps the package's own name by definition — that is `REQ-SERVER-012`.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "repo units are prefixed custom-"
- **Relations:**
  - depends-on REQ-SERVER-011
