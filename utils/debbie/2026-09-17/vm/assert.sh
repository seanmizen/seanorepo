#!/bin/bash
# assert.sh - run INSIDE the guest, over SSH, and say whether the box is right.
#
# Streamed in by test-vm.sh with `ssh ... 'bash -s' < assert.sh`, so it must be
# self-contained: no arguments, no files alongside it, nothing from the repo.
#
# Exit 0 only if every check passes. This is what makes the harness report by
# exit code rather than by a human reading a console - REQ-EMU-003.
#
# Every check is architecture-neutral. The arm64 run and the amd64 run assert
# exactly the same things; where a name differs by arch (the EFI loader) the
# check globs rather than branching.
#
# PHASE says WHEN this is running, and it is the whole point of #285.
#
#   firstboot    the installed system has booted and nothing has been run on it
#                by hand. Only what the INSTALLER produced may be asserted.
#   provisioned  postinstall.sh has run and the box has rebooted. Everything.
#
# Without that split, a bug the installer creates and postinstall.sh repairs is
# invisible: every assertion ran after the repair, so the box was right by the
# time anything looked, and wrong in between. The hostname was `192` for the
# whole of that window and no run ever went red. A check that passes in
# `provisioned` and fails in `firstboot` is precisely "postinstall repaired it",
# and that is now a distinguishable, reportable state rather than a silence.
set -uo pipefail

EXPECT_ARCH="${EXPECT_ARCH:-}"
EXPECT_HOSTNAME="${EXPECT_HOSTNAME:-debbie}"
DEPLOY_USER="${DEPLOY_USER:-srv}"
PHASE="${PHASE:-provisioned}"
# Must match the default in scripts/postinstall.sh. The checkout itself arrives
# in #278; until then the yarn-version check skips rather than fails, and prints
# the path it looked at so a disagreement between the two files is visible.
REPO_DIR="${REPO_DIR:-/home/$DEPLOY_USER/projects/seanorepo}"

case "$PHASE" in
    firstboot | provisioned) ;;
    *) echo "assert.sh: PHASE must be 'firstboot' or 'provisioned', not '$PHASE'" >&2; exit 2 ;;
esac

pass=0
fail=0
skip=0

ok()   { printf '  \033[32m/\033[0m %s\n' "$1"; pass=$((pass + 1)); }
no()   { printf '  \033[31mX\033[0m %s\n' "$1"; fail=$((fail + 1)); }
sk()   { printf '  \033[33m-\033[0m %s \033[33m(skipped: %s)\033[0m\n' "$1" "$2"; skip=$((skip + 1)); }
# The eval runs in a SUBSHELL, deliberately. `eval` in the current shell lets a
# check containing `exit` terminate assert.sh itself: the checks after it never
# run, the summary never prints, and the script exits with whatever that `exit`
# said - reporting success for assertions that were never made. That happened.
# A wireless check written with a bare `exit 0` silently skipped the whole
# firewall section on real hardware and returned 0, and because QEMU has no
# 802.11 device the guarded branch made it unreachable in every VM run, so no
# amount of green in the harness could have caught it.
#
# Subshelling here fixes the whole class rather than that one call site.
check() { if ( eval "$2" ) > /dev/null 2>&1; then ok "$1"; else no "$1"; fi; }

# Stated up front so a pasted log says which of the two runs it came from. The
# same check name means different things in each, which is the entire point.
if [ "$PHASE" = firstboot ]; then
    echo "### PHASE=firstboot - asserting what the INSTALLER produced."
    echo "### postinstall.sh has NOT run. A failure below is an install bug."
else
    echo "### PHASE=provisioned - asserting the provisioned box."
fi

echo
echo "== system =="
if [ -n "$EXPECT_ARCH" ]; then
    # Catches a harness mix-up: the wrong netboot images for the chosen guest.
    check "architecture is $EXPECT_ARCH" "[ \"\$(dpkg --print-architecture)\" = '$EXPECT_ARCH' ]"
