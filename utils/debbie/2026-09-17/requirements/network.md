# REQ-NETWORK — How traffic reaches the server, and how it keeps reaching it

The path from the public internet to a container on the host, and the
behaviour that keeps that path alive without anyone watching.

`2026-09-17/` implements these requirements, and the evidence below cites the
files of that generation. `REQ-NETWORK-001` and `REQ-NETWORK-002` cover the
tunnel. `REQ-NETWORK-003` and `REQ-NETWORK-004` cover route failover.
`REQ-NETWORK-005` covers remote SSH. The outage of 2026-08-14, recorded in
`REQ-NETWORK-003`, is the reason for the failover requirements.

---

## REQ-NETWORK-001 — Nothing is published by opening a port

- **Status:** active
- **Source:** sean
- **Origin:** #273
- **Type:** constraint
- **Priority:** P0
- **Statement:** The host shall serve public traffic through an outbound
  tunnel, without any inbound port being forwarded.
- **Rationale:** The machine is a laptop on a domestic connection with a
  dynamic address. Port forwarding would expose it directly, tie the sites to
  an address that changes, and put TLS termination on a machine that nobody
  patches on a schedule.

  A Cloudflare tunnel dials out. The router needs no configuration, the
  address can change freely, and TLS terminates at the edge. The firewall can
  also stay closed. `REQ-SERVER-002` allows four ports, and none of them is an
  application port.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "no other ports open"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "cloudflared installed"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "custom-cloudflared.service
    installed in /usr/local/lib/systemd/system"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "no other cloudflared unit
    is enabled" — the check catches two daemons that dial out for one tunnel
  - Inspection — `utils/debbie/2026-09-17/services/custom-cloudflared.service`
    runs `cloudflared tunnel run`, which dials out, and opens no port
- **Relations:** none

## REQ-NETWORK-002 — Ingress rules live in the repository

- **Status:** active
- **Source:** sean
- **Origin:** #273
- **Type:** constraint
- **Priority:** P1
- **Statement:** The host shall take its tunnel ingress rules from
  `apps/cloudflared/config.yml` in the deployed checkout.
- **Rationale:** The hostname-to-port map changes whenever an app is added,
  and people are likely to edit it in a hurry. In the repository, a routing
  change is reviewable, revertable and visible in the same history as the app
  it routes to. A file edited over SSH exists in one place and has no backup.

  The credentials are the one exception. They are specific to the host and
  gitignored, and `REQ-DEPLOY-006` protects them. Provisioning defines where
  they go and creates the directory. It never writes their content, and a
  second run never overwrites a set that exists.

  `config.yml` names its `credentials-file` by a path *relative* to itself, so
  the unit must run with its working directory set to `apps/cloudflared`.
  Without that, the daemon starts and then cannot find the credentials. The
  error looks like an authentication problem, but the cause is the path.

  The tunnel runs only on the machine with the tunnel role (`ROLE_TUNNEL`,
  exactly one machine). Credentials alone are not sufficient: a copy on a
  second machine must not pull public traffic to it.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the tunnel runs only on a
    machine with the tunnel role"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the tunnel is NOT enabled
    without the tunnel role" — credentials alone, the state between two steps
    of the runbook's tunnel move, must not enable the tunnel
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the tunnel reads config.yml
    from the checkout"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the tunnel runs in the
    checkout's cloudflared directory"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "credentials directory is
    mode 700"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the tunnel is NOT enabled
    while credentials are absent" — a host with no credentials does not run
    the tunnel, so the unit does not restart forever
  - Inspection — `utils/debbie/2026-09-17/services/custom-cloudflared.service`
    passes `--config` the checkout's `apps/cloudflared/config.yml` and runs in
    the checkout's `apps/cloudflared`, as rendered by
    `payload/setup-server-environment.sh`
- **Relations:**
  - depends-on REQ-NETWORK-001
  - depends-on REQ-DEPLOY-005
  - depends-on REQ-DEPLOY-006

## REQ-NETWORK-003 — A link with carrier but no route is treated as dead

- **Status:** active
- **Source:** sean
- **Origin:** #273
- **Type:** functional
- **Priority:** P0
- **Statement:** When the interface holding the default route cannot reach the
  gateway, the host shall move the default route to an interface that can.
- **Rationale:** On 2026-08-14 `seanmizen.com` returned Cloudflare Error 1033
  while `cloudflared` ran normally. The interface that held the default route
  had carrier but no upstream, so every outbound packet was blackholed. The
  tunnel sent into a disconnected wire, and nothing noticed.

  The network stack reacts to carrier loss. It does not react to lost
  reachability. So a dead switch port, or a cable unplugged at the far end,
  keeps its address and its route indefinitely. Static metrics do not help.
  The preferred interface is preferred without evidence, so the failure only
  waits for that interface to die.

  So the probe must go *through* the interface that owns the route. A healthy
  link must never be bounced, because an unnecessary failover is an outage
  too.
