#!/bin/bash
# postinstall.sh - bring a freshly installed Debian 13 box up to "debbie".
#
# Deliberately minimal. This generation proves the VM loop; the deploy poller,
# cloudflared tunnel and network failover watchdog are NOT here and arrive in a
# later generation under REQ-DEPLOY-* and REQ-NETWORK-*.
#
# Every step is idempotent and every append is guarded. The previous
# generation's postinstall re-appended its zsh prompt block on every run while
# its own docs claimed idempotency - a claim nobody checked because nothing
# asserted it. Here, each step below has a matching assertion in vm/assert.sh.
#
# Usage: sudo ./postinstall.sh
set -euo pipefail
IFS=$'\n\t'
export DEBIAN_FRONTEND=noninteractive

SERVER_NAME="${SERVER_NAME:-debbie}"
DEPLOY_USER="${DEPLOY_USER:-srv}"
# Where the checkout lives. This default is not free to change: it has to agree
# with three other places at once, and nothing but agreement makes the deploy
# work.
#
#   - vm/assert.sh reads the same default, and its checkout and yarn-version
#     assertions look here.
#   - 2025-10-08b/scripts/deploy.sh - what production runs today - resolves
#     "${REPO_PATH:-$HOME/projects/seanorepo}" as the deploy user, which for
#     DEPLOY_USER=srv is this exact path.
#   - the corepack activation further down reads $REPO_DIR/package.json.
#
# deploy.sh's override is spelled REPO_PATH and this one REPO_DIR, which is a
# wart inherited from the older generation. They are left as they are rather
# than renamed here: renaming the one in 2025-10-08b would edit what production
# runs, and this generation does not own that file. The DEFAULTS agree, which
# is what actually matters, and the next generation's deploy script should
# adopt REPO_DIR.
REPO_DIR="${REPO_DIR:-/home/$DEPLOY_USER/projects/seanorepo}"
REPO_URL="${REPO_URL:-https://github.com/seanmizen/seanorepo.git}"
# The host deploys `release` and never `main` - REQ-DEPLOY-001. `release` moves
# only when someone runs `yarn release`, so on a box provisioned before the
# first release it legitimately does not exist yet.
RELEASE_BRANCH="${RELEASE_BRANCH:-release}"

log() { echo "[postinstall] $*"; }

[ "$(id -u)" -eq 0 ] || { echo "must run as root (use sudo)" >&2; exit 1; }

#------------------------------------------------------------------------------
# Packages
#------------------------------------------------------------------------------
# avahi-daemon, avahi-utils and libnss-mdns are installed by the preseed as of
# #285, so on a box this generation installed these are already present and
# apt-get does nothing. They stay named here because this script must also
# repair a box installed by an earlier preseed, and because ufw is genuinely
# only wanted after the install (it would otherwise close 22 mid-provision).
#
# ca-certificates, curl and gnupg are here for the Docker step below: it
# fetches an armoured signing key over TLS and dearmors it, which needs all
# three. A Debian 13 minimal install has neither curl nor gpg.
#
# git is for the checkout further down, and a minimal install has no git
# either. ca-certificates is load-bearing twice over: the clone is an
# anonymous HTTPS fetch from github.com, which fails on a box with no trust
# store in a way that reads like a network fault.
log "installing packages"
apt-get update -y
apt-get install -y ufw avahi-daemon avahi-utils libnss-mdns ca-certificates curl git gnupg

#------------------------------------------------------------------------------
# Hostname and mDNS - REQ-SERVER-004
#
# REPAIR, NOT RE-DO. Since #285 the preseed's late_command has already set both
# of these before first boot, and on such a box every branch here is skipped.
# What survives is the repair path for a box installed by an older preseed, or
# one whose identity has drifted.
#
# The bug this guards: netcfg preferred a reverse-DNS answer over the preseeded
# hostname, split 192.168.1.182 at its first dot, and installed the box as
# `192`. postinstall.sh quietly fixed it, which is exactly why nothing noticed
# for so long - every assertion ran after this script. vm/assert.sh now also
# runs BEFORE it, so "the preseed set it" and "postinstall repaired it" can no
# longer be confused.
#------------------------------------------------------------------------------
log "hostname -> $SERVER_NAME"
if [ "$(hostnamectl --static)" != "$SERVER_NAME" ]; then
    log "  repairing hostname (was '$(hostnamectl --static)')"
    hostnamectl set-hostname "$SERVER_NAME"
    echo "$SERVER_NAME" > /etc/hostname
fi

