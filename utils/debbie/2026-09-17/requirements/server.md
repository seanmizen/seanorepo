# REQ-SERVER — What a provisioned server must be

The properties that `payload/setup-server-environment.sh` gives a freshly
installed host. Each one has a check in
`utils/debbie/2026-09-17/payload/assert.sh`.

This file covers the host itself. The deploy poller is in `REQ-DEPLOY-*`. The
Cloudflare tunnel, the network failover watchdog and remote SSH are in
`REQ-NETWORK-*`.

---

## REQ-SERVER-001 — No local event takes the server down

- **Status:** active
- **Source:** sean
- **Origin:** #259
- **Type:** constraint
- **Priority:** P0
- **Statement:** While the operating system is running, the host shall ignore
  lid-close, idle, power-button, suspend-key and hibernate-key events rather
  than suspending or powering off.
- **Rationale:** asus, the production host, is a laptop that serves from a
  shelf with the lid shut. By default, logind suspends on lid close. That takes
  every hosted site offline until somebody physically opens the lid. The
  machine looks healthy the whole time, because it is only asleep.

  **The requirement covers every physical event on the shelf.** The lid is the
  most obvious event, but the power button has the same effect. A drop-in that
  ignored only the lid left `HandlePowerKey` at the systemd default of
  `poweroff`. A brief press was then a graceful shutdown of every hosted site.
  This happened twice on the first evening of real use. The second time, a
  `provision.sh` run reported "did not come up on SSH". DHCP had moved the
  machine to a different address, so it looked dead, and somebody switched it
  off while the script waited. The suspend and hibernate keys are in the
  Statement for the same reason: a laptop keyboard has them.

  **The host keeps every deliberate way to stop.** `systemctl poweroff` over
  SSH shuts the machine down on purpose, and this requirement does not affect
  it. A held power button still cuts power. The firmware does that force-off
  after approximately four seconds, unconditionally, and logind never sees it.
  `HandlePowerKeyLongPress` is a separate setting: the *software* long press of
  logind. It is set to `ignore`, so no press of any duration makes logind act.
  A value of `poweroff` would open the same gap for anyone who holds the button
  a moment too long.

  The settings are one drop-in under `/etc/systemd/logind.conf.d/`. The
  package owns `logind.conf`, and an upgrade can revert it or conflict with an
  edit. `setup-server-environment.sh` does not restart `systemd-logind` after
  it writes the drop-in. A restart terminates the calling session and would
  stop the provisioning run over SSH. logind reads the drop-in at the next
  boot, so the checks run only after a reboot.

  The key checks read the running logind manager over the bus. They do not
  read the drop-in file. A file that logind never read is exactly the failing
  state. A check that its contents satisfy would pass on a machine that is
  about to switch itself off.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "lid-close drop-in present"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "lid close ignored"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "lid close on power ignored"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "lid close docked ignored"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "sleep.target masked"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "power key ignored"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "long power press ignored"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "suspend key ignored"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "hibernate key ignored"
- **Relations:** none

## REQ-SERVER-002 — Only four ports are reachable

- **Status:** active
- **Source:** sean
- **Origin:** #259
- **Type:** constraint
- **Priority:** P1
- **Statement:** The host shall accept inbound connections on exactly ports
  22/tcp, 80/tcp, 443/tcp and 5353/udp, and refuse every other port, including
  every port published by a container. The one exception is a machine with the
  webserver role and without the tunnel role, which publishes its apps
  on ports 4000-4999 to the LAN by design.
