#!/bin/bash
# Deploy the release branch to debbie.
#
# Invoked two ways:
#   deploy.sh            - from deploy-poll-custom.timer; deploys only if origin/release moved
#   deploy.sh --force    - from deployment-custom.service at boot; deploys unconditionally
#
# Boot must force: no app docker-compose.yml sets a restart policy, so after a
# reboot the containers are down even though the SHA has not changed.

set -euo pipefail
IFS=$'\n\t'

REPO_DIR="${REPO_PATH:-$HOME/projects/seanorepo}"
RELEASE_BRANCH="release"
REMOTE="origin"
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/seanorepo-deploy.lock}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/seanorepo"
DEPLOYED_MARKER="$STATE_DIR/last-deployed"
FAILED_MARKER="$STATE_DIR/last-failed"
MAX_ATTEMPTS=3
CLOUDFLARED_UNIT="cloudflared-custom.service"
CLOUDFLARED_CONFIG="apps/cloudflared/config.yml"

FORCE=false
for arg in "$@"; do
    case "$arg" in
        --force) FORCE=true ;;
        *) echo "Unknown argument: $arg" >&2; exit 2 ;;
    esac
done

log() { echo "[deploy] $*"; }

##############################################################################
# Notification (ntfy relay) - silent no-op unless NOTIFY_SECRET is configured
##############################################################################
notify() {
    local message="$1" title="$2" priority="$3" tag="$4"
    local relay="${NOTIFY_RELAY_URL:-}" secret="${NOTIFY_SECRET:-}"

    if [ -z "$secret" ] || [ -z "$relay" ]; then
        return 0
    fi

    local body sig
    body=$(printf '{"message":%s,"title":%s,"priority":%s,"tags":["%s"]}' \
        "$(json_string "$message")" "$(json_string "$title")" "$priority" "$tag")
    sig="sha256=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$secret" | awk '{print $NF}')"

    curl -sS -m 10 -o /dev/null -X POST "$relay/notify" \
        -H "Content-Type: application/json" \
        -H "X-Notify-Signature: $sig" \
        -d "$body" || log "warning: notification failed (deploy itself is unaffected)"
}

# Minimal JSON string encoder - deploy output can contain quotes, backslashes and
# newlines, all of which would otherwise produce an unparseable body. Pure bash
# on purpose: this box is not guaranteed to have python3 or jq installed.
json_string() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '"%s"' "$s"
}

##############################################################################
# Single-flight
##############################################################################
# A missing or broken flock must not look like a held lock - that would mean the
# server quietly stops deploying and nothing ever says why.
command -v flock > /dev/null || { echo "[deploy] FATAL: flock not found (install util-linux)" >&2; exit 1; }

exec 9>"$LOCK_FILE"
flock -n 9 || lock_status=$?
if [ "${lock_status:-0}" -eq 1 ]; then
    log "another deploy holds $LOCK_FILE - skipping this run"
    exit 0
elif [ "${lock_status:-0}" -ne 0 ]; then
    echo "[deploy] FATAL: flock failed with status ${lock_status} on $LOCK_FILE" >&2
    exit 1
fi

cd "$REPO_DIR"
mkdir -p "$STATE_DIR"

##############################################################################
# Has anything changed?
##############################################################################
# ls-remote is a single ref lookup - cheaper than fetching objects, and it keeps
# the object store from growing on every one of the ~720 daily polls.
REMOTE_SHA="$(git ls-remote "$REMOTE" "refs/heads/$RELEASE_BRANCH" | awk '{print $1}')"
if [ -z "$REMOTE_SHA" ]; then
    log "$REMOTE/$RELEASE_BRANCH does not exist yet - nothing to deploy"
    exit 0
fi

DEPLOYED_SHA="$(cat "$DEPLOYED_MARKER" 2>/dev/null || echo "")"

if [ "$FORCE" = false ] && [ "$REMOTE_SHA" = "$DEPLOYED_SHA" ]; then
    exit 0
fi

