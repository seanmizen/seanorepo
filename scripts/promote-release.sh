#!/bin/bash
# Promote main to the release branch, which is what debbie deploys.
#
# debbie polls origin/release every couple of minutes and redeploys when the SHA
# moves. Merging to main changes nothing in production until this script runs.
#
# Usage:
#   yarn release          # show what would ship, then confirm
#   yarn release --yes    # skip the confirmation

set -euo pipefail

RELEASE_BRANCH="release"
SOURCE_BRANCH="main"
REMOTE="origin"
ASSUME_YES=false

for arg in "$@"; do
    case "$arg" in
        -y|--yes) ASSUME_YES=true ;;
        -h|--help) sed -n '2,10p' "$0" | sed 's/^# \?//'; exit 0 ;;
        *) echo "Unknown argument: $arg" >&2; exit 2 ;;
    esac
done

die() { echo "error: $*" >&2; exit 1; }

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$CURRENT_BRANCH" = "$SOURCE_BRANCH" ] || \
    die "on '$CURRENT_BRANCH', not '$SOURCE_BRANCH'. Promote from $SOURCE_BRANCH only."

git diff --quiet && git diff --cached --quiet || \
    die "working tree is dirty. Commit or stash before promoting."

echo "Fetching $REMOTE..."
git fetch --quiet "$REMOTE"

LOCAL_SHA="$(git rev-parse "$SOURCE_BRANCH")"
REMOTE_SHA="$(git rev-parse "$REMOTE/$SOURCE_BRANCH")"
[ "$LOCAL_SHA" = "$REMOTE_SHA" ] || \
    die "local $SOURCE_BRANCH ($(git rev-parse --short "$LOCAL_SHA")) differs from $REMOTE/$SOURCE_BRANCH ($(git rev-parse --short "$REMOTE_SHA")). Pull or push first."

if git rev-parse --verify --quiet "$REMOTE/$RELEASE_BRANCH" > /dev/null; then
    # Catch divergence here rather than letting git reject the push with a raw
    # "non-fast-forward" hint. It means someone committed straight to release,
    # and the fix is to merge that back into main - not to overwrite it.
    BEHIND="$(git rev-list --count "$SOURCE_BRANCH..$REMOTE/$RELEASE_BRANCH")"
    if [ "$BEHIND" -gt 0 ]; then
        echo "" >&2
        echo "$REMOTE/$RELEASE_BRANCH has $BEHIND commit(s) that $SOURCE_BRANCH does not:" >&2
        git log --oneline --no-decorate "$SOURCE_BRANCH..$REMOTE/$RELEASE_BRANCH" | sed 's/^/  /' >&2
        echo "" >&2
        die "release has diverged. Merge those commits into $SOURCE_BRANCH first - promoting would discard what is live."
    fi

    RANGE="$REMOTE/$RELEASE_BRANCH..$SOURCE_BRANCH"
    if [ -z "$(git log --oneline "$RANGE")" ]; then
        echo "$REMOTE/$RELEASE_BRANCH is already at $(git rev-parse --short "$LOCAL_SHA"). Nothing to ship."
        exit 0
    fi
    echo ""
    echo "About to ship to $RELEASE_BRANCH:"
    git log --oneline --no-decorate "$RANGE" | sed 's/^/  /'
else
    echo ""
    echo "$REMOTE/$RELEASE_BRANCH does not exist yet - creating it at $(git rev-parse --short "$LOCAL_SHA")."
fi

echo ""
if [ "$ASSUME_YES" = false ]; then
    read -r -p "Promote to $RELEASE_BRANCH? [y/N] " reply
    case "$reply" in
        [yY]|[yY][eE][sS]) ;;
        *) echo "Aborted."; exit 0 ;;
    esac
fi

# Deliberately no --force: a non-fast-forward means release holds something main
# does not, and that should fail loudly rather than be rewritten under a live server.
git push "$REMOTE" "$SOURCE_BRANCH:$RELEASE_BRANCH"

echo ""
echo "Promoted. debbie polls every 2 minutes - watch it land with:"
echo "  ssh srv@debbie.local journalctl -u deploy-poll-custom.service -f"
