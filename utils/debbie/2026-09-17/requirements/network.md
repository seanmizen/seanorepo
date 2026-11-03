# REQ-NETWORK — How traffic reaches the server, and how it keeps reaching it

The path from the public internet to a container on the host, and the
behaviour that keeps that path alive without anyone watching.

`2026-09-17/` implements these requirements, and the evidence below cites the
files of that generation. `REQ-NETWORK-001` and `REQ-NETWORK-002` cover the
tunnel. `REQ-NETWORK-003` and `REQ-NETWORK-004` cover route failover.
`REQ-NETWORK-005` covers remote SSH through ngrok. `REQ-NETWORK-006` and
`REQ-NETWORK-007` cover the WireGuard VPN and its DNS record. The outage of
2026-08-14, recorded in `REQ-NETWORK-003`, is the reason for the failover
requirements.

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

  **The one deliberate inbound port is the VPN.** On the machine with the VPN
  role, the router lets UDP 51820 through over IPv6, and WireGuard listens on
  it (`REQ-NETWORK-006`). It serves no public traffic, so this statement still
  holds. The port is acceptable because WireGuard sends no reply to a packet
  without a valid key. A port scan gets no answer, the same as from a port
  that the firewall drops, so the scan cannot see the port. Only a device with
  a key from the repository's peer list gets a reply.
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

## REQ-NETWORK-006 — The VPN host lets its own devices into the LAN over IPv6

- **Status:** active
- **Source:** sean
- **Origin:** #1032
- **Type:** functional
- **Priority:** P2
- **Statement:** Where the host has `ROLE_VPN=yes`, the host shall forward
  traffic to the LAN from the peers in `services/wireguard-peers` that
  connect over WireGuard on UDP 51820.
- **Rationale:** ngrok (`REQ-NETWORK-005`) gives a new address at each agent
  restart, so it needs `apps/tcp-getter` to email the address. A VPN gives a
  fixed name, SSH to every LAN device, and no third party in the traffic path.
  It costs nothing. A VPS hub costs money. Cloudflare WARP decrypts the
  traffic and couples the VPN to the production tunnel.

  **IPv6 only, from outside.** The router's IPv4 WAN address is CGNAT
  (`100.64.0.0/10`), so no IPv4 port forward is possible. IPv6 is native: the
  ISP delegates a /56, and each host has a public address. So WireGuard
  listens over IPv6, and a client needs an IPv6 network. Most UK mobile data
  has IPv6. On a network without it, use a phone hotspot. Inside the tunnel,
  traffic is IPv4 (`10.99.0.0/24`), and the host masquerades it onto the LAN,
  so LAN devices need no route to the tunnel.

  **A fixed address: the /64 of the uplink, plus `::51`.** The uplinks get
  stable-privacy SLAAC addresses, which nobody can type. On asus, the
  ethernet and the wifi get SLAAC addresses on the same /64. So `::51` must be
  on one interface only: on both, duplicate address detection fails on the
  second. `services/vpn-sync.sh` puts it on the uplink that holds the IPv4
  default route, because `net-failover.sh` keeps that route on an uplink that
  works (`REQ-NETWORK-003`). It removes the old address before it adds the
  new one. A policy route sends replies from `::51` out of the same uplink:
  the watchdog moves the IPv4 route only, so after a failover the main IPv6
  route can still point at the dead uplink. `ip addr` adds the address to a
  running interface, so nothing restarts. Neither ifupdown nor dhcpcd removes
  an address that it did not add.

  **The masquerade rule names no interface.** It matches the source
  `10.99.0.0/24` and the destination, the LAN subnet that the script reads
  from the uplink's own kernel route. So the rule works on whichever uplink is
  live. Docker sets the FORWARD policy to DROP, so a `DOCKER-USER` rule
  accepts traffic from `wg0` to the LAN, and its replies. The sync runs every
  2 minutes and adds any rule that a reboot removed.

  **Keys.** The host makes its private key on the host, once. The key never
  leaves the host and is in no repository. The peers' public keys are in the
  repository, one line for each device, so a new device is one line and one
  provisioning run. `wg syncconf` applies the new list, and the tunnels of the
  other peers stay up. `Table = off` stops `wg-quick` from adding routes, so
  `wg0` never takes the default route.

  **The router rule.** The ZTE allows the port with one manual IPv6 filter
  rule (see the README). The rule has no destination address, so it survives a
  prefix change. The host's own firewall opens 51820/udp only with the role
  (`REQ-SERVER-002`).

  This requirement adds the VPN beside ngrok. ngrok stays until the
  demonstrations below pass on the real machine.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "wg0 is up at
    10.99.0.1/24"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "wg0 listens on UDP
    51820"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "wg0 adds no default
    route"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the private key and the
    config are root-only"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "wg0 runs every peer of
    wg0.conf"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "DOCKER-USER accepts
    traffic from wg0"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the tunnel is
    masqueraded onto the LAN"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "::51 is on exactly one
    interface, the uplink" (skipped in a VM, which has no global IPv6)
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "no WireGuard config
    without the VPN role"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "no ::51 address without
    the VPN role"
  - Inspection — `utils/debbie/2026-09-17/payload/setup-server-environment.sh`
    makes the private key on the host and never replaces it, writes `wg0.conf`
    from `services/wireguard-peers`, and applies a change with `wg syncconf`
  - Demonstration — on asus: a phone on mobile data, with wifi off, connects.
    Over the tunnel it opens SSH to asus with a key, and reaches one other LAN
    device.
  - Demonstration — on asus: a laptop on the phone's hotspot does the same.
  - Demonstration — on asus: provisioning with the role restarts no network
    interface, cloudflared or Docker. seanmizen.com, carolinemizen.art and SSH
    through ngrok all work after it.
