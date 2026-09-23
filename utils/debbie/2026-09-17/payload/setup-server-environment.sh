#!/bin/bash
# setup-server-environment.sh: turns a machine that already has the developer
# toolchain into a server.
#
# Where: on the target machine, as root. provision.sh and test-vm.sh send it
#        over SSH and run it after setup-developer-environment.sh.
# When:  after the first boot, and again whenever the configuration or the
#        machine's roles must change.
# Why:   a server needs what a laptop must not have, in this order:
#          1. its own hostname and mDNS name
#          2. power keys ignored, and a capped journal
#          3. firewall, SSH keys only, automatic security updates
#          4. Docker publishing to loopback only
#          5. the checkout moved to the release branch
#          6. the release poller, the deploy unit and the roles
#          7. the Cloudflare tunnel, then ngrok
#          8. SSH keys for the deploy user, an address for each network
#             interface, and the failover watchdog
#          9. tcp-getter, and loopback exempt from sshd penalties
#         10. the gated upgrade of cloudflared and ngrok
#
# Docker, Node, Yarn, the shell and the seanorepo clone come from
# setup-developer-environment.sh, which runs first.
#
# It is idempotent: a second run leaves the machine in the same state.
# test-vm.sh runs it twice to prove this. Each step has a check in assert.sh.
#
# Usage: sudo SERVER_NAME=<name> [DEPLOY_USER=srv] [ROLE_WEBSERVER=yes]
#        [ROLE_TUNNEL=yes] bash setup-server-environment.sh
set -euo pipefail
IFS=$'\n\t'
export DEBIAN_FRONTEND=noninteractive

# No default - REQ-SERVER-014. A default name would let a new machine claim
# the name of a live one and collide with it on mDNS.
SERVER_NAME="${SERVER_NAME:-}"
if [ -z "$SERVER_NAME" ]; then
    echo "[server-setup] ERROR: SERVER_NAME is not set. It has no default: every machine must be named on purpose." >&2
    exit 1
fi

#------------------------------------------------------------------------------
# Roles - REQ-SERVER-014. What this machine DOES, as opposed to what it is able
# to do.
#
# Every machine gets the same capabilities: Docker, Node, the checkout, the release
# poller, ngrok, the shell. A role switches one of them on. Each role is a
# ROLE_<NAME> setting, taken from scripts/3-provision/<machine>.env by provision.sh, and a flag file
# under /etc/seanorepo/roles/ that the role's unit is conditioned on.
#
# UNSET MEANS OFF. A forgotten or empty setting never enables anything, and
# every run makes the flag files match the settings exactly. So a run of this
# script without ROLE_WEBSERVER=yes on the production webserver REMOVES the
# role. That is deliberate: the settings are the one source of truth. The run
# ends with a banner that shows the roles of the machine.
#
#   ROLE_WEBSERVER  runs `yarn prod:docker` (custom-deploy.service). Any number
#                   of machines. Without the tunnel role it publishes the apps on
#                   the LAN. With it, it publishes on loopback only (deploy.sh
#                   decides).
#   ROLE_TUNNEL     runs the Cloudflare tunnel (custom-cloudflared.service), so
#                   the internet reaches this machine. Requires ROLE_WEBSERVER - the
#                   tunnel only forwards to localhost:4xxx. EXACTLY ONE machine in
#                   the fleet: the apps are SQLite on local volumes, and the
#                   public one must have a single writer.
#
# This script checks the settings here, before it installs anything, so a typo
# fails the run and does not leave a half-provisioned machine.
#------------------------------------------------------------------------------
ROLES_DIR=/etc/seanorepo/roles
role_value() {
    case "$1" in
        yes) echo yes ;;
        no | '') echo no ;;
        *) return 1 ;;
    esac
}
ROLE_WEBSERVER="$(role_value "${ROLE_WEBSERVER:-}")" \
    || { echo "[server-setup] ERROR: ROLE_WEBSERVER must be yes, no or unset" >&2; exit 1; }
ROLE_TUNNEL="$(role_value "${ROLE_TUNNEL:-}")" \
    || { echo "[server-setup] ERROR: ROLE_TUNNEL must be yes, no or unset" >&2; exit 1; }
if [ "$ROLE_TUNNEL" = yes ] && [ "$ROLE_WEBSERVER" != yes ]; then
    echo "[server-setup] ERROR: ROLE_TUNNEL=yes needs ROLE_WEBSERVER=yes - the tunnel forwards to this machine's own sites." >&2
    exit 1
fi
if [ -n "${DEBBIE_SERVES:-}" ]; then
    echo "[server-setup] ERROR: DEBBIE_SERVES is not supported. Set ROLE_WEBSERVER=yes instead. An unset role is off." >&2
    exit 1
fi
DEPLOY_USER="${DEPLOY_USER:-srv}"
# Where the checkout lives. This default is not free to change: it has to agree
# with three other places at once, and nothing but agreement makes the deploy
# work.
#
#   - payload/assert.sh reads the same default, and its checkout and yarn-version
#     assertions look here.
#   - services/deploy.sh and services/release-poll.sh resolve
#     "${REPO_DIR:-$HOME/projects/seanorepo}" as the deploy user, which for
#     DEPLOY_USER=srv is this exact path.
#   - setup-developer-environment.sh clones the repository to this path.
REPO_DIR="${REPO_DIR:-/home/$DEPLOY_USER/projects/seanorepo}"
REPO_URL="${REPO_URL:-https://github.com/seanmizen/seanorepo.git}"
# The host deploys `release` and never `main` - REQ-DEPLOY-001. `release` moves
# only when someone runs `yarn release`. Before the first release, the branch
# does not exist, and that is a correct state.
RELEASE_BRANCH="${RELEASE_BRANCH:-release}"

log() { echo "[server-setup] $*"; }
# Fatal. Most failure paths in this script log and call exit 1 inline.
# render_unit needs a helper. scripts/lib.sh's die() runs on the operator's
# computer only, so this file has its own.
die() { echo "[server-setup] ERROR: $*" >&2; exit 1; }

# Where this script and its unit templates were unpacked. provision.sh and
# test-vm.sh both send payload/ and services/ as one tar and run this file by
# path, so $0 is real in both.
#
# NOT the checkout at $GEN_DIR. That tracks `release` by REQ-DEPLOY-001, but
# this script arrives from the branch the operator is on. If the templates came
# from the checkout, provisioning from a feature branch would look for units
# that only `release` has.
PAYLOAD_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICES_SRC="$PAYLOAD_DIR/../services"
ADMIN_PUBKEY="$PAYLOAD_DIR/seanorepo-admin.pub"

[ "$(id -u)" -eq 0 ] || { echo "must run as root (use sudo)" >&2; exit 1; }

#------------------------------------------------------------------------------
# Packages
#------------------------------------------------------------------------------
# The preseed installs avahi-daemon, avahi-utils and libnss-mdns
# (REQ-SERVER-004), so on a machine that this generation installed, apt-get
# does nothing for them. They are named here so that this script also repairs a
# machine with a different install. ufw is wanted only after the install,
# because it would close port 22 during provisioning.
#
# ca-certificates, curl and gnupg are here for the Docker step below: it
# fetches an armoured signing key over TLS and dearmors it, which needs all
# three. A Debian 13 minimal install has neither curl nor gpg.
#
# git is for the checkout further down, and a minimal install has no git
# either. ca-certificates matters twice: the clone is an anonymous HTTPS fetch
# from github.com, and on a machine with no trust store that fetch fails in a
# way that looks like a network fault.
#
# unattended-upgrades is REQ-SERVER-006 and is configured further down.
# Deliberately WITHOUT powermgmt-base. With it installed, unattended-upgrades
# skips every run while the machine is on battery. A target machine can be a
# laptop, so it has a battery, and a short mains failure would look the same
# as "patching stopped". Without the package, the answer to "is it on battery?"
# is always "do not know, continue".
log "installing packages"
apt-get update -y
apt-get install -y ufw avahi-daemon avahi-utils libnss-mdns ca-certificates curl git gnupg \
    unattended-upgrades

#------------------------------------------------------------------------------
# Hostname and mDNS - REQ-SERVER-004
#
# REPAIR, NOT RE-DO. The preseed's late_command sets both of these before the
# first boot, so on such a machine this script skips every branch here. The
# branches repair a machine with a different install, or one whose identity
# has drifted.
#
# The failure this guards against: netcfg can prefer a reverse-DNS answer over
# the preseeded hostname, split 192.168.1.182 at its first dot, and install the
# machine as `192`. A silent repair here would hide that fault. So
# payload/assert.sh also runs BEFORE this script, and "the preseed set it" and
# "this script repaired it" stay separate results.
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

