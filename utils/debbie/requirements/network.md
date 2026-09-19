# REQ-NETWORK — How traffic reaches debbie, and how it keeps reaching it

The path from the public internet to a container on the host, and the
behaviour that keeps that path alive without anyone watching.

`2025-10-08b/` implements these on the box running today. `2026-09-17/` has
rebuilt the tunnel half (`REQ-NETWORK-001`, `REQ-NETWORK-002`, in #280) and has
not rebuilt the failover half. The August 2026 outage recorded in
`REQ-NETWORK-003` is why the failover half exists at all.

Introduced in #273.

---

## REQ-NETWORK-001 — Nothing is published by opening a port

- **Status:** active
- **Source:** sean
- **Origin:** #273
- **Type:** constraint
- **Priority:** P0
- **Statement:** The host shall serve public traffic through an outbound
  tunnel, without any inbound port being forwarded.
- **Rationale:** The box is a laptop on a domestic connection with a dynamic
  address. Port forwarding would expose it directly, tie the sites to an
  address that changes, and put TLS termination on a machine nobody patches on
  a schedule.

  A Cloudflare tunnel dials out, so the router needs no configuration, the
  address can change freely, and TLS terminates at the edge. It also means the
  firewall can stay closed — `REQ-SERVER-002` allows four ports and none of
  them is an application port.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "no other ports open"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "cloudflared installed"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "custom-cloudflared.service
    installed in /usr/local/lib/systemd/system"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "no other cloudflared unit
    is enabled" — two daemons dialling out for one tunnel is the failure this
    catches
  - Inspection — `utils/debbie/2025-10-08b/services/cloudflared-custom.service`
    (what production runs today, until a box is rebuilt on `2026-09-17/`)
- **Relations:** none

## REQ-NETWORK-002 — Ingress rules live in the repository

- **Status:** active
- **Source:** sean
- **Origin:** #273
- **Type:** constraint
- **Priority:** P1
- **Statement:** The host shall take its tunnel ingress rules from
  `apps/cloudflared/config.yml` in the deployed checkout.
- **Rationale:** Hostname-to-port mapping is the thing that changes whenever an
  app is added, and it is the thing most likely to be edited in a hurry. Keeping
  it in the repository means a routing change is reviewable, revertable and
  visible in the same history as the app it routes to, rather than being a file
  edited over SSH that exists in one place and is backed up nowhere.

  The credentials are the deliberate exception: they are host-specific and
  gitignored, which is what `REQ-DEPLOY-006` protects. Provisioning defines
  where they go and creates the directory; it never writes their content, and
  re-running it never overwrites a set that is already there.

  Because `config.yml` names its `credentials-file` by a path *relative* to
  itself, the unit has to run with its working directory set to
  `apps/cloudflared`. Without that the daemon starts and then cannot find the
  credentials, which reads as an authentication problem rather than a path one.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "the tunnel reads config.yml
    from the checkout"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "the tunnel runs in the
    checkout's cloudflared directory"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "credentials directory is
    mode 700"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "the tunnel is NOT enabled
    while credentials are absent" — a host with no credentials refuses to run
    the tunnel rather than restarting against it forever
  - Inspection — `utils/debbie/2025-10-08b/services/cloudflared-custom.service`
    points at the checkout's `config.yml`
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
  while `cloudflared` was running normally: the interface holding the default
  route had carrier but no upstream, so every outbound packet was blackholed.
  The tunnel was shouting into a disconnected wire and nothing noticed.

  NetworkManager reacts to carrier loss, not to reachability, so a dead switch
  port or a cable unplugged at the far end keeps its address and its route
  indefinitely. Static metrics do not help either: whichever interface is
  preferred is preferred on faith, so the failure simply waits for that one to
  die.

  The probe therefore has to go *through* the interface that currently owns the
  route, and a healthy link must never be bounced — an unnecessary failover is
  its own outage.
- **Verification:**
  - Inspection — `utils/debbie/2025-10-08b/scripts/net-failover.sh` pings the
    gateway with `-I <iface>` and exits without acting when it succeeds
  - Inspection — `utils/debbie/2025-10-08b/services/net-failover-custom.timer`
- **Relations:** depends-on REQ-NETWORK-001

## REQ-NETWORK-004 — The failover watchdog and the wifi configuration agree on an owner

- **Status:** proposed
- **Source:** sean
- **Origin:** #273
- **Type:** constraint
- **Priority:** P1
- **Statement:** Where the host reaches the network over wifi, the interface
  shall be managed by the subsystem the failover watchdog drives.
- **Rationale:** `net-failover.sh` promotes and demotes routes through `nmcli`,
  so it can only act on interfaces NetworkManager manages. A wifi-only host
  installed by `netcfg` does not have one: `netcfg` persists wifi as a
  `wpa-ssid`/`wpa-psk` stanza in `/etc/network/interfaces` and installs
  `wpasupplicant`, which is ifupdown.

  Installing `network-manager` alongside that stanza produces the worst of the
  three available states rather than the best. NetworkManager's ifupdown plugin
  marks any interface listed in `/etc/network/interfaces` as unmanaged, so
  `nmcli` does not drive the wifi, ifupdown does — and the watchdog silently
  does nothing, which is indistinguishable from the watchdog working.

  Held at **proposed** because the migration is the risky part, not the
  requirement. It has to delete the stanza and write an NM connection profile
  in a single step, and a mistake leaves a headless machine with no network and
  no way in. That is worth doing with physical access to the box, which is why
  it is deliberately not coupled to installing one.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "wifi config persisted"
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
- **Rationale:** Most repair work on this box is done by hand over SSH, usually
  while something is already broken, and often from somewhere else. `ngrok tcp
  22` is the only path that does this: the agent dials out, so
  `REQ-NETWORK-001` still holds. The Cloudflare SSH tunnel
  (`ssh.seanmizen.com`) is dead and is deliberately not rebuilt.

  Two properties follow from being the only way in. The agent never stops
  retrying, because a unit that gave up during an outage would stay down on a
  box nobody can reach. And every ngrok login reaches `sshd` from
  `127.0.0.1`, so loopback is exempt from sshd's per-source penalties:
  otherwise one scanner hitting the public address would lock the owner out
  before authentication, whatever key they held. `REQ-SERVER-008` is what
  keeps attackers out.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "ngrok is dpkg-owned, not a manual binary drop"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "ngrok runs as $DEPLOY_USER"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "ngrok never stops retrying"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "no other ngrok unit is enabled"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "starting ngrok without an authtoken refuses rather than looping"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "sshd exempts loopback from per-source penalties"
  - Demonstration — an SSH login through ngrok from off the LAN, with key
    authentication, on the real box
- **Relations:**
  - depends-on REQ-NETWORK-001
  - depends-on REQ-SERVER-008