# Guarded so a correct file is left byte-identical. Rewrite rather than append
# when it IS wrong, so re-running cannot accumulate 127.0.1.1 lines. The
# pattern accepts either separator: late_command writes a space, this writes a
# tab, and both are valid in a whitespace-delimited /etc/hosts.
if ! grep -qE "^127\.0\.1\.1[[:space:]]+${SERVER_NAME}[[:space:]]*\$" /etc/hosts; then
    log "  repairing the 127.0.1.1 line in /etc/hosts"
    sed -i '/^127\.0\.1\.1/d' /etc/hosts
    printf '127.0.1.1\t%s\n' "$SERVER_NAME" >> /etc/hosts
fi

# Already enabled and running on a box the preseed installed avahi onto; this
# is idempotent and is what repairs an older one.
systemctl enable --now avahi-daemon

#------------------------------------------------------------------------------
# Power - REQ-SERVER-001
#
# debbie is a laptop serving from a shelf with the lid shut. Default logind
# suspends on lid close, which takes every site down until someone opens it.
#
# A drop-in, not a sed over /etc/systemd/logind.conf: the main file is package
# owned, so an upgrade can revert or conflict with an edit made in place, and a
# drop-in states only what we override.
#------------------------------------------------------------------------------
log "disabling sleep on lid close and idle"
install -d /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/10-debbie-nosleep.conf <<'EOF'
# Managed by utils/debbie postinstall.sh - REQ-SERVER-001
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
IdleAction=ignore
IdleActionSec=0
EOF

# Deliberately NOT restarting systemd-logind. It terminates the calling
# session, which kills this script when run over SSH. The drop-in is read at
# next boot, and the harness reboots before asserting.
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

#------------------------------------------------------------------------------
# Firewall - REQ-SERVER-002
#
# Nothing but SSH, HTTP, HTTPS and mDNS. App ports (4000-4061) are deliberately
# closed: everything public arrives through the tunnel, which is outbound only,
# so an open app port would be a second unaudited way in.
#------------------------------------------------------------------------------
log "configuring firewall"
ufw --force reset > /dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 5353/udp
ufw --force enable

#------------------------------------------------------------------------------
# Docker engine - REQ-DEPLOY-004
#
# The deploy is `yarn prod:docker`, so the box needs the engine and the compose
# plugin, not merely a group named docker. Until #276 this script created the
# group and stopped, and vm/assert.sh's "srv in docker" check passed against an
# empty group - an assertion that read as "Docker works" while proving only
# that `groupadd` had run.
#
# Docker's own apt repository, not Debian's docker.io: compose v2 ships there
# as a plugin (`docker compose`, not `docker-compose`), which is what
# yarn prod:docker invokes.
#
# Each step below is guarded so a second run is a no-op rather than a second
# source file, a re-download, or a duplicate deb line that makes apt-get update
# complain about a doubly-configured repository.
#------------------------------------------------------------------------------
DOCKER_KEYRING=/etc/apt/keyrings/docker.gpg
DOCKER_LIST=/etc/apt/sources.list.d/docker.list

log "docker engine"
install -d -m 0755 /etc/apt/keyrings

if [ ! -s "$DOCKER_KEYRING" ]; then
    log "  fetching Docker's apt signing key"
    # Dearmored via a temp file rather than a pipe: a curl failure mid-stream
    # would otherwise leave a truncated keyring that is present, non-empty and
    # unusable - and the guard above would then skip repairing it forever.
    docker_key_tmp="$(mktemp)"
    curl -fsSL https://download.docker.com/linux/debian/gpg -o "$docker_key_tmp"
    gpg --batch --yes --dearmor -o "$DOCKER_KEYRING" "$docker_key_tmp"
    rm -f "$docker_key_tmp"
    chmod 0644 "$DOCKER_KEYRING"
fi

# Written whole and compared whole, so a correct file is left byte-identical
# and a wrong one is replaced rather than appended to.
docker_deb_line="deb [arch=$(dpkg --print-architecture) signed-by=$DOCKER_KEYRING] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable"
docker_repo_changed=0
if [ ! -f "$DOCKER_LIST" ] || [ "$(cat "$DOCKER_LIST")" != "$docker_deb_line" ]; then
    log "  writing $DOCKER_LIST"
    printf '%s\n' "$docker_deb_line" > "$DOCKER_LIST"
    docker_repo_changed=1
fi

# Refresh only when there is a reason to. The second condition covers a box
# whose previous run wrote the source and then failed before installing: the
# file is already right, so the first condition is false, but the package lists
# may never have been fetched.
if [ "$docker_repo_changed" = 1 ] \
    || ! dpkg-query -W -f='${Status}' docker-ce 2> /dev/null | grep -q "^install ok installed"; then
    apt-get update -y
fi

apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