fi
check "Debian 13 (trixie)"        '. /etc/os-release; [ "$VERSION_CODENAME" = trixie ]'
check "timezone is Europe/London" '[ "$(timedatectl show -p Timezone --value)" = Europe/London ]'
check "DNS and routing work"      'getent hosts deb.debian.org'

# REQ-SERVER-004 - #285. Asserted in BOTH phases, which is the fix: in
# `firstboot` nothing but the installer has touched the box, so a pass here
# means the preseed produced a usable identity, and a failure here followed by
# a pass in `provisioned` means postinstall.sh papered over it.
#
# The hostname is checked three ways because the failure mode split them: the
# running hostname, the static one in /etc/hostname, and the 127.0.1.1 line.
# The real box had `192` in all three; a box repaired by hostnamectl alone
# would have the first two right and the third stale.
echo
echo "== identity (REQ-SERVER-004) =="
check "hostname is $EXPECT_HOSTNAME" \
    "[ \"\$(hostname)\" = '$EXPECT_HOSTNAME' ]"
check "static hostname is $EXPECT_HOSTNAME" \
    "[ \"\$(hostnamectl --static)\" = '$EXPECT_HOSTNAME' ]"
# Accepts either separator - late_command writes a space, postinstall.sh a tab.
check "127.0.1.1 maps to $EXPECT_HOSTNAME" \
    "grep -qE '^127\.0\.1\.1[[:space:]]+$EXPECT_HOSTNAME([[:space:]]|\$)' /etc/hosts"
check "no leftover 127.0.1.1 line" \
    '[ "$(grep -c "^127\.0\.1\.1" /etc/hosts)" -eq 1 ]'
check "avahi-daemon installed"    'dpkg-query -W -f="\${Status}" avahi-daemon 2>/dev/null | grep -q "^install ok installed"'
check "libnss-mdns installed"     'dpkg-query -W -f="\${Status}" libnss-mdns 2>/dev/null | grep -q "^install ok installed"'
check "nsswitch resolves .local via mdns" 'grep -qE "^hosts:.*mdns" /etc/nsswitch.conf'
check "avahi-daemon enabled"      'systemctl is-enabled avahi-daemon'
check "avahi-daemon active"       'systemctl is-active avahi-daemon'
# The one check that exercises the whole path rather than its parts. nss-mdns
# asks the local avahi-daemon, which answers for the name it publishes, so this
# proves the box would answer to $EXPECT_HOSTNAME.local - see the README for
# what it does NOT prove, which is that another machine on the LAN can hear it.
check "$EXPECT_HOSTNAME.local resolves" \
    "getent hosts '$EXPECT_HOSTNAME.local' || avahi-resolve -n '$EXPECT_HOSTNAME.local'"

echo
echo "== boot chain =="
# The reason the harness uses pflash rather than -bios: without a writable
# variable store the installer's boot entry is discarded and none of this holds.
check "booted via UEFI"           '[ -d /sys/firmware/efi ]'
check "ESP is mounted"            'findmnt -no TARGET /boot/efi'
# The ESP is vfat mounted umask=0077, so only root can traverse it. Without
# sudo these read as permission denied, which a [ -f ] test cannot tell apart
# from the file genuinely being absent - the box boots through GRUB either way.
check "grub EFI config present"   'sudo -n test -f /boot/efi/EFI/debian/grub.cfg'
# Globbed on purpose: BOOTAA64.EFI on arm64, BOOTX64.EFI on amd64. The glob has
# to be expanded by root inside sh -c: an unprivileged shell cannot expand it
# against an unreadable directory and would hand ls the literal pattern.
check "removable-path loader"     'sudo -n sh -c "ls /boot/efi/EFI/BOOT/BOOT*.EFI"'
check "fstab mounts by UUID"      'grep -q "^UUID=" /etc/fstab'

echo
echo "== services =="
check "systemd reached a steady state" 'systemctl is-system-running --wait | grep -qE "running|degraded"'
check "ssh enabled"               'systemctl is-enabled ssh'
check "ssh active"                'systemctl is-active ssh'
check "headless (no display manager)" '! systemctl list-unit-files | grep -qE "^(gdm3?|sddm|lightdm)\.service"'

