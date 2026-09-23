#!/bin/bash
# deploy.sh: starts the sites from this target machine's checkout, after the
# release poller moves it.
#
# Where: on a target machine with the webserver role (REQ-SERVER-014), as the
#        deploy user, from the checkout.
# When:  after every release poll (REQ-DEPLOY-002). It deploys only when the
#        checkout or the boot id changed since the last deploy. To deploy
#        anyway, run `deploy.sh --force` over SSH.
# Why:   nothing can connect to a target machine from outside
#        (REQ-SERVER-002), so each one pulls its own deploys. The delay is at
#        most two minutes.
#
# Output goes to the journal:
#   journalctl -u custom-deploy.service -u custom-release-poll.service -f
#   journalctl -u custom-deploy.service -p info     decisions only
#
# Each line starts with <6>, <7> or <3> when stdout is not a terminal. systemd
# reads that as the syslog priority, so `-p info` hides the "up to date"
# lines. On a terminal the script omits the prefixes.

set -euo pipefail
IFS=$'\n\t'

# Resolves to /home/srv/projects/seanorepo. setup-server-environment.sh clones
# there, and payload/assert.sh looks there. The override is named REPO_DIR to
# agree with setup-server-environment.sh and payload/assert.sh.
#
# The archived generation archive/2025-10-08b names this override REPO_PATH.
# This generation uses REPO_DIR in every file.
REPO_DIR="${REPO_DIR:-$HOME/projects/seanorepo}"

# State lives under the deploy user's own directory rather than /tmp. A
# predictable /tmp path is a file any other account can create first, and the
# deploy would then either fail to open it or take a lock nobody else respects.
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/seanorepo"
LOCK_FILE="${DEPLOY_LOCK_FILE:-$STATE_DIR/deploy.lock}"
MARKER="${DEPLOY_MARKER:-$STATE_DIR/last-deployed}"

# The tunnel unit (REQ-NETWORK-001). The name has the `custom-` prefix
# (REQ-SERVER-013). A file named `cloudflared.service` in
# /usr/local/lib/systemd/system would silently displace the unit that
# Cloudflare's apt package ships (REQ-SERVER-012).
#
# setup-server-environment.sh sets the same name for the unit file and for the
# sudoers drop-in. payload/assert.sh asserts that the unit on disk, this name
# and the name sudo permits all agree. A change to the name must change both
# scripts, or the assertion fails.
CLOUDFLARED_UNIT="custom-cloudflared.service"
TCP_GETTER_UNIT="custom-tcp-getter.service"
CLOUDFLARED_CONFIG="apps/cloudflared/config.yml"

# Absolute, and matching the sudoers drop-in character for character. sudo
# matches the command as written, so a PATH-resolved `systemctl` is a grant
# that works until the day PATH differs.
SYSTEMCTL=/usr/bin/systemctl
# Role flags that setup-server-environment.sh writes (REQ-SERVER-014). The
# override is for the tests only.
ROLES_DIR="${ROLES_DIR:-/etc/seanorepo/roles}"

#------------------------------------------------------------------------------
# Logging
#------------------------------------------------------------------------------
if [ -t 1 ]; then
    P_INFO='' P_DEBUG='' P_ERR=''
else
    P_INFO='<6>' P_DEBUG='<7>' P_ERR='<3>'
fi

log()   { echo "${P_INFO}[deploy] $*"; }
debug() { echo "${P_DEBUG}[deploy] $*"; }
err()   { echo "${P_ERR}[deploy] ERROR: $*" >&2; }

FORCE=false
for arg in "$@"; do
    case "$arg" in
        --force) FORCE=true ;;
        *) err "unknown argument '$arg' (only --force is accepted)"; exit 2 ;;
    esac
done

