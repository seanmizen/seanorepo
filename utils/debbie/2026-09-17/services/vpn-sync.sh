#!/bin/bash
# vpn-sync.sh: keeps the VPN's address, forwarding rules and DNS record in line
# with the live network.
#
# Where: the VPN host (ROLE_VPN=yes), as root. custom-vpn-sync.timer runs it.
#        setup-server-environment.sh installs it in /usr/local/lib/seanorepo,
#        and runs `vpn-sync.sh down` when the host loses the role.
# When:  every 2 minutes. `down` runs once, when the role goes off.
# Why:   REQ-NETWORK-006 and REQ-NETWORK-007. Four things depend on the live
#        network, and no event announces a change to any of them:
#          1. The uplink that holds the IPv4 default route. net-failover.sh
#             moves that route (REQ-NETWORK-003).
#          2. The delegated IPv6 prefix. The ISP can change it.
#          3. The LAN subnet. Tunnel traffic is masqueraded onto it.
#          4. The AAAA record of vpn.seanmizen.com. It must hold the address
#             of item 1 and item 2.
#        Each run reads all four and changes only what is different.
#
# Logs go to stdout, so the journal holds them. A run that changes nothing
# logs nothing. A condition that lasts (no IPv6, no token) logs once, when it
# starts. The script sends no notification.
#
# Usage: vpn-sync.sh          make the host match the network
#        vpn-sync.sh down     remove the ::51 address, its route and the rules
set -uo pipefail

# The tunnel subnet and interface. setup-server-environment.sh writes the same
# values into /etc/wireguard/wg0.conf.
TUNNEL_NET=10.99.0.0/24
WG_IF=wg0
# The interface identifier of the fixed address. Clients reach
# <delegated /64>::51.
SUFFIX_GROUPS="0:0:0:51"
# A routing table for packets from the ::51 address only. The number is free:
# nothing else on the host uses table 51.
ROUTE_TABLE=51
RULE_PRIORITY=5151
# Every firewall rule that this script adds carries this comment, so the
# script can find and remove its own rules and no others.
TAG=seanorepo-vpn
# The record and its zone. The zone ID is not a secret: it is in
# infra/cloudflare/imports.tf too.
DNS_NAME=vpn.seanmizen.com
ZONE_ID=428a9a9f5e22c95bc7e67faa7d5ab942
API=https://api.cloudflare.com/client/v4
# A Cloudflare API token with DNS:Edit on the seanmizen.com zone and nothing
# else. root:root, mode 600. It is never the OpenTofu token. See the README.
TOKEN_FILE=/etc/seanorepo/vpn-ddns.token
# One file for each lasting condition, so the condition logs once.
NOTE_DIR=/run/seanorepo-vpn-sync

log() { echo "vpn-sync: $*"; }

# note KEY MESSAGE: log MESSAGE only when it differs from the last note for
# KEY. clear_note KEY: the condition ended.
note() {
    local key="$1"
    shift
    mkdir -p "$NOTE_DIR"
    if [ "$(cat "$NOTE_DIR/$key" 2> /dev/null)" != "$*" ]; then
        log "$*"
        printf '%s\n' "$*" > "$NOTE_DIR/$key"
    fi
}
clear_note() { rm -f "$NOTE_DIR/$1"; }