# On a machine where the preseed installed avahi, it is enabled and running
# already. This line is idempotent, and it repairs a machine with a different
# install.
systemctl enable --now avahi-daemon

#------------------------------------------------------------------------------
# Power - REQ-SERVER-001
#
# A target machine can be a laptop that serves from a shelf with the lid shut.
# The default logind suspends on lid close, which takes every site down until
# someone opens the lid.
#
# The power button is the same risk. logind's default HandlePowerKey is
# `poweroff`, so a short press shuts down every hosted site. A provision.sh run
# that reports "did not come up on SSH" can be this: the machine went off while
# the script waited for it. The suspend and hibernate keys are ignored for the
# same reason: a laptop keyboard has them, and a shelf is not a desk.
#
# Nothing deliberate is lost. `systemctl poweroff` over SSH works as before,
# and a held button cuts power: the firmware's force-off after about 4 seconds
# is unconditional and never reaches logind. HandlePowerKeyLongPress is
# logind's own software long press, which is a different thing. It is set to
# `ignore` so that no press of any duration makes logind act.
#
# A drop-in, not a sed over /etc/systemd/logind.conf. A package owns the main
# file, so an upgrade can revert an edit made in place, or conflict with it. A
# drop-in states only what we override.
#
# One drop-in, rewritten in full on every run rather than appended to, so a
# second run leaves a correct file byte-identical and cannot accumulate
# duplicate keys.
#------------------------------------------------------------------------------
log "ignoring lid, idle, power, suspend and hibernate events"
install -d /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/10-debbie-nosleep.conf <<'EOF'
# Managed by utils/debbie/2026-09-17/payload/setup-server-environment.sh - REQ-SERVER-001
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
HandlePowerKey=ignore
HandlePowerKeyLongPress=ignore
HandleSuspendKey=ignore
HandleHibernateKey=ignore
IdleAction=ignore
IdleActionSec=0
EOF

# Deliberately NO restart of systemd-logind. A restart ends the calling
# session, which stops this script when it runs over SSH. logind reads the
# drop-in at the next boot, and the harness reboots before it asserts.
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

#------------------------------------------------------------------------------
# Journal size - REQ-SERVER-007
#
# Capped at 1G. The disk can be as small as 128 GB, shared with Docker images
# and the SQLite volumes. A full disk takes every site down, with a cause that
# does not look like disk space. journald's own default is 10% of the
# filesystem, capped at 4G. That is a limit by accident, and nothing on this
# machine reads that much history.
#
# A drop-in, not an edit to the package-owned journald.conf. It is rewritten in
# full, so a second run gives the same bytes. A journald restart is safe here,
# unlike logind: journald does not own the calling session, and the restart
# makes the running daemon read the new limit.
#------------------------------------------------------------------------------
log "capping the journal at 1G"
install -d /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/10-debbie-size.conf <<'EOF'
# Managed by utils/debbie/2026-09-17/payload/setup-server-environment.sh - REQ-SERVER-007
[Journal]
SystemMaxUse=1G
EOF
systemctl restart systemd-journald

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
# SSH accepts keys only - REQ-SERVER-008
#
# Port 22 is open on the LAN by REQ-SERVER-002, and the deploy account has
# passwordless sudo by REQ-SERVER-003. So a guessed password gives the whole
# host. The password path must not exist, not only be hard to use.
#
# Without this file, the property is true BY ACCIDENT. The account has a
# password hash, and PasswordAuthentication is at its compiled-in default. A
# change to sshd's packaging, or a stray drop-in, could open the password path
# again with every test green. This file states the property, and assert.sh
# checks it.
#
# A drop-in, not a sed over /etc/ssh/sshd_config. A package owns the main file,
# so an upgrade can revert an edit made in place, or conflict with it. The file
# is rewritten in full on every run, not appended to, so a repair run leaves a
# correct file with the same bytes.
#
# The name matters. sshd reads sshd_config.d/*.conf in LEXICAL order, and,
# unlike apt, the FIRST setting wins. A drop-in that sorts after one that sets
# these keys has no effect, and nothing reports it. 10- keeps this file ahead of
# anything a package ships. assert.sh reads the effective config, not this
# file, so a 05- file that shadows it fails the run.
#
# The account password is deliberately NOT locked. Console login at the
# physical keyboard is the documented recovery path if the key is lost, and
# this machine has no other out-of-band access.
#------------------------------------------------------------------------------
log "ssh accepts keys only"
install -d -m 755 /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/10-debbie-keys-only.conf <<'EOF'
# Managed by utils/debbie/2026-09-17/payload/setup-server-environment.sh - REQ-SERVER-008
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
chmod 644 /etc/ssh/sshd_config.d/10-debbie-keys-only.conf

# Check BEFORE the reload. A malformed sshd_config that is only written costs
# nothing. One that is written and then reloaded stops sshd, and this script
# runs over that SSH connection. On failure, the script removes the drop-in and
# stops with an error. The machine then accepts passwords: degraded, but
# reachable. That is the correct result on a host whose only other way in is a
# physical keyboard.
if sshd -t; then
    systemctl reload ssh
else
    log "  ERROR: sshd -t rejected the drop-in. Removing it and stopping."
    rm -f /etc/ssh/sshd_config.d/10-debbie-keys-only.conf
    exit 1
fi

#------------------------------------------------------------------------------
# Unattended security upgrades - REQ-SERVER-006
#
# Nobody logs in to this machine for months, so "I will run apt upgrade at the
# next SSH login" can mean a year or more. An unpatched host on the internet
# that nobody looks at is the worst combination.
#
# TWO THINGS MUST BOTH BE TRUE for an upgrade to happen. The usual error is to
# do only one of them:
#   - the apt configuration must permit the upgrade
#   - apt's timers must be enabled to start it
# A correct 50unattended-upgrades on a machine with apt-daily-upgrade.timer
# masked never applies a patch, and reports nothing. This script does both, and
# payload/assert.sh checks both.
#
# SECURITY SUITE ONLY. Debian's stock 50unattended-upgrades enables three
# patterns, and only two of them are security:
#
#   origin=Debian,codename=${distro_codename},label=Debian            <- NOT security
#   origin=Debian,codename=${distro_codename},label=Debian-Security
#   origin=Debian,codename=${distro_codename}-security,label=Debian-Security
#
# The first is the whole stable suite, so a stock machine installs every
# point-release update for trixie without anyone watching. This was measured: a
# --dry-run against the stock config proposed base-files, bash, libc6,
# perl-base and tzdata from `archive:stable label:Debian`. REQ-SERVER-006 asks
# for security updates only, and this host has no console attached.
#
# So this file CLEARS the list and sets one pattern. `#clear` is not a comment.
# apt.conf list syntax APPENDS, so a drop-in that only names the pattern it
# wants keeps all three of Debian's and adds a fourth duplicate. This was
# checked in a debian:trixie container: without the #clear lines,
# `Allowed origins are:` printed four entries, the non-security one included.
#
# A DROP-IN, NOT AN EDIT OF 50unattended-upgrades, for the same reason as the
# logind drop-in above. The package owns that file and regenerates it, and a
# drop-in states only what we override. 52 sorts after 50, so the override
# wins: apt reads /etc/apt/apt.conf.d in sorted order.
#
# ${distro_codename} stays a variable and is not written out as `trixie`.
# unattended-upgrades expands it against the running release, so the pattern
# works after the next dist-upgrade. A hardcoded codename would stop matching
# anything, with no report, when the machine moves to Debian 14. That is the
# failure this requirement exists to prevent.
#
# REBOOTS ARE NOT AUTOMATIC, and this is the most important line in the file.
# A machine can serve from a shelf on wifi, and an unattended reboot that does
# not bring the network back is an outage that nobody watches for. The wifi
# configuration has no proof across an unattended reboot (REQ-SERVER-005). The
# value is set EXPLICITLY to "false", not left at the package default, which is
# also false. A security property must be true on purpose, not by accident, and
# only an explicit value lets an assertion tell it apart from "nobody decided".
#
# The consequence is accepted on purpose. A kernel or libc update is downloaded
# and unpacked, but it has no effect until someone reboots the machine by hand.
# /var/run/reboot-required says so, and
# `ssh srv@<machine>.local sudo systemctl reboot` is the way to act on it.
#
# Both files are rewritten in full on every run, not appended to, so a repair
# run leaves a correct file with the same bytes and no duplicate keys.
#------------------------------------------------------------------------------
log "unattended security upgrades"

# This file makes the periodic job run at all. `dpkg-reconfigure` writes it
# from a debconf answer, but interactively, so this script writes the file
# directly. It is a generated file, not a dpkg conffile, so no upgrade prompts
# about it.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
// Managed by utils/debbie/2026-09-17/payload/setup-server-environment.sh - REQ-SERVER-006
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