#------------------------------------------------------------------------------
# The lock - REQ-DEPLOY-003
#
# The timer fires every two minutes and a deploy that rebuilds images takes
# considerably longer, so without this a slow deploy is joined by a second one
# running `git checkout -f` underneath it, and the tree ends up matching no
# commit at all.
#
# The lock is flock on a file descriptor. The kernel releases it when the
# process dies, whatever kills it: a failure under `set -e`, a SIGKILL, the
# unit's TimeoutStartSec, a reboot mid-deploy. There is no stale lock to clean
# up, and no cleanup path that can itself be skipped. A PID file has exactly
# that failure mode.
#
# -n makes a second invocation return immediately. It does not queue. A queue
# would be worse than useless here: 720 polls a day that all block on one slow
# deploy would stack up 720 processes that then deploy the same commit in turn.
# The exit status 0 is intentional too. A request to deploy while a deploy runs
# is the timer working correctly. It is not a failure, and a non-zero exit
# would put the unit in `failed` and mean nothing.
#
# --force takes the lock as well. Two deploys racing is exactly as bad when a
# human started one of them.
#------------------------------------------------------------------------------
command -v flock > /dev/null \
    || { err "flock not found (install util-linux) - refusing to deploy unlocked"; exit 1; }

mkdir -p "$STATE_DIR"

# A missing or broken flock must never read as "a deploy is running": that
# would mean the host quietly stops deploying and nothing says why. Only
# status 1 - the documented "could not acquire" - is treated as a held lock.
exec 9> "$LOCK_FILE"
lock_status=0
flock -n 9 || lock_status=$?
if [ "$lock_status" -eq 1 ]; then
    log "another deploy holds $LOCK_FILE - skipping this run"
    exit 0
elif [ "$lock_status" -ne 0 ]; then
    err "flock failed with status $lock_status on $LOCK_FILE"
    exit 1
fi

#------------------------------------------------------------------------------
# Should anything be deployed?
#------------------------------------------------------------------------------
cd "$REPO_DIR" 2> /dev/null \
    || { err "no checkout at $REPO_DIR - setup-developer-environment.sh clones it"; exit 1; }
git rev-parse --git-dir > /dev/null 2>&1 \
    || { err "$REPO_DIR is not a git checkout"; exit 1; }

# What to deploy is whatever the checkout holds. release-poll.sh moves the
# checkout (REQ-DEPLOY-002). This script never fetches or checks out.
# Converging services and tracking `release` are separate jobs. So a machine
# that does not serve still tracks `release`, and a machine that serves never
# deploys a half-written tree (the two scripts share the lock above).
HEAD_SHA="$(git rev-parse HEAD 2> /dev/null || true)"
if [ -z "$HEAD_SHA" ]; then
    debug "the checkout has no commit yet - nothing to deploy"
    exit 0
fi

# The marker is two lines: the SHA deployed, then the boot id it was deployed
# under. Two lines rather than two fields because IFS is $'\n\t' here, so a
# space-separated read would not split.
#
# ABSENT ON THE FIRST RUN. That is a normal state, and no code defends against
# it. Both reads yield the empty string, neither matches, and the deploy
# proceeds. A marker that holds a SHA that is gone, after a force-push or a
# rebuilt `release`, behaves the same way. It does not equal HEAD, so the host
# deploys.
marker_sha="$(sed -n 1p "$MARKER" 2> /dev/null || true)"
marker_boot="$(sed -n 2p "$MARKER" 2> /dev/null || true)"

# The boot id changes on every boot and on nothing else. Recording it alongside
# the SHA is what brings the sites back after a power cut: no app compose file
# sets a restart policy, so after a reboot the containers are down even though
# `release` has not moved, and a SHA comparison alone would never notice. The
# release poller triggers this unit after every run, so the first poll after a
# boot is what finds it.
boot_id="$(cat /proc/sys/kernel/random/boot_id 2> /dev/null || true)"

reason=""
if [ "$FORCE" = true ]; then
    reason="--force"
elif [ "$HEAD_SHA" != "$marker_sha" ]; then
    reason="the checkout moved to ${HEAD_SHA:0:7} (last deployed ${marker_sha:-none})"
elif [ -n "$boot_id" ] && [ "$boot_id" != "$marker_boot" ]; then
    reason="the host has rebooted since ${HEAD_SHA:0:7} was deployed - the containers are not running"
else
    debug "up to date at ${HEAD_SHA:0:7} - nothing to do"
    exit 0
fi