#------------------------------------------------------------------------------
# Deploy user - REQ-SERVER-003
#
# The docker-ce package creates the docker group itself, so by here it exists.
# The getent guard stays for the repair path: a box provisioned by an older
# revision of this script has the group without the engine, and one where the
# package install is later changed should not silently lose the membership.
#
# Membership grants root-equivalent access through the daemon socket, which is
# the point - the deploy runs unattended and cannot answer a sudo prompt.
#------------------------------------------------------------------------------
log "deploy user $DEPLOY_USER"
getent group docker > /dev/null || groupadd docker
id "$DEPLOY_USER" > /dev/null 2>&1 || { echo "user $DEPLOY_USER missing" >&2; exit 1; }

# usermod -aG is already additive, so this is safe to repeat. The new group
# does NOT appear in sessions that already exist - including the one running
# this script - so `docker info` without sudo is only true from the next login
# onwards. vm/assert.sh asserts it over a fresh SSH connection after a reboot,
# which is why it can make that claim honestly.
usermod -aG docker,sudo "$DEPLOY_USER"

#------------------------------------------------------------------------------
# Repository checkout - REQ-DEPLOY-001
#
# Nothing deployed anything before this, because nothing had put the repository
# on the box. This clones it, and it does so BEFORE the Node and Yarn section
# on purpose: that section activates the Yarn the repository declares, and can
# only do so once there is a package.json to read. Put the clone after it and
# the activation is a no-op on every first run and only ever works on the
# second - which is the kind of ordering bug that hides for a generation
# because both runs eventually converge.
#
# ANONYMOUS HTTPS, NO CREDENTIAL. seanmizen/seanorepo is a public repository,
# so an unauthenticated clone works and provisioning holds no secret, no deploy
# key and nothing to rotate. If the repository is ever made private this step
# is the thing that breaks, and it breaks loudly at provision time rather than
# silently at deploy time - which is the right place to find out.
#
# AS THE DEPLOY USER, NOT ROOT - REQ-SERVER-003. The deploy runs unattended as
# $DEPLOY_USER and cannot answer a password prompt, so a checkout root happens
# to own is a checkout the deploy cannot fetch into. Cloning under sudo -u is
# the easy half; the ownership repair below is the half that is easy to get
# subtly wrong, because a single root-owned object inside an otherwise correct
# tree is enough to break `git fetch` months later.
#------------------------------------------------------------------------------
log "repository checkout at $REPO_DIR"

repo_parent="$(dirname "$REPO_DIR")"
deploy_group="$(id -gn "$DEPLOY_USER")"

# -o/-g so the parent directories are the deploy user's too. `install -d`
# applies them to every component it creates, and leaves an existing one alone.
install -d -o "$DEPLOY_USER" -g "$deploy_group" -m 0755 "$repo_parent"

if [ ! -d "$REPO_DIR/.git" ]; then
    log "  cloning $REPO_URL"
    sudo -u "$DEPLOY_USER" -H git clone "$REPO_URL" "$REPO_DIR"
    repo_cloned=1
else
    log "  already cloned - fetching"
    repo_cloned=0
fi

# Always fetch, clone or no clone: this is what makes a second run cheap and
# correct rather than a re-clone. --prune so a branch deleted upstream does not
# linger as a remote-tracking ref that a later checkout could resolve against.
sudo -u "$DEPLOY_USER" -H git -C "$REPO_DIR" fetch --prune origin

# `|| true` because symbolic-ref exits non-zero on a detached HEAD, which is a
# state to report rather than to die on, and `set -e` would otherwise take the
# whole script down over it.
current_branch="$(sudo -u "$DEPLOY_USER" -H git -C "$REPO_DIR" symbolic-ref --short -q HEAD || true)"

if sudo -u "$DEPLOY_USER" -H git -C "$REPO_DIR" \
    rev-parse --verify --quiet "refs/remotes/origin/$RELEASE_BRANCH" > /dev/null; then
    if [ "$current_branch" = "$RELEASE_BRANCH" ]; then
        # Deliberately nothing. Re-running must not move a host that is already
        # where it belongs: between provisioning runs the deploy poller (#279)
        # owns advancing this checkout, and resetting it here would undo a
        # deploy and could roll production backwards on an unrelated repair.
        log "  already on $RELEASE_BRANCH - leaving the working tree alone"
    else
        # -f, matching deploy.sh, and only reached when the box is NOT on the
        # release branch - a fresh clone (on the default branch) or one that
        # has drifted. It discards modifications to TRACKED files, which on a
        # deploy host is exactly right, and leaves untracked files alone
        # because there is no `git clean` here - REQ-DEPLOY-006, which exists
        # because apps/cloudflared/credentials/ lives untracked on the host.
        log "  checking out $RELEASE_BRANCH (was ${current_branch:-a detached HEAD})"
        sudo -u "$DEPLOY_USER" -H git -C "$REPO_DIR" \
            checkout -f -B "$RELEASE_BRANCH" "origin/$RELEASE_BRANCH"
    fi