#------------------------------------------------------------------------------
# IPv6 text to a fixed form: 8 groups, lowercase, no leading zeros.
#
# The kernel and Cloudflare can write one address in two ways (2001:db8:0:0::51
# and 2001:db8::51). Two addresses are equal when this form is equal.
#------------------------------------------------------------------------------
expand6() {
    local a="${1%%/*}" head tail g out="" n i
    local -a h=() t=() all=()
    case "$a" in
        *::*) head="${a%%::*}" tail="${a#*::}" ;;
        *) head="$a" tail="" ;;
    esac
    IFS=: read -ra h <<< "$head"
    IFS=: read -ra t <<< "$tail"
    n=$((8 - ${#h[@]} - ${#t[@]}))
    all=("${h[@]}")
    for ((i = 0; i < n; i++)); do all+=(0); done
    all+=("${t[@]}")
    for g in "${all[@]}"; do out="$out:$(printf '%x' "$((16#${g:-0}))")"; done
    printf '%s\n' "${out#:}"
}

#------------------------------------------------------------------------------
# Read the network.
#------------------------------------------------------------------------------

# The interface that the IPv4 default route uses now. net-failover.sh keeps
# that route on an uplink that reaches its gateway, so the ::51 address goes
# where it goes. `route get` asks the kernel for its real choice. The address
# is from the documentation range and gets no packet.
uplink() {
    ip -4 -o route get 192.0.2.1 2> /dev/null \
        | awk '{ for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit } }'
}

# The LAN subnet on that uplink, from the kernel's own route for it.
lan_subnet() {
    ip -4 -o route show dev "$1" proto kernel scope link 2> /dev/null | awk '{ print $1; exit }'
}

# One SLAAC address on the uplink, for its /64 prefix. `dynamic` excludes the
# ::51 address, which this script adds as permanent.
slaac_address() {
    ip -6 -o addr show dev "$1" scope global dynamic -deprecated -tentative 2> /dev/null \
        | awk '$4 ~ /\/64$/ { print $4; exit }'
}

# Every ::51 address on the host, one "<dev> <addr>/128" line each.
fixed_addresses() {
    ip -6 -o addr show scope global 2> /dev/null \
        | awk '$4 ~ /::51\/128$/ { print $2, $4 }'
}

# The IPv6 gateway of an interface (on asus, fe80::1).
gateway6() {
    ip -6 route show default dev "$1" 2> /dev/null \
        | awk '{ for (i = 1; i < NF; i++) if ($i == "via") { print $(i + 1); exit } }'
}

#------------------------------------------------------------------------------
# Firewall rules - REQ-NETWORK-006.
#
# The masquerade rule matches the source (the tunnel) and the destination (the
# LAN subnet). It names no output interface, so it works on whichever uplink
# is live. Docker sets the FORWARD policy to DROP, so DOCKER-USER accepts the
# tunnel's traffic to the LAN, and the replies.
#------------------------------------------------------------------------------
remove_rules() {
    local table chain line
    for spec in "filter DOCKER-USER" "nat POSTROUTING"; do
        table="${spec%% *}"
        chain="${spec#* }"
        iptables -t "$table" -S "$chain" 2> /dev/null | grep -- "--comment $TAG" | sed 's/^-A /-D /' \
            | while read -r line; do
                # shellcheck disable=SC2086 # the rule is a list of words
                iptables -t "$table" $line
            done
    done
}

sync_rules() {
    local lan="$1" spec table chain missing=0 failed=0
    local -a args
    local -a rules=(
        "filter DOCKER-USER -i $WG_IF -s $TUNNEL_NET -d $lan -j ACCEPT"
        "filter DOCKER-USER -o $WG_IF -d $TUNNEL_NET -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT"
        "nat POSTROUTING -s $TUNNEL_NET -d $lan -j MASQUERADE"
    )
    for spec in "${rules[@]}"; do
        read -ra args <<< "$spec"
        iptables -t "${args[0]}" -C "${args[1]}" "${args[@]:2}" -m comment --comment "$TAG" 2> /dev/null \
            || missing=1
    done
    [ "$missing" = 1 ] || return 0

    # A rule is missing (after a boot), or the LAN subnet changed. Remove every
    # rule of ours, then add the full set, so no rule for an old subnet stays.
    remove_rules
    # Docker creates DOCKER-USER when it starts. Before that, the chain is
    # created here, and Docker uses it as it is.
    iptables -t filter -N DOCKER-USER 2> /dev/null || true
    for spec in "${rules[@]}"; do
        read -ra args <<< "$spec"
        table="${args[0]}"
        chain="${args[1]}"
        iptables -t "$table" -I "$chain" 1 "${args[@]:2}" -m comment --comment "$TAG" || failed=1
    done
    if [ "$failed" = 1 ]; then
        log "ERROR: could not add the forwarding rules for $TUNNEL_NET to $lan"
        return 1
    fi
    log "forwarding $TUNNEL_NET to the LAN $lan"
}

#------------------------------------------------------------------------------
# The fixed address - REQ-NETWORK-006.
#
# Both uplinks get SLAAC addresses on the same /64. So the ::51 address must be
# on ONE interface: on two, duplicate address detection fails on the second.
# It goes on the uplink that holds the IPv4 default route. The old address is
# removed BEFORE the new one is added, so the two never exist at once.
#
# `ip addr` adds an address to a running interface. Nothing restarts.
#------------------------------------------------------------------------------
remove_address() { ip -6 addr del "$2" dev "$1" 2> /dev/null && log "removed $2 from $1"; }

sync_address() {
    local up="$1" want="$2" dev addr present=0
    while read -r dev addr; do
        [ -n "${dev:-}" ] || continue
        if [ "$dev" = "$up" ] && [ "$(expand6 "$addr")" = "$(expand6 "$want")" ]; then
            present=1
        else
            remove_address "$dev" "$addr"
        fi
    done <<< "$(fixed_addresses)"
    [ "$present" = 1 ] && return 0
    if ! ip -6 addr add "$want/128" dev "$up"; then
        log "ERROR: could not add $want to $up"
        return 1
    fi
    log "added $want to $up"
}

# Replies from ::51 leave by the uplink that holds the address. Without this
# table, they follow the main IPv6 default route. After a failover, that
# route can still point at the dead uplink, because net-failover.sh moves the
# IPv4 route only.
sync_route() {
    local up="$1" addr="$2" gw
    gw="$(gateway6 "$up")"
    if [ -z "$gw" ]; then
        note route "no IPv6 default route on $up - replies from $addr use the main table"
        return 0
    fi
    clear_note route
    ip -6 route replace default via "$gw" dev "$up" table "$ROUTE_TABLE"
    if ! ip -6 rule show | grep -q "from $addr lookup $ROUTE_TABLE"; then
        while ip -6 rule del lookup "$ROUTE_TABLE" 2> /dev/null; do :; done
        ip -6 rule add from "$addr" lookup "$ROUTE_TABLE" priority "$RULE_PRIORITY"
    fi
}

remove_route() {
    while ip -6 rule del lookup "$ROUTE_TABLE" 2> /dev/null; do :; done
    ip -6 route flush table "$ROUTE_TABLE" 2> /dev/null || true
}

#------------------------------------------------------------------------------
# The DNS record - REQ-NETWORK-007.
#
# One GET reads the record. When its content differs from the address on the
# interface, one PATCH writes the address. The token goes to curl on stdin
# (`--config -`), never in argv, so `ps` cannot show it.
#------------------------------------------------------------------------------
cf_api() {
    local token
    token="$(cat "$TOKEN_FILE")"
    printf 'header = "Authorization: Bearer %s"\n' "$token" \
        | curl -fsS -m 15 --config - "$@"
}

sync_dns() {
    local addr="$1" resp id content
    if [ ! -s "$TOKEN_FILE" ]; then
        note token "no token at $TOKEN_FILE - $DNS_NAME is not updated. See the README."
        return 0
    fi
    clear_note token

    if ! resp="$(cf_api "$API/zones/$ZONE_ID/dns_records?type=AAAA&name=$DNS_NAME")"; then
        log "ERROR: could not read the AAAA record of $DNS_NAME from Cloudflare"
        return 1
    fi
    id="$(jq -r '.result[0].id // empty' <<< "$resp")"
    content="$(jq -r '.result[0].content // empty' <<< "$resp")"
    if [ -z "$id" ]; then
        log "ERROR: $DNS_NAME has no AAAA record. infra/cloudflare declares it. Apply that stack first."
        return 1
    fi
    [ "$(expand6 "$content")" = "$(expand6 "$addr")" ] && return 0

    if ! cf_api -X PATCH -H "Content-Type: application/json" \
        --data "{\"content\":\"$addr\"}" "$API/zones/$ZONE_ID/dns_records/$id" > /dev/null; then
        log "ERROR: could not update $DNS_NAME from $content to $addr"
        return 1
    fi
    log "$DNS_NAME AAAA: $content -> $addr"
}

#------------------------------------------------------------------------------
# down: the host lost the role. Remove what the sync added.
#------------------------------------------------------------------------------
if [ "${1:-}" = down ]; then
    while read -r dev addr; do
        [ -n "${dev:-}" ] && remove_address "$dev" "$addr"
    done <<< "$(fixed_addresses)"
    remove_route
    remove_rules
    rm -rf "$NOTE_DIR"
    exit 0
fi
[ -z "${1:-}" ] || { echo "usage: $(basename "$0") [down]" >&2; exit 2; }

#------------------------------------------------------------------------------
# sync
#------------------------------------------------------------------------------
rc=0

UP="$(uplink)"
if [ -z "$UP" ]; then
    # Every link is down. That is a fact about the network, not a fault here.
    note uplink "no IPv4 default route - nothing to do until the network returns"
    exit 0
fi
clear_note uplink

LAN="$(lan_subnet "$UP")"
if [ -n "$LAN" ]; then
    clear_note lan
    sync_rules "$LAN" || rc=1
else
    note lan "no LAN subnet on $UP - the forwarding rules are unchanged"
fi

SLAAC="$(slaac_address "$UP")"
if [ -z "$SLAAC" ]; then
    # The address stays where it is. Clients cannot reach this host over IPv4
    # anyway (CGNAT), so there is nothing better to do.
    note ipv6 "no global IPv6 /64 on $UP - the VPN is not reachable"
    exit "$rc"
fi
clear_note ipv6

FULL="$(expand6 "$SLAAC")"
WANT="$(printf '%s' "$FULL" | cut -d: -f1-4):$SUFFIX_GROUPS"
sync_address "$UP" "$WANT" || exit 1

# The address as the kernel writes it. The record gets this text.
ADDR="$(fixed_addresses | awk -v d="$UP" '$1 == d { sub("/128$", "", $2); print $2; exit }')"
if [ -z "$ADDR" ]; then
    log "ERROR: $WANT is not on $UP after the add"
    exit 1
fi

sync_route "$UP" "$ADDR" || rc=1
sync_dns "$ADDR" || rc=1
exit "$rc"