cat > /etc/apt/apt.conf.d/52debbie-unattended-upgrades <<'EOF'
// Managed by utils/debbie/2026-09-17/payload/setup-server-environment.sh - REQ-SERVER-006

// apt.conf lists APPEND. Without these two lines, Debian's three stock
// patterns stay in force, and one of them is the whole stable suite, not
// security. This file would only add a fourth.
#clear Unattended-Upgrade::Allowed-Origins;
#clear Unattended-Upgrade::Origins-Pattern;

Unattended-Upgrade::Origins-Pattern {
        "origin=Debian,codename=${distro_codename}-security,label=Debian-Security";
};

// REQ-SERVER-006. Explicit, not a default. This machine can be on a shelf on
// wifi, and an unattended reboot that does not come back is an outage that
// nobody watches for. Reboot it by hand: `sudo systemctl reboot` over SSH.
Unattended-Upgrade::Automatic-Reboot "false";
EOF

# The other half. A stock Debian enables both timers, so on a healthy machine
# this line changes nothing. It repairs a machine where they are off, and it
# makes this script state the property instead of a package default.
# apt-daily.timer refreshes the package lists, and apt-daily-upgrade.timer
# starts unattended-upgrade. The second needs the first, because it can only
# install what apt knows about.
#
# Enabled, NOT --now, like the deploy poller and the tunnel below. A reboot
# follows provisioning, in both harnesses and on real hardware. A start here
# could let a catch-up run take the dpkg lock while this script installs
# cloudflared and ngrok.
systemctl enable apt-daily.timer apt-daily-upgrade.timer

#------------------------------------------------------------------------------
# setup-developer-environment.sh installs Docker, and it runs first. This
# section sets what is true only of a server: where a published port can
# listen.

#------------------------------------------------------------------------------
# Published ports bind loopback - REQ-SERVER-002
#
# THE HOLE THIS CLOSES. Docker writes its own DOCKER chain into the `nat`
# table. A container published with `-p 4000:4000` gets a DNAT rule there, and
# the kernel reads that rule BEFORE ufw's chain. Without this file, every app
# port in the 4xxx range is reachable from the LAN as soon as
# `yarn prod:docker` runs, while `ufw status` says the ports are closed. ufw
# cannot show it, because those rules are not ufw's.
#
# THE APPROACH, a deliberate choice between two. The other option is an
# explicit LAN-deny rule in DOCKER-USER, which leaves every port published to
# 0.0.0.0 and filters the packets afterwards. This file changes the DEFAULT
# ADDRESS that Docker binds a published port to, so the LAN never sees the
# port. That removes the whole class of problem, needs no rule to survive a
# reboot, and has no rule order to get wrong. It costs nothing here: every
# ingress rule in apps/cloudflared/config.yml reaches its origin as
# `http://localhost:4xxx`, and cloudflared runs as a host process. So the
# tunnel uses loopback only.
#
# `ip` is dockerd's `--ip` flag, documented as "Host IP for port publishing".
# This was checked on docker 28.5.2, not taken from the docs. With this file in
# place, `-p 4000:4000` binds 127.0.0.1:4000 and nothing else (the [::]:4000
# listener of the default goes too), and the nat DOCKER rule becomes
# `-d 127.0.0.1/32 ... -j DNAT`.
#
# WHAT IT DOES NOT DO, stated here because payload/assert.sh depends on it:
# this is a DEFAULT. A compose file that writes `"0.0.0.0:4001:4001"` names the
# address explicitly, and it publishes to the LAN. This was measured on the
# same daemon, from another host. Nothing here can stop that, so the assertion
# reads the listening sockets and the nat chain, not this file. Each compose
# file names its host address too (see .claude/rules/ports.md).
#
# WRITTEN WHOLE AND COMPARED WHOLE, with no comment in it. daemon.json is
# strict JSON, dockerd does not start on a file it cannot parse, and a
# half-merged file is a machine with no Docker. This script owns the file.
#------------------------------------------------------------------------------
DOCKER_DAEMON_JSON=/etc/docker/daemon.json

log "  docker publishes to loopback only"
install -d -m 0755 /etc/docker

# Captured BEFORE the write, for the repair path. On a new machine, docker is
# not running, and it reads this file when it starts, so no restart is needed.
# On a machine that serves sites, a CHANGED file has effect only after a
# restart, and a restart stops every running container. A restart only when
# the file changed keeps a second run of this script from interrupting
# production for no reason.
# Written as an `if`, like the stale-unit loop further down, for the same
# reason. Under `set -e`, a bare `cmd && var=1` is a trap that depends on where
# it sits, and this script must not stop because docker is not running.
docker_was_active=0
if systemctl is-active --quiet docker 2> /dev/null; then
    docker_was_active=1
fi

docker_daemon_tmp="$(mktemp)"
cat > "$docker_daemon_tmp" <<'EOF'
{
  "ip": "127.0.0.1"
}
EOF

docker_daemon_changed=0
if [ ! -f "$DOCKER_DAEMON_JSON" ] || ! cmp -s "$docker_daemon_tmp" "$DOCKER_DAEMON_JSON"; then
    log "    writing $DOCKER_DAEMON_JSON"
    install -m 0644 -o root -g root "$docker_daemon_tmp" "$DOCKER_DAEMON_JSON"
    docker_daemon_changed=1
fi
rm -f "$docker_daemon_tmp"


# Not a reload. dockerd's SIGHUP live-reload covers a named set of settings,
# and `ip` is not in it. This was measured: after the file was written and
# SIGHUP sent, a later `-p 4000:4000` bound to 0.0.0.0. Only a full restart
# moved it to 127.0.0.1. A reload here would look correct and leave the hole
# open until the next reboot.
if [ "$docker_daemon_changed" = 1 ] && [ "$docker_was_active" = 1 ]; then
    log "    restarting docker so the new default takes effect"
    systemctl restart docker
fi

#------------------------------------------------------------------------------
# Deploy user - REQ-SERVER-003
#
# The docker-ce package creates the docker group, so the group exists at this
# point. The getent guard is for the repair path: a machine can have the group
# without the engine, and a change to the package install must not remove the
# membership with no report.
#
# Membership gives root-equivalent access through the daemon socket. That is
# the purpose: the deploy runs unattended and cannot answer a sudo prompt.
#------------------------------------------------------------------------------
log "deploy user $DEPLOY_USER"
getent group docker > /dev/null || groupadd docker
id "$DEPLOY_USER" > /dev/null 2>&1 || { echo "user $DEPLOY_USER missing" >&2; exit 1; }

# usermod -aG adds to the groups, so this is safe to repeat. The new group
# does NOT appear in sessions that exist already, the one that runs this script
# included. So `docker info` without sudo works only from the next login.
# payload/assert.sh checks it over a new SSH connection after a reboot, so the
# check is correct.
usermod -aG docker,sudo "$DEPLOY_USER"

#------------------------------------------------------------------------------
# The repository checkout - REQ-DEPLOY-001
#
# setup-developer-environment.sh clones seanorepo for this user first. This
# section sets the branch: a server tracks `release`, never `main`.
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

# Every branch, full history - REQ-DEPLOY-001. setup-developer-environment.sh
# clones with --depth 1, which implies --single-branch. The refspec then names
# only main, no fetch brings `release` in, and the release poller fails on
# every run, on a machine whose provisioning passed. set-branches rewrites the
# refspec, and --unshallow gives deploy.sh the history that it diffs.
sudo -u "$DEPLOY_USER" -H git -C "$REPO_DIR" remote set-branches origin '*'
unshallow=""
if [ "$(sudo -u "$DEPLOY_USER" -H git -C "$REPO_DIR" rev-parse --is-shallow-repository)" = true ]; then
    unshallow="--unshallow"
fi

# Always fetch, after a clone or not. That makes a second run cheap and
# correct, with no second clone. --prune, so that a branch deleted upstream
# does not stay as a remote-tracking ref that a later checkout could use.
sudo -u "$DEPLOY_USER" -H git -C "$REPO_DIR" fetch --prune $unshallow origin

# `|| true` because symbolic-ref exits non-zero on a detached HEAD. That state
# is for a report, not a stop, and without this `set -e` would stop the whole
# script.
current_branch="$(sudo -u "$DEPLOY_USER" -H git -C "$REPO_DIR" symbolic-ref --short -q HEAD || true)"