- **Rationale:** Everything public arrives through the Cloudflare tunnel, which
  is an outbound connection. An open application port is a second way in that
  nobody audits or watches. Outside the exception in the Statement, the app
  ports in the 4000-4061 range stay closed, also on the LAN.

  The checks assert the count as well as the membership. A check that only
  finds the four would let a fifth port appear silently, and that is the drift
  this requirement must catch.

  **Container ports need their own checks.** Docker writes its own chains into
  the `nat` and `filter` tables. A container published with `-p 4000:4000`
  gets a DNAT rule that the kernel reads *before* the ufw rules. The port then
  answers from the LAN while `ufw status` reports only the four. That report
  is correct for ufw and false for the host. An earlier host had this fault.
  Its only check was `ufw status`, so the check agreed with the requirement and
  disagreed with the machine. The checks below read the machine.

  **How the host meets it.** `payload/setup-server-environment.sh` writes
  `/etc/docker/daemon.json` with `{"ip": "127.0.0.1"}`. That is the dockerd
  `--ip` option, "Host IP for port publishing". A published port then binds
  `127.0.0.1` and no other address. The LAN never sees the port, so there is
  no packet to filter. A LAN-deny rule in `DOCKER-USER` would filter the
  problem. The daemon setting removes it: no rule has to survive a reboot, and
  no chain order has to be correct. The setting costs nothing on the tunnel
  machine. Every ingress rule in `apps/cloudflared/config.yml` reaches its
  origin as `http://localhost:4xxx`, and `cloudflared` runs as a host process,
  so the tunnel uses only loopback.

  **The limit of the daemon setting.** `ip` is a *default*. A compose file
  that names a host address explicitly, such as `"0.0.0.0:4001:4001"`,
  bypasses it. This was measured on docker 28.5.2, and the port was reachable
  from another host. For that reason every `apps/*/docker-compose.yml` port
  names its address as `"${PUBLISH_ADDR:-127.0.0.1}:PORT:PORT"`. The address
  is loopback unless something sets `PUBLISH_ADDR`. `deploy.sh` sets it to
  `0.0.0.0` only on a webserver without the tunnel role, which is the
  exception in the Statement. A dev script can also set it. The daemon default
  is the second layer. The checks below read listening sockets, the `nat`
  chain and a published probe port. They do not read either configuration.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "ufw active"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "ufw allows no port beyond
    the four"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "docker publishes to
    loopback by default"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "nothing outside the four
    ports listens on a non-loopback address"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "no docker DNAT rule reaches
    a non-loopback address"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "a deliberately published
    port binds loopback and nothing else"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "that port refuses a
    connection to the host's own routable address"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the deploy publishes on
    loopback with the tunnel and on the LAN without"
- **Relations:** none

## REQ-SERVER-003 — The deploy user can deploy without a password

- **Status:** active
- **Source:** sean
- **Origin:** #259
- **Type:** functional
- **Priority:** P1
- **Statement:** The host shall provide a deploy user holding both `sudo` and
  `docker` group membership.
- **Rationale:** Deployment runs unattended from a systemd timer. A step that
  asks for a password makes a deploy that hangs forever. It does not fail
  visibly.

  An archived generation had a preseed that created a user named `sean` on a
  host named `debbie2`. Every systemd unit, the sudoers drop-in and all the
  docs expected `srv` on `debbie`. Nothing made the usernames agree. A machine
  built from those files end to end could start none of the units. This
  requirement names the user so that the two halves cannot drift apart.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "user srv exists"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "srv in sudo"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "srv in docker"
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
- **Rationale:** Every runbook step reaches a machine as `<name>.local`, for
  example `asus.local`. A LAN address has moved more than once, and an IP
  address in a document goes stale silently. mDNS keeps the name working
  across an address change.

  "From its first boot" is the core of the requirement.
  `setup-server-environment.sh` is itself a runbook step, so it also reaches
  the machine as `<name>.local`. When `setup-server-environment.sh` installed
  mDNS, the name worked only after the step that needed it. The hostname was
  also wrong. netcfg preferred a reverse-DNS answer to the preseeded name,
  split `192.168.1.182` at its first dot, and installed the machine as `192`.
  The two problems are one fault, because avahi advertises the system
  hostname. A fix to only one of them leaves the machine unreachable by name.

  For diagnosis: where a host has two interfaces on one subnet,
  `<name>.local` may resolve to either address. Do not use the name to reach
  one specific interface. Use the explicit IP address for that.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "hostname is debbie"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "static hostname is debbie"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "127.0.1.1 maps to debbie"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "avahi-daemon active"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "debbie.local resolves"
  - Test — `utils/debbie/2026-09-17/scripts/test-vm/test-vm.sh` › the `PHASE=firstboot` run,
    which asserts all of the above before `setup-server-environment.sh` executes and so
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
- **Rationale:** asus serves from a shelf with the lid shut. A network that
  needs a human to come back is the same outage as no network. DHCP over
  ethernet needs no extra work, but wifi does. The installed system must keep
  the credentials. It is not sufficient that the installer uses them.

  `netcfg` keeps them. It writes a `wpa-ssid`/`wpa-psk` stanza into
  `/etc/network/interfaces` and installs `wpasupplicant` into the target. That
  is **ifupdown**, and it satisfies this requirement.

  The obvious next step is a trap: `network-manager` added to the package
  list. With the `netcfg` stanza in place, that gives the worst of both. The
  ifupdown plugin of NetworkManager marks an interface listed in
  `/etc/network/interfaces` as unmanaged. `nmcli` then does not drive the
  wifi, and neither subsystem is in charge. A migration must remove the stanza
  and write an NM connection profile in one step. If that step is wrong, the
  result is a headless machine with no network and no way in. For that reason
  the migration is separate from the machine install. `REQ-NETWORK-004`
  records it.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "wifi config persisted"
    (skipped where the host has no wireless interface, which is every VM run —
    QEMU has no 802.11 device the installer would drive)