#------------------------------------------------------------------------------
# Deploy
#------------------------------------------------------------------------------
# The tunnel decision below diffs what was last DEPLOYED against what is about
# to be. That is the marker. The checkout's previous HEAD does not work here,
# because the poller may have moved the checkout several times while this
# machine was not serving. The marker is empty on a first deploy, which the
# tunnel decision treats as "cannot prove the config is unchanged".
OLD_SHA="$marker_sha"
NEW_SHA="$HEAD_SHA"

log "deploying: $reason"

# THE DEPLOY PATH HAS NO `git clean` (REQ-DEPLOY-006).
# apps/cloudflared/credentials/ is gitignored and holds the tunnel's
# credentials file, which exists only on this host and is in no repository. A
# `git clean -fdx` added to make trees deterministic would delete it, the
# tunnel would fail to start on its next restart, and every site would go down
# with nothing in the repository's history to explain why. Untracked host data
# under uploads/ goes the same way. Do not add a clean step here or to
# release-poll.sh.

# Where the apps publish (REQ-SERVER-014). The roles decide it. No setting
# does. A webserver that is also the tunnel machine publishes on loopback only.
# The tunnel reaches localhost:4xxx, and nothing on the LAN should
# (REQ-SERVER-002). A webserver WITHOUT the tunnel publishes on the LAN,
# because the only reason to run one is to be reached from the LAN. Every
# compose port reads ${PUBLISH_ADDR:-127.0.0.1} (REQ-SERVER-002).
if [ -e "$ROLES_DIR/tunnel" ]; then
    export PUBLISH_ADDR=127.0.0.1
    log "publishing on loopback (tunnel machine)"
else
    export PUBLISH_ADDR=0.0.0.0
    log "publishing on the LAN (webserver without the tunnel role)"
fi

yarn install --immutable
yarn prod:docker

#------------------------------------------------------------------------------
# tcp-getter - built here, because nothing else builds it.
#
# It is a host unit rather than a container, so `yarn prod:docker` above skips
# it, and the unit runs Node against dist/index.mjs. Node cannot run
# TypeScript, so without this step the unit either runs the previous commit's
# bundle or refuses to start at all.
#
# The build runs here rather than in the unit's ExecStartPre because this is
# the step that knows the code moved. ExecStartPre would rebuild on every
# restart and put a yarn invocation inside systemd's startup path.
#
# NOT FATAL. A tcp-getter that fails to build must not stop a deploy that has
# already brought every site up. The sites are the point. tcp-getter only
# reports an address. The failure goes to the log as an error, and the deploy
# continues.
#------------------------------------------------------------------------------
if yarn workspace tcp-getter build; then
    if ! $SYSTEMCTL cat -- "$TCP_GETTER_UNIT" > /dev/null 2>&1; then
        debug "$TCP_GETTER_UNIT is not installed on this host - nothing to restart"
    elif sudo -n "$SYSTEMCTL" restart "$TCP_GETTER_UNIT"; then
        log "rebuilt tcp-getter and restarted $TCP_GETTER_UNIT"
    else
        err "rebuilt tcp-getter but could not restart $TCP_GETTER_UNIT - it may be serving the previous bundle"
    fi
else
    err "tcp-getter failed to build - the unit keeps the previous bundle, and this machine's ngrok address may go unreported"
fi

# THE SCRIPT WRITES THE MARKER HERE, BEFORE THE END (REQ-DEPLOY-002).
#
# It means "this commit has been deployed", and after `yarn prod:docker` it
# has. The two steps below are follow-ups: re-running the whole deploy would
# not fix either of them, and leaving the marker unwritten until after them
# turns a failed tunnel restart into a full rebuild every two minutes forever.
# Anything that fails before this point IS retried on the next poll, which is
# the property worth keeping.
printf '%s\n%s\n' "$NEW_SHA" "$boot_id" > "$MARKER"
log "deployed ${NEW_SHA:0:7} (was ${OLD_SHA:0:7})"

exit_status=0