if sudo -u "$DEPLOY_USER" -H git -C "$REPO_DIR" \
    rev-parse --verify --quiet "refs/remotes/origin/$RELEASE_BRANCH" > /dev/null; then
    if [ "$current_branch" = "$RELEASE_BRANCH" ]; then
        # Deliberately nothing. A second run must not move a host that is on
        # the correct branch. Between provisioning runs, the release poller
        # moves this checkout (REQ-DEPLOY-002). A reset here would undo a
        # deploy, and an unrelated repair could move production backwards.
        log "  already on $RELEASE_BRANCH - leaving the working tree alone"
    else
        # -f, like deploy.sh. The script reaches this line only when the
        # machine is NOT on the release branch: a new clone (on the default
        # branch), or one that has drifted. -f discards changes to TRACKED
        # files, which is correct on a deploy host. It keeps untracked files,
        # because there is no `git clean` here - REQ-DEPLOY-006.
        # apps/cloudflared/credentials/ is untracked on the host.
        log "  checking out $RELEASE_BRANCH (was ${current_branch:-a detached HEAD})"
        sudo -u "$DEPLOY_USER" -H git -C "$REPO_DIR" \
            checkout -f -B "$RELEASE_BRANCH" "origin/$RELEASE_BRANCH"
    fi
else
    # NOT AN ERROR, and the exit status stays zero. The first `yarn release`
    # creates `release`. Before that, a provisioned machine is correct and has
    # nothing to deploy. A branch created here would publish the current `main`
    # as if someone chose to ship it. REQ-DEPLOY-001 exists to prevent exactly
    # that.
    log "  NOTE: origin/$RELEASE_BRANCH does not exist."
    log "        This is the normal state before the first release, not a"
    log "        failure. Run 'yarn release' from a clean main on a dev machine"
    log "        to create it. Until then, the checkout stays on"
    log "        '${current_branch:-a detached HEAD}'."
fi

# Ownership of every file, not only the top directory. If someone runs
# `sudo git pull` by hand, root owns objects inside an srv-owned checkout. The
# next unattended fetch then fails on a file it cannot write, at 3am, in the
# journal, with no clear cause. -print -quit stops at the first wrong file, so
# the usual case costs one stat, and chown runs only when there is a repair to
# make.
if [ -n "$(find "$REPO_DIR" ! -user "$DEPLOY_USER" -print -quit)" ]; then
    log "  repairing ownership under $REPO_DIR"
    chown -R "$DEPLOY_USER:$deploy_group" "$REPO_DIR"
fi

if [ "$repo_cloned" = 1 ]; then
    log "  cloned at $(sudo -u "$DEPLOY_USER" -H git -C "$REPO_DIR" rev-parse --short HEAD)"
fi

#------------------------------------------------------------------------------
# The release poller, the deploy unit and the roles - REQ-DEPLOY-002
#
# Node and Yarn come from setup-developer-environment.sh. The deploy runs
# `yarn install --immutable` then `yarn prod:docker`. The system yarn gives
# control to the release that yarnPath in the repository's .yarnrc.yml names.
#------------------------------------------------------------------------------
UNIT_DIR=/usr/local/lib/systemd/system
GEN_DIR="$REPO_DIR/utils/debbie/2026-09-17"
DEPLOY_SCRIPT="$GEN_DIR/services/deploy.sh"
RELEASE_POLL_SCRIPT="$GEN_DIR/services/release-poll.sh"
HOST_TOOLS_SCRIPT="$GEN_DIR/services/host-tools.sh"
# /usr/local/lib, NOT the checkout. deploy.sh and release-poll.sh run from the
# checkout, because their job is to deploy what `release` holds. The watchdog
# is different: it must work on a machine that has never deployed. The
# checkout tracks `release` (REQ-DEPLOY-001), so a watchdog there would be
# absent on the machines whose `release` is behind. This script installs it
# from the payload instead, so it matches the provisioner that installed it.
NET_FAILOVER_DIR=/usr/local/lib/seanorepo
NET_FAILOVER_SCRIPT="$NET_FAILOVER_DIR/net-failover.sh"
# The gated upgrade of cloudflared and ngrok, from the payload for the same
# reason as the watchdog: it must work on a machine that has never deployed.
VENDOR_UPGRADE_SCRIPT="$NET_FAILOVER_DIR/vendor-upgrade.sh"

# tcp-getter runs on the host, not in a container. It reads this host's ngrok
# agent API and this host's SSH host key. So it is a host unit, like
# cloudflared and ngrok, and not a workspace in `yarn prod:docker`.
TCP_GETTER_DIR="$REPO_DIR/apps/tcp-getter"
TCP_GETTER_UNIT=custom-tcp-getter.service
# From the nodejs package that setup-developer-environment.sh installs. Stated
# absolutely because a unit gets no PATH worth trusting.
NODE_BIN=/usr/bin/node
# Must match CLOUDFLARED_UNIT in that deploy.sh. The tunnel section near the
# end of this script writes the unit. This is the name that the deploy can
# restart. payload/assert.sh checks that three names agree: the unit on disk,
# the name that deploy.sh restarts, and the name that sudo permits.
# The `custom-` prefix is REQ-SERVER-013. The name is deliberately not
# `cloudflared.service`, which would shadow a packaged unit of that name -
# REQ-SERVER-012.
CLOUDFLARED_UNIT="${CLOUDFLARED_UNIT:-custom-cloudflared.service}"

log "release poller and deploy"

# /usr/local/lib/systemd/system, not /etc/systemd/system - REQ-SERVER-011. It
# is on systemd's search path, has /usr/local meaning, and is empty on a new
# install. So `ls` there answers "what did we install?".
install -d -m 0755 "$UNIT_DIR"

units_changed=0

# Compare before the write, so a correct unit keeps the same bytes and a second
# provisioning run does not disturb systemd. The daemon-reload below then runs
# only when something changed, so a second run of this script costs nothing.
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

#------------------------------------------------------------------------------
# Render one unit from services/, then install it.
#
# The unit files live beside the scripts they run - services/deploy.sh next to
# services/custom-deploy.service. A unit is then a file systemd-analyze can
# read and git can diff, rather than a heredoc in the middle of this script.
#
# The templates come from SERVICES_SRC - the services/ directory unpacked
# beside this script, not the checkout. See the note on PAYLOAD_DIR.
#
# Substitution takes an explicit allowlist, and the render FAILS when any
# ${...} is left. envsubst would write an empty string instead. A unit with a
# blank ExecStart installs without an error and fails at runtime, and this
# generation is designed against that kind of failure. read_env refuses an
# unknown key for the same reason. An unset variable stops provisioning here,
# with an error.
#------------------------------------------------------------------------------
# An ARRAY, not a space-separated string. This script sets IFS=$'\n\t', so a
# string splits on newlines and tabs only. Every name on one line would arrive
# as one word, and ${!v} would reject it as an invalid variable name. An array
# needs no splitting.
UNIT_TEMPLATE_VARS=(
    DEPLOY_USER REPO_DIR ROLES_DIR RELEASE_POLL_SCRIPT DEPLOY_SCRIPT
    HOST_TOOLS_SCRIPT
    NET_FAILOVER_SCRIPT
    VENDOR_UPGRADE_SCRIPT
    TCP_GETTER_DIR NODE_BIN
    CLOUDFLARED_DIR CLOUDFLARED_CONFIG CLOUDFLARED_CREDS_DIR NGROK_CONFIG
)

render_unit() {
    local unit="$1" template="$SERVICES_SRC/$1" rendered v
    [ -f "$template" ] || die "no unit template at $template"
    rendered="$(cat "$template")"
    for v in "${UNIT_TEMPLATE_VARS[@]}"; do
        # Indirect expansion. An unset variable leaves the placeholder, not an
        # empty string, and the check below finds it.
        [ -n "${!v-}" ] || continue
        rendered="${rendered//\$\{$v\}/${!v}}"
    done
    case "$rendered" in
        *'${'*)
            die "$template: unresolved placeholder(s): $(printf '%s' "$rendered" \
                | grep -oE '\$\{[A-Za-z_][A-Za-z_0-9]*\}' | sort -u | tr '\n' ' ')" ;;
    esac
    printf '%s\n' "$rendered" | write_unit "$unit"
}

render_unit custom-release-poll.service

render_unit custom-release-poll.timer

render_unit custom-deploy.service

render_unit custom-host-tools.service

# custom-deploy-poll did both jobs in one unit. This script removes it, not
# only disables it: two pollers would each fetch, and custom-deploy-poll would
# deploy on a machine without the webserver role.
for old_unit in custom-deploy-poll.timer custom-deploy-poll.service; do
    if [ -f "$UNIT_DIR/$old_unit" ]; then
        log "  removing $old_unit (replaced by custom-release-poll + custom-deploy)"
        systemctl disable --now "$old_unit" 2> /dev/null || true
        rm -f "$UNIT_DIR/$old_unit"
        units_changed=1
    fi
