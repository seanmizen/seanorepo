#!/bin/bash
# lan-names.sh: publishes <site>.<hostname>.local over mDNS for each LAN site.
#
# Where: a webserver without the tunnel role (REQ-SERVER-016), as
#        custom-lan-names.service.
# Why:   Caddy (infra/edge) serves each site at <site>.<hostname>.local, and
#        avahi publishes only <hostname>.local by itself.
#
# The site names come from the Caddyfile: every `http://<site>.{$EDGE_HOST}.local`
# block. The Caddyfile is the one list of LAN sites.
#
# The script exits when the machine's IPv4 address changes, or when a
# publisher dies. systemd then starts it again with the new address.
set -euo pipefail

caddyfile="${1:?usage: lan-names.sh <Caddyfile>}"
host="$(hostname -s)"

address() {
    ip -4 route get 1.1.1.1 2> /dev/null \
        | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }'
}

addr="$(address)"
[ -n "$addr" ] || { echo "lan-names: no IPv4 address yet" >&2; exit 1; }

mapfile -t sites < <(sed -nE 's#^http://([a-z0-9-]+)\.\{\$EDGE_HOST\}\.local.*#\1#p' "$caddyfile" | sort -u)
[ "${#sites[@]}" -gt 0 ] || { echo "lan-names: no sites in $caddyfile" >&2; exit 1; }

pids=()
trap 'kill "${pids[@]}" 2> /dev/null || true' EXIT
for site in "${sites[@]}"; do
    avahi-publish -a -R "$site.$host.local" "$addr" > /dev/null &
    pids+=("$!")
    echo "lan-names: $site.$host.local -> $addr"
done

while sleep 60; do
    [ "$(address)" = "$addr" ] || { echo "lan-names: the address changed"; exit 0; }
    for pid in "${pids[@]}"; do
        kill -0 "$pid" 2> /dev/null || { echo "lan-names: a publisher stopped" >&2; exit 1; }
    done
done