- **Relations:** none


## REQ-SERVER-006 — Security updates apply without anyone logging in

- **Status:** active
- **Source:** sean
- **Origin:** #273
- **Type:** functional
- **Priority:** P1
- **Statement:** The host shall install updates from the security suite
  unattended and without rebooting itself.
- **Rationale:** Nobody logs into this machine for months at a time. An
  unpatched internet-facing host that nobody looks at is the worst combination
  of the two. "I will run apt upgrade when I next SSH in" once meant sixteen
  months: the self-update of cloudflared failed silently for that long, and
  nothing reported it.

  Reboots are **never** automatic. This host serves from a shelf. An
  unattended reboot that does not bring wifi back is an outage that nobody
  watches for. The move off ifupdown (`REQ-NETWORK-004`) has the status
  `proposed`, so the wifi path after a reboot is not settled. That makes an
  automatic reboot less acceptable.

  `Unattended-Upgrade::Automatic-Reboot` is set **explicitly** to `false`. The
  package default is also `false`, but the default is not sufficient. A
  security property must be true on purpose, and only an explicit value lets a
  check tell it apart from "nobody considered the question".
  `PasswordAuthentication` in `REQ-SERVER-008` follows the same logic. The
  accepted cost: a kernel or libc fix is downloaded and unpacked, but it is
  not in force until somebody reboots by hand. `/var/run/reboot-required`
  shows when a reboot is necessary.

  **The stock configuration is wider than the security suite.** Debian's
  `50unattended-upgrades` enables three origin patterns. The first,
  `origin=Debian,codename=${distro_codename},label=Debian`, is the whole
  stable suite. A `--dry-run` against the stock file proposed `base-files`,
  `bash`, `libc6`, `perl-base` and `tzdata` from
  `archive:stable label:Debian`. So `setup-server-environment.sh` writes a
  drop-in that `#clear`s the list and then sets one pattern. The apt.conf list
  syntax **appends**. A drop-in that only names its pattern leaves all three
  Debian patterns in force and adds a fourth.

  **Two independent halves.** The apt configuration sets what may be
  upgraded. `apt-daily.timer` and `apt-daily-upgrade.timer` set whether an
  upgrade ever runs. A host with a correct configuration and masked timers has
  applied no patch since installation, and it reports nothing. That is the
  same failure as the cloudflared incident. The checks cover both halves. They
  read the timers from systemd and do not check for a file.

  `powermgmt-base` is **never** installed. When it is present,
  `unattended-upgrades` skips every run while the machine is on battery. asus
  is a laptop, so the package always finds a battery.

  The checks read the **effective** configuration. `apt-config shell` is the
  apt parser over the apt tree. `unattended-upgrade --dry-run --debug` prints
  the origin list with `${distro_codename}` expanded against the running
  release. The checks never fall back to a grep of `50unattended-upgrades`. A
  file that the tool never read is the bug, so a check that the file contents
  satisfy would pass in the failing state.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "unattended-upgrades installed"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "powermgmt-base absent, so a battery cannot pause patching"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the security suite is in apt's sources"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "apt-daily.timer enabled"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "apt-daily.timer active"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "apt-daily-upgrade.timer enabled"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "apt-daily-upgrade.timer active"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "apt's periodic unattended upgrade is on"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "only the security suite is upgraded unattended"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "automatic reboot explicitly disabled"