done

# Make the role files match the settings validated at the top. Written whole,
# removed when off - never left as they were.
install -d -m 0755 "$ROLES_DIR"
for role in webserver tunnel; do
    case "$role" in
        webserver) want="$ROLE_WEBSERVER" ;;
        tunnel)    want="$ROLE_TUNNEL" ;;
    esac
    if [ "$want" = yes ]; then
        [ -e "$ROLES_DIR/$role" ] || log "  role $role: ON"
        printf '%s\n' "# Presence means this machine has the $role role. Set by setup-server-environment.sh from ROLE_* (REQ-SERVER-014)." > "$ROLES_DIR/$role"
    elif [ -e "$ROLES_DIR/$role" ]; then
        log "  role $role: OFF (was on) - removing $ROLES_DIR/$role"
        rm -f "$ROLES_DIR/$role"
    fi
done
# The roles replace this switch file, which turned the deploy on by default.
rm -f /etc/seanorepo/serving

if [ "$units_changed" = 1 ]; then
    systemctl daemon-reload
fi

# Install the host tools during provisioning, so the first login has them -
# REQ-DEPLOY-007.
# From the payload copy, because the checkout's `release` can be older than the
# script. After this, custom-host-tools.service keeps the tools current. A
# build that CI has not published is not a failure here: the next poll tries
# again.
log "  host tools (image-to-ascii)"
sudo -u "$DEPLOY_USER" -H REPO_DIR="$REPO_DIR" bash "$SERVICES_SRC/host-tools.sh" \
    || log "    host-tools.sh failed. The release poller tries again."

#------------------------------------------------------------------------------
# The sudoers drop-in - REQ-DEPLOY-005
#
# deploy.sh runs as $DEPLOY_USER and needs root for two restarts only: the
# tunnel, when apps/cloudflared/config.yml changes, and tcp-getter. This file
# grants those two commands. No wildcard, no other unit, no other verb, and no
# ALL in the command position. So the deploy does not need general root.
#
# What this file is, and what it is not. write_overrides in scripts/lib.sh has
# the installer write `$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL` to
# /etc/sudoers.d/90-$DEPLOY_USER. So on a provisioned machine, this file
# restricts nothing: the account has general passwordless root. This file makes
# the DEPLOY need only these commands, so that a tighter grant later
# (REQ-SERVER-008) does not break the deploy. This file is not the security
# boundary. A deploy that works inside it makes that boundary possible.
#
# CHECK BEFORE THE INSTALL, always. sudo does not run at all when any file in
# /etc/sudoers.d fails to parse. A direct write, checked afterwards, can lock
# every account out of root on a headless machine, the account that must fix it
# included. So: write to a temp path, run `visudo -c` against it, and install
# only when it parses. Mode 0440 root:root, which sudo requires of a drop-in.
#------------------------------------------------------------------------------
SUDOERS_DEST=/etc/sudoers.d/seanorepo-deploy
sudoers_tmp="$(mktemp)"

cat > "$sudoers_tmp" <<EOF
# Managed by utils/debbie/2026-09-17/payload/setup-server-environment.sh - REQ-DEPLOY-005.
# Two commands, both restarts. The sudoers section of that script says why.
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart $CLOUDFLARED_UNIT
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart $TCP_GETTER_UNIT
EOF

if visudo -cf "$sudoers_tmp" > /dev/null; then
    if [ ! -f "$SUDOERS_DEST" ] || ! cmp -s "$sudoers_tmp" "$SUDOERS_DEST"; then
        log "  installing $SUDOERS_DEST"
        install -m 0440 -o root -g root "$sudoers_tmp" "$SUDOERS_DEST"
    fi
else
    # Fatal, with an error. A deploy that cannot restart the tunnel serves old
    # ingress after a config.yml change, with no report. There is no correct way
    # to continue past a sudoers file that this script made and cannot parse.
    rm -f "$sudoers_tmp"
    echo "[server-setup] ERROR: the generated sudoers drop-in failed visudo -c. Not installing it." >&2
    exit 1
fi
rm -f "$sudoers_tmp"

# Enabled, NOT started. `--now` here would start a deploy during provisioning:
# a cold `yarn install` and a full docker build, in a race with the rest of this
# script and the reboot after it. OnBootSec=3min starts it after the next boot,
# and both harnesses reboot before they assert.
systemctl enable custom-release-poll.timer

if [ ! -x "$DEPLOY_SCRIPT" ] || [ ! -x "$RELEASE_POLL_SCRIPT" ]; then
    # Not fatal, and the timer stays enabled on purpose. When the checkout has
    # the scripts, the poller works with no other action.
    log "  NOTE: $DEPLOY_SCRIPT or $RELEASE_POLL_SCRIPT is not in the checkout."
    log "        This machine is on a '$RELEASE_BRANCH' that is older than the"
    log "        deploy poller, so the timer fails until the branch moves. Run"
    log "        'yarn release' from a clean main on a dev machine, then run"
    log "        this script again. Its checkout step above brings the new"
    log "        commit onto the machine."
fi

#------------------------------------------------------------------------------
# Cloudflare tunnel - REQ-NETWORK-001, REQ-NETWORK-002
#
# All public traffic arrives this way. REQ-SERVER-002 forwards no inbound
# port, and the firewall above allows four, none of them an app port. So
# without the tunnel, the machine serves nothing to the internet. The tunnel
# connects OUT to Cloudflare, and traffic comes back on that connection.
#
# FROM CLOUDFLARE'S APT REPOSITORY, NOT A BINARY COPIED IN BY HAND. A binary
# copied into /usr/local/bin is invisible to dpkg and gets no updates, except
# from cloudflared's own self-update, which can fail with no report. As a
# package, custom-vendor-upgrade.timer updates it, 7 days after a release
# (REQ-SERVER-015), and `dpkg -S` can say where it came from.
#------------------------------------------------------------------------------
CLOUDFLARED_KEYRING=/usr/share/keyrings/cloudflare-main.gpg
CLOUDFLARED_LIST=/etc/apt/sources.list.d/cloudflared.list
# `any`, NOT $VERSION_CODENAME. This is a checked fact, not a preference.
# Cloudflare's repository had no `trixie` suite when this was written
# (https://pkg.cloudflare.com/cloudflared/dists/trixie/Release gave a 404). The
# codename substitution that the Docker repository uses would make apt fail on
# every update on a trixie machine. The `any` suite exists for this case, and
# it is not a downgrade. Its main/binary-<arch>/Packages has the same bytes as
# bookworm's (same MD5), so `any` and a codename suite serve the same package.
# cloudflared is a static Go binary with no libc version to disagree about, so
# one build covers every suite.
CLOUDFLARED_SUITE="${CLOUDFLARED_SUITE:-any}"

CLOUDFLARED_DIR="$REPO_DIR/apps/cloudflared"
# REQ-NETWORK-002 - ingress comes from the repository, so a routing change is
# reviewable and revertable rather than being a file edited over SSH.
CLOUDFLARED_CONFIG="$CLOUDFLARED_DIR/config.yml"
# REQ-DEPLOY-006 - gitignored, specific to the host, and the reason deploy.sh
# has no `git clean`. Provisioning defines this path and creates the directory.
# It NEVER writes anything into it: see the note further down.
CLOUDFLARED_CREDS_DIR="$CLOUDFLARED_DIR/credentials"

log "cloudflare tunnel"

# Binary already, unlike Docker's key: `file` reports an OpenPGP Public Key,
# not ASCII armour. So there is no `gpg --dearmor` step here, and one would
# corrupt the key. It downloads to a temp file first, for the same reason as
# the Docker key: a curl that stops mid-stream must not leave a present,
# non-empty, unusable keyring that the guard then never repairs.
if [ ! -s "$CLOUDFLARED_KEYRING" ]; then
    log "  fetching Cloudflare's apt signing key"
    cf_key_tmp="$(mktemp)"
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o "$cf_key_tmp"
    install -m 0644 -o root -g root "$cf_key_tmp" "$CLOUDFLARED_KEYRING"
    rm -f "$cf_key_tmp"
fi