- **Relations:**
  - depends-on REQ-NETWORK-003
  - depends-on REQ-SERVER-002
  - depends-on REQ-SERVER-014

## REQ-NETWORK-007 — The VPN's DNS name follows the host's address

- **Status:** active
- **Source:** sean
- **Origin:** #1032
- **Type:** functional
- **Priority:** P2
- **Statement:** While the host has `ROLE_VPN=yes`, the host shall make the
  AAAA record of `vpn.seanmizen.com` equal to its `::51` address within 3
  minutes of a difference.
- **Rationale:** The ISP delegates the IPv6 prefix, and it can change at a
  reconnect. One 28-day WAN session showed one prefix, but a reconnect is
  untested. So the record must follow the address, and no person must do it.
  Clients connect to `vpn.seanmizen.com:51820`, so a wrong record is a VPN
  that nobody can reach.

  `custom-vpn-sync.timer` runs `services/vpn-sync.sh` every 2 minutes. The
  script reads the `::51` address from the interface, reads the record with
  one GET, and on a difference writes it with one PATCH. A run that changes
  nothing logs nothing. Logs go to the journal. There is no notification:
  ntfy is deprecated.

  **Its own token.** The token has DNS:Edit on the seanmizen.com zone and
  nothing else. It is a root-only file on the host. It is never the OpenTofu
  token, which can change every zone, the tunnel and the state bucket. A
  stolen DNS token can change DNS records in one zone. The OpenTofu token on
  the host would give much more. OpenTofu applies only in CI from `release`,
  so the host must not apply.

  **Two owners, one record.** `infra/cloudflare/` declares the record:
  grey-cloud, because Cloudflare's proxy does not carry UDP, and TTL 60, so a
  new address reaches clients fast. It ignores changes to the content, so an
  apply never writes the placeholder back over the timer's value.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "custom-vpn-sync.timer
    active"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the VPN sync runs every
    two minutes"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the VPN sync runs only
    on a machine with the VPN role"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the VPN sync timer is
    off without the VPN role"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the DNS token is
    root-only" (skipped where the machine has no token)
  - Inspection — the OpenTofu stack of Cloudflare (the repository's
    `infra` folder, outside this unit) declares the AAAA record grey-cloud,
    TTL 60, with `ignore_changes = [content]`
  - Inspection — `utils/debbie/2026-09-17/services/vpn-sync.sh` passes the
    token to curl on stdin, never in argv, and writes the record only when it
    differs from the address
  - Demonstration — on asus: set the AAAA record to a wrong value by hand. The
    timer restores it within 3 minutes.
- **Relations:** depends-on REQ-NETWORK-006
