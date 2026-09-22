#!/bin/bash
# Deploy the release branch to debbie.
#
# Invoked two ways:
#   deploy.sh            - from deploy-poll-custom.timer; deploys only if origin/release moved
#   deploy.sh --force    - from deployment-custom.service at boot; deploys unconditionally
#
# Boot must force: no app docker-compose.yml sets a restart policy, so after a
# reboot the containers are down even though the SHA has not changed.
#
# Output goes to the journal: journalctl -u deploy-poll-custom.service -f

set -euo pipefail
IFS=$'\n\t'

REPO_DIR="${REPO_PATH:-$HOME/projects/seanorepo}"
RELEASE_BRANCH="${RELEASE_BRANCH:-release}"
REMOTE="origin"
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/seanorepo-deploy.lock}"
MARKER="${XDG_STATE_HOME:-$HOME/.local/state}/seanorepo/last-deployed"
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
mkdir -p "$(dirname "$MARKER")"

# ls-remote is a single ref lookup - cheaper than fetching objects, and it keeps
# the object store from growing on every one of the ~720 daily polls.
REMOTE_SHA="$(git ls-remote "$REMOTE" "refs/heads/$RELEASE_BRANCH" | awk '{print $1}')"
if [ -z "$REMOTE_SHA" ]; then
    log "$REMOTE/$RELEASE_BRANCH does not exist yet - nothing to deploy"
    exit 0
fi

# The marker is written only on success, so a deploy that fails after the
# checkout is retried on the next tick rather than looking done.
if [ "$FORCE" = false ] && [ "$REMOTE_SHA" = "$(cat "$MARKER" 2>/dev/null || true)" ]; then
    exit 0
fi

OLD_SHA="$(git rev-parse HEAD)"
log "deploying ${REMOTE_SHA:0:7} (was ${OLD_SHA:0:7})"

git fetch "$REMOTE" --prune
# checkout -B rather than reset --hard: the server may still be sitting on main.
# Deliberately no `git clean` - apps/cloudflared/credentials/ is gitignored and
# holds the tunnel credentials, and untracked host data lives under uploads/.
git checkout -f -B "$RELEASE_BRANCH" "$REMOTE/$RELEASE_BRANCH"

yarn install --immutable
yarn prod:docker

# Only restart the tunnel when its ingress actually changed: a restart costs a
# couple of seconds of Cloudflare 1033 while the four connections re-register.
# After the containers are up, so the tunnel never points at a dead port.
if git diff --name-only "$OLD_SHA" "$REMOTE_SHA" | grep -qx "$CLOUDFLARED_CONFIG"; then
    log "cloudflared config changed - restarting the tunnel"
    sudo systemctl restart "$CLOUDFLARED_UNIT"
fi

# prod:docker runs --build for every workspace every time, so untagged layers
# accumulate fast on a home server's disk.
docker image prune -f

echo "$REMOTE_SHA" > "$MARKER"
log "deployed ${REMOTE_SHA:0:7} successfully"
