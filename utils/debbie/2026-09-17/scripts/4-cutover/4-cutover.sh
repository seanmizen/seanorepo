#!/bin/bash
# 4-cutover.sh: moves the Cloudflare tunnel from one machine to another.
#
# Where: your computer. Both machines must be up and reachable.
# When:  once, when a new machine is ready to serve and the old one should stop.
# Why:   provisioning cannot do this. setup-server-environment.sh stops a
#        tunnel with `disable --now` but starts one with plain `enable`, so
#        ROLE_TUNNEL=yes plus provision.sh serves the tunnel only after the
#        reboot that step triggers. Doing it by hand instead leaves the machine
#        running a tunnel its env file says it should not, and the next
#        provision.sh run stops it - immediately, because that side is --now.
#
#        This script does the swap and writes both env files, so the machines
#        and their configuration agree afterwards.
#
# Usage:
#   ./4-cutover.sh <old-machine> <new-machine>
#
# It reads ../3-provision/<name>.env for each machine. There is no env file of
# its own: the machines are already described there.
#
# Downtime is however long cloudflared takes to connect to Cloudflare, which is
# a couple of seconds.
#
# CAROLINEMIZEN.ART CAN LOSE A WRITE. Requests stop reaching the old machine
# and start reaching the new one. A write that lands on the old machine after
# its database was copied is lost. The window is the seconds between the copy
# and this script, and the site takes admin writes only, so the chance is small
# and the cost is one re-upload. Making that site safe to move belongs to that
# site, not here.
#
# ngrok is not touched. One agent session, an admin path rather than user
# traffic, and tcp-getter reports the new address once it runs on the new
# machine. Start it there by hand.
#
# Exit codes:
#   0   the tunnel now runs on the new machine
#   1   a precondition failed, and nothing was changed
#   2   the swap was attempted and did not finish - read the output
set -euo pipefail
IFS=$'\n\t'

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$(dirname "$HERE")"
GEN_DIR="$(dirname "$SCRIPTS")"
WORK="$GEN_DIR/working"
ENV_DIR="$SCRIPTS/3-provision"
# shellcheck source=../lib.sh
. "$SCRIPTS/lib.sh"