echo
echo "== provisioning =="
# REQ-SERVER-003. The user, its sudo membership and the sudoers drop-in all
# come from the preseed, so they hold in both phases.
check "user $DEPLOY_USER exists"  "id '$DEPLOY_USER'"
check "$DEPLOY_USER in sudo"      "id -nG '$DEPLOY_USER' | tr ' ' '\n' | grep -qx sudo"
check "passwordless sudo works"   'sudo -n true'

if [ "$PHASE" = provisioned ]; then
    # The docker group does not exist at install time - postinstall.sh installs
    # the engine, whose package creates it. Skipped rather than failed at first
    # boot, because its absence there is correct rather than a regression.
    #
    # This check alone is NOT evidence that Docker works - see the docker
    # section below, which is what #276 added after this one spent a generation
    # passing against an empty group.
    check "$DEPLOY_USER in docker" "id -nG '$DEPLOY_USER' | tr ' ' '\n' | grep -qx docker"

    # REQ-SERVER-001 - asserted after a reboot, which is when the drop-in takes
    # effect. postinstall.sh deliberately does not restart logind.
    check "lid-close drop-in present" '[ -f /etc/systemd/logind.conf.d/10-debbie-nosleep.conf ]'
    check "lid close ignored"         '[ "$(loginctl show-seat seat0 -p IdleAction --value 2>/dev/null || busctl get-property org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager HandleLidSwitch 2>/dev/null | awk "{print \$2}" | tr -d \")" = ignore ] || grep -q "^HandleLidSwitch=ignore" /etc/systemd/logind.conf.d/10-debbie-nosleep.conf'
    check "sleep.target masked"       '[ "$(systemctl is-enabled sleep.target 2>&1)" = masked ]'
else
    sk "$DEPLOY_USER in docker"   "postinstall.sh creates the group"
    sk "lid-close drop-in present" "postinstall.sh writes it"
    sk "lid close ignored"         "postinstall.sh writes it"
    sk "sleep.target masked"       "postinstall.sh masks it"
fi

# REQ-DEPLOY-004 - the deploy is `yarn prod:docker`, so the engine has to be
# there and has to be usable by the account the deploy runs as.
#
# The membership check above is deliberately not repeated here, because on its
# own it proves nothing: a group can exist with no daemon behind it, and for a
# generation that is exactly what it asserted. `docker info` is the check that
# cannot be satisfied by an empty group - it opens /var/run/docker.sock and
# asks the daemon its version.
#
# Run WITHOUT sudo, on purpose. `sudo docker info` would pass on a box where
# the deploy user has no access at all, which is the failure this is for.
# assert.sh arrives over a fresh SSH connection, so the session carries the
# docker group; a session that predates `usermod -aG` would not, and the right
# answer to that is to log in again rather than to reach for sudo.
echo
echo "== docker (REQ-DEPLOY-004) =="
if [ "$PHASE" = provisioned ]; then
    check "docker-ce installed" \
        'dpkg-query -W -f="\${Status}" docker-ce 2>/dev/null | grep -q "^install ok installed"'
    check "apt keyring present"       '[ -s /etc/apt/keyrings/docker.gpg ]'
    # Idempotency, asserted rather than assumed. postinstall.sh runs more than
    # once on any box that is ever repaired, and the classic way to write this
    # step is an append, which leaves apt warning about a doubly-configured
    # repository on every update. One line is the whole claim.
    check "exactly one docker apt source" \
        '[ "$(grep -rhsE "^deb .*download\.docker\.com" /etc/apt/sources.list /etc/apt/sources.list.d/ | wc -l)" -eq 1 ]'
    check "docker.service enabled"    'systemctl is-enabled docker'
    check "docker.service active"     'systemctl is-active docker'
    # --format, not a bare `docker info`: it makes the check depend on an
    # answer from the daemon rather than on an exit code, and a client that
    # cannot reach the socket prints its error to stderr and yields nothing.
    check "docker info works as $DEPLOY_USER without sudo" \
        '[ -n "$(docker info --format "{{.ServerVersion}}" 2>/dev/null)" ]'
    # `docker compose`, not `docker-compose`. yarn prod:docker calls the v2
    # plugin, so the v1 python script being present would not help.
    check "docker compose plugin present" 'docker compose version'