# Written whole and compared whole, like the Docker source list. A correct
# file keeps the same bytes, and a wrong one is replaced, not appended to. An
# append makes apt report a repository configured twice on every update, and
# payload/assert.sh counts the lines.
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
# Two daemons on one tunnel is a real failure. Cloudflare accepts both
# connections, requests go to either one, and a restart of "the tunnel" fixes
# half of them. This script checks for it and does not assume, because a
# person causes two of the three ways it happens.
#
# What the package does NOT do, checked by unpacking the .deb, not by reading
# the docs: cloudflared 2026.9.1 ships /usr/bin/cloudflared, a man page and a
# changelog, and no systemd unit. Its postinst only links
# /usr/local/bin/cloudflared -> /usr/bin/cloudflared and touches a marker file.
# So there is no packaged `cloudflared.service` to race ours, and nothing to
# mask.
#
# A `cloudflared.service` can appear anyway, so this loop exists.
# `cloudflared service install` writes one into /etc/systemd/system. That is
# the documented method, so a repair session is likely to use it.
# `cloudflared-custom.service` is the unit of an older setup.
#
# Disabled, not masked. A mask would make a later `cloudflared service
# install` fail in a way nobody would connect to this script. A disable is
# reversible, visible in `systemctl is-enabled`, and applied again on every
# provisioning run. payload/assert.sh checks the property that matters (no
# other cloudflared unit is enabled), not the mechanism.
#------------------------------------------------------------------------------
for stale_unit in cloudflared.service cloudflared-custom.service; do
    # Written as an `if`, not `[ ... ] && continue`. Under `set -e`, a bare
    # failing test at the top of a loop body is a trap that depends on where it
    # sits, and this script must not stop on one.
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
# CREDENTIAL. There is no credential in this repository, on the installer
# medium or on any command line. The tunnel's credentials file is specific to
# the host. `cloudflared tunnel create` makes it once, on a machine with a
# Cloudflare login, and someone copies it to the machine by hand. See the
# README.
#
# `install -d` sets the directory's own mode and owner and touches nothing
# inside it, so a second run cannot break a working tunnel. 0700, because the
# contents are a bearer credential for every hostname this machine serves:
# anything that can read the file can serve traffic as this machine.
#
# Only when the checkout has apps/cloudflared. On a machine whose `release` is
# older than that directory, a directory created here would be an untracked
# directory with no purpose. The unit's conditions below refuse to start
# either way.
#------------------------------------------------------------------------------
if [ -d "$CLOUDFLARED_DIR" ]; then
    install -d -o "$DEPLOY_USER" -g "$deploy_group" -m 0700 "$CLOUDFLARED_CREDS_DIR"
else
    log "  NOTE: $CLOUDFLARED_DIR is not in the checkout, so this script"
    log "        did not create the credentials directory."
fi

#------------------------------------------------------------------------------
# The unit.
#
# WorkingDirectory is necessary, and it is the least obvious line here.
# config.yml says `credentials-file: ./credentials/<uuid>.json`, a RELATIVE
# path, and cloudflared resolves it against the process's working directory,
# not against the config file. Without this line, the daemon starts, reads the
# config, and fails to find the credentials under the directory that systemd
# gave it.
#
# --no-autoupdate, for a reason, not for style. cloudflared's self-update can
# fail with no report. As a package, custom-vendor-upgrade.timer owns the
# version (REQ-SERVER-015), and a self-update would be a second mechanism that
# writes the same binary. It also runs as $DEPLOY_USER, which cannot write /usr/bin, so it
# could only fail, with no report.
#
# /usr/bin/cloudflared, not /usr/local/bin/cloudflared. The second is the link
# that the package's postinst creates. The real path means the unit does not
# depend on that link.
#------------------------------------------------------------------------------
units_changed=0

render_unit "$CLOUDFLARED_UNIT"

if [ "$units_changed" = 1 ]; then
    systemctl daemon-reload
fi

#------------------------------------------------------------------------------
# Enable it only if it can run.
#
# The test matches the unit's two Conditions exactly, on purpose. If this
# script and systemd disagreed about "ready", the machine would have an enabled
# unit that never starts, or a working tunnel that nobody enabled.
#
# Enabled, NOT --now, like the deploy poller above. A reboot follows
# provisioning, in both harnesses and on real hardware.
#
# NOT DISABLED IN THE ELSE BRANCH, deliberately. The conditions handle a
# machine whose credentials are missing: the unit stays enabled and systemd
# skips it, with no loop. A disable here would let a provisioning run that
# misread the state stop a working tunnel. The requirement is to refuse to
# enable. It is not to remove.
#
# EXIT 0 EITHER WAY. No credentials is the correct state of a new machine, like
# a missing origin/release. The script reports it with the remedy, and does not
# treat it as a provisioning failure.
#------------------------------------------------------------------------------
if [ "$ROLE_TUNNEL" != yes ]; then
    # Not the tunnel machine. If the unit is enabled or running, it stops here.
    # Two machines on one tunnel is what the role exists to prevent, and the
    # explicit setting has priority over the "never disable" rule below.
    if systemctl is-enabled --quiet "$CLOUDFLARED_UNIT" 2> /dev/null \
        || systemctl is-active --quiet "$CLOUDFLARED_UNIT" 2> /dev/null; then
        log "  ROLE_TUNNEL is not yes - stopping and disabling $CLOUDFLARED_UNIT"
        systemctl disable --now "$CLOUDFLARED_UNIT" || true
    else
        log "  not the tunnel machine (ROLE_TUNNEL unset) - $CLOUDFLARED_UNIT stays off"
    fi
elif [ -f "$CLOUDFLARED_CONFIG" ] \
    && [ -d "$CLOUDFLARED_CREDS_DIR" ] \
    && [ -n "$(ls -A "$CLOUDFLARED_CREDS_DIR" 2> /dev/null)" ]; then
    log "  credentials present - enabling $CLOUDFLARED_UNIT"
    systemctl enable "$CLOUDFLARED_UNIT"
else
    log "  NOT enabling $CLOUDFLARED_UNIT - this machine has no tunnel credentials."
    log "        This is the normal state of a new machine, not a failure. The"
    log "        credentials are specific to the host, are in no repository,"
    log "        and this script never writes them."
    log "        To finish the tunnel, on a machine with a Cloudflare login:"
    log "          cloudflared tunnel login"
    log "          cloudflared tunnel create <name>    # writes ~/.cloudflared/<uuid>.json"
    log "        then copy that file to this machine as"
    log "          $CLOUDFLARED_CREDS_DIR/<uuid>.json"
    log "        make sure the uuid matches 'tunnel:' in $CLOUDFLARED_CONFIG,"
    log "        and run this script again. It enables the unit when the"
    log "        credentials are there. See utils/debbie/2026-09-17/README.md."
fi

#------------------------------------------------------------------------------
# ngrok - remote SSH, REQ-NETWORK-005
#
# `ngrok tcp 22` is the ONLY way into this machine from outside the home
# network. There is deliberately no Cloudflare SSH tunnel. Without ngrok, the
# machine is reachable from the LAN only, and the first sign is a failed login
# from somewhere else.
#
# From ngrok's apt repository, so dpkg owns the binary, and
# custom-vendor-upgrade.timer updates it like cloudflared (REQ-SERVER-015). The package installs /usr/local/bin/ngrok and
# nothing else: no unit, no postinst. That path is the package's own choice,
# checked by unpacking ngrok_3.39.11-0_arm64.deb. So, unlike for cloudflared,
# the path is not a sign of a manual install, and payload/assert.sh asks dpkg
# who owns the file.
#
# Suite `bookworm`. ngrok publishes suites for each release up to bookworm, and
# had no `trixie` suite on 2026-09-19 (404). `buster` and `bookworm` serve the
# same 3.39.11. The newest suite is the least likely to be retired first.
#------------------------------------------------------------------------------
NGROK_KEYRING=/usr/share/keyrings/ngrok.asc
NGROK_LIST=/etc/apt/sources.list.d/ngrok.list
NGROK_SUITE="${NGROK_SUITE:-bookworm}"
NGROK_UNIT=custom-ngrok.service
deploy_home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
# ngrok v3's default config path for the user it runs as.
# `ngrok config add-authtoken <token>`, run as $DEPLOY_USER, writes exactly this
# file. So the documented setup step and the unit agree, and neither names the
# other.
NGROK_CONFIG="$deploy_home/.config/ngrok/ngrok.yml"

log "ngrok ssh tunnel"

# ASCII-armoured, and kept that way. apt reads an armoured key directly when
# the file ends in .asc, so there is no gpg --dearmor step to get wrong. It
# downloads to a temp file first, like the other keys, so a curl that stops
# mid-stream cannot leave a present, unusable keyring that the guard never
# repairs.
if [ ! -s "$NGROK_KEYRING" ]; then
    log "  fetching ngrok's apt signing key"
    ngrok_key_tmp="$(mktemp)"
    curl -fsSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc -o "$ngrok_key_tmp"
    install -m 0644 -o root -g root "$ngrok_key_tmp" "$NGROK_KEYRING"
    rm -f "$ngrok_key_tmp"
fi