#------------------------------------------------------------------------------
# The tunnel - REQ-DEPLOY-005
#
# Restarting it drops every in-flight request and costs a couple of seconds of
# Cloudflare 1033 while the four connections re-register, so doing it on every
# deploy makes each deploy a small outage for no reason. Ingress rules are the
# only thing the tunnel reads out of the repository, so a diff of that one path
# is a sufficient trigger.
#
# After the containers are up, so the tunnel is never pointed at a dead port.
#
# The pathspec does the filtering rather than piping into `grep -qx`. With
# `set -o pipefail`, a `grep -q` that matches early closes the pipe, git takes
# SIGPIPE, and the pipeline reports 141 - so the branch that should have
# restarted the tunnel is the one that gets skipped. Rare, timing-dependent,
# and silent. No pipe, no race.
#------------------------------------------------------------------------------
tunnel_restart=no
if [ -z "$marker_sha" ]; then
    # FIRST DEPLOY THIS HOST HAS RECORDED. The chosen action is a restart.
    # Nothing here knows what configuration the tunnel is running against - it
    # may have been started before this checkout existed, or against a config
    # from a previous provisioning. Not restarting leaves that mismatch in
    # place with no future event that would ever correct it, because from the
    # next deploy onwards the diff is empty. One restart of a tunnel that is
    # serving little or nothing, once per host, is the cheaper mistake.
    tunnel_restart=yes
    tunnel_why="first recorded deploy on this host - the tunnel's configuration cannot be assumed current"
elif [ -z "$OLD_SHA" ]; then
    tunnel_restart=yes
    tunnel_why="no previous HEAD to diff against"
elif ! git cat-file -e "${OLD_SHA}^{commit}" 2> /dev/null; then
    # The previous commit was garbage collected, or `release` was rebuilt out
    # from under it. Fail towards restarting: an unnecessary restart costs
    # seconds, a skipped one serves stale ingress until somebody notices.
    tunnel_restart=yes
    tunnel_why="${OLD_SHA:0:7} is no longer in the object store, so $CLOUDFLARED_CONFIG cannot be diffed"
elif [ "$OLD_SHA" = "$NEW_SHA" ]; then
    tunnel_why="the checkout did not move (${NEW_SHA:0:7})"
elif [ -n "$(git diff --name-only "$OLD_SHA" "$NEW_SHA" -- "$CLOUDFLARED_CONFIG")" ]; then
    tunnel_restart=yes
    tunnel_why="$CLOUDFLARED_CONFIG changed between ${OLD_SHA:0:7} and ${NEW_SHA:0:7}"
else
    tunnel_why="$CLOUDFLARED_CONFIG is unchanged between ${OLD_SHA:0:7} and ${NEW_SHA:0:7}"
fi

if [ "$tunnel_restart" = yes ] && [ ! -e "$ROLES_DIR/tunnel" ]; then
    tunnel_restart=no
    tunnel_why="this machine does not have the tunnel role"
fi
if [ "$tunnel_restart" = no ]; then
    debug "not restarting $CLOUDFLARED_UNIT: $tunnel_why"
elif ! $SYSTEMCTL cat -- "$CLOUDFLARED_UNIT" > /dev/null 2>&1; then
    # A host without the unit has no tunnel to restart. The script logs this
    # and continues. An exit here would leave the marker written, the sites
    # up, and the unit in `failed` on every poll. That is a red light for
    # something that is not this script's job.
    log "$CLOUDFLARED_UNIT is not installed on this host, so there is nothing to restart"
    log "  (setup-server-environment.sh installs it. A restart was wanted because: $tunnel_why)"
else
    log "restarting $CLOUDFLARED_UNIT: $tunnel_why"
    # The one command this account is allowed to run as root, and the whole
    # reason the sudoers drop-in grants a single command rather than general
    # privilege - REQ-DEPLOY-005.
    if ! sudo -n "$SYSTEMCTL" restart "$CLOUDFLARED_UNIT"; then
        # The script reports this failure and continues. The marker above is
        # already written. The new code is live. What failed is the tunnel
        # pickup, and a new deploy would not fix it. So the exit code carries
        # the failure to systemd and the journal, and the host does not enter
        # a rebuild loop.
        err "failed to restart $CLOUDFLARED_UNIT - the new commit is live but the tunnel may be serving stale ingress"
        exit_status=1
    fi
fi

# prod:docker builds every workspace every time, so untagged layers accumulate
# fast on a home server's disk.
docker image prune -f > /dev/null

log "done"
exit "$exit_status"