[ $# -eq 2 ] || die "usage: $(basename "$0") <old-machine> <new-machine>"
OLD_NAME="$1"
NEW_NAME="$2"
[ "$OLD_NAME" != "$NEW_NAME" ] || die "the two machines are the same: $OLD_NAME"

#------------------------------------------------------------------------------
# Read both machines out of 3-provision.
#
# read_env only assigns the keys a file actually sets, so a key missing from the
# second file would keep the first file's value. Unset between reads.
#------------------------------------------------------------------------------
load_machine() {
    local which="$1" name="$2"
    unset SERVER_NAME DEPLOY_USER SSH_KEY ROLE_WEBSERVER ROLE_TUNNEL
    select_env "$ENV_DIR" "$name"
    read_env SERVER_NAME DEPLOY_USER SSH_KEY ROLE_WEBSERVER ROLE_TUNNEL
    [ -n "${SERVER_NAME:-}" ] || die "SERVER_NAME is not set in $ENV_FILE"
    printf -v "${which}_ENV" '%s' "$ENV_FILE"
    printf -v "${which}_HOST" '%s' "$SERVER_NAME.local"
    printf -v "${which}_USER" '%s' "${DEPLOY_USER:-srv}"
    printf -v "${which}_KEY" '%s' "${SSH_KEY:-$WORK/id_ed25519}"
    printf -v "${which}_ROLE" '%s' "${ROLE_TUNNEL:-}"
}

load_machine OLD "$OLD_NAME"
load_machine NEW "$NEW_NAME"

# -t so sudo can ask for a password. The old machine is the previous
# generation, where the deploy account's sudo is password-gated, and somebody is
# sitting here running a cutover.
sshto() {
    local host="$1" user="$2" key="$3"
    shift 3
    ssh -t -i "$key" -o BatchMode=no -o ConnectTimeout=10 \
        -o StrictHostKeyChecking=accept-new "$user@$host" "$@"
}
on_old() { sshto "$OLD_HOST" "$OLD_USER" "$OLD_KEY" "$@"; }
on_new() { sshto "$NEW_HOST" "$NEW_USER" "$NEW_KEY" "$@"; }

#------------------------------------------------------------------------------
# Which unit each machine calls its tunnel.
#
# The name changed between generations: cloudflared-custom.service on
# 2025-10-08b, custom-cloudflared.service on this one. Asking the machine is
# shorter than tracking which machine is which generation.
#------------------------------------------------------------------------------
tunnel_unit() {
    local out
    out="$("$1" 'for u in custom-cloudflared.service cloudflared-custom.service cloudflared.service; do
                     if systemctl cat -- "$u" > /dev/null 2>&1; then echo "$u"; exit 0; fi
                 done' 2> /dev/null | tr -d '\r')" || true
    printf '%s' "$out"
}

log "reading both machines"
OLD_UNIT="$(tunnel_unit on_old)"
NEW_UNIT="$(tunnel_unit on_new)"
[ -n "$OLD_UNIT" ] || die "$OLD_HOST has no cloudflared unit - is it the tunnel machine?"
[ -n "$NEW_UNIT" ] || die "$NEW_HOST has no cloudflared unit - provision it first"
log "  $OLD_HOST: $OLD_UNIT"
log "  $NEW_HOST: $NEW_UNIT"

#------------------------------------------------------------------------------
# Preconditions. Each one is a way to end up with no tunnel at all, so they are
# checked before anything is stopped.
#------------------------------------------------------------------------------
CREDS_DIR="/home/$NEW_USER/projects/seanorepo/apps/cloudflared/credentials"
on_new "[ -n \"\$(ls -A '$CREDS_DIR' 2>/dev/null)\" ]" > /dev/null 2>&1 \
    || die "$NEW_HOST has no tunnel credential in $CREDS_DIR.
       The file is host-specific and in no repository. Copy it there at mode
       0600, check the uuid matches 'tunnel:' in apps/cloudflared/config.yml,
       and run this again."

# Same tunnel, or this swaps one tunnel for a different one and every hostname
# moves with it.
OLD_UUID="$(on_old "sed -n 's/^tunnel: *//p' /home/$OLD_USER/projects/seanorepo/apps/cloudflared/config.yml | head -1" 2> /dev/null | tr -d '\r\n' || true)"
NEW_UUID="$(on_new "sed -n 's/^tunnel: *//p' /home/$NEW_USER/projects/seanorepo/apps/cloudflared/config.yml | head -1" 2> /dev/null | tr -d '\r\n' || true)"
if [ -n "$OLD_UUID" ] && [ -n "$NEW_UUID" ] && [ "$OLD_UUID" != "$NEW_UUID" ]; then
    die "the two machines name different tunnels:
       $OLD_HOST: $OLD_UUID
       $NEW_HOST: $NEW_UUID
       Serving a different tunnel moves every hostname. Fix config.yml first."
fi

if on_new "systemctl is-active --quiet '$NEW_UNIT'" > /dev/null 2>&1; then
    die "$NEW_HOST is already serving the tunnel. Two machines on one tunnel is
       what the role exists to prevent, so nothing has been changed. Stop it
       there, or run this the other way round."
fi

#------------------------------------------------------------------------------
# The swap. Old off first: two machines on one tunnel is worse than a gap.
#------------------------------------------------------------------------------
log "stopping the tunnel on $OLD_HOST"
if ! on_old "sudo systemctl disable --now '$OLD_UNIT'"; then
    echo "ERROR: could not stop $OLD_UNIT on $OLD_HOST." >&2
    echo "       Nothing else was changed and the tunnel still runs there." >&2
    exit 2
fi

log "starting the tunnel on $NEW_HOST"
if ! on_new "sudo install -d -m 0755 /etc/seanorepo/roles \
             && sudo touch /etc/seanorepo/roles/tunnel \
             && sudo systemctl enable --now '$NEW_UNIT'"; then
    echo "" >&2
    echo "ERROR: $NEW_UNIT did not start on $NEW_HOST, and the tunnel is now" >&2
    echo "       stopped on $OLD_HOST. Every site is down. Put it back:" >&2
    echo "" >&2
    echo "         ssh -t $OLD_USER@$OLD_HOST sudo systemctl enable --now $OLD_UNIT" >&2
    echo "" >&2
    exit 2
fi

#------------------------------------------------------------------------------
# Make the env files agree with what is now running.
#
# Without this the next provision.sh run on either machine undoes the swap, and
# on the new machine it does so immediately: the role is read from ROLE_TUNNEL,
# and the not-yes branch is `disable --now`.
#
# ROLE_TUNNEL is commented rather than deleted on the old machine. lib.sh
# read_env skips a line that starts with '#', so a comment reads as unset, and
# the key stays visible for whoever looks next.
#------------------------------------------------------------------------------
log "updating $OLD_ENV"
sed -i.bak 's/^ROLE_TUNNEL=/#ROLE_TUNNEL=/' "$OLD_ENV" && rm -f "$OLD_ENV.bak"

log "updating $NEW_ENV"
if grep -qE '^#?ROLE_TUNNEL=' "$NEW_ENV"; then
    sed -i.bak 's/^#\{0,1\}ROLE_TUNNEL=.*/ROLE_TUNNEL=yes/' "$NEW_ENV" && rm -f "$NEW_ENV.bak"
else
    printf 'ROLE_TUNNEL=yes\n' >> "$NEW_ENV"
fi

#------------------------------------------------------------------------------
log "================================================================"
log "the tunnel now runs on $NEW_HOST ($NEW_UNIT)"
log ""
log "Check a hostname before you walk away, for example:"
log "  curl -sS -o /dev/null -w '%{http_code}\\n' https://seanmizen.com"
log ""
log "ngrok was not touched. Start it on $NEW_HOST to get remote SSH back:"
log "  ssh $NEW_USER@$NEW_HOST 'ngrok config add-authtoken <token>'"
log "  ssh -t $NEW_USER@$NEW_HOST 'sudo systemctl enable --now custom-ngrok.service'"
log "The address and the host key both change, so the command tcp-getter emails"
log "you will differ from the one you have."
log ""
log "To reverse this cutover:"
log "  ./4-cutover.sh $NEW_NAME $OLD_NAME"
log "================================================================"