else
    # NOT AN ERROR, and the exit status stays zero. `release` is created the
    # first time someone runs `yarn release`, which on a brand new box has not
    # happened yet, so a box provisioned before the first release is correct
    # and simply has nothing to deploy. Creating the branch here would be
    # worse than useless: it would publish whatever `main` happened to be as
    # though someone had chosen to ship it - the precise thing REQ-DEPLOY-001
    # exists to prevent.
    log "  NOTE: origin/$RELEASE_BRANCH does not exist yet."
    log "        This is the normal state of a box provisioned before the first"
    log "        release, not a failure. Run 'yarn release' from a clean main on"
    log "        a dev machine to create it; the checkout stays on"
    log "        '${current_branch:-a detached HEAD}' until then."
fi

# Belt and braces, and the reason AC 1 says "not just the top directory". A box
# where someone once ran `sudo git pull` by hand has root-owned objects inside
# an srv-owned checkout, and the next unattended fetch fails on a file it
# cannot write - at 3am, in the journal, with no obvious cause. -print -quit
# stops at the first offender, so the common case costs one stat, and the
# chown only runs when there is something to repair.
if [ -n "$(find "$REPO_DIR" ! -user "$DEPLOY_USER" -print -quit)" ]; then
    log "  repairing ownership under $REPO_DIR"
    chown -R "$DEPLOY_USER:$deploy_group" "$REPO_DIR"
fi

if [ "$repo_cloned" = 1 ]; then
    log "  cloned at $(sudo -u "$DEPLOY_USER" -H git -C "$REPO_DIR" rev-parse --short HEAD)"
fi

#------------------------------------------------------------------------------
# Node and Yarn - REQ-DEPLOY-004
#
# The deploy runs `yarn install --immutable` then `yarn prod:docker`, so the box
# needs Node and a Yarn 4 that the repository agrees with.
#
# DEBIAN'S OWN nodejs, NOT NodeSource. Trixie ships 20.19.2, which is Node 20 -
# the thing the ticket asks for - so a third-party apt source would buy nothing
# and cost a second keyring to go stale. The previous generation added
# NodeSource because bookworm shipped Node 18; that reason expired with trixie.
#
# `corepack enable`, NOT `npm install -g yarn`. The previous generation did both
# and contradicted itself: a globally npm-installed yarn lands in /usr/local/bin
# and shadows the corepack shim in /usr/bin, so the box ends up running Yarn 1
# against a Yarn 4 repository. npm is not installed here at all, which is the
# cheapest way to keep that from coming back.
#
# NO VERSION IS NAMED HERE, deliberately, and that is the point of the ticket.
# `corepack prepare --activate` with no argument reads `packageManager` from the
# package.json of the directory it runs in, so the repository stays the single
# source of the Yarn version and the two cannot drift. Pinning it a second time
# in this script is exactly the contradiction being removed.
#
# Since #278 the section above has already cloned the repository, so on any
# normal run the guard below is satisfied and the activation genuinely happens.
# The guard stays for the case where it is not - REPO_DIR pointed somewhere
# else, or a clone that failed and left a directory with no package.json in it.
# Skipping there costs nothing: corepack resolves `packageManager` at
# INVOCATION time, so even with no pre-warm at all the first `yarn` run inside
# the checkout fetches the declared version by itself. The step only moves that
# fetch earlier, to a moment when a failure is still attributable.
#------------------------------------------------------------------------------
log "node and yarn"
apt-get install -y nodejs node-corepack

# `yarn` only. A bare `corepack enable` also drops npm and pnpm shims into
# /usr/bin, and the npm one would collide with Debian's npm package if anything
# ever pulled it in. We want exactly one of the three.
corepack enable yarn

if [ -f "$REPO_DIR/package.json" ]; then
    log "  activating the yarn from $REPO_DIR/package.json"
    # As the deploy user, with -H: corepack's cache and its record of the
    # activated version are per-user, under $HOME. Warming root's cache would
    # do the deploy no good at all.
    sudo -u "$DEPLOY_USER" -H sh -c 'cd "$1" && corepack prepare --activate' _ "$REPO_DIR"
else
    log "  no package.json at $REPO_DIR - corepack will resolve the version"
    log "  from packageManager on first use inside the checkout"
fi

log "done"
