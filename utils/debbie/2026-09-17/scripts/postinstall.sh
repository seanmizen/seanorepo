#!/bin/bash
# postinstall.sh - bring a freshly installed Debian 13 box up to "debbie".
#
# Deliberately minimal. This generation proves the VM loop. Since #279 it also
# installs the deploy poller and since #280 the cloudflared tunnel; the network
# failover watchdog is still NOT here and arrives under REQ-NETWORK-003.
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

#------------------------------------------------------------------------------
# Deploy poller - REQ-DEPLOY-002, REQ-DEPLOY-003, REQ-DEPLOY-005, REQ-DEPLOY-006
#
# The host pulls: every two minutes it compares origin/release against a marker
# and deploys when the two differ. Nothing reaches in, because nothing can -
# REQ-SERVER-002 forwards no port.
#
# WRITTEN HERE RATHER THAN COPIED FROM THE CHECKOUT, and the reason is not
# taste. This script is delivered on its own - scp'd to /tmp by vm/test-vm.sh,
# streamed over stdin by metal/provision.sh - so it can read no file that sits
# beside it in the repository. The only copy of the repository it could read
# from is the checkout it made above, which is on `release`, which by
# definition holds the last thing that was SHIPPED. On the first box this
# generation provisions, `release` still points at the previous generation and
# contains none of this. Sourcing the units from there would mean the poller is
# installed only on a box that already had a working poller.
#
# So the units are literals here, in the one file that is guaranteed to be
# current because a human just ran it. The same is true of the logind drop-in
# and the Docker apt source above; this follows that pattern rather than
# inventing a second one.
#
# deploy.sh itself cannot be inlined - it is 250 lines and having two copies
# would be worse than the problem - so ExecStart points into the checkout, and
# a deploy updates the deployer. The guard below says so out loud when the
# checkout does not have it yet, with the remedy, rather than leaving a unit
# that fails every two minutes with "No such file or directory".
#------------------------------------------------------------------------------
UNIT_DIR=/usr/local/lib/systemd/system
GEN_DIR="$REPO_DIR/utils/debbie/2026-09-17"
DEPLOY_SCRIPT="$GEN_DIR/scripts/deploy.sh"
# Must match CLOUDFLARED_UNIT in that deploy.sh. The unit itself is written by
# the tunnel section at the bottom of this script (#280); this is the name the
# deploy is permitted to restart, and vm/assert.sh asserts that all three - the
# unit on disk, the name deploy.sh restarts and the name sudo permits - agree.
# `custom-` prefixed per REQ-SERVER-013, and deliberately not
# `cloudflared.service`, which would shadow a packaged unit of that name -
# REQ-SERVER-012.
CLOUDFLARED_UNIT="${CLOUDFLARED_UNIT:-custom-cloudflared.service}"

log "deploy poller"

# /usr/local/lib/systemd/system, not /etc/systemd/system - REQ-SERVER-011. It
# is already on systemd's search path, carries /usr/local semantics, and is
# empty on a fresh install, so `ls` there answers "what did we install?".
install -d -m 0755 "$UNIT_DIR"

units_changed=0

# Compare before writing, so a correct unit is left byte-identical and a second
# provisioning run does not churn systemd. The daemon-reload below is then
# conditional on something having actually changed, which is what makes
# re-running this script genuinely free.
write_unit() {
    local dest="$UNIT_DIR/$1" tmp
    tmp="$(mktemp)"
    cat > "$tmp"
    if [ ! -f "$dest" ] || ! cmp -s "$tmp" "$dest"; then
        log "  writing $dest"
        install -m 0644 -o root -g root "$tmp" "$dest"
        units_changed=1
    fi
    rm -f "$tmp"
}

write_unit custom-deploy-poll.service <<EOF
# Managed by utils/debbie/2026-09-17/scripts/postinstall.sh - REQ-DEPLOY-002
[Unit]
Description=Deploy origin/release to this host if it has moved
Documentation=https://github.com/seanmizen/seanorepo/issues/279
# docker.service because the deploy is \`yarn prod:docker\`, and
# network-online because the first thing it does is talk to github.com.
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
User=$DEPLOY_USER
WorkingDirectory=$REPO_DIR
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$DEPLOY_SCRIPT

