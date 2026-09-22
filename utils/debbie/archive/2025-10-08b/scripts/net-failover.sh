#!/bin/bash
# net-failover.sh - keep debbie's default route on an interface that works.
#
# NetworkManager reacts to carrier loss, not to reachability. A NIC with link
# but no upstream - a dead switch port, a cable unplugged at the far end, a
# sulking USB adapter - keeps its static address and its default route
# indefinitely, blackholing every outbound packet. On 2026-08-14 that took
# seanmizen.com down with Cloudflare Error 1033: cloudflared was running
# happily, shouting into a disconnected wire.
#
# Static metrics cannot fix this on their own. Whichever interface is preferred
# is preferred on faith, so the failure just waits for that one to die.
#
# This probes the gateway THROUGH the interface that currently owns the default
# route. If that works it exits without touching anything - a healthy link is
# never bounced. Only when the active path is genuinely dead does it look for a
# verified-healthy interface, promote it, and demote the rest.
#
# Idempotent, safe to run on a timer. Decisions are logged to the journal under
# the 'net-failover' tag.

set -uo pipefail

GW="${GATEWAY:-192.168.1.1}"
METRIC_GOOD="${NET_FAILOVER_METRIC_GOOD:-100}"
METRIC_BAD="${NET_FAILOVER_METRIC_BAD:-600}"
PING_COUNT="${NET_FAILOVER_PING_COUNT:-3}"
PING_WAIT="${NET_FAILOVER_PING_WAIT:-2}"
SETTLE_SECONDS="${NET_FAILOVER_SETTLE_SECONDS:-3}"

log() {
    logger -t net-failover -- "$*" 2>/dev/null || true
    echo "net-failover: $*"
}

# Can this interface actually reach the gateway right now? Carrier first,
# because ping -I on a carrier-less interface is a slow way to learn nothing.
reaches_gateway() {
    iface="$1"
    [ -n "$iface" ] || return 1
    [ "$(cat "/sys/class/net/$iface/carrier" 2>/dev/null || echo 0)" = "1" ] || return 1
    ping -c "$PING_COUNT" -W "$PING_WAIT" -I "$iface" "$GW" > /dev/null 2>&1
}

# Active NetworkManager connections as "NAME<TAB>DEVICE", skipping loopback and
# anything Docker or virtualisation owns.
physical_connections() {
    nmcli -t -f NAME,DEVICE connection show --active 2>/dev/null \
        | while IFS=: read -r con dev; do
            [ -n "$con" ] && [ -n "$dev" ] || continue
            case "$dev" in
                lo | docker* | br-* | veth* | virbr* | tun* | tap*) continue ;;
            esac
            printf '%s\t%s\n' "$con" "$dev"
        done
}

current_default_iface() {
    ip route show default 2>/dev/null \
        | awk '{ for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit } }'
}

ACTIVE_IFACE="$(current_default_iface)"

if [ -n "$ACTIVE_IFACE" ] && reaches_gateway "$ACTIVE_IFACE"; then
    # Healthy. Do nothing at all - re-applying a connection would bounce a
    # working link for no reason.
    exit 0
fi

log "default route via '${ACTIVE_IFACE:-none}' cannot reach $GW - searching for a healthy interface"

REPLACEMENT_CON=""
REPLACEMENT_DEV=""
while IFS="$(printf '\t')" read -r con dev; do
    [ -n "${dev:-}" ] || continue
    [ "$dev" = "$ACTIVE_IFACE" ] && continue
    if reaches_gateway "$dev"; then
        REPLACEMENT_CON="$con"
        REPLACEMENT_DEV="$dev"
        break
    fi
    log "candidate '$con' ($dev) also cannot reach $GW"
done <<EOF
$(physical_connections)
EOF

if [ -z "$REPLACEMENT_CON" ]; then
    log "no healthy interface available - leaving routing untouched"
    exit 1
fi

log "promoting '$REPLACEMENT_CON' ($REPLACEMENT_DEV) to metric $METRIC_GOOD"
nmcli connection modify "$REPLACEMENT_CON" ipv4.route-metric "$METRIC_GOOD" || {
    log "ERROR: could not set metric on '$REPLACEMENT_CON'"
    exit 1
}

# Demote everything else so the verified-healthy interface wins the default
# route. These metrics are stored in the connection profile, so the decision
# survives a reboot.
while IFS="$(printf '\t')" read -r con dev; do
    [ -n "${con:-}" ] || continue
    [ "$con" = "$REPLACEMENT_CON" ] && continue
    log "demoting '$con' ($dev) to metric $METRIC_BAD"
    nmcli connection modify "$con" ipv4.route-metric "$METRIC_BAD" || true
done <<EOF
$(physical_connections)
EOF

nmcli connection up "$REPLACEMENT_CON" > /dev/null 2>&1 || true
sleep "$SETTLE_SECONDS"

NEW_IFACE="$(current_default_iface)"
if reaches_gateway "${NEW_IFACE:-}"; then
    log "recovered: default route now via $NEW_IFACE"
    # cloudflared retries on its own, but it backs off hard and can sit idle
    # for minutes after the network returns. try-restart is a no-op when the
    # unit is not already running.
    systemctl try-restart cloudflared-custom.service 2>/dev/null || true
    exit 0
fi

log "WARNING: failover applied but $GW still unreachable via '${NEW_IFACE:-none}'"
exit 1