else
    sk "docker-ce installed"          "postinstall.sh installs it"
    sk "apt keyring present"          "postinstall.sh fetches it"
    sk "exactly one docker apt source" "postinstall.sh writes it"
    sk "docker.service enabled"       "postinstall.sh installs it"
    sk "docker.service active"        "postinstall.sh installs it"
    sk "docker info works as $DEPLOY_USER without sudo" "postinstall.sh installs it"
    sk "docker compose plugin present" "postinstall.sh installs it"
fi

# REQ-DEPLOY-004 - the other half of `yarn prod:docker`. Docker above proves the
# box can run the containers; this proves it can get as far as asking.
#
# Everything here runs as $DEPLOY_USER over a fresh SSH connection, WITHOUT
# sudo, on purpose. The failure being guarded is a yarn that only root can
# reach, or one that is on PATH for an interactive login and not for the
# non-interactive shell the deploy timer actually uses.
echo
echo "== node and yarn (REQ-DEPLOY-004) =="
if [ "$PHASE" = provisioned ]; then
    check "node 20 installed"         'node --version | grep -qE "^v20\."'
    check "corepack installed" \
        'dpkg-query -W -f="\${Status}" node-corepack 2>/dev/null | grep -q "^install ok installed"'
    # THE point of #277, stated as something that can fail. `npm install -g
    # yarn` puts a real Yarn 1 tarball in /usr/local/bin, which precedes
    # /usr/bin on PATH, so the box would run Yarn 1 against a Yarn 4
    # repository while `command -v yarn` still answered. Resolving the shim
    # tells the two apart: corepack's is a symlink into its own dist, an
    # npm-installed one is not, and because `command -v` takes whichever comes
    # first on PATH this also catches the shadowing case rather than just the
    # replacing one.
    check "yarn is corepack's shim, not a global npm install" \
        'readlink -f "$(command -v yarn)" | grep -q corepack'
    # No version is written here either. The expected value is read out of the
    # repository's own packageManager field at assertion time, so this check
    # cannot drift from the repo any more than postinstall.sh can - if the repo
    # bumps Yarn, both sides move together and nothing needs editing.
    if [ -f "$REPO_DIR/package.json" ]; then
        check "yarn --version matches the repo's packageManager" \
            'want=$(sed -n "s/.*\"packageManager\"[[:space:]]*:[[:space:]]*\"yarn@\([^\"+]*\).*/\1/p" "$REPO_DIR/package.json" | head -1); [ -n "$want" ] && [ "$(cd "$REPO_DIR" && yarn --version)" = "$want" ]'
    else
        sk "yarn --version matches the repo's packageManager" \
            "no checkout at $REPO_DIR - #278 clones it"
    fi
else
    sk "node 20 installed"            "postinstall.sh installs it"
    sk "corepack installed"           "postinstall.sh installs it"
    sk "yarn is corepack's shim, not a global npm install" "postinstall.sh enables it"
    sk "yarn --version matches the repo's packageManager"  "postinstall.sh enables it"
fi