# Stated rather than inherited. A cold \`yarn install\` plus a rebuild of every
# workspace is tens of minutes, and the default for a oneshot unit is not worth
# guessing at when being wrong means SIGKILL half way through a docker build.
# Being killed is survivable either way: the deploy holds its lock on a file
# descriptor, so the kernel releases it when the process dies and the next
# poll picks up cleanly - REQ-DEPLOY-003.
TimeoutStartSec=30min

# No [Install] section. custom-deploy-poll.timer owns this unit, and enabling
# it separately would give it a second, uncoordinated trigger.
EOF

write_unit custom-deploy-poll.timer <<EOF
# Managed by utils/debbie/2026-09-17/scripts/postinstall.sh - REQ-DEPLOY-002
[Unit]
Description=Poll origin/release every two minutes and deploy on change
Documentation=https://github.com/seanmizen/seanorepo/issues/279

[Timer]
# Late enough after boot that docker and the network are up. The run it
# triggers is also what brings the containers back after a power cut: no app
# compose file sets a restart policy, and deploy.sh records the boot id
# alongside the deployed SHA so a reboot counts as a reason to deploy even
# though \`release\` has not moved.
OnBootSec=3min
OnUnitActiveSec=2min
# The poll costs one ls-remote. Letting systemd batch it saves wakeups and
# nobody can tell the difference at a two-minute period.
AccuracySec=30s
Unit=custom-deploy-poll.service

[Install]
WantedBy=timers.target
EOF

if [ "$units_changed" = 1 ]; then
    systemctl daemon-reload
fi

#------------------------------------------------------------------------------
# The sudoers drop-in - REQ-DEPLOY-005
#
# deploy.sh runs as $DEPLOY_USER and needs root for exactly one thing:
# restarting the tunnel when apps/cloudflared/config.yml has changed. This
# grants that one command. No wildcard, no other unit, no other verb, and no
# ALL in the command position - which is the whole reason the deploy does not
# need general root.
#
# Note honestly what this is and is not today. scripts/write-overrides.sh has
# the installer write `$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL` to
# /etc/sudoers.d/90-$DEPLOY_USER, so on a box as it stands this file narrows
# nothing - the account already has general passwordless root. What it does is
# make the DEPLOY need only one command, so that tightening the blanket grant
# later (REQ-SERVER-008) does not break the deploy. Reading this file as the
# boundary today would be wrong; writing the deploy as though it were is what
# makes the boundary available.
#
# VALIDATE BEFORE INSTALLING, always. sudo refuses to run at all when any file
# in /etc/sudoers.d fails to parse, so writing this directly and then checking
# it can lock every account out of root on a headless box - including the
# account that would have to fix it. Write to a temp path, run `visudo -c`
# against that, and only install once it parses. Mode 0440 root:root, which is
# what sudo requires of a drop-in and will otherwise refuse to read.
#------------------------------------------------------------------------------
SUDOERS_DEST=/etc/sudoers.d/seanorepo-deploy
sudoers_tmp="$(mktemp)"

cat > "$sudoers_tmp" <<EOF
# Managed by utils/debbie/2026-09-17/scripts/postinstall.sh - REQ-DEPLOY-005.
# Exactly one command. See the deploy poller section of that script for why.
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart $CLOUDFLARED_UNIT
EOF

if visudo -cf "$sudoers_tmp" > /dev/null; then
    if [ ! -f "$SUDOERS_DEST" ] || ! cmp -s "$sudoers_tmp" "$SUDOERS_DEST"; then
        log "  installing $SUDOERS_DEST"
        install -m 0440 -o root -g root "$sudoers_tmp" "$SUDOERS_DEST"
    fi
else
    # Loud, and fatal. A deploy that cannot restart the tunnel is a deploy that
    # silently serves stale ingress after an config.yml change, and there is no
    # correct way to continue past a sudoers file this script itself generated
    # and cannot parse.
    rm -f "$sudoers_tmp"
    echo "[postinstall] ERROR: generated sudoers drop-in failed visudo -c; not installing" >&2
    exit 1
fi
rm -f "$sudoers_tmp"

# Enabled, NOT started. `--now` here would fire a deploy in the middle of
# provisioning - a cold `yarn install` and a full docker build, racing the rest
# of this script and the reboot that follows it. OnBootSec=3min starts it after
# the next boot, which both harnesses perform before asserting.
systemctl enable custom-deploy-poll.timer

