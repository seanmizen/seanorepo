#!/usr/bin/env bash
# host-tools.sh: installs the image-to-ascii binary that matches this checkout.
#
# Where: on every target machine, whatever its roles, as the deploy user.
# When:  after every successful release poll (custom-host-tools.service), and
#        once at the end of provisioning.
# Why:   the login animation runs a Go binary (REQ-DEPLOY-007). CI builds it
#        once per version of utils/image-to-ascii, and publishes it as a
#        GitHub release tagged with that folder's git tree hash. This machine
#        downloads the build for the tree it has checked out, so the binary
#        always matches the spec files beside it. The machine needs no Go.
set -euo pipefail
IFS=$'\n\t'

REPO_DIR="${REPO_DIR:-$HOME/projects/seanorepo}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/seanorepo"
RELEASES="${RELEASES:-https://github.com/seanmizen/seanorepo/releases/download}"

# journald reads a <N> prefix as the priority, so `-p info` hides the line that
# says nothing changed.
if [ -t 1 ]; then
    P_INFO='' P_DEBUG='' P_ERR=''
else
    P_INFO='<6>' P_DEBUG='<7>' P_ERR='<3>'
fi
log()   { echo "${P_INFO}[host-tools] $*"; }
debug() { echo "${P_DEBUG}[host-tools] $*"; }
err()   { echo "${P_ERR}[host-tools] ERROR: $*" >&2; }

tree="$(git -C "$REPO_DIR" rev-parse HEAD:utils/image-to-ascii 2> /dev/null)" || {
    debug "this checkout has no utils/image-to-ascii - nothing to install"
    exit 0
}

case "$(uname -m)" in
    x86_64) arch=amd64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *)
        err "CI builds no image-to-ascii for $(uname -m)"
        exit 1
        ;;
esac

marker="$STATE_DIR/image-to-ascii.tree"
if [ -x "$BIN_DIR/image-to-ascii" ] && [ "$(cat "$marker" 2> /dev/null)" = "$tree" ]; then
    debug "image-to-ascii is current (${tree:0:7})"
    exit 0
fi

tag="image-to-ascii-$tree"
name="image-to-ascii-linux-$arch"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if ! curl -fsL -o "$tmp/$name" "$RELEASES/$tag/$name" \
    || ! curl -fsL -o "$tmp/SHA256SUMS" "$RELEASES/$tag/SHA256SUMS"; then
    # Normal for a few minutes after a merge: CI may still be building this
    # tree. The next poll tries again. Any binary already installed stays.
    log "no published build for ${tree:0:7} yet - keeping the current binary"
    exit 0
fi

if ! (cd "$tmp" && grep " $name\$" SHA256SUMS | sha256sum -c --quiet -); then
    err "the checksum of $name does not match SHA256SUMS - not installing it"
    exit 1
fi

mkdir -p "$BIN_DIR" "$STATE_DIR"
install -m 0755 "$tmp/$name" "$BIN_DIR/image-to-ascii"
printf '%s\n' "$tree" > "$marker"
log "installed image-to-ascii for ${tree:0:7} ($arch)"
