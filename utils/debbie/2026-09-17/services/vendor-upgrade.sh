#!/bin/bash
# vendor-upgrade.sh: installs a new cloudflared or ngrok only when the version
# is 7 days old - REQ-SERVER-015.
#
# Where: a provisioned machine. custom-vendor-upgrade.timer runs it as root.
# When:  once a day, early in the morning.
# Why:   unattended-upgrades takes the Debian security suite only
#        (REQ-SERVER-006), so it never updates the two vendor packages. The
#        vendors put every release, security fix or feature, in one suite, so
#        apt cannot tell a security release from a bad one. cloudflared's
#        history has bad releases (2024.1.3, 2024.9.0, 2026.8.0, 2026.8.1), and
#        each one was fixed or reverted within 2 days. It has no remote
#        vulnerability in the daemon. So a version installs only after it has
#        been the newest version for MIN_AGE_DAYS.
#
# How it measures age. The vendor repositories record no publish date.
# Cloudflare's repository holds only the newest version. So the script records
# the date when it FIRST SEES each candidate version, in STATE_DIR. A newer
# version before the gate opens replaces the record and starts a new count, so
# a series of quick fixes delays the install until the releases stop.
#
# After an install:
#   - cloudflared: the script restarts custom-cloudflared.service, if it runs.
#     The restart drops requests for a few seconds, so the timer runs early.
#   - ngrok: NO restart. On the free plan, a restart gives a new public address.
#     The new version starts at the next restart of custom-ngrok.service (a
#     reboot, or a reconnect after an outage).
#
# A package that `apt-mark hold` holds is skipped, so a rollback can stay in
# place. See the README, "Upgrade or roll back cloudflared and ngrok".
#
# The script does not run `apt-get update`. apt-daily.timer refreshes the
# package lists twice a day, for every source.
#
# Environment, for tests only:
#   STATE_DIR     where the first-seen records live
#   NOW           the time, in seconds since the epoch
#   MIN_AGE_DAYS  the gate, in days
set -euo pipefail
IFS=$'\n\t'

MIN_AGE_DAYS="${MIN_AGE_DAYS:-7}"
STATE_DIR="${STATE_DIR:-/var/lib/seanorepo/vendor-upgrade}"
NOW="${NOW:-$(date +%s)}"

# package:unit. The unit is restarted after an install. Empty means no restart.
PACKAGES=(
    cloudflared:custom-cloudflared.service
    ngrok:
)

log() { echo "[vendor-upgrade] $*"; }

install -d -m 0755 "$STATE_DIR"
held="$(apt-mark showhold 2> /dev/null || true)"

for entry in "${PACKAGES[@]}"; do
    pkg="${entry%%:*}"
    unit="${entry#*:}"
    record="$STATE_DIR/$pkg"

    installed="$(dpkg-query -W -f='${Version}' "$pkg" 2> /dev/null || true)"
    if [ -z "$installed" ]; then
        log "$pkg is not installed - skipping"
        continue
    fi
    if printf '%s\n' "$held" | grep -qx "$pkg"; then
        log "$pkg is held at $installed - skipping"
        continue
    fi

    candidate="$(apt-cache policy "$pkg" | awk '/Candidate:/ { print $2; exit }')"
    if [ -z "$candidate" ] || [ "$candidate" = "(none)" ] || [ "$candidate" = "$installed" ]; then
        rm -f "$record"
        continue
    fi

    seen_version=""
    seen_at=""
    if [ -f "$record" ]; then
        # IFS is newline and tab in this script. The record is space-separated.
        IFS=' ' read -r seen_version seen_at < "$record" || true
    fi
    if [ "$seen_version" != "$candidate" ]; then
        printf '%s %s\n' "$candidate" "$NOW" > "$record"
        log "$pkg $candidate is new (installed: $installed). It installs after $MIN_AGE_DAYS days."
        continue
    fi

    age_days=$(( (NOW - seen_at) / 86400 ))
    if [ "$age_days" -lt "$MIN_AGE_DAYS" ]; then
        log "$pkg $candidate is $age_days days old - waiting for $MIN_AGE_DAYS"
        continue
    fi

    log "installing $pkg $candidate (was $installed, first seen $age_days days ago)"
    # The lock timeout lets this wait for unattended-upgrades, which can hold
    # the dpkg lock at the same time of day.
    DEBIAN_FRONTEND=noninteractive apt-get install -y -o DPkg::Lock::Timeout=600 "$pkg=$candidate"
    rm -f "$record"

    if [ -n "$unit" ] && systemctl is-active --quiet "$unit"; then
        log "restarting $unit"
        systemctl restart "$unit"
    fi
done
