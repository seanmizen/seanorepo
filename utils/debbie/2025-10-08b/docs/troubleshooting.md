# Troubleshooting debbie

## Cloudflare Error 1033 — tunnel unreachable

`Error 1033` means **no connector is registered with Cloudflare's edge**. It is
not an origin problem. If cloudflared were connected but the app behind it were
down, you would get `502` or `1016` instead.

### Confirm it

```bash
systemctl status cloudflared-custom.service --no-pager
journalctl -u cloudflared-custom.service -n 80 --no-pager
```

`active (running)` is not sufficient — systemd only knows the process did not
exit. Look for these lines instead:

| Log line | Meaning |
|---|---|
| `Registered tunnel connection connIndex=0..3` | Healthy. Four connections to the edge. |
| `Failed to fetch features … timeout` | Cannot reach Cloudflare's API — outbound problem. |
| `Unable to lookup protocol percentage` | Same, ~60s later. Confirms timeouts, not refusals. |
| `Initial protocol http2` | QUIC/UDP 7844 unavailable, fell back to TCP. Normal alone; suspicious alongside the above. |

Absence of `Registered tunnel connection` is the decisive signal. Timeouts
(rather than connection-refused) mean packets are leaving and nothing returns.

Server-side check of what Cloudflare thinks is connected:

```bash
cloudflared tunnel info <tunnel-uuid>
```

Zero connectors confirms 1033.

## Root cause seen on 2026-08-14: dead ethernet holding the default route

debbie is dual-homed on a single `/24`:

```
enx9cebe84aa579  UP   192.168.1.6/24     USB ethernet, static
wlp1s0           UP   192.168.1.103/24   wifi
```

`ipv4.method manual` assigns the static address **whether or not the link has
real upstream connectivity**. A USB NIC that is unplugged, loose, or in a dead
switch port still shows `UP` with an address in `ip -br addr`. Because
`postinstall.sh` historically gave ethernet `route-metric 100` against wifi's
`200`, the dead interface won the default route and every outbound packet was
blackholed — including cloudflared's.

`postinstall.sh` now probes carrier **and** gateway reachability before
preferring ethernet, demoting it to metric `300` when the probe fails.

### Diagnose

```bash
ip -br addr                  # addresses per interface
ip -br link                  # look for LOWER_UP on the ethernet device
ip route show                # two "default via" lines = ambiguous routing
sudo ethtool <iface> | grep -i 'link detected'
ping -c2 -I <iface> 192.168.1.1
```

`Link detected: no` → reseat the USB adapter and the cable at both ends.

### Recover a demoted interface by hand

```bash
sudo nmcli connection modify static-wifi ipv4.route-metric 50
sudo nmcli connection up static-wifi
sudo systemctl restart cloudflared-custom.service
```

## ARP flux

Two NICs on one subnet means either interface will answer ARP for either
address, so a remote host sees both IPs sharing one MAC:

```
debbie.mynet (192.168.1.6)  at 48:45:20:40:e4:e9
             (192.168.1.103) at 48:45:20:40:e4:e9   # same MAC, different NIC
```

`postinstall.sh` installs `/etc/sysctl.d/10-debbie-arp.conf` with
`arp_ignore=1` and `arp_announce=2` to stop this. Verify:

```bash
sysctl net.ipv4.conf.all.arp_ignore net.ipv4.conf.all.arp_announce
```

## Locking yourself out

`nmcli device disconnect <iface>` drops any SSH session routed over that
interface. `debbie.local` resolves via mDNS and may point at **either**
address, so it is not a safe way to reach a specific NIC — use the explicit IP.

`device disconnect` is not persistent: a reboot restores the interface as long
as `connection.autoconnect` is still `yes`. Only `nmcli connection modify
<profile> connection.autoconnect no` makes it survive a restart.

Out-of-band access: `ngrok tcp 22` runs on debbie, and a desktop session is
available on tty1 at the physical console.

## Running status.sh

```bash
sudo bash /home/srv/projects/seanorepo/utils/debbie/2025-10-08b/status.sh
```

Use `bash`, not `sh` — on Debian `sh` is dash, which cannot parse the array
literal in the script and fails with `Syntax error: "(" unexpected`.

## Services are up but the site 502s

All docker bridges showing `DOWN` in `status.sh` means no containers are
running, so nothing is listening on the ingress ports:

```bash
cd ~/projects/seanorepo && yarn prod:docker
docker ps
ss -tlnp | grep -E ':(4000|4030|4031|4042|4120)'
```
