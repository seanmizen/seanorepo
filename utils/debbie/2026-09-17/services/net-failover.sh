#!/bin/bash
# net-failover.sh: keep the default route on an interface that reaches upstream.
#
# Where: a provisioned machine. custom-net-failover.timer runs it.
# When:  every minute, and on nothing else. There is no event to wait for -
#        that is the whole problem.
# Why:   REQ-NETWORK-003. A DHCP client reacts to carrier. It does not check
#        reachability. An interface with carrier and no upstream - a dead switch
#        port, a cable unplugged at the far end, an access point that stopped
#        forwarding - keeps its address and its default route indefinitely and
#        blackholes every outbound packet. On 2026-08-14 that returned
#        Cloudflare Error 1033 for seanmizen.com while cloudflared ran normally,
#        shouting into a disconnected wire, and nothing noticed.
#
# It takes NO configuration. Interface names differ between machines and a
# hardcoded name is a machine this does not protect. Candidates, their
# gateways, and which of them are wireless all come from the running system.
#
# The script uses `ip` only. It never uses nmcli. This generation has no
# NetworkManager. It uses ifupdown and dhcpcd, and `nmcli` is not installed. A
# watchdog built on nmcli finds no candidates and silently does nothing, which
# is worse than no watchdog. `ip` works whatever configured the interface.
#
# It never bounces a healthy link. An unnecessary failover is its own outage,
# so the probe goes THROUGH the interface that owns the route, and a success
# exits without touching anything.
#
# It does not fail back. Promotion happens only when the ACTIVE path is dead,
# so after a failover the machine stays where it is until that path dies too.
# Automatic failback would flap between two marginal links.
#
# Decisions go to the journal under the net-failover tag. A healthy run says
# nothing: this runs every minute and a log line per minute is a log nobody
# reads.
set -uo pipefail

PING_COUNT=2
PING_WAIT=2
METRIC_GOOD=100
SETTLE_SECONDS=3

log() { logger -t net-failover -- "$*" 2> /dev/null || echo "net-failover: $*"; }

#------------------------------------------------------------------------------
# The interface that owns the default route, and what it calls its gateway.
#
# Each interface has its own gateway. A machine with two links on two networks
# has two gateways. One global setting such as GATEWAY=192.168.1.1 protects
# only the machines whose gateway has that address.
#------------------------------------------------------------------------------
route_owner() {
    ip -4 route show default 2> /dev/null \
        | awk '{ for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit } }'
}

gateway_of() {
    [ -n "${1:-}" ] || return 1
    ip -4 route show default dev "$1" 2> /dev/null \
        | awk '{ for (i = 1; i < NF; i++) if ($i == "via") { print $(i + 1); exit } }'
}

is_wireless() { [ -d "/sys/class/net/$1/wireless" ]; }

has_carrier() { [ "$(cat "/sys/class/net/$1/carrier" 2> /dev/null || echo 0)" = 1 ]; }

#------------------------------------------------------------------------------
# Can this interface reach its own gateway, right now?
#
# Carrier first: ping -I on a carrier-less interface is a slow way to learn
# nothing, and wifi has no carrier until it associates. No gateway means not a
# candidate - an interface with no route out cannot be given the route out.
#------------------------------------------------------------------------------
reaches_upstream() {
    local iface="$1" gw
    [ -n "$iface" ] || return 1
    has_carrier "$iface" || return 1
    gw="$(gateway_of "$iface")" || return 1
    [ -n "$gw" ] || return 1
    ping -c "$PING_COUNT" -W "$PING_WAIT" -I "$iface" "$gw" > /dev/null 2>&1
}

#------------------------------------------------------------------------------
# Candidates, wired before wireless.
#
# This is the whole of the priority rule, and it needs no configuration:
# /sys/class/net/<iface>/wireless exists only on a wireless device. Wired is
# preferred because it is the one that does not share a channel with the
# neighbours. Within a class the order is whatever /sys lists, which is stable
# enough for a tie nobody can observe.
#------------------------------------------------------------------------------
candidates() {
    local wired="" wireless="" dev
    for path in /sys/class/net/*; do
        dev="$(basename "$path")"
        # A real NIC has a device symlink. Loopback, bridges, veths and docker0
        # do not, so this needs no list of name prefixes to keep up to date -
        # promoting a veth would be a new outage rather than a fix.
        [ -e "$path/device" ] || continue
        if is_wireless "$dev"; then
            wireless="$wireless$dev"$'\n'
        else
            wired="$wired$dev"$'\n'
        fi
    done
    printf '%s%s' "$wired" "$wireless"
}

#------------------------------------------------------------------------------
# Healthy? Then stop. This is the common case and it is silent.
#------------------------------------------------------------------------------
ACTIVE="$(route_owner)"

if [ -n "$ACTIVE" ] && reaches_upstream "$ACTIVE"; then
    exit 0
fi

log "default route via '${ACTIVE:-none}' cannot reach its gateway - looking for a link that can"

NEW_DEV=""
while read -r dev; do
    [ -n "${dev:-}" ] || continue
    [ "$dev" = "$ACTIVE" ] && continue
    if reaches_upstream "$dev"; then
        NEW_DEV="$dev"
        break
    fi
    log "  $dev cannot reach its gateway either"
done <<< "$(candidates)"

#------------------------------------------------------------------------------
# Nothing to promote. Say so and change nothing.
#
# Exit 0. Every link being down is a fact about the network. It is not a fault
# in this unit, and a failed unit on a timer is noise that outlives the outage.
# The log line is the report.
#------------------------------------------------------------------------------
if [ -z "$NEW_DEV" ]; then
    log "no link reaches a gateway - leaving routing alone"
    exit 0
fi

#------------------------------------------------------------------------------
# Promote the verified link. Nothing is demoted.
#------------------------------------------------------------------------------
NEW_GW="$(gateway_of "$NEW_DEV")"
log "promoting $NEW_DEV via $NEW_GW"

# A lower metric wins, so adding one route is the whole promotion. The losing
# routes are left alone: deleting dhcpcd's routes would have it put them back on
# its next renewal, and a fight with the DHCP client is not a fix.
#
# This route does NOT survive a reboot, by design. dhcpcd rebuilds its own
# metrics at boot, and the timer runs again a minute later. So the machine
# decides again with fresh evidence. It does not inherit a choice made during
# an outage that may be over.
if ! ip -4 route replace default via "$NEW_GW" dev "$NEW_DEV" metric "$METRIC_GOOD"; then
    log "ERROR: could not add a default route via $NEW_DEV - routing is unchanged"
    exit 1
fi

sleep "$SETTLE_SECONDS"

FINAL="$(route_owner)"
if reaches_upstream "${FINAL:-}"; then
    log "recovered: default route now via $FINAL"
    # cloudflared retries by itself but backs off hard, and can sit idle for
    # minutes after the network returns. try-restart is a no-op when the unit is
    # not running, so this is safe on a machine that serves no tunnel.
    systemctl try-restart custom-cloudflared.service 2> /dev/null || true
    exit 0
fi

log "ERROR: promoted $NEW_DEV but the default route is via '${FINAL:-none}' and still cannot reach a gateway"
exit 1
