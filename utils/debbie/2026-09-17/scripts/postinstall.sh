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
log "installing packages"
apt-get update -y
apt-get install -y ufw avahi-daemon avahi-utils libnss-mdns ca-certificates curl

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
# Deploy user - REQ-SERVER-003
#
# Docker group membership only. Docker itself is a later generation's problem;
# creating the group here keeps the assertion meaningful without pulling the
# whole engine into a run that does not use it.
#------------------------------------------------------------------------------
log "deploy user $DEPLOY_USER"
getent group docker > /dev/null || groupadd docker
id "$DEPLOY_USER" > /dev/null 2>&1 || { echo "user $DEPLOY_USER missing" >&2; exit 1; }

# usermod -aG is already additive, so this is safe to repeat.
usermod -aG docker,sudo "$DEPLOY_USER"

log "done"