##############################################################################
# Back off after repeated failures on the same commit
##############################################################################
# Without this a commit that cannot build produces a priority-5 notification
# every two minutes, forever.
FAILED_SHA=""
FAILED_COUNT=0
if [ -f "$FAILED_MARKER" ]; then
    IFS=' ' read -r FAILED_SHA FAILED_COUNT < "$FAILED_MARKER" || true
    FAILED_COUNT="${FAILED_COUNT:-0}"
fi

if [ "$FORCE" = false ] && [ "$FAILED_SHA" = "$REMOTE_SHA" ] && [ "$FAILED_COUNT" -ge "$MAX_ATTEMPTS" ]; then
    log "${REMOTE_SHA:0:7} has failed $FAILED_COUNT times - backing off until a new commit lands"
    exit 0
fi

##############################################################################
# Deploy
##############################################################################
record_failure() {
    local stage="$1" output="$2"
    local count=1
    if [ "$FAILED_SHA" = "$REMOTE_SHA" ]; then
        count=$((FAILED_COUNT + 1))
    fi
    echo "$REMOTE_SHA $count" > "$FAILED_MARKER"

    log "FAILED at $stage (attempt $count/$MAX_ATTEMPTS)"
    notify "$(printf '%s failed at %s (attempt %s/%s)\n\n%s' \
        "${REMOTE_SHA:0:7}" "$stage" "$count" "$MAX_ATTEMPTS" "$(printf '%s' "$output" | tail -n 20)")" \
        "debbie deploy failed" 5 "rotating_light"
    exit 1
}

# Each stage is captured so the tail of a failure reaches the phone, but is also
# echoed so it lands in the journal for the full picture.
run_stage() {
    local stage="$1"; shift
    local output status
    log "$stage"
    set +e
    output="$("$@" 2>&1)"
    status=$?
    set -e
    printf '%s\n' "$output"
    [ $status -eq 0 ] || record_failure "$stage" "$output"
}

OLD_SHA="$(git rev-parse HEAD)"
log "deploying ${REMOTE_SHA:0:7} (was ${OLD_SHA:0:7})"

run_stage "fetch" git fetch "$REMOTE" --prune
# checkout -B rather than reset --hard: the server may still be sitting on main.
# Deliberately no `git clean` - apps/cloudflared/credentials/ is gitignored and
# holds the tunnel credentials, and untracked host data lives under uploads/.
run_stage "checkout" git checkout -f -B "$RELEASE_BRANCH" "$REMOTE/$RELEASE_BRANCH"

CHANGED_FILES="$(git diff --name-only "$OLD_SHA" "$REMOTE_SHA" 2>/dev/null || echo "")"

if ! printf '%s\n' "$CHANGED_FILES" | grep -qx "yarn.lock" && [ -f .yarn/install-state.gz ]; then
    log "install: skipped (yarn.lock unchanged, install state present)"
else
    run_stage "install" yarn install --immutable
fi

run_stage "prod:docker" yarn prod:docker

# Only restart the tunnel when its ingress actually changed: a restart costs a
# couple of seconds of Cloudflare 1033 while the four connections re-register.
# After the containers are up, so the tunnel never points at a dead port.
if printf '%s\n' "$CHANGED_FILES" | grep -qx "$CLOUDFLARED_CONFIG"; then
    run_stage "cloudflared restart" sudo systemctl restart "$CLOUDFLARED_UNIT"
else
    log "cloudflared: unchanged, not restarting"
fi

# prod:docker runs --build for every workspace every time, so untagged layers
# accumulate fast on a home server's disk.
log "pruning dangling images"
docker image prune -f || log "warning: image prune failed"

##############################################################################
# Success
##############################################################################
echo "$REMOTE_SHA" > "$DEPLOYED_MARKER"
rm -f "$FAILED_MARKER"

SUBJECT="$(git log -1 --format=%s "$REMOTE_SHA")"
log "deployed ${REMOTE_SHA:0:7} successfully"
notify "$(printf '%s  %s' "${REMOTE_SHA:0:7}" "$SUBJECT")" "debbie deployed" 2 "white_check_mark"