if [ ! -x "$DEPLOY_SCRIPT" ]; then
    # Not fatal, and the timer stays enabled on purpose: the moment the
    # checkout catches up, the poller starts working with no further action.
    log "  NOTE: $DEPLOY_SCRIPT is not in the checkout yet."
    log "        This box is on a '$RELEASE_BRANCH' that predates the deploy"
    log "        poller, so the timer will fail until it advances. Run"
    log "        'yarn release' from a clean main on a dev machine, then"
    log "        re-run this script - its checkout step above is what pulls"
    log "        the new commit onto the box."
fi

#------------------------------------------------------------------------------
# Cloudflare tunnel - REQ-NETWORK-001, REQ-NETWORK-002
#
# Everything public arrives this way. REQ-SERVER-002 forwards no inbound port
# and the firewall above allows four, none of them an app port, so without this
# the box serves nothing to the internet at all. The tunnel dials OUT to
# Cloudflare and traffic comes back down that connection.
#
# FROM CLOUDFLARE'S APT REPOSITORY, NOT A BINARY DROPPED IN BY HAND - #135.
# The old arrangement had someone curl the binary into /usr/local/bin, which
# made it invisible to dpkg, absent from every update path, and dependent on
# cloudflared's own self-update - which failed silently for about sixteen
# months (#136). As a package it is upgraded by REQ-SERVER-006's unattended
# upgrades like anything else, and `dpkg -S` can say where it came from.
#------------------------------------------------------------------------------
CLOUDFLARED_KEYRING=/usr/share/keyrings/cloudflare-main.gpg
CLOUDFLARED_LIST=/etc/apt/sources.list.d/cloudflared.list
# `any`, NOT $VERSION_CODENAME, and this is a verified fact rather than a
# preference. Cloudflare's repository has no `trixie` suite - as of writing
# https://pkg.cloudflare.com/cloudflared/dists/trixie/Release is a 404 - so the
# codename substitution used for the Docker repository above would leave apt
# failing on every update, on the box this generation is FOR. The `any` suite
# exists precisely for this, and it is not a downgrade: its
# main/binary-<arch>/Packages is byte-identical to bookworm's (same MD5), so
# `any` and a codename suite serve the same package. cloudflared is a static Go
# binary with no libc version to disagree about, which is why one build covers
# every suite.
CLOUDFLARED_SUITE="${CLOUDFLARED_SUITE:-any}"

CLOUDFLARED_DIR="$REPO_DIR/apps/cloudflared"
# REQ-NETWORK-002 - ingress comes from the repository, so a routing change is
# reviewable and revertable rather than being a file edited over SSH.
CLOUDFLARED_CONFIG="$CLOUDFLARED_DIR/config.yml"
# REQ-DEPLOY-006 - gitignored, host-specific, and the reason deploy.sh has no
# `git clean`. Provisioning defines this path and creates the directory. It
# NEVER writes anything into it: see the note further down.
CLOUDFLARED_CREDS_DIR="$CLOUDFLARED_DIR/credentials"

log "cloudflare tunnel"

# Already binary, unlike Docker's - `file` reports an OpenPGP Public Key rather
# than ASCII armour - so there is no `gpg --dearmor` step here and adding one
# would corrupt it. Downloaded to a temp file first for the same reason as the
# Docker key: a curl that dies mid-stream must not leave a present, non-empty,
# unusable keyring that the guard then skips repairing forever.
if [ ! -s "$CLOUDFLARED_KEYRING" ]; then
    log "  fetching Cloudflare's apt signing key"
    cf_key_tmp="$(mktemp)"
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o "$cf_key_tmp"
    install -m 0644 -o root -g root "$cf_key_tmp" "$CLOUDFLARED_KEYRING"
    rm -f "$cf_key_tmp"
fi

# Written whole and compared whole, exactly as the Docker source above is, so a
# correct file is left byte-identical and a wrong one is replaced rather than
# appended to. An append here is what leaves apt complaining about a
# doubly-configured repository on every update - vm/assert.sh counts the lines.
cf_deb_line="deb [arch=$(dpkg --print-architecture) signed-by=$CLOUDFLARED_KEYRING] https://pkg.cloudflare.com/cloudflared $CLOUDFLARED_SUITE main"
cf_repo_changed=0
if [ ! -f "$CLOUDFLARED_LIST" ] || [ "$(cat "$CLOUDFLARED_LIST")" != "$cf_deb_line" ]; then
    log "  writing $CLOUDFLARED_LIST"
    printf '%s\n' "$cf_deb_line" > "$CLOUDFLARED_LIST"
    cf_repo_changed=1
fi

