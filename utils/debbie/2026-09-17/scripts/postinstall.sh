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
log "installing packages"
apt-get update -y
apt-get install -y ufw avahi-daemon avahi-utils libnss-mdns ca-certificates curl gnupg

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

log "done"