ngrok_deb_line="deb [signed-by=$NGROK_KEYRING] https://ngrok-agent.s3.amazonaws.com $NGROK_SUITE main"
ngrok_repo_changed=0
if [ ! -f "$NGROK_LIST" ] || [ "$(cat "$NGROK_LIST")" != "$ngrok_deb_line" ]; then
    log "  writing $NGROK_LIST"
    printf '%s\n' "$ngrok_deb_line" > "$NGROK_LIST"
    ngrok_repo_changed=1
fi

if [ "$ngrok_repo_changed" = 1 ] \
    || ! dpkg-query -W -f='${Status}' ngrok 2> /dev/null | grep -q "^install ok installed"; then
    apt-get update -y
fi

apt-get install -y ngrok

# One agent. `ngrok service install` writes ngrok.service and is the
# documented setup, so a repair session is likely to use it.
# ngrok-custom.service is the unit of an older setup. Two agents give two
# public addresses for one sshd, and use up the free plan's session limit.
# Disabled, not masked, for the same reasons as the cloudflared loop above.
for stale_unit in ngrok.service ngrok-custom.service; do
    if systemctl cat -- "$stale_unit" > /dev/null 2>&1; then
        log "  disabling $stale_unit so it cannot race $NGROK_UNIT"
        systemctl disable --now "$stale_unit" || true
    fi
done

# The config directory, private to the deploy user. Provisioning creates the
# directory and NEVER writes the file. The authtoken is a credential for the
# ngrok account of the person who set it up, and it is in no repository.
install -d -o "$DEPLOY_USER" -g "$deploy_group" -m 0700 "$deploy_home/.config"
install -d -o "$DEPLOY_USER" -g "$deploy_group" -m 0700 "$(dirname "$NGROK_CONFIG")"

#------------------------------------------------------------------------------
# The unit.
#
# NEVER STOPS TRYING. That is the opposite of the tunnel's choice, and it is
# deliberate. The tunnel stops after five failures, because many failures
# would hide the cause. This unit is the way back in when something is wrong
# already: a network outage, a failover, or ngrok down for an hour. A unit that
# stopped before the network came back would stay down until someone rebooted
# a machine that nobody can reach. So StartLimitIntervalSec=0 and a 30s
# RestartSec: at most about 2900 lines a day, into a journal capped at 1G
# (REQ-SERVER-007).
#
# The condition refuses a machine with no token at all. That is a normal
# first-boot state, not a failure: skipped, inactive, and never looping.
#
# --log stdout: the journal is where the public address is recorded (the free
# plan changes it on every restart), and with a log destination set ngrok does
# not try to draw its console UI on a terminal it does not have.
#
# The web inspector keeps its default of 127.0.0.1:4040. Loopback only, which
# the "nothing outside the four ports listens on a non-loopback address" check
# enforces whenever the agent is running.
#------------------------------------------------------------------------------
units_changed=0

render_unit "$NGROK_UNIT"

if [ "$units_changed" = 1 ]; then
    systemctl daemon-reload
fi

# Enable only when the config has a token. This matches the condition, plus
# the one thing that a condition cannot read. Never disabled in the else
# branch, like the tunnel: a provisioning run must not stop remote access.
if [ -s "$NGROK_CONFIG" ] && grep -q "authtoken" "$NGROK_CONFIG" 2> /dev/null; then
    log "  authtoken present - enabling $NGROK_UNIT"
    systemctl enable "$NGROK_UNIT"
else
    log "  NOT enabling $NGROK_UNIT - this machine has no ngrok authtoken."
    log "        This is normal for a new machine. Until it is fixed, this"
    log "        machine CANNOT be reached over SSH from outside the LAN."
    log "        On the machine, as $DEPLOY_USER:"
    log "          ngrok config add-authtoken <token>   # dashboard.ngrok.com"
    log "        then run this script again. See utils/debbie/2026-09-17/README.md."
fi

#------------------------------------------------------------------------------
# authorized_keys, written on EVERY run - REQ-SERVER-008.
#
# With PasswordAuthentication no (REQ-SERVER-008), a file that the installer
# writes once would make one private key on one computer the only way in. If
# that key is lost, only the physical console helps, and a key rotation needs
# a reinstall.
#
# A write here makes rotation a provisioning run. The source is the admin
# public key committed beside this script, so it travels with the installer,
# and every machine trusts the same key by design. There is no key in an env
# file and nothing to remember, and a revocation is a commit that someone can
# audit.
#
# THE GUARD IS THE POINT. An authorized_keys with no valid key, on a host that
# refuses passwords, is a brick that only a monitor and a keyboard can fix. So
# the file is built in a temp file, checked for at least one key line, and only
# then installed. A missing or empty source leaves the existing file untouched
# and says so.
#------------------------------------------------------------------------------
log "authorized_keys for $DEPLOY_USER"

deploy_home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
AUTH_KEYS="$deploy_home/.ssh/authorized_keys"

if [ ! -s "$ADMIN_PUBKEY" ]; then
    log "  WARNING: no admin public key at $ADMIN_PUBKEY."
    log "           Leaving $AUTH_KEYS exactly as it is. This machine keeps"
    log "           whatever key already opens it, and gains none."
else
    # EXTRA_AUTHORIZED_KEYS holds whole public-key lines, one per line. It
    # exists for two callers. The VM harness makes a throwaway keypair, and
    # without this it would lock itself out on this run. And a machine that
    # moves to the admin key keeps the key that opens it, so the new key can
    # be PROVEN before the old one goes. A rewrite that drops the working key
    # before anybody tests the new one ends at a physical console.
    auth_tmp="$(mktemp)"
    {
        echo "# Managed by utils/debbie/2026-09-17/payload/setup-server-environment.sh - REQ-SERVER-008"
        echo "# Edit payload/seanorepo-admin.pub, not this file: a provisioning run rewrites it."
        grep -vE '^[[:space:]]*(#.*)?$' "$ADMIN_PUBKEY"
        [ -z "${EXTRA_AUTHORIZED_KEYS:-}" ] || printf '%s\n' "$EXTRA_AUTHORIZED_KEYS"
    } > "$auth_tmp"

    # At least one line that looks like a key. A count of non-comment lines is
    # not enough: a truncated file can leave a fragment that opens nothing.
    if [ "$(grep -cE '^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-|sk-)' "$auth_tmp")" -lt 1 ]; then
        rm -f "$auth_tmp"
        die "$ADMIN_PUBKEY holds no usable public key. Refusing to write $AUTH_KEYS: with passwords refused, that would lock this machine to its console."
    fi

    install -d -o "$DEPLOY_USER" -g "$deploy_group" -m 0700 "$deploy_home/.ssh"
    if [ ! -f "$AUTH_KEYS" ] || ! cmp -s "$auth_tmp" "$AUTH_KEYS"; then
        log "  writing $AUTH_KEYS ($(grep -cE '^ssh-|^ecdsa-|^sk-' "$auth_tmp") key(s))"
        install -m 0600 -o "$DEPLOY_USER" -g "$deploy_group" "$auth_tmp" "$AUTH_KEYS"
    fi
    rm -f "$auth_tmp"
fi

#------------------------------------------------------------------------------
# Every physical interface gets an address - REQ-NETWORK-003.
#
# The installer configures only the interface that it installed over. So a
# machine with two NICs starts with one configured link and one unconfigured
# link. A failover watchdog on such a machine does nothing: there is no link to
# change to.
#
# One file per interface under interfaces.d, never an edit to
# /etc/network/interfaces. The installer owns that file, and it sources this
# directory. An append to it makes two tools disagree about who owns a stanza.
#
# allow-hotplug, not auto. `auto` makes boot wait for DHCP on an interface
# whose cable may not be connected. allow-hotplug configures the interface when
# the kernel reports the link, and does nothing if it never appears.
#
# A real NIC has a device link in /sys/class/net. Loopback, docker0, bridges
# and veths do not. The watchdog uses the same test: one rule, not two lists of
# name prefixes that drift apart.
#------------------------------------------------------------------------------
log "addressing every physical interface"

install -d -m 0755 /etc/network/interfaces.d