if [ "$cf_repo_changed" = 1 ] \
    || ! dpkg-query -W -f='${Status}' cloudflared 2> /dev/null | grep -q "^install ok installed"; then
    apt-get update -y
fi

apt-get install -y cloudflared

#------------------------------------------------------------------------------
# Nothing else may drive this tunnel.
#
# Two daemons running one tunnel is a real failure mode: Cloudflare accepts
# both connections, requests are dealt to whichever, and restarting "the
# tunnel" fixes half of them. Checked here rather than assumed, because two of
# the three ways it happens are things a person does.
#
# What the package does NOT do, verified by unpacking the .deb rather than by
# reading the docs: cloudflared 2026.9.1 ships /usr/bin/cloudflared, a man page
# and a changelog, and no systemd unit at all. Its postinst only symlinks
# /usr/local/bin/cloudflared -> /usr/bin/cloudflared and touches a marker file.
# So there is no packaged `cloudflared.service` to race us and nothing to mask.
#
# A `cloudflared.service` can still appear, which is why this loop exists:
# `cloudflared service install` writes one into /etc/systemd/system, and that
# is the documented way to do this, so it is exactly what a future repair
# session reaches for. `cloudflared-custom.service` is the previous
# generation's unit and is live on the box this replaces.
#
# Disabled, not masked. Masking would make a later `cloudflared service
# install` fail in a way nobody would connect to this script; disabling is
# reversible, visible in `systemctl is-enabled`, and re-applied on every
# provisioning run. vm/assert.sh asserts the property that matters - that no
# other cloudflared unit is enabled - rather than the mechanism.
#------------------------------------------------------------------------------
for stale_unit in cloudflared.service cloudflared-custom.service; do
    # Spelled as an `if` rather than `[ ... ] && continue`: under `set -e` a
    # bare failing test at the top of a loop body is a trap that depends on
    # exactly where it sits in the list, and this script must not die on one.
    if [ "$stale_unit" = "$CLOUDFLARED_UNIT" ]; then
        continue
    fi
    if systemctl cat -- "$stale_unit" > /dev/null 2>&1; then
        log "  disabling $stale_unit so it cannot race $CLOUDFLARED_UNIT"
        systemctl disable --now "$stale_unit" || true
    fi
done

#------------------------------------------------------------------------------
# The credentials directory - REQ-DEPLOY-006.
#
# PROVISIONING DEFINES THE PATH AND CREATES THE DIRECTORY. IT NEVER WRITES A
# CREDENTIAL. There is no credential in this repository, none on the installer
# medium and none on any command line - the tunnel's credentials file is
# host-specific, is created once by `cloudflared tunnel create` on a machine
# with a Cloudflare login, and is copied to the box by hand. See the README.
#
# `install -d` touches the directory's own mode and ownership and nothing
# inside it, so a second run cannot clobber a working tunnel - which is the
# whole of AC 3. 0700 because the contents are a bearer credential for every
# hostname this box serves: anything that can read the file can serve traffic
# as debbie.
#
# Guarded on the checkout having apps/cloudflared at all. On a box whose
# `release` predates that directory, creating it here would scatter untracked
# directories through the checkout to no purpose - the unit's conditions below
# would still correctly refuse to start.
#------------------------------------------------------------------------------
if [ -d "$CLOUDFLARED_DIR" ]; then
    install -d -o "$DEPLOY_USER" -g "$deploy_group" -m 0700 "$CLOUDFLARED_CREDS_DIR"
else
    log "  NOTE: $CLOUDFLARED_DIR is not in the checkout yet, so the"
    log "        credentials directory has not been created."
fi

#------------------------------------------------------------------------------
# The unit.
#
# WorkingDirectory is load-bearing and is the least obvious line here.
# config.yml says `credentials-file: ./credentials/<uuid>.json` - a RELATIVE
# path - and cloudflared resolves it against the process's working directory,
# not against the config file. Drop this line and the daemon starts, reads the
# config, and fails looking for the credentials under whatever directory
# systemd happened to give it. The previous generation's unit set it for the
# same reason.
#
# --no-autoupdate, and this is #136 rather than a style choice. cloudflared's
# self-update is what silently failed for sixteen months on the old box. Now
# that this is a package, REQ-SERVER-006's unattended upgrades own the version,
# and leaving self-update on would have two mechanisms writing the same binary
# - one of which runs as $DEPLOY_USER and cannot write /usr/bin anyway, so it
# could only ever fail, quietly, exactly as it did before.
#
# /usr/bin/cloudflared, not /usr/local/bin/cloudflared. The latter is the
# symlink the package's postinst creates; pointing at the real path means the
# unit does not depend on that symlink surviving.
#------------------------------------------------------------------------------
units_changed=0