- **Relations:** none

## REQ-SERVER-007 — Logs cannot fill the disk

- **Status:** active
- **Source:** sean
- **Origin:** #273
- **Type:** constraint
- **Priority:** P2
- **Statement:** The host shall bound the on-disk size of its journal.
- **Rationale:** An uncapped journal on a host nobody inspects eventually fills
  the disk, and a full disk takes down every site at once with a cause that
  presents as anything but disk space — containers failing to start, SQLite
  write errors, a tunnel that will not come up.

  This is separate from `REQ-SERVER-006` because the two fail independently. A
  fully patched host can fill its disk. A capped journal does nothing about an
  unpatched OpenSSH.

  A drop-in sets the cap to 1G. The disk is a 128 GB SSD, shared with Docker
  images and the SQLite volumes. The journald default of 10% of the filesystem
  is a bound, but only by accident.

  The check reads the limit that the running journald reports. It does not
  read the drop-in. A file that journald never read is the failing state.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "journald size capped"
- **Relations:** none

## REQ-SERVER-008 — SSH accepts keys and nothing else

- **Status:** active
- **Source:** sean
- **Origin:** #273
- **Type:** constraint
- **Priority:** P0
- **Statement:** The host shall accept SSH authentication by public key only,
  refusing password authentication, keyboard-interactive authentication and
  root login, as sshd reports its own effective configuration.
- **Rationale:** Port 22 is open on the LAN by `REQ-SERVER-002`, and the deploy
  account has passwordless sudo by `REQ-SERVER-003`. Together, those two mean
  that a guessed password gives complete control of the host. The password
  path must not exist. It is not sufficient that it is hard to use.

  Without an explicit setting, key-only access holds only by accident. The
  account has a password hash. With `PasswordAuthentication` at its default
  and no check, nothing guarantees the property.

  The checks use `sshd -T` and do not read the drop-in. sshd globs
  `sshd_config.d/*.conf` in lexical order, and the **first** setting of a
  keyword wins. A drop-in that sorts too late, or has a name that sshd never
  globs, has no effect, but a `grep` on it still matches. A file that sshd did
  not read is the fault that this requirement must catch.

  The account password stays unlocked. Console login is the recovery path,
  and this generation has no out-of-band access.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "sshd config is valid"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "ssh passwords refused"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "ssh keyboard-interactive refused"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "ssh root login refused"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "ssh still accepts keys"
- **Relations:**
  - depends-on REQ-SERVER-002
  - depends-on REQ-SERVER-003

## REQ-SERVER-009 — Repeated failed authentication is throttled

- **Status:** withdrawn
- **Source:** sean
- **Origin:** #273
- **Type:** functional
- **Priority:** P2
- **Statement:** When a client fails authentication repeatedly, the host shall
  refuse further attempts from that address for a period.
- **Rationale:** This is secondary to `REQ-SERVER-008` and has a lower
  priority. The removal of the password mechanism matters more than a rate
  limit on attacks against it. When keys are the only path, this requirement
  adds a bound on log volume and on the CPU that a scanner costs. For that
  reason it sits next to `REQ-SERVER-007` and replaces nothing.

  **Withdrawn 2026-09-19.** Throttling by source address has nothing to act on
  here. The only internet-facing SSH path is ngrok, which reaches `sshd` from
  `127.0.0.1`, so every remote client shares one address. If loopback is
  exempt, the throttle stops no attacker. If loopback is not exempt, one
  scanner can lock out the owner. The LAN is exempt, so provisioning cannot
  lock itself out. `REQ-SERVER-008` keeps attackers out. `REQ-SERVER-007`
  bounds their log volume.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "fail2ban active"