for net_path in /sys/class/net/*; do
    net_if="$(basename "$net_path")"
    [ -e "$net_path/device" ] || continue

    # Already spoken for by the installer's own file? Leave it completely alone.
    if grep -qE "^[[:space:]]*(auto|allow-hotplug|iface)[[:space:]]+$net_if\b" \
        /etc/network/interfaces 2> /dev/null; then
        log "  $net_if is configured by the installer - leaving it alone"
        continue
    fi

    net_stanza="/etc/network/interfaces.d/$net_if"
    net_tmp="$(mktemp)"
    {
        echo "# Managed by utils/debbie/2026-09-17/payload/setup-server-environment.sh - REQ-NETWORK-003"
        echo "allow-hotplug $net_if"
        echo "iface $net_if inet dhcp"
    } > "$net_tmp"

    if [ ! -f "$net_stanza" ] || ! cmp -s "$net_tmp" "$net_stanza"; then
        log "  writing $net_stanza"
        install -m 0644 -o root -g root "$net_tmp" "$net_stanza"
        # ifup, not a restart of networking. A stop of the whole stack would
        # also stop the interface that this script arrived over.
        ifup "$net_if" > /dev/null 2>&1 || log "    $net_if did not start - no cable, or no DHCP server"
    fi
    rm -f "$net_tmp"
done

#------------------------------------------------------------------------------
# The failover watchdog - REQ-NETWORK-003.
#
# NetworkManager reacts to carrier, not to reachability. An interface with
# carrier and no upstream keeps its default route and drops every packet. That
# can make Cloudflare return Error 1033 for a site while cloudflared runs
# normally. There is no event for "has carrier, does not forward", so this is a
# timer and not a dispatcher hook.
#
# UNCONDITIONAL. No role, no config, and no interface name for each machine. A
# machine with one link runs it and finds nothing to do. A machine with two is
# protected. Interface names in an env file would leave every machine without
# that file unprotected by default.
#
# Enabled, not started. The timer's OnBootSec starts it after the reboot that
# follows provisioning. A start here would probe a network that this script
# changes.
#------------------------------------------------------------------------------
log "network failover watchdog"

install -d -m 0755 "$NET_FAILOVER_DIR"
if [ ! -f "$NET_FAILOVER_SCRIPT" ] \
    || ! cmp -s "$SERVICES_SRC/net-failover.sh" "$NET_FAILOVER_SCRIPT"; then
    log "  installing $NET_FAILOVER_SCRIPT"
    install -m 0755 -o root -g root "$SERVICES_SRC/net-failover.sh" "$NET_FAILOVER_SCRIPT"
fi

units_changed=0

render_unit custom-net-failover.service
render_unit custom-net-failover.timer

if [ "$units_changed" = 1 ]; then
    systemctl daemon-reload
fi

# The units of an older setup, if this machine has them. Two watchdogs that
# write route metrics would fight, and the last one to run wins.
for stale_unit in net-failover-custom.timer net-failover-custom.service; do
    if systemctl is-enabled --quiet "$stale_unit" 2> /dev/null \
        || systemctl is-active --quiet "$stale_unit" 2> /dev/null; then
        log "  disabling $stale_unit - custom-net-failover.timer replaces it"
        systemctl disable --now "$stale_unit" || true
    fi
done

systemctl enable custom-net-failover.timer

#------------------------------------------------------------------------------
# The gated upgrade of cloudflared and ngrok - REQ-SERVER-015.
#
# unattended-upgrades takes the Debian security suite only (REQ-SERVER-006), so
# it never updates these two vendor packages. This timer installs a new
# version when it has been the newest version for 7 days. It restarts the
# tunnel after a cloudflared install, and never restarts ngrok. See
# services/vendor-upgrade.sh for the reasons.
#
# Enabled, not started, like the other timers. Persistent=true runs a missed
# day at the next boot.
#------------------------------------------------------------------------------
log "gated upgrade of cloudflared and ngrok"

if [ ! -f "$VENDOR_UPGRADE_SCRIPT" ] \
    || ! cmp -s "$SERVICES_SRC/vendor-upgrade.sh" "$VENDOR_UPGRADE_SCRIPT"; then
    log "  installing $VENDOR_UPGRADE_SCRIPT"
    install -m 0755 -o root -g root "$SERVICES_SRC/vendor-upgrade.sh" "$VENDOR_UPGRADE_SCRIPT"
fi

units_changed=0

render_unit custom-vendor-upgrade.service
render_unit custom-vendor-upgrade.timer

if [ "$units_changed" = 1 ]; then
    systemctl daemon-reload
fi

systemctl enable custom-vendor-upgrade.timer

#------------------------------------------------------------------------------
# tcp-getter - the service that tells you the ngrok address.
#
# ngrok gives a new host:port on every agent restart, and nothing else on this
# machine reports it. Without tcp-getter, remote access works, but nobody can
# find the address. The first time you are away from home, that is the same as
# no remote access.
#
# A HOST UNIT, NOT A CONTAINER. It reads this host's ngrok agent on loopback,
# and this host's /etc/ssh/ssh_host_ed25519_key.pub to pin the host key in the
# command that it emails. A container on a bridge network reaches neither,
# unless the ngrok inspector moves off loopback and the key is mounted in.
#
# NODE, NOT BUN. Nothing provisions bun. A bun binary copied into a home
# directory has no package owner and gets no updates. The host has Node and
# yarn. Debian 13 ships Node 20, which cannot run TypeScript, so deploy.sh
# builds the workspace with rslib and this unit runs the output. CLAUDE.md
# gives bundling to the build tool, not to bun.
#------------------------------------------------------------------------------
log "tcp-getter"

units_changed=0

render_unit "$TCP_GETTER_UNIT"

if [ "$units_changed" = 1 ]; then
    systemctl daemon-reload
fi

# Enabled whenever it can run. The unit's own Conditions decide each start. So
# an enable before the .env or the build exists costs one skipped start and one
# log line, not a restart loop. Never disabled in the else branch, like the
# tunnel and ngrok: a provisioning run must not stop the report of the remote
# address.
if [ -d "$TCP_GETTER_DIR" ]; then
    log "  enabling $TCP_GETTER_UNIT"
    systemctl enable "$TCP_GETTER_UNIT"
    [ -s "$TCP_GETTER_DIR/.env" ] || {
        log "  NOTE: $TCP_GETTER_DIR/.env does not exist, so systemd skips the"
        log "        unit at boot. Copy .env.example and fill it in. Until then,"
        log "        nothing reports this machine's ngrok address."
    }
else
    log "  $TCP_GETTER_DIR is not in the checkout - nothing to enable"
fi

#------------------------------------------------------------------------------
# sshd's per-source penalties must not apply to loopback - REQ-NETWORK-005.
#
# OpenSSH 9.8 and later refuse an address for a time after failed or
# unfinished logins (PerSourcePenalties, on by default). Every ngrok connection
# reaches sshd from 127.0.0.1. So one scanner on the public ngrok address earns
# penalties for loopback, and the owner's own login, through the same tunnel
# from the same 127.0.0.1, is refused before authentication. The correct key
# does not help. With loopback exempt, the ngrok path has no per-address
# throttling, like an OpenSSH older than the feature. REQ-SERVER-008 keeps
# attackers out.
#
# LAN addresses keep their penalties. Only when sshd knows the keyword: an
# unknown keyword fails `sshd -t`, and an sshd that does not start is the one
# failure that nobody can repair on this machine remotely.
#------------------------------------------------------------------------------
NGROK_SSHD_DROPIN=/etc/ssh/sshd_config.d/20-debbie-ngrok-loopback.conf
# Matched with `case` on captured output, not `sshd -T | grep -q`. Under
# pipefail, grep -q exits at the first match, sshd gets SIGPIPE when it writes
# the rest, and the pipeline reports failure. So the result would depend on
# timing, and two VM runs of the same image can disagree.
case "$(sshd -T 2> /dev/null || true)" in
    *persourcepenaltyexemptlist*) sshd_has_penalties=yes ;;
    *) sshd_has_penalties=no ;;
esac
if [ "$sshd_has_penalties" = yes ]; then
    log "  exempting loopback from sshd per-source penalties"
    cat > "$NGROK_SSHD_DROPIN" <<'EOF'
# Managed by utils/debbie/2026-09-17/payload/setup-server-environment.sh - REQ-NETWORK-005. ngrok arrives from loopback.
PerSourcePenaltyExemptList 127.0.0.1,::1
EOF
    chmod 644 "$NGROK_SSHD_DROPIN"
    if sshd -t; then
        systemctl reload ssh
    else
        log "  ERROR: sshd -t rejected $NGROK_SSHD_DROPIN. Removing it and stopping."
        rm -f "$NGROK_SSHD_DROPIN"
        exit 1
    fi
else
    log "  sshd has no per-source penalties - nothing to exempt"
fi

# The .deb files that apt keeps after an install. Nothing reads them again, and
# the disk can be as small as 128 GB, shared with Docker images and the SQLite
# volumes.
log "clearing the apt cache"
apt-get clean

log "================================================================"
log "roles on $SERVER_NAME: webserver=$ROLE_WEBSERVER tunnel=$ROLE_TUNNEL"
[ "$ROLE_WEBSERVER" = yes ] || log "  this machine tracks release but runs NO sites (ROLE_WEBSERVER unset)"
log "================================================================"
log "done"