write_unit "$CLOUDFLARED_UNIT" <<EOF
# Managed by utils/debbie/2026-09-17/scripts/postinstall.sh - REQ-NETWORK-001
[Unit]
Description=Cloudflare tunnel - public ingress for every site this host serves
Documentation=https://github.com/seanmizen/seanorepo/issues/280
# The tunnel's first act is to dial out to Cloudflare, so it wants a route.
After=network-online.target
Wants=network-online.target

# REFUSE, RATHER THAN FAIL IN A LOOP. Both of these are absent on a box that
# has been provisioned but whose tunnel has never been set up by hand, which is
# a normal first-boot state rather than an error. A condition that is not met
# makes systemd log one line and leave the unit inactive - it does NOT count as
# a failure, does not trigger Restart=, and cannot fill the journal. Starting
# without credentials would instead be an authentication failure every
# RestartSec forever, against a journal that is uncapped until #287, hiding the
# one fact that matters: nobody has put the credentials on this box.
ConditionPathExists=$CLOUDFLARED_CONFIG
ConditionDirectoryNotEmpty=$CLOUDFLARED_CREDS_DIR

# The backstop for a failure the conditions cannot see - credentials that are
# present but rejected, or a config.yml that does not parse. Five attempts in
# ten minutes, then systemd gives up and leaves the unit in \`failed\`, which is
# a state \`systemctl status\` reports and a human can find. Without this,
# Restart=on-failure means "retry every ten seconds until the disk fills".
StartLimitIntervalSec=10min
StartLimitBurst=5

[Service]
Type=simple
User=$DEPLOY_USER
# Not optional - see the note above this unit. config.yml's credentials-file is
# a relative path and cloudflared resolves it from here.
WorkingDirectory=$CLOUDFLARED_DIR
ExecStart=/usr/bin/cloudflared --no-autoupdate --config $CLOUDFLARED_CONFIG tunnel run
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
EOF

if [ "$units_changed" = 1 ]; then
    systemctl daemon-reload
fi

#------------------------------------------------------------------------------
# Enable it only if it could actually run.
#
# The test mirrors the unit's two Conditions exactly, on purpose: if this
# script and systemd disagreed about what "ready" means, the box would either
# carry an enabled unit that never starts or a working tunnel nobody enabled.
#
# Enabled, NOT --now, matching the deploy poller above. Provisioning is
# followed by a reboot in both harnesses and on metal.
#
# NOT DISABLED IN THE ELSE BRANCH, deliberately. A box whose credentials have
# gone missing is already handled by the conditions - the unit stays enabled
# and is skipped rather than looping - and disabling here would mean a
# re-provisioning run that misread the state could take a working tunnel down.
# Refusing to enable is the requirement; tearing down is not.
#
# EXIT 0 EITHER WAY. No credentials is the correct state of a freshly built
# box, exactly like #278's missing origin/release. It is reported, loudly, with
# the remedy - not treated as a provisioning failure.
#------------------------------------------------------------------------------
if [ -f "$CLOUDFLARED_CONFIG" ] \
    && [ -d "$CLOUDFLARED_CREDS_DIR" ] \
    && [ -n "$(ls -A "$CLOUDFLARED_CREDS_DIR" 2> /dev/null)" ]; then
    log "  credentials present - enabling $CLOUDFLARED_UNIT"
    systemctl enable "$CLOUDFLARED_UNIT"
else
    log "  NOT enabling $CLOUDFLARED_UNIT - this box has no tunnel credentials."
    log "        This is the normal state of a newly provisioned box, not a"
    log "        failure. The credentials are host-specific, are in no"
    log "        repository, and are never written by this script."
    log "        To finish the tunnel, on a machine with a Cloudflare login:"
    log "          cloudflared tunnel login"
    log "          cloudflared tunnel create <name>    # writes ~/.cloudflared/<uuid>.json"
    log "        then copy that file to this box as"
    log "          $CLOUDFLARED_CREDS_DIR/<uuid>.json"
    log "        make sure the uuid matches 'tunnel:' in $CLOUDFLARED_CONFIG,"
    log "        and re-run this script - it enables the unit once the"
    log "        credentials are there. See utils/debbie/2026-09-17/README.md."
fi

log "done"
