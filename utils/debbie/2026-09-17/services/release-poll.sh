#!/usr/bin/env bash
# release-poll.sh: checks whether origin/release moved, and if it did, checks
# out the new commit on this target machine.
#
# Where: on every target machine, whatever its roles, as the deploy user.
# When:  every two minutes, from custom-release-poll.timer.
# Why:   a target machine must follow `release` with no inbound connection
#        (REQ-DEPLOY-001, REQ-DEPLOY-002). It changes only the checkout: no
#        containers, no units, no yarn. So a standby target is always at the
#        right commit.
#
# After each successful run, systemd starts custom-deploy.service (OnSuccess=).
# That is the only trigger for a deploy, so a deploy never starts during a
# checkout. deploy.sh then decides whether there is anything to do.
set -euo pipefail
IFS=$'\n\t'

REPO_DIR="${REPO_DIR:-$HOME/projects/seanorepo}"
RELEASE_BRANCH="${RELEASE_BRANCH:-release}"
REMOTE="origin"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/seanorepo"
# The SAME lock as deploy.sh (REQ-DEPLOY-003). A checkout must never move under
# a running deploy, so while one holds it this run does nothing and the next
# tick tries again.
LOCK_FILE="${DEPLOY_LOCK_FILE:-$STATE_DIR/deploy.lock}"

# journald reads a <N> prefix as the priority, so `-p info` shows decisions
# and hides the "up to date" line that would otherwise appear 720 times a day.
if [ -t 1 ]; then
    P_INFO='' P_DEBUG='' P_ERR=''
else
    P_INFO='<6>' P_DEBUG='<7>' P_ERR='<3>'
fi
log()   { echo "${P_INFO}[release-poll] $*"; }
debug() { echo "${P_DEBUG}[release-poll] $*"; }
err()   { echo "${P_ERR}[release-poll] ERROR: $*" >&2; }

command -v flock > /dev/null \
    || { err "flock not found (install util-linux) - refusing to touch the checkout unlocked"; exit 1; }
mkdir -p "$STATE_DIR"
exec 9> "$LOCK_FILE"
lock_status=0
flock -n 9 || lock_status=$?
if [ "$lock_status" -eq 1 ]; then
    log "a deploy holds $LOCK_FILE - leaving the checkout alone this run"
    exit 0
elif [ "$lock_status" -ne 0 ]; then
    err "flock failed with status $lock_status on $LOCK_FILE"
    exit 1
fi

cd "$REPO_DIR" 2> /dev/null \
    || { err "no checkout at $REPO_DIR - postinstall.sh clones it"; exit 1; }
git rev-parse --git-dir > /dev/null 2>&1 \
    || { err "$REPO_DIR is not a git checkout"; exit 1; }

REMOTE_SHA="$(git ls-remote "$REMOTE" "refs/heads/$RELEASE_BRANCH" | awk '{print $1}')"
if [ -z "$REMOTE_SHA" ]; then
    # Normal until someone runs `yarn release` for the first time.
    debug "$REMOTE/$RELEASE_BRANCH does not exist yet - nothing to track"
    exit 0
fi

HEAD_SHA="$(git rev-parse HEAD 2> /dev/null || true)"
if [ "$HEAD_SHA" = "$REMOTE_SHA" ]; then
    debug "up to date at ${REMOTE_SHA:0:7}"
    exit 0
fi

log "$REMOTE/$RELEASE_BRANCH moved to ${REMOTE_SHA:0:7} (checkout at ${HEAD_SHA:0:7}) - checking out"
git fetch "$REMOTE" --prune
# -f discards tracked local edits, which on this box are always accidents.
# Untracked files are left alone - REQ-DEPLOY-006: no `git clean`, because
# apps/cloudflared/credentials/ is gitignored and exists only on this host.
git checkout -f -B "$RELEASE_BRANCH" "$REMOTE/$RELEASE_BRANCH"
log "checkout now at $(git rev-parse --short HEAD)"