- **Verification:**
  - Inspection — `utils/debbie/2026-09-17/services/net-failover.sh` probes the
    gateway with `ping -I <iface>` through the interface that owns the route,
    and exits without acting when it succeeds
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the watchdog names no
    interface and no gateway" — the watchdog takes no configuration, so it
    protects every machine, and not only a machine that an env file describes
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "case 1+8: a healthy run changes nothing and logs
    nothing" — the watchdog never bounces a healthy link, and the journal stays
    readable
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "case 4: upstream dead with carrier up moves the
    default route" — the check reproduces the 2026-08-14 failure: it blackholes
    the gateway while the carrier stays up
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "case 7: the route does not fail back on its own"
  - Test — `utils/debbie/2026-09-17/scripts/test-vm/test-vm.sh` › "case 5:
    pulling the cable on n1" — carrier loss, driven through the QEMU monitor,
    because only the emulator can remove a link
  - Demonstration — a machine with one link runs the watchdog and finds nothing
    to promote. The VM always has three links, so no VM check covers this.
- **Relations:** depends-on REQ-NETWORK-001

  A VM run does not cover wifi association and WPA. QEMU has no wireless
  device. The VM matrix proves the probe, the promotion and the demotion. Only
  a run on metal proves wifi.

## REQ-NETWORK-004 — The failover watchdog and the wifi configuration agree on an owner

- **Status:** withdrawn
- **Source:** sean
- **Origin:** #273
- **Type:** constraint
- **Priority:** P1
- **Statement:** Where the host reaches the network over wifi, the interface
  shall be managed by the subsystem the failover watchdog drives.
- **Rationale:** A wifi-only host installed by `netcfg` has its wifi in
  ifupdown. `netcfg` persists wifi as a `wpa-ssid`/`wpa-psk` stanza in
  `/etc/network/interfaces` and installs `wpasupplicant`. The watchdog must act
  on the interface that owns the route, so the watchdog and the wifi
  configuration must agree on the subsystem that manages that interface.

  In this generation, `net-failover.sh` uses `ip` only and never `nmcli`, and
  `network-manager` is not installed, so the two agree. The risk is a partial
  move to NetworkManager. If `network-manager` is installed next to the
  stanza, the result is the worst of the three available states. The ifupdown
  plugin of NetworkManager marks any interface listed in
  `/etc/network/interfaces` as unmanaged. A watchdog built on `nmcli` then
  silently does nothing, and that looks the same as a watchdog that works.

  **Withdrawn 2026-09-23.** This requirement existed to justify a move of the
  wifi to NetworkManager, for a watchdog built on `nmcli`. The watchdog uses
  `ip` only, so it works with the ifupdown configuration that the installer
  writes, and there is no move to make. A move would add the risk of a
  headless machine with no network, for no gain. `REQ-SERVER-005` covers the
  wifi, and `REQ-NETWORK-003` covers the watchdog.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "wifi config persisted"
    (skipped where the host has no wireless interface, which is every VM run)
  - Demonstration — the wifi interface survives a reboot and `nmcli device`
    reports it as managed
- **Relations:**
  - refines REQ-SERVER-005
  - depends-on REQ-NETWORK-003

## REQ-NETWORK-005 — The host is reachable over SSH from outside the local network

- **Status:** active
- **Source:** sean
- **Origin:** #317
- **Type:** functional
- **Priority:** P1
- **Statement:** The host shall accept an SSH connection that originates outside
  the local network, without any inbound port being opened.
- **Rationale:** Most repair work on this machine is done by hand over SSH,
  usually while something is broken, and often from somewhere else. `ngrok tcp
  22` is the only path that does this. The agent dials out, so
  `REQ-NETWORK-001` holds. The Cloudflare SSH tunnel (`ssh.seanmizen.com`)
  does not work, and this generation does not build it.

  ngrok is the only way in, and two properties follow from that. The agent
  never stops retrying, because a unit that stopped during an outage would
  stay down on a machine that nobody can reach. Every ngrok login reaches
  `sshd` from `127.0.0.1`, so loopback is exempt from the per-source penalties
  of sshd. Without the exemption, one scanner on the public address would
  lock the owner out before authentication, whatever key the owner held.
  `REQ-SERVER-008` keeps attackers out.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "ngrok is dpkg-owned, not a manual binary drop"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "ngrok runs as $DEPLOY_USER"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "ngrok never stops retrying"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "no other ngrok unit is enabled"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "starting ngrok without an authtoken refuses rather than looping"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "sshd exempts loopback from per-source penalties"
  - Demonstration — an SSH login through ngrok from off the LAN, with key
    authentication, on the real machine
- **Relations:**
  - depends-on REQ-NETWORK-001
  - depends-on REQ-SERVER-008