- **Relations:** refines REQ-SERVER-008

## REQ-SERVER-010 — The interactive shell is the one described in the repository

- **Status:** active
- **Source:** sean
- **Origin:** #273
- **Type:** quality
- **Priority:** P3
- **Statement:** The host shall give the deploy user the configured interactive
  shell and prompt.
- **Rationale:** Most work on this machine is done by hand over SSH, usually
  while something is broken. A shell with history search, completion and a
  prompt that shows the git branch helps to diagnose a bad deploy. It also
  helps to prevent a `git checkout` on the wrong branch.

  The priority is P3 because this is cosmetic compared with everything else
  here. It is a requirement because an archived generation's postinstall
  appended its prompt block again on every run. Its documentation claimed
  idempotency, but nothing asserted the claim, so nobody noticed.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "deploy user shell is zsh"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "shell config is idempotent"
    — the VM harness runs `setup-developer-environment.sh` twice and hashes
    `.zshrc` before and after the second run. The check skips on metal, where
    there is no second run
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "oh-my-zsh and both plugins present"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "zsh starts cleanly with that config"
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
  unit-paths` shows 156 more in `/usr/lib/systemd/system`. In that mix, a
  person can find their own service only by a naming trick. The archived
  generation `archive/2025-10-08b/` put `custom` in every filename for this
  reason.

  `/usr/local/lib/systemd/system` is in the default search path. It has the
  FHS `/usr/local` meaning: software that the package manager of the
  distribution does not own. It is empty on a fresh install. So the units
  placed there are the only files in that directory, and a plain `ls` answers
  "what did we install?" with no convention to remember.

  The naming convention in `REQ-SERVER-013` is still necessary. The directory
  answers the question only in the filesystem, and most of the time a person
  reads `systemctl` output.

  `/etc/systemd/system` keeps its usual role: enable symlinks, masks and
  drop-ins. This requirement does not change that.

  systemd does not recurse into subdirectories of the search path, so a
  per-project folder is not possible. Only `<unit>.d/` drop-ins and
  `<target>.wants/` have meaning there. This requirement is the nearest thing
  that works.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "no repo units in /etc/systemd/system"
  - Inspection — every unit installed by `utils/debbie/2026-09-17/` resolves to
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
  wins, and systemd never reads the package's own version. That is a trap.
  The override does not show in the package's directory, it survives a
  package upgrade, and it gives no clue to a person who debugs why a
  documented default does not apply.

  The risk is real. A unit named `ssh.service` in the higher-precedence
  directory would quietly replace the one that `openssh-server` ships. The
  `cloudflared` package ships no unit, but `cloudflared service install`
  writes a `cloudflared.service`. For that reason the tunnel unit of this
  repository is `custom-cloudflared.service`.

  A drop-in states only what is different, adds to whatever the package
  ships, and shows in `systemctl cat`, where a person will find it.
  `REQ-SERVER-011` governs a service that this repository introduces. This
  requirement governs a change to a service that a package owns.
- **Verification:**
  - Inspection — no filename in `/usr/local/lib/systemd/system` matches a unit
    present in `/usr/lib/systemd/system`
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "no shadowed package units"
- **Relations:** depends-on REQ-SERVER-011

## REQ-SERVER-013 — Our units are identifiable in systemctl output

- **Status:** active
- **Source:** sean
- **Origin:** #292
- **Type:** constraint
- **Priority:** P2
- **Statement:** The host shall name every unit this repository introduces with
  a `custom-` prefix.
- **Rationale:** `REQ-SERVER-011` separates our units on disk, and the
  separation stops there. `systemctl list-units` and `systemctl status` show
  every unit from all three search paths in one flat list. The list does not
  show which directory a unit came from. So the separate directory is
  invisible in the place where a person usually looks.

  A prefix gives the same separation there. `systemctl list-units 'custom-*'`
  shows the whole stack and nothing else. `archive/2025-10-08b/` used a
  suffix, as in `cloudflared-custom.service`. A suffix globs equally well, but
  it sorts each unit next to unrelated ones, so a listing never groups them.

  The word `custom` comes from that archived generation, and no project name
  replaces it. It is already the habit. `custom-` also reads correctly for
  anything added locally, whichever project adds it.

  This requirement does not apply to a packaged unit changed by a drop-in.
  That unit keeps the package's own name by definition, and `REQ-SERVER-012`
  governs it.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "repo units are prefixed custom-"
- **Relations:**
  - depends-on REQ-SERVER-011

## REQ-SERVER-014 — A forgotten setting never switches anything on

- **Status:** active
- **Source:** sean
- **Origin:** #329
- **Type:** constraint
- **Priority:** P0
- **Statement:** Where a provisioning setting is unset, the host shall take the
  choice that runs nothing, or refuse to provision.
- **Rationale:** The retired setting `DEBBIE_SERVES` defaulted to on, so a
  forgotten line made a machine run `yarn prod:docker`. `SERVER_NAME` had a
  default of `debbie`, so a forgotten line installed a second `debbie.local`
  and pointed `provision.sh` at the live machine. Both failures are silent
  until they matter.

  So each role (`ROLE_WEBSERVER`, `ROLE_TUNNEL`) is off unless it is set to
  `yes`. Every provisioning run makes the roles of the machine match the
  settings exactly. `SERVER_NAME` has no default in any script. The scripts
  refuse a retired setting by name. They do not ignore it.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "roles on this machine are
    exactly '${EXPECT_ROLES:-none}'" — the VM sets no roles, so no role file
    may exist
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "without the webserver role a
    triggered deploy runs nothing"
  - Demonstration — `provision.sh`, `serve-preseed.sh` and `build-iso.sh` with
    no `SERVER_NAME`, and `provision.sh` with a leftover `DEBBIE_SERVES`, each
    exit with a message before contacting any machine
- **Relations:**
  - refines REQ-DEPLOY-002
  - refines REQ-NETWORK-002

## REQ-SERVER-015 — Vendor packages update only when a release is 7 days old

- **Status:** active
- **Source:** sean
- **Origin:** #476
- **Type:** functional
- **Priority:** P2
- **Statement:** When a new version of `cloudflared` or `ngrok` has been the
  newest version for 7 days, the host shall install it unattended.
- **Rationale:** `REQ-SERVER-006` takes the Debian security suite only, so it
  never updates these two packages, which come from their vendors' apt
  repositories. Without an update path, a daemon on the internet stays at an
  old version with no report, which is the reason `cloudflared` runs from a
  package at all.

  The vendors put every release in one suite, so apt cannot tell a security
  fix from a feature release or a bad one. The history of `cloudflared`
  decided the rule. Its two security advisories are local, and for Windows. It
  has no remote vulnerability in the daemon. Its bad releases were short:
  2024.1.3 (a CPU spike on Linux), 2024.9.0 (reverted the same day), and
  2026.8.0 and 2026.8.1 (path normalization that broke applications, marked
  "do not use", and reverted in 2026.8.2). Each one was fixed or reverted
  within 2 days. A 7-day minimum age skips all of them, and costs little
  against that history.

  The repositories record no publish date, and Cloudflare's holds only the
  newest version. So the host records when it first sees each version. A
  newer version resets the count, so a series of quick fixes waits until the
  releases stop.

  After an install the host restarts the tunnel, which drops requests for a
  few seconds, so the timer runs early in the morning. It never restarts
  ngrok: on the free plan, a restart gives a new public address. The new ngrok
  version starts at the next restart of the unit. `unattended-upgrades` keeps
  its security-only configuration, and this is a separate timer.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "custom-vendor-upgrade.timer installed and enabled"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the vendor upgrade is installed outside the checkout"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the vendor upgrade gate is 7 days"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the vendor upgrade installs nothing before a version is 7 days old"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the vendor upgrade installs both packages on day 7"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the vendor upgrade restarts cloudflared and never ngrok"
  - Inspection — `utils/debbie/2026-09-17/services/vendor-upgrade.sh` skips a
    package that `apt-mark hold` holds, so a rollback stays in place
- **Relations:**
  - refines REQ-SERVER-006
  - depends-on REQ-NETWORK-005