# REQ-SERVER-005 - only meaningful on a wireless host. Skipped rather than
# passed in a VM: QEMU has no 802.11 device the installer would drive, so a
# green VM run says nothing at all about this and must not pretend otherwise.
echo
echo "== network =="
if [ -n "$(ls -d /sys/class/net/*/wireless 2> /dev/null)" ]; then
    # netcfg persists wifi as an ifupdown stanza plus wpasupplicant in the
    # target. Either that, or a NetworkManager profile once REQ-NETWORK-* lands.
    check "wifi config persisted" \
        'sudo -n grep -rqs "wpa-ssid\|wpa-psk" /etc/network/interfaces /etc/network/interfaces.d/ \
         || sudo -n grep -rqs "^ssid=\|wifi.ssid" /etc/NetworkManager/system-connections/'
    # No `exit` in here either, subshell or not: a loop that sets a flag says
    # what it means, and cannot be broken by a later change to how check() runs.
    check "a wireless interface has an address" \
        'found=1; for w in /sys/class/net/*/wireless; do i=$(basename "$(dirname "$w")"); if ip -4 -o addr show "$i" | grep -q inet; then found=0; fi; done; [ "$found" = 0 ]'
else
    sk "wifi config persisted" "no wireless interface"
fi

# REQ-SERVER-011 / REQ-SERVER-012 - where our units live, and what they must
# not displace. Both are cheap to assert and easy to regress: the obvious place
# to drop a new unit is /etc/systemd/system, and the obvious name for a unit
# that configures cloudflared is cloudflared.service.
echo
echo "== systemd unit layout =="
# `-type f` is the whole trick, and it is exact rather than approximate: on a
# stock Debian 13 host the top level of /etc/systemd/system contains no regular
# files at all. Everything legitimately there is a symlink - a dbus alias into
# /usr/lib/systemd/system, or a mask pointing at /dev/null - or a directory,
# either <unit>.d/ or <target>.wants/. So any regular unit file appearing here
# was put there by us, and that is precisely the violation. Verified on the
# real box: `find /etc/systemd/system -maxdepth 1 -type f` returns nothing.
#
# An earlier draft filtered by modification time instead. That would have
# rotted the moment the hardcoded date passed, and would have missed a unit
# restored from a backup with an old mtime.
check "no repo units in /etc/systemd/system" \
    '! find /etc/systemd/system -maxdepth 1 -type f \( -name "*.service" -o -name "*.timer" -o -name "*.socket" \) | grep -q .'
# REQ-SERVER-013. Vacuously true until the first unit is installed, which is
# fine: it becomes load-bearing exactly when there is something to get wrong.
check "repo units are prefixed custom-" \
    'for f in /usr/local/lib/systemd/system/*.service /usr/local/lib/systemd/system/*.timer; do [ -e "$f" ] || continue; case "$(basename "$f")" in custom-*) ;; *) exit 1 ;; esac; done; true'
# A filename present in both directories means ours silently wins.
check "no shadowed package units" \
    'for f in /usr/local/lib/systemd/system/*; do [ -e "$f" ] || continue; b=$(basename "$f"); if [ -e "/usr/lib/systemd/system/$b" ]; then exit 1; fi; done; true'

# REQ-SERVER-002 - exactly four ports, nothing else. An extra open port is a
# failure, not a curiosity, so the count is asserted as well as the members.
#
# ufw is installed and enabled by postinstall.sh, on purpose: enabling it
# during the install would close 22 before anything could provision the box.
echo
echo "== firewall =="
if [ "$PHASE" = provisioned ]; then
    check "ufw active"                'sudo -n ufw status | grep -q "Status: active"'
    check "22 open"                   'sudo -n ufw status | grep -q "^22/tcp"'
    check "80 open"                   'sudo -n ufw status | grep -q "^80/tcp"'
    check "443 open"                  'sudo -n ufw status | grep -q "^443/tcp"'
    check "5353 open"                 'sudo -n ufw status | grep -q "^5353/udp"'
    # ufw prints a v4 rule and a matching "(v6)" rule for every allow, so a
    # naive line count sees eight where four were asked for. Count v4 only.
    check "no other ports open"       '[ "$(sudo -n ufw status | grep -E "^[0-9]+/(tcp|udp)" | grep -vc "(v6)")" -eq 4 ]'
else
    sk "ufw active" "postinstall.sh installs and enables it"
fi

echo
if [ "$skip" -gt 0 ]; then
    echo "passed $pass, failed $fail, skipped $skip"
else
    echo "passed $pass, failed $fail"
fi
[ "$fail" -eq 0 ]
