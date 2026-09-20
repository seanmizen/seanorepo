#!/bin/bash
# assert.sh: checks a target machine against the requirements, and exits 0
# only if every check passes.
#
# Where: on the target machine. provision.sh and test-vm.sh send it over SSH
#        (`bash -s`), so it must not read any file beside it.
# When:  twice in each run:
#          1. PHASE=firstboot, before setup-server-environment.sh. It checks only what the
#             installer produced.
#          2. PHASE=provisioned, after setup-server-environment.sh and a reboot. It checks
#             everything.
# Why:   the exit code is the result, so nobody must read a console
#        (REQ-EMU-003). A check that fails in firstboot and passes in
#        provisioned shows a fault that setup-server-environment.sh repaired
#        (REQ-SERVER-004).
#
# Every check is the same on arm64 and amd64. Where a name differs by
# architecture, the check uses a glob.
set -uo pipefail

EXPECT_ARCH="${EXPECT_ARCH:-}"
# No default - #329. provision.sh and test-vm.sh always pass it.
EXPECT_HOSTNAME="${EXPECT_HOSTNAME:?EXPECT_HOSTNAME must be set - the name this machine should have}"
DEPLOY_USER="${DEPLOY_USER:-srv}"
PHASE="${PHASE:-provisioned}"
# Must match the default in payload/setup-developer-environment.sh, which clones here, and the
# path 2025-10-08b/scripts/deploy.sh resolves as the deploy user. A check that
# depends on the checkout and cannot find one SKIPS with the path it looked at
# printed, so a disagreement between the three is visible rather than silent.
REPO_DIR="${REPO_DIR:-/home/$DEPLOY_USER/projects/seanorepo}"
RELEASE_BRANCH="${RELEASE_BRANCH:-release}"

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

# logind's LIVE view of one of its Handle* properties, printed bare.
#
# `busctl get-property ... HandlePowerKey` answers `s "ignore"`, which is the
# same text #283 quoted off the real machine when it still said `poweroff`. This is
# the running configuration, not the file: a drop-in that was written but never
# read still reports the compiled-in default here, which is exactly the state
# that took the machine down twice and exactly why REQ-SERVER-001 is asserted only
# after a reboot.
#
# Deliberately NOT `loginctl show-session`. debbie is headless and assert.sh
# arrives over SSH, so there is no seat and no graphical session to interrogate;
# the manager object exists whether anyone is logged in or not. Equally
# deliberately, there is no fall back to grepping the drop-in - a file that
# logind has not read is the bug, so a check satisfied by the file's contents
# would pass in the failing state.
# sshd's OWN value for one keyword, lowercased and printed bare.
#
# `sshd -T` is sshd parsing its own configuration exactly as it will at the next
# connection, drop-ins and Match blocks and lexical precedence all resolved. It
# is therefore the EFFECTIVE configuration, not a file: a keyword set in a
# drop-in that sorts too late, or under a filename sshd never globs, reports the
# compiled-in default here while `grep` on that file is perfectly happy.
#
# That is #283's and #313's lesson applied to sshd, and it is why there is
# deliberately no fall back to grepping 10-debbie-keys-only.conf. A drop-in that
# sshd has not read is precisely the bug REQ-SERVER-008 exists to catch, so a
# check the file could satisfy would pass in the failing state.
sshd_effective() {
    # sudo: sshd is in /usr/sbin, off the deploy user's PATH, and needs root
    # to read the host keys - #320.
    sudo -n sshd -T 2> /dev/null | awk -v k="$(printf '%s' "$1" | tr 'A-Z' 'a-z')" \
        'tolower($1) == k { print tolower($2); exit }'
}

# journald's OWN size limit for the persistent journal, as the running daemon
# reported it, e.g. `1.0G`.
#
# journald logs "System Journal (...) is 8.0M, max 1.0G, 990.1M free." each
# time it opens /var/log/journal, and the `max` there is the limit it computed
# from its configuration. That is the effective value, not the drop-in: a file
# journald never read reports the default here (10% of the filesystem), which
# is #313's lesson applied to journald. The last such line of this boot is the
# current daemon's.
#
# Matched by syslog identifier, not `-u`: journald's reports about its own
# files are not reliably tagged with its unit. The size is printed as `1.0G` or
# `1G` depending on the systemd version, so both count.
journal_usage_line() {
    sudo -n journalctl -b -t systemd-journald -o cat --no-pager 2> /dev/null |
        grep -E '^System Journal .* max ' | tail -n 1
}
journal_max_use() {
    journal_usage_line | sed -n 's/.* max \([0-9.]*[KMGT]\).*/\1/p' | sed 's/\.0\([KMGT]\)$/\1/'
}

logind_handler() {
    busctl get-property org.freedesktop.login1 /org/freedesktop/login1 \
        org.freedesktop.login1.Manager "$1" 2>/dev/null |
        awk '{print $2}' | tr -d '"'
}

# apt's OWN value for one configuration key, printed bare, or EMPTY if nothing
# under /etc/apt/apt.conf.d sets it.
#
# `apt-config shell` is apt's parser reading apt's own configuration tree, which
# is the same tree unattended-upgrades reads - it asks python-apt for
# `Unattended-Upgrade::Automatic-Reboot` and gets whatever this prints. So this
# is the EFFECTIVE configuration, not a file: a key in a file apt never reads -
# wrong directory, wrong name, or a syntax error earlier in the file that made
# apt discard the rest - reports empty here while `grep` on that file is
# perfectly happy. That is #283's and #313's lesson applied to apt, and it is
# why there is deliberately no fall back to grepping 50unattended-upgrades.
#
# Empty for an unset key is the whole point for REQ-SERVER-006. The package
# default for Automatic-Reboot is already false, so a check that accepted
# "false or unset" would pass on a machine where nobody had ever considered the
# question - which is precisely the state the requirement forbids.
apt_config_value() {
    local value=
    eval "$(apt-config shell value "$1" 2> /dev/null)"
    printf '%s' "$value"
}

# unattended-upgrades' OWN list of the suites it will upgrade from, expanded.
#
# `--dry-run --debug` prints "Allowed origins are: ..." with ${distro_codename}
# already substituted against the running release. That substitution happens
# nowhere else and is visible nowhere else: apt-config reports the literal
# "${distro_codename}", so a pattern hardcoded to the wrong codename -
# `bookworm-security` on a trixie machine, which is what half the tutorials online
# will hand you - reads as perfectly well-formed there while matching nothing
# at all in reality.
#
# `grep -m1` closes the pipe on the first match, so unattended-upgrade dies of
# SIGPIPE on its next debug line, which is the one immediately after. That is
# deliberate and load-bearing: a --dry-run allowed to finish DOWNLOADS every
# candidate .deb, and an assertion that fetches packages is changing the machine it
# claims to be describing. Measured at about a second, with no Get: lines.
unattended_upgrade_origins() {
    sudo -n unattended-upgrade --dry-run --debug 2> /dev/null |
        grep -m1 '^Allowed origins are: ' |
        sed 's/^Allowed origins are: //'
}

# Stated up front so a pasted log says which of the two runs it came from. The
# same check name means different things in each, which is the entire point.
if [ "$PHASE" = firstboot ]; then
    echo "### PHASE=firstboot - asserting what the INSTALLER produced."
    echo "### setup-server-environment.sh has NOT run. A failure below is an install bug."
else
    echo "### PHASE=provisioned - asserting the provisioned machine."
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
# `firstboot` nothing but the installer has touched the machine, so a pass here
# means the preseed produced a usable identity, and a failure here followed by
# a pass in `provisioned` means setup-server-environment.sh papered over it.
#
# The hostname is checked three ways because the failure mode split them: the
# running hostname, the static one in /etc/hostname, and the 127.0.1.1 line.
# The real machine had `192` in all three; a machine repaired by hostnamectl alone
# would have the first two right and the third stale.
echo
echo "== identity (REQ-SERVER-004) =="
check "hostname is $EXPECT_HOSTNAME" \
    "[ \"\$(hostname)\" = '$EXPECT_HOSTNAME' ]"
check "static hostname is $EXPECT_HOSTNAME" \
    "[ \"\$(hostnamectl --static)\" = '$EXPECT_HOSTNAME' ]"
# Accepts either separator - late_command writes a space, setup-server-environment.sh a tab.
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
# proves the machine would answer to $EXPECT_HOSTNAME.local - see the README for
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
# from the file genuinely being absent - the machine boots through GRUB either way.
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
    # The docker group does not exist at install time - setup-developer-environment.sh installs
    # the engine, whose package creates it. Skipped rather than failed at first
    # boot, because its absence there is correct rather than a regression.
    #
    # This check alone is NOT evidence that Docker works - see the docker
    # section below, which is what #276 added after this one spent a generation
    # passing against an empty group.
    check "$DEPLOY_USER in docker" "id -nG '$DEPLOY_USER' | tr ' ' '\n' | grep -qx docker"

    # REQ-SERVER-001 - asserted after a reboot, which is when the drop-in takes
    # effect. setup-server-environment.sh deliberately does not restart logind.
    check "lid-close drop-in present" '[ -f /etc/systemd/logind.conf.d/10-debbie-nosleep.conf ]'
    # #313. Asked of the running manager via logind_handler, like the keys
    # below, with no fall back to the drop-in's text: a file logind never read
    # is the fault. setup-server-environment.sh sets all three lid handlers, so all three
    # are asserted - on external power or docked, logind consults the latter
    # two instead of HandleLidSwitch. HandleLidSwitchDocked already defaults
    # to `ignore` in systemd, so that one is a regression guard and cannot be
    # shown red by removing its line; the other two default to suspending.
    check "lid close ignored"         '[ "$(logind_handler HandleLidSwitch)" = ignore ]'
    check "lid close on power ignored" '[ "$(logind_handler HandleLidSwitchExternalPower)" = ignore ]'
    check "lid close docked ignored"  '[ "$(logind_handler HandleLidSwitchDocked)" = ignore ]'
    check "sleep.target masked"       '[ "$(systemctl is-enabled sleep.target 2>&1)" = masked ]'
    # #283. The lid was covered and the power button was not, so systemd's
    # default of HandlePowerKey=poweroff stood: a brief press cleanly shut the
    # whole machine down, twice in one evening. Asserted against the running
    # manager, so `poweroff` here fails the run.
    check "power key ignored"         '[ "$(logind_handler HandlePowerKey)" = ignore ]'
    # Not `poweroff`. The deliberate shutdown path is `systemctl poweroff` over
    # SSH; the emergency one is the firmware's own force-off, which holds the
    # rail down without consulting logind. Setting this to poweroff would only
    # re-open the hole for anyone who held the button a moment too long.
    check "long power press ignored"  '[ "$(logind_handler HandlePowerKeyLongPress)" = ignore ]'
    check "suspend key ignored"       '[ "$(logind_handler HandleSuspendKey)" = ignore ]'
    check "hibernate key ignored"     '[ "$(logind_handler HandleHibernateKey)" = ignore ]'

    # REQ-SERVER-007, #287. Read from the running journald, not the drop-in.
    check "journald size capped"      '[ "$(journal_max_use)" = 1G ]'
    echo "      journald reports: $(journal_usage_line || true)"

    # REQ-SERVER-008, #288. Asked of sshd, not of the drop-in - a file sshd
    # never read is the fault being tested for. `no` exactly, never "no or
    # unset": measured on stock trixie, `sshd -T` reports
    # PasswordAuthentication=yes and PermitRootLogin=without-password, so an
    # unset key here IS the failing state for both.
    #
    # KbdInteractiveAuthentication already defaults to `no` on trixie, so that
    # one check is a regression guard rather than a reproduction - it cannot be
    # shown red by removing the drop-in. The other two can, and were.
    check "sshd config is valid"           'sudo -n sshd -t'
    check "ssh passwords refused"          '[ "$(sshd_effective PasswordAuthentication)" = no ]'
    check "ssh keyboard-interactive refused" '[ "$(sshd_effective KbdInteractiveAuthentication)" = no ]'
    check "ssh root login refused"         '[ "$(sshd_effective PermitRootLogin)" = no ]'
    check "ssh still accepts keys"         '[ "$(sshd_effective PubkeyAuthentication)" = yes ]'
    check "$DEPLOY_USER has an authorized key" \
        "sudo test -s /home/$DEPLOY_USER/.ssh/authorized_keys"
else
    sk "$DEPLOY_USER in docker"   "setup-developer-environment.sh creates the group"
    sk "lid-close drop-in present" "setup-server-environment.sh writes it"
    sk "lid close ignored"         "setup-server-environment.sh writes it"
    sk "lid close on power ignored" "setup-server-environment.sh writes it"
    sk "lid close docked ignored"  "setup-server-environment.sh writes it"
    sk "sleep.target masked"       "setup-server-environment.sh masks it"
    sk "power key ignored"         "setup-server-environment.sh writes it"
    sk "long power press ignored"  "setup-server-environment.sh writes it"
    sk "suspend key ignored"       "setup-server-environment.sh writes it"
    sk "hibernate key ignored"     "setup-server-environment.sh writes it"
    sk "journald size capped"      "setup-server-environment.sh writes the drop-in"
    sk "sshd config is valid"              "setup-server-environment.sh writes the drop-in"
    sk "ssh passwords refused"             "setup-server-environment.sh writes the drop-in"
    sk "ssh keyboard-interactive refused"  "setup-server-environment.sh writes the drop-in"
    sk "ssh root login refused"            "setup-server-environment.sh writes the drop-in"
    sk "ssh still accepts keys"            "setup-server-environment.sh writes the drop-in"
    sk "$DEPLOY_USER has an authorized key" "setup-server-environment.sh writes the drop-in"
fi

# REQ-SERVER-006 - the machine patches itself, from the security suite only, and
# never reboots itself to do it.
#
# TWO INDEPENDENT HALVES, and a machine can have either without the other. The apt
# configuration says what may be upgraded; the systemd timers say whether
# anything ever asks. A perfect 50unattended-upgrades on a host with
# apt-daily-upgrade.timer masked has applied no patch since the day it was
# installed and says nothing about it, which is the #136 failure mode exactly -
# a thing that was supposed to keep itself current, quietly not doing so for
# sixteen months with nothing reporting it. So the timers are asserted against
# systemd rather than against the presence of a config file.
#
# Both timers, not just the upgrade one. apt-daily.timer refreshes the package
# lists; apt-daily-upgrade.timer invokes unattended-upgrade. The second can only
# install what the first has told apt about, so a machine with stale lists installs
# the security fixes it heard about last, forever.
echo
echo "== unattended upgrades (REQ-SERVER-006) =="
# Built from the RUNNING release rather than written out, so this file does not
# have to be edited on the day the machine moves to Debian 14 - and so that a machine
# whose pattern was hardcoded to the previous codename goes red here.
EXPECT_SECURITY_ORIGIN="origin=Debian,codename=$(
    . /etc/os-release 2> /dev/null
    printf '%s' "${VERSION_CODENAME:-unknown}"
)-security,label=Debian-Security"
# Asserted in BOTH phases, because this one is the INSTALLER's doing rather
# than setup-server-environment.sh's: the preseed asks for it with apt-setup/services-select,
# and there is no point configuring a security-only upgrade policy on a machine
# whose apt cannot reach the security suite at all. A red here at firstboot is
# an install bug, which is exactly what the phase split is for.
check "the security suite is in apt's sources" \
    'apt-cache policy | grep -q "l=Debian-Security"'
if [ "$PHASE" = provisioned ]; then
    check "unattended-upgrades installed" \
        'dpkg-query -W -f="\${Status}" unattended-upgrades 2>/dev/null | grep -q "^install ok installed"'
    # Not installed, deliberately - see the note in setup-server-environment.sh. With it
    # present, unattended-upgrades skips every run while the machine is on
    # battery, and debbie is a laptop, so its battery is always discoverable.
    check "powermgmt-base absent, so a battery cannot pause patching" \
        '! dpkg-query -W -f="\${Status}" powermgmt-base 2>/dev/null | grep -q "^install ok installed"'
    check "apt-daily.timer enabled"          '[ "$(systemctl is-enabled apt-daily.timer 2>/dev/null)" = enabled ]'
    check "apt-daily.timer active"           'systemctl is-active apt-daily.timer'
    check "apt-daily-upgrade.timer enabled"  '[ "$(systemctl is-enabled apt-daily-upgrade.timer 2>/dev/null)" = enabled ]'
    check "apt-daily-upgrade.timer active"   'systemctl is-active apt-daily-upgrade.timer'
    # What turns the timer's daily run into an actual upgrade. 20auto-upgrades
    # sets it; this reads apt's parsed value, so a file apt never read is red.
    check "apt's periodic unattended upgrade is on" \
        '[ "$(apt_config_value APT::Periodic::Unattended-Upgrade)" = 1 ]'

    # AC 1. Printed before the check, like the firewall section's offenders: a
    # bare red line saying the origins are wrong, without saying what they are,
    # is a bad afternoon.
    uu_origins="$(unattended_upgrade_origins)"
    echo "  allowed origins: ${uu_origins:-<none reported>}"
    echo "  expected:        $EXPECT_SECURITY_ORIGIN"
    # EXACT, not "contains -security". Debian's stock configuration enables
    # three patterns and one of them is the whole stable suite with no security
    # label at all, so "at least one security origin is present" is satisfied by
    # the very configuration this requirement exists to replace. An extra origin
    # is a failure, not a curiosity - the same reason the firewall counts ports.
    check "only the security suite is upgraded unattended" \
        "[ \"\$uu_origins\" = '$EXPECT_SECURITY_ORIGIN' ]"

    # THE ONE THAT MATTERS MOST. debbie serves from a shelf on wifi, and an
    # unattended reboot that fails to bring the network back up is an outage
    # nobody is watching for - #282 is still open precisely because that wifi
    # story is unsettled.
    #
    # `= false`, not "false or unset". The package default is already false, so
    # accepting unset would pass on a machine where nobody had ever considered the
    # question, and a security-relevant property has to be true on purpose
    # rather than by accident.
    uu_reboot="$(apt_config_value Unattended-Upgrade::Automatic-Reboot)"
    echo "  Unattended-Upgrade::Automatic-Reboot: ${uu_reboot:-<unset>}"
    check "automatic reboot explicitly disabled" '[ "$uu_reboot" = false ]'
else
    sk "unattended-upgrades installed"       "setup-server-environment.sh installs it"
    sk "powermgmt-base absent, so a battery cannot pause patching" \
        "only meaningful once setup-server-environment.sh has installed unattended-upgrades"
    sk "apt-daily.timer enabled"             "setup-server-environment.sh enables it"
    sk "apt-daily.timer active"              "setup-server-environment.sh enables it"
    sk "apt-daily-upgrade.timer enabled"     "setup-server-environment.sh enables it"
    sk "apt-daily-upgrade.timer active"      "setup-server-environment.sh enables it"
    sk "apt's periodic unattended upgrade is on" "setup-server-environment.sh writes 20auto-upgrades"
    sk "only the security suite is upgraded unattended" "setup-server-environment.sh writes the drop-in"
    sk "automatic reboot explicitly disabled"           "setup-server-environment.sh writes the drop-in"
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
# Run WITHOUT sudo, on purpose. `sudo docker info` would pass on a machine where
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
    # Idempotency, asserted rather than assumed. setup-server-environment.sh runs more than
    # once on any machine that is ever repaired, and the classic way to write this
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
    sk "docker-ce installed"          "setup-developer-environment.sh installs it"
    sk "apt keyring present"          "setup-server-environment.sh fetches it"
    sk "exactly one docker apt source" "setup-developer-environment.sh writes it"
    sk "docker.service enabled"       "setup-developer-environment.sh installs it"
    sk "docker.service active"        "setup-developer-environment.sh installs it"
    sk "docker info works as $DEPLOY_USER without sudo" "setup-developer-environment.sh installs it"
    sk "docker compose plugin present" "setup-developer-environment.sh installs it"
fi

# REQ-DEPLOY-001 - the host deploys `release` and no other branch.
#
# Everything here runs as $DEPLOY_USER over a fresh SSH connection and WITHOUT
# sudo, on purpose, because that is the account the deploy runs as. A checkout
# root can read and the deploy user cannot write is the failure being guarded,
# and `sudo git -C ...` would pass straight through it.
#
# The `release` branch is created by `yarn release` from a dev machine, so on a
# machine provisioned before the first release it genuinely does not exist. That is
# a SKIP, not a failure: setup-server-environment.sh is explicitly forbidden from creating
# the branch, because doing so would ship whatever `main` was at provision time
# as though someone had decided to.
echo
echo "== repository checkout (REQ-DEPLOY-001) =="
if [ "$PHASE" = provisioned ]; then
    check "checkout exists at $REPO_DIR" '[ -d "$REPO_DIR/.git" ]'
    # AC 1, and the reason it is spelled this way rather than as a stat of the
    # top directory: `sudo git clone` into a pre-made srv-owned directory
    # leaves the directory right and everything inside it root-owned, and the
    # next unattended fetch is the thing that finds out.
    check "every file under $REPO_DIR is owned by $DEPLOY_USER" \
        '[ -d "$REPO_DIR" ] && [ -z "$(find "$REPO_DIR" ! -user "$DEPLOY_USER" -print -quit 2>/dev/null)" ]'
    # Idempotency, asserted rather than assumed: a second provisioning run that
    # re-cloned or re-added the remote would show up here. One remote, named
    # origin, pointing at the repository this generation is for.
    check "origin is the only remote, and is seanorepo" \
        '[ "$(git -C "$REPO_DIR" remote | wc -l)" -eq 1 ] \
         && git -C "$REPO_DIR" remote get-url origin | grep -q "seanmizen/seanorepo"'
    # The claim that provisioning needs no credential, made as something that
    # can fail. GIT_TERMINAL_PROMPT=0 so a repository that has become private
    # reports an auth error immediately instead of hanging for a username that
    # no unattended deploy will ever type.
    check "$DEPLOY_USER can reach origin with no credential" \
        'GIT_TERMINAL_PROMPT=0 git -C "$REPO_DIR" ls-remote --quiet origin HEAD'
    if [ ! -d "$REPO_DIR/.git" ]; then
        sk "HEAD is on $RELEASE_BRANCH" "no checkout at $REPO_DIR"
    elif git -C "$REPO_DIR" rev-parse --verify --quiet \
        "refs/remotes/origin/$RELEASE_BRANCH" > /dev/null 2>&1; then
        # symbolic-ref, not `git branch --show-current` or a rev-parse of the
        # SHA: it is false on a detached HEAD, which is a state a deploy can
        # leave behind and which compares equal by SHA while not tracking the
        # branch at all.
        check "HEAD is on $RELEASE_BRANCH" \
            '[ "$(git -C "$REPO_DIR" symbolic-ref --short -q HEAD)" = "$RELEASE_BRANCH" ]'
    else
        sk "HEAD is on $RELEASE_BRANCH" \
            "origin/$RELEASE_BRANCH does not exist yet - 'yarn release' creates it"
    fi
else
    sk "checkout exists at $REPO_DIR" "setup-developer-environment.sh clones it"
    sk "every file under $REPO_DIR is owned by $DEPLOY_USER" "setup-developer-environment.sh clones it"
    sk "origin is the only remote, and is seanorepo" "setup-developer-environment.sh clones it"
    sk "$DEPLOY_USER can reach origin with no credential" "setup-developer-environment.sh clones it"
    sk "HEAD is on $RELEASE_BRANCH" "setup-server-environment.sh checks it out"
fi

# REQ-DEPLOY-004 - the other half of `yarn prod:docker`. Docker above proves the
# machine can run the containers; this proves it can get as far as asking.
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
    # /usr/bin on PATH, so the machine would run Yarn 1 against a Yarn 4
    # repository while `command -v yarn` still answered. Resolving the shim
    # tells the two apart: corepack's is a symlink into its own dist, an
    # npm-installed one is not, and because `command -v` takes whichever comes
    # first on PATH this also catches the shadowing case rather than just the
    # replacing one.
    check "yarn is corepack's shim, not a global npm install" \
        'readlink -f "$(command -v yarn)" | grep -q corepack'
    # No version is written here either. The expected value is read out of the
    # repository's own packageManager field at assertion time, so this check
    # cannot drift from the repo any more than setup-server-environment.sh can - if the repo
    # bumps Yarn, both sides move together and nothing needs editing.
    if [ -f "$REPO_DIR/package.json" ]; then
        check "yarn --version matches the repo's packageManager" \
            'want=$(sed -n "s/.*\"packageManager\"[[:space:]]*:[[:space:]]*\"yarn@\([^\"+]*\).*/\1/p" "$REPO_DIR/package.json" | head -1); [ -n "$want" ] && [ "$(cd "$REPO_DIR" && yarn --version)" = "$want" ]'
    else
        # Reachable only if the checkout section above already failed, so this
        # skip is a consequence rather than an independent gap. Since #278 a
        # provisioned machine has the repository, and this check does run.
        sk "yarn --version matches the repo's packageManager" \
            "no package.json at $REPO_DIR - see the checkout section above"
    fi
    # The tools setup-developer-environment.sh installs for its own sake.
    # shist comes from its GitHub release: brew on macOS, a checksummed
    # tarball on Linux. No machine needs a Go toolchain.
    check "apt cache is empty"        '[ -z "$(ls -A /var/cache/apt/archives/*.deb 2>/dev/null)" ]'
    check "shist installed"           "sudo -n test -x ~$DEPLOY_USER/.local/bin/shist"
    check "shist runs"                "sudo -n -u $DEPLOY_USER ~$DEPLOY_USER/.local/bin/shist --help > /dev/null 2>&1"
    check "git config came from config-anywhere" \
        "sudo -n test -s ~$DEPLOY_USER/.gitconfig"
else
    sk "apt cache is empty"           "setup-server-environment.sh clears it"
    sk "shist installed"              "setup-developer-environment.sh installs it"
    sk "shist runs"                   "setup-developer-environment.sh installs it"
    sk "git config came from config-anywhere" "setup-developer-environment.sh applies it"
    sk "node 20 installed"            "setup-developer-environment.sh installs it"
    sk "corepack installed"           "setup-developer-environment.sh installs it"
    sk "yarn is corepack's shim, not a global npm install" "setup-developer-environment.sh enables it"
    sk "yarn --version matches the repo's packageManager"  "setup-developer-environment.sh enables it"
fi

# REQ-DEPLOY-002 / -003 / -005 / -006 - the deploy poller, #279.
#
# The timer and the sudoers drop-in are what a machine HAS; the two properties that
# matter most are things deploy.sh DOES, and both are asserted as behaviour or
# as the absence of a thing rather than as the presence of a comment.
echo
echo "== release poller and deploy (REQ-DEPLOY-002) =="
DEPLOY_SCRIPT_REL="utils/debbie/2026-09-17/services/deploy.sh"
DEPLOY_SCRIPT="$REPO_DIR/$DEPLOY_SCRIPT_REL"
RELEASE_POLL_SCRIPT_REL="utils/debbie/2026-09-17/services/release-poll.sh"
RELEASE_POLL_SCRIPT="$REPO_DIR/$RELEASE_POLL_SCRIPT_REL"

#------------------------------------------------------------------------------
# One rule for every check that reads deploy.sh - #311.
#
# deploy.sh lives in the checkout, and the checkout is on `release`. A machine
# provisioned before the generation shipped is on a `release` that does not
# contain this directory at all, so the file CANNOT be there. setup-server-environment.sh
# says so in as many words and leaves the timer enabled deliberately.
#
# Until #311 this section held two rules for that one state: the three checks
# that READ deploy.sh skipped with the reason printed, while the check for its
# PRESENCE failed hard. Both cannot be right about the same machine, and the failing
# one made every `--full` run red for a reason having nothing to do with the
# branch under test - REQ-EMU-003's exit code stopped being a gate.
#
# A BARE SKIP IS NOT THE FIX EITHER, and this is the whole point of the ticket.
# Skipping whenever deploy.sh is missing would make a green run unable to tell
# "this machine legitimately predates the poller" from "the poller should be here
# and is gone", and the second is a genuine fault - a broken clone, a lost mode
# bit, a file deleted on the machine. That is exactly the shape #300 removed from
# the firewall section: a check reporting green over a real hole.
#
# So the skip is conditional on the CAUSE, and the cause is answerable locally:
#
#   the checked-out commit does not track deploy.sh  -> the machine cannot have it
#                                                       -> SKIP, with the reason
#   it does track it, but the file is absent/not -x  -> something is wrong
#                                                       -> FAIL, loudly
#
# Asked with `git cat-file -e HEAD:<path>` rather than with `ls-tree` of the
# generation DIRECTORY, and against HEAD rather than against origin/release:
#
#   - the exact path, not the directory, because the directory landed before
#     deploy.sh did (#279 added the script). A `release` in between has the
#     directory and no script, and on such a machine the file still cannot exist.
#     The directory test would call that a fault; it is not one.
#   - HEAD, because HEAD is what produced this working tree. origin/release is
#     a remote-tracking ref that may be stale (never fetched) or ahead of the
#     checkout, and either way it answers a question about a commit that is not
#     the one on disk. HEAD also needs no network, which matters: nothing in
#     assert.sh may depend on reaching a registry to decide whether to assert.
#------------------------------------------------------------------------------
deploy_expected=no
deploy_skip_reason=
if [ ! -d "$REPO_DIR/.git" ]; then
    deploy_skip_reason="no checkout at $REPO_DIR - see the checkout section above"
elif git -C "$REPO_DIR" cat-file -e "HEAD:$DEPLOY_SCRIPT_REL" 2> /dev/null; then
    deploy_expected=yes
else
    deploy_skip_reason="the commit on disk ($(git -C "$REPO_DIR" rev-parse --short HEAD 2> /dev/null || echo unreadable)) does not track $DEPLOY_SCRIPT_REL, so this machine cannot have it - '$RELEASE_BRANCH' predates the deploy poller"
fi

# The single rule. Every check below that reads $DEPLOY_SCRIPT - here, in the
# sudoers section and in the tunnel section - is gated on this and nothing else,
# so all of them agree about a machine rather than coinciding by accident.
deploy_script_expected() { [ "$deploy_expected" = yes ]; }

# Same rule for release-poll.sh (#307), asked separately: a `release` between
# #279 and #307 tracks deploy.sh and not the poller.
release_poll_expected=no
release_poll_skip_reason=
if [ ! -d "$REPO_DIR/.git" ]; then
    release_poll_skip_reason="no checkout at $REPO_DIR - see the checkout section above"
elif git -C "$REPO_DIR" cat-file -e "HEAD:$RELEASE_POLL_SCRIPT_REL" 2> /dev/null; then
    release_poll_expected=yes
else
    release_poll_skip_reason="the commit on disk ($(git -C "$REPO_DIR" rev-parse --short HEAD 2> /dev/null || echo unreadable)) does not track $RELEASE_POLL_SCRIPT_REL - '$RELEASE_BRANCH' predates #307"
fi

# The BEHAVIOUR of the two scripts is tested against whichever copy is the one
# under test. The VM harness copies the commit under test to UNDER_TEST_DIR, so
# a harness run proves the scripts the PR is about, not whatever `release` was
# when the machine was cloned. On metal there is no such copy and the checkout's own
# scripts are tested, under the rules above.
if [ -n "${UNDER_TEST_DIR:-}" ] && [ -x "$UNDER_TEST_DIR/deploy.sh" ] && [ -x "$UNDER_TEST_DIR/release-poll.sh" ]; then
    DEPLOY_UNDER_TEST="$UNDER_TEST_DIR/deploy.sh"
    RELEASE_POLL_UNDER_TEST="$UNDER_TEST_DIR/release-poll.sh"
    behaviour_skip_reason=
elif deploy_script_expected && [ "$release_poll_expected" = yes ]; then
    DEPLOY_UNDER_TEST="$DEPLOY_SCRIPT"
    RELEASE_POLL_UNDER_TEST="$RELEASE_POLL_SCRIPT"
    behaviour_skip_reason=
else
    behaviour_skip_reason="no copy of the scripts under test: ${release_poll_skip_reason:-$deploy_skip_reason}"
fi

# A throwaway `origin` with a `release` branch two commits long, a machine cloned at
# the first, and shims for every command that could touch a running service.
# Each shim appends its argv to $1/calls and does nothing else, so a test can
# assert exactly which service commands a script ran - and a script that
# misbehaves writes a line to a file instead of rebuilding containers in the
# middle of an assertion run. Prints the SHA `release` ends on.
scratch_release() {
    local t="$1" c
    mkdir -p "$t/bin"
    for c in docker yarn systemctl sudo; do
        printf '#!/bin/sh\necho "%s $*" >> "%s/calls"\n' "$c" "$t" > "$t/bin/$c"
        chmod +x "$t/bin/$c"
    done
    git init -q --bare "$t/origin.git"
    git init -q "$t/w"
    git -C "$t/w" -c user.email=a@t -c user.name=a commit -q --allow-empty -m one
    git -C "$t/w" remote add origin "$t/origin.git"
    git -C "$t/w" push -q origin HEAD:refs/heads/release
    git clone -q -b release "$t/origin.git" "$t/machine"
    git -C "$t/w" -c user.email=a@t -c user.name=a commit -q --allow-empty -m two
    git -C "$t/w" push -q origin HEAD:refs/heads/release
    git -C "$t/w" rev-parse HEAD
}

if [ "$PHASE" = provisioned ]; then
    UD=/usr/local/lib/systemd/system
    check "custom-release-poll.timer enabled"   'systemctl is-enabled custom-release-poll.timer'
    # Active, not merely enabled. setup-server-environment.sh deliberately does not start it
    # - that would deploy in the middle of provisioning - so this is a claim
    # about the reboot the harness performs.
    check "custom-release-poll.timer active"    'systemctl is-active custom-release-poll.timer'
    # Two minutes is the upper bound on deploy latency that REQ-DEPLOY-002
    # trades for needing no inbound port. Read from `systemctl cat`, so it is
    # the EFFECTIVE unit, drop-ins included.
    check "the timer polls every two minutes" \
        'systemctl cat custom-release-poll.timer | grep -qx "OnUnitActiveSec=2min"'
    check "custom-release-poll.service is timer-owned (static)" \
        '[ "$(systemctl is-enabled custom-release-poll.service 2>&1)" = static ]'
    # #307: one clock. The deploy has no [Install] and no timer of its own, so
    # the poller is the only thing that can start it and a deploy can never
    # race a checkout.
    check "custom-deploy.service is not on a timer" \
        "[ \"\$(systemctl is-enabled custom-deploy.service 2>&1)\" = static ] \
         && [ ! -e $UD/custom-deploy.timer ] \
         && ! grep -qsx 'Unit=custom-deploy.service' $UD/*.timer /etc/systemd/system/*.timer"
    check "the release poller triggers the deploy" \
        'systemctl show -p OnSuccess --value custom-release-poll.service | grep -qw custom-deploy.service'
    # #329: roles. Unset means off, so the files present must be EXACTLY the
    # roles this machine was provisioned with - EXPECT_ROLES, which the VM harness
    # sets (default: none) and provision.sh derives from the machine env file.
    check "the deploy runs only on a machine with the webserver role" \
        'systemctl cat custom-deploy.service | grep -qx "ConditionPathExists=/etc/seanorepo/roles/webserver"'
    check "the tunnel runs only on a machine with the tunnel role" \
        'systemctl cat custom-cloudflared.service | grep -qx "ConditionPathExists=/etc/seanorepo/roles/tunnel"'
    check "roles on this machine are exactly '${EXPECT_ROLES:-none}'" \
        '[ "$(ls /etc/seanorepo/roles 2>/dev/null | sort | tr "\n" " " | sed "s/ $//")" = "$(printf "%s" "${EXPECT_ROLES:-}" | tr " " "\n" | sort | tr "\n" " " | sed "s/ $//")" ]'
    check "the #307 serving flag is gone" '[ ! -e /etc/seanorepo/serving ]'
    if [ ! -e /etc/seanorepo/roles/webserver ]; then
        # The whole point of #329: with no role, a triggered deploy is
        # skipped by its condition and runs nothing.
        check "without the webserver role a triggered deploy runs nothing" \
            'sudo -n systemctl start custom-deploy.service > /dev/null 2>&1;
             [ "$(systemctl show -p ConditionResult --value custom-deploy.service)" = no ] \
             && [ "$(systemctl is-failed custom-deploy.service 2>&1)" != failed ] \
             && [ -z "$(docker ps -q 2>/dev/null)" ]'
    else
        sk "without the webserver role a triggered deploy runs nothing" "this machine has the webserver role"
    fi
    check "the pre-#307 poller units are gone" \
        "[ ! -e $UD/custom-deploy-poll.timer ] && [ ! -e $UD/custom-deploy-poll.service ]"

    # The four checks that read deploy.sh, under the one rule above. They run
    # together or they skip together: a machine that cannot have the file is not a
    # machine that fails one of these and skips three.
    if deploy_script_expected; then
        # Run as $DEPLOY_USER without sudo, like everything else here: the unit
        # runs as that account, and a deploy script only root can execute is a
        # timer that fails every two minutes. Reached only when the commit on disk
        # DOES track the file, so a failure here is a real one - the checkout has
        # lost a file it should have, or lost its mode bit.
        check "deploy.sh present and executable" '[ -x "$DEPLOY_SCRIPT" ]'

        # REQ-DEPLOY-003, as behaviour rather than as a grep for `flock`.
        #
        # A lock is taken and held, then deploy.sh is asked to run against it. It
        # must exit 0 - being asked while a deploy runs is the timer working, not a
        # failure - and must say why.
        #
        # REPO_DIR is pointed at an empty temporary directory ON PURPOSE. If the
        # locking ever stopped working, this check would otherwise start a real
        # deploy in the middle of an assertion run. With nowhere to deploy from,
        # the unlocked path instead dies at "not a git checkout" and the check goes
        # red - so the failure mode of the test is a red light, never a build.
        check "a second deploy exits cleanly while one holds the lock" \
            'lock=$(mktemp -u); empty=$(mktemp -d);
             flock -x "$lock" -c "sleep 20" & held=$!;
             sleep 2;
             out=$(DEPLOY_LOCK_FILE="$lock" REPO_DIR="$empty" "$DEPLOY_SCRIPT" 2>&1); rc=$?;
             kill "$held" 2>/dev/null; rmdir "$empty";
             [ "$rc" -eq 0 ] && printf "%s" "$out" | grep -q "another deploy holds"'

        # REQ-DEPLOY-006, asserted as an absence. This is the one requirement whose
        # violation looks like a tidy-up: somebody making checkouts deterministic
        # would reasonably reach for `git clean -fdx`, and that would delete
        # apps/cloudflared/credentials/, which is gitignored and exists only on
        # this host. Every site would go down with nothing in the repository to
        # explain it. The check reads the deployed script, so it catches the change
        # after it has shipped as well as before.
        #
        # The `[ -r ]` is load-bearing, not belt-and-braces. This check is an
        # inverted grep, and grep on a file that does not exist exits 2 - which `!`
        # turns into a pass. Under the old guard that was unreachable; under the
        # one rule it is exactly the case that must go red, so the readability of
        # the file is asserted as part of the claim rather than assumed by a guard.
        check "no git clean anywhere in the deploy path" \
            '[ -r "$DEPLOY_SCRIPT" ] \
             && ! grep -qE "^[^#]*\bgit[[:space:]]+clean\b" "$DEPLOY_SCRIPT"'
        # AC 6 asks for the comment as well as the absence, because an absence
        # with no explanation is what gets tidied away. No `[ -r ]` needed: this
        # grep is not inverted, so a missing file fails it already.
        check "deploy.sh says why there is no git clean" \
            'grep -q "REQ-DEPLOY-006" "$DEPLOY_SCRIPT"'
    else
        sk "deploy.sh present and executable"                      "$deploy_skip_reason"
        sk "a second deploy exits cleanly while one holds the lock" "$deploy_skip_reason"
        sk "no git clean anywhere in the deploy path"               "$deploy_skip_reason"
        sk "deploy.sh says why there is no git clean"               "$deploy_skip_reason"
    fi

    if [ "$release_poll_expected" = yes ]; then
        check "release-poll.sh present and executable" '[ -x "$RELEASE_POLL_SCRIPT" ]'
        check "no git clean in the release poller" \
            '[ -r "$RELEASE_POLL_SCRIPT" ] \
             && ! grep -qE "^[^#]*\bgit[[:space:]]+clean\b" "$RELEASE_POLL_SCRIPT"'
    else
        sk "release-poll.sh present and executable" "$release_poll_skip_reason"
        sk "no git clean in the release poller"     "$release_poll_skip_reason"
    fi

    # Behaviour, #307 - against a scratch origin and a scratch machine, with every
    # service command replaced by a shim that only records it. Nothing here can
    # touch this host's real checkout, containers or units.
    if [ -z "$behaviour_skip_reason" ]; then
        # The whole point of the split: a machine that does not serve keeps
        # tracking `release`, and tracking it changes nothing that runs.
        check "the release poller moves the checkout and touches no service" \
            't=$(mktemp -d); want=$(scratch_release "$t");
             PATH="$t/bin:$PATH" REPO_DIR="$t/machine" DEPLOY_LOCK_FILE="$t/lock" XDG_STATE_HOME="$t/state" \
                 "$RELEASE_POLL_UNDER_TEST" > /dev/null 2>&1; rc=$?;
             got=$(git -C "$t/machine" rev-parse HEAD); n=$(cat "$t/calls" 2>/dev/null | wc -l);
             rm -rf "$t";
             [ "$rc" = 0 ] && [ "$got" = "$want" ] && [ "$n" -eq 0 ]'
        check "a release poll leaves the checkout alone while a deploy holds the lock" \
            't=$(mktemp -d); scratch_release "$t" > /dev/null; before=$(git -C "$t/machine" rev-parse HEAD);
             flock -x "$t/lock" -c "sleep 20" & held=$!; sleep 2;
             REPO_DIR="$t/machine" DEPLOY_LOCK_FILE="$t/lock" XDG_STATE_HOME="$t/state" \
                 "$RELEASE_POLL_UNDER_TEST" > /dev/null 2>&1; rc=$?;
             kill "$held" 2>/dev/null; after=$(git -C "$t/machine" rev-parse HEAD); rm -rf "$t";
             [ "$rc" = 0 ] && [ "$before" = "$after" ]'
        # REQ-DEPLOY-002/004: the deploy is `yarn prod:docker`, it runs when the
        # checkout differs from what was deployed, and not again until the
        # checkout moves or the host reboots.
        # #329: the address comes from the roles. The yarn shim records
        # PUBLISH_ADDR, and ROLES_DIR points at a scratch directory.
        check "the deploy publishes on loopback with the tunnel and on the LAN without" \
            't=$(mktemp -d); scratch_release "$t" > /dev/null; git -C "$t/machine" pull -q;
             printf "#!/bin/sh\necho \"yarn \$* PUBLISH_ADDR=\$PUBLISH_ADDR\" >> \"%s/calls\"\n" "$t" > "$t/bin/yarn";
             mkdir -p "$t/roles"; touch "$t/roles/webserver" "$t/roles/tunnel";
             run() { PATH="$t/bin:$PATH" REPO_DIR="$t/machine" DEPLOY_LOCK_FILE="$t/lock" ROLES_DIR="$t/roles" \
                     DEPLOY_MARKER="$t/marker" XDG_STATE_HOME="$t/state" "$DEPLOY_UNDER_TEST" --force > /dev/null 2>&1; };
             run; a=$(grep "^yarn prod:docker" "$t/calls" | tail -1);
             rm "$t/roles/tunnel"; run; b=$(grep "^yarn prod:docker" "$t/calls" | tail -1);
             rm -rf "$t";
             [ "$a" = "yarn prod:docker PUBLISH_ADDR=127.0.0.1" ] && [ "$b" = "yarn prod:docker PUBLISH_ADDR=0.0.0.0" ]'
        check "the deploy runs once per checkout and again after a reboot" \
            't=$(mktemp -d); scratch_release "$t" > /dev/null; git -C "$t/machine" pull -q;
             run() { PATH="$t/bin:$PATH" REPO_DIR="$t/machine" DEPLOY_LOCK_FILE="$t/lock" \
                     DEPLOY_MARKER="$t/marker" XDG_STATE_HOME="$t/state" \
                     "$DEPLOY_UNDER_TEST" > /dev/null 2>&1; };
             count() { grep -c "^yarn prod:docker" "$t/calls" 2>/dev/null || true; };
             run; a=$(count); run; b=$(count);
             sed -i "2s/.*/a-previous-boot/" "$t/marker"; run; c=$(count);
             rm -rf "$t";
             [ "$a" = 1 ] && [ "$b" = 1 ] && [ "$c" = 2 ]'
    else
        sk "the release poller moves the checkout and touches no service" "$behaviour_skip_reason"
        sk "a release poll leaves the checkout alone while a deploy holds the lock" "$behaviour_skip_reason"
        sk "the deploy runs once per checkout and again after a reboot" "$behaviour_skip_reason"
        sk "the deploy publishes on loopback with the tunnel and on the LAN without" "$behaviour_skip_reason"
    fi
else
    sk "custom-release-poll.timer enabled"  "setup-server-environment.sh installs it"
    sk "custom-release-poll.timer active"   "setup-server-environment.sh installs it"
    sk "the timer polls every two minutes" "setup-server-environment.sh installs it"
    sk "custom-release-poll.service is timer-owned (static)" "setup-server-environment.sh installs it"
    sk "custom-deploy.service is not on a timer" "setup-server-environment.sh installs it"
    sk "the release poller triggers the deploy" "setup-server-environment.sh installs it"
    sk "the deploy runs only on a machine with the webserver role" "setup-server-environment.sh installs it"
    sk "the tunnel runs only on a machine with the tunnel role" "setup-server-environment.sh installs it"
    sk "roles on this machine are exactly '${EXPECT_ROLES:-none}'" "setup-server-environment.sh writes them"
    sk "the #307 serving flag is gone" "setup-server-environment.sh removes it"
    sk "without the webserver role a triggered deploy runs nothing" "setup-server-environment.sh installs it"
    sk "the deploy publishes on loopback with the tunnel and on the LAN without" "setup-developer-environment.sh clones the checkout"
    sk "the pre-#307 poller units are gone" "setup-server-environment.sh removes them"
    sk "deploy.sh present and executable"  "setup-developer-environment.sh clones the checkout"
    sk "a second deploy exits cleanly while one holds the lock" "setup-developer-environment.sh clones the checkout"
    sk "no git clean anywhere in the deploy path" "setup-developer-environment.sh clones the checkout"
    sk "deploy.sh says why there is no git clean" "setup-developer-environment.sh clones the checkout"
    sk "release-poll.sh present and executable" "setup-developer-environment.sh clones the checkout"
    sk "no git clean in the release poller" "setup-developer-environment.sh clones the checkout"
    sk "the release poller moves the checkout and touches no service" "setup-developer-environment.sh clones the checkout"
    sk "a release poll leaves the checkout alone while a deploy holds the lock" "setup-developer-environment.sh clones the checkout"
    sk "the deploy runs once per checkout and again after a reboot" "setup-developer-environment.sh clones the checkout"
fi

# REQ-DEPLOY-005 - the security boundary, asserted as a boundary.
#
# "A file exists" is not the claim. The claim is that this drop-in authorises
# ONE command, so the deploy never needs general root, and every check below
# exists because of a specific way that could stop being true: a second line, a
# wildcard, ALL in the command position, a comma-separated list, a different
# runas target, or a mode sudo will not read.
#
# Read with `sudo -n`: /etc/sudoers.d is 0750 root:root and the file is 0440,
# so an unprivileged stat cannot tell "absent" from "unreadable".
#
# What this does NOT prove, stated plainly: the machine also carries
# /etc/sudoers.d/90-$DEPLOY_USER from the installer, granting NOPASSWD:ALL
# (see write_overrides in scripts/lib.sh), so $DEPLOY_USER has general root today
# regardless of what this file says. `sudo -l` would therefore pass no matter
# how broad this drop-in became, which is exactly why these checks read the
# file itself. The narrow grant is what lets REQ-SERVER-008 tighten the blanket
# one later without breaking the deploy.
echo
echo "== deploy sudoers boundary (REQ-DEPLOY-005) =="
SUDOERS_DEST=/etc/sudoers.d/seanorepo-deploy
if [ "$PHASE" = provisioned ]; then
    check "sudoers drop-in present"   "sudo -n test -f '$SUDOERS_DEST'"
    # 0440 root:root. sudo ignores a drop-in with any other mode, so a wrong
    # mode is a grant that silently is not there - and the deploy would then
    # fail to restart the tunnel with no clue as to why.
    check "sudoers drop-in is mode 440" \
        "[ \"\$(sudo -n stat -c %a '$SUDOERS_DEST' 2>/dev/null)\" = 440 ]"
    check "sudoers drop-in is owned by root:root" \
        "[ \"\$(sudo -n stat -c '%U:%G' '$SUDOERS_DEST' 2>/dev/null)\" = root:root ]"
    check "sudoers drop-in parses" "sudo -n visudo -cf '$SUDOERS_DEST'"
    # Exactly one rule. Comments and blank lines do not grant anything; a
    # second rule does, and would be invisible to a check that only looked at
    # the first line.
    check "sudoers drop-in has exactly one rule" \
        "[ \"\$(sudo -n grep -cvE '^[[:space:]]*(#.*)?\$' '$SUDOERS_DEST')\" -eq 1 ]"
    # The rule, whole, against a pattern that admits exactly one systemctl
    # restart of one unit. Anchored at both ends, so nothing can be appended.
    # No comma (a command list), no wildcard, no ALL in the command position,
    # no shell metacharacter - every one of those is a way to turn "restart the
    # tunnel" into "run anything".
    check "the one rule is a single systemctl restart of a single unit" \
        "sudo -n grep -qE '^${DEPLOY_USER} ALL=\\(root\\) NOPASSWD: /usr/bin/systemctl restart [A-Za-z0-9@:._-]+\\.service\$' '$SUDOERS_DEST'"
    # Belt and braces, and each of these has a distinct way of getting in.
    check "sudoers drop-in grants no wildcard" "! sudo -n grep -q '[*]' '$SUDOERS_DEST'"
    check "sudoers drop-in grants no command list" \
        "! sudo -n grep -qE 'NOPASSWD:.*,' '$SUDOERS_DEST'"
    check "sudoers drop-in does not grant ALL as a command" \
        "! sudo -n grep -qE 'NOPASSWD:[[:space:]]*ALL' '$SUDOERS_DEST'"

    # The divergence this is really for. deploy.sh names the unit it restarts
    # and the drop-in names the unit sudo permits; if #280 renames the tunnel
    # and only one of the two moves, the deploy fails at the exact moment it
    # matters - an ingress change - and passes every other day of the year.
    #
    # Gated on the same rule as the deploy-poller section - #311 - not on the
    # file being there. `sed` on an absent file yields nothing, so `want` is
    # empty and the check goes red, which is right when the commit on disk says
    # the file should exist and wrong when it says it cannot.
    if deploy_script_expected; then
        check "the unit deploy.sh restarts is the unit sudo permits" \
            'want=$(sed -n "s/^CLOUDFLARED_UNIT=\"\([^\"]*\)\".*/\1/p" "$DEPLOY_SCRIPT" | head -1);
             [ -n "$want" ] && sudo -n grep -qF "/usr/bin/systemctl restart $want" "$SUDOERS_DEST"'
    else
        sk "the unit deploy.sh restarts is the unit sudo permits" "$deploy_skip_reason"
    fi
else
    sk "sudoers drop-in present"        "setup-server-environment.sh installs it"
    sk "sudoers drop-in is mode 440"    "setup-server-environment.sh installs it"
    sk "sudoers drop-in is owned by root:root" "setup-server-environment.sh installs it"
    sk "sudoers drop-in parses"         "setup-server-environment.sh installs it"
    sk "sudoers drop-in has exactly one rule" "setup-server-environment.sh installs it"
    sk "the one rule is a single systemctl restart of a single unit" "setup-server-environment.sh installs it"
    sk "sudoers drop-in grants no wildcard"     "setup-server-environment.sh installs it"
    sk "sudoers drop-in grants no command list" "setup-server-environment.sh installs it"
    sk "sudoers drop-in does not grant ALL as a command" "setup-server-environment.sh installs it"
    sk "the unit deploy.sh restarts is the unit sudo permits" "setup-server-environment.sh installs it"
fi

# REQ-NETWORK-001 / REQ-NETWORK-002 - the tunnel, #280.
#
# What a VM run can and cannot prove, stated once here rather than implied by
# each check: there are no Cloudflare credentials in any VM and there never
# will be, so nothing below proves a tunnel connects, authenticates or routes a
# request. What it proves is that the machine is provisioned to run one, that the
# binary is a package rather than a hand-dropped file, that nothing else is
# driving the same tunnel, and - the one behavioural check here - that the
# absence of credentials produces a refusal rather than a restart loop.
echo
echo "== cloudflare tunnel (REQ-NETWORK-001) =="
CLOUDFLARED_DIR="$REPO_DIR/apps/cloudflared"
CLOUDFLARED_CONFIG="$CLOUDFLARED_DIR/config.yml"
CLOUDFLARED_CREDS_DIR="$CLOUDFLARED_DIR/credentials"
CLOUDFLARED_UNIT=custom-cloudflared.service
if [ "$PHASE" = provisioned ]; then
    check "cloudflared installed" \
        'dpkg-query -W -f="\${Status}" cloudflared 2>/dev/null | grep -q "^install ok installed"'
    check "cloudflare apt keyring present" '[ -s /usr/share/keyrings/cloudflare-main.gpg ]'
    # Same idempotency claim as the docker source above, and the same way to
    # get it wrong: an append rather than a whole-file compare.
    check "exactly one cloudflared apt source" \
        '[ "$(grep -rhsE "^deb .*pkg\.cloudflare\.com" /etc/apt/sources.list /etc/apt/sources.list.d/ | wc -l)" -eq 1 ]'

    # #135, as something that can fail. The old arrangement curled the binary
    # into /usr/local/bin, where dpkg cannot see it and no update path reaches
    # it. Asking dpkg who owns the binary is the difference between "a
    # cloudflared exists" and "cloudflared is a package".
    check "cloudflared is dpkg-owned, not a manual binary drop" \
        'dpkg -S /usr/bin/cloudflared 2>/dev/null | grep -q "^cloudflared:"'
    # The subtle half of #135, and the reason this is not simply "nothing in
    # /usr/local/bin": the package's own postinst CREATES
    # /usr/local/bin/cloudflared as a symlink to /usr/bin/cloudflared, so the
    # path being occupied is normal. A REGULAR FILE there is the #135 shape -
    # a hand-installed binary shadowing the packaged one, since /usr/local/bin
    # precedes /usr/bin on PATH. Absent is fine too; a non-symlink is not.
    check "/usr/local/bin/cloudflared is the package symlink, not a binary" \
        '[ ! -e /usr/local/bin/cloudflared ] \
         || { [ -L /usr/local/bin/cloudflared ] \
              && [ "$(readlink -f /usr/local/bin/cloudflared)" = /usr/bin/cloudflared ]; }'

    check "$CLOUDFLARED_UNIT installed in /usr/local/lib/systemd/system" \
        "[ -f /usr/local/lib/systemd/system/$CLOUDFLARED_UNIT ]"
    # REQ-NETWORK-002, and the AC that says "config path points into the
    # checkout". Read from `systemctl cat`, so it is the EFFECTIVE unit rather
    # than the file - a drop-in overriding ExecStart would show up here.
    check "the tunnel reads config.yml from the checkout" \
        "systemctl cat $CLOUDFLARED_UNIT 2>/dev/null | grep -qF -- '--config $CLOUDFLARED_CONFIG'"
    # Load-bearing and easy to delete as noise. config.yml's credentials-file
    # is a RELATIVE path, which cloudflared resolves against the working
    # directory; without this the daemon starts and then cannot find its
    # credentials.
    check "the tunnel runs in the checkout's cloudflared directory" \
        "systemctl cat $CLOUDFLARED_UNIT 2>/dev/null | grep -qx 'WorkingDirectory=$CLOUDFLARED_DIR'"
    # #136. Self-update is what failed silently for sixteen months; the package
    # is now upgraded by REQ-SERVER-006 instead.
    check "the tunnel does not self-update" \
        "systemctl cat $CLOUDFLARED_UNIT 2>/dev/null | grep -q -- '--no-autoupdate'"

    # Two daemons for one tunnel. `cloudflared service install` writes a
    # cloudflared.service and is the documented way to set this up, so it is
    # what a future repair session would reach for; cloudflared-custom.service
    # is the previous generation's unit. Either being enabled alongside ours
    # means requests are dealt between two processes and restarting "the
    # tunnel" fixes half of them.
    check "no other cloudflared unit is enabled" \
        'for u in cloudflared.service cloudflared-custom.service; do
             if systemctl is-enabled "$u" 2>/dev/null | grep -qx enabled; then exit 1; fi
         done; true'

    # AC 3 - the path is defined and private. The credentials are a bearer
    # token for every hostname this machine serves, so group or world read is a
    # finding, not a detail.
    if [ -d "$CLOUDFLARED_DIR" ]; then
        check "credentials directory exists" '[ -d "$CLOUDFLARED_CREDS_DIR" ]'
        check "credentials directory is mode 700" \
            '[ "$(stat -c %a "$CLOUDFLARED_CREDS_DIR" 2>/dev/null)" = 700 ]'
        check "credentials directory belongs to $DEPLOY_USER" \
            '[ "$(stat -c %U "$CLOUDFLARED_CREDS_DIR" 2>/dev/null)" = "$DEPLOY_USER" ]'
    else
        sk "credentials directory exists" "no $CLOUDFLARED_DIR in the checkout"
        sk "credentials directory is mode 700" "no $CLOUDFLARED_DIR in the checkout"
        sk "credentials directory belongs to $DEPLOY_USER" "no $CLOUDFLARED_DIR in the checkout"
    fi

    # AC 4, and the branch that matters is the SECOND one - it is the state
    # every VM run is in, and the state a freshly provisioned machine is in.
    #
    # Neither branch is a skip. "No credentials" is not a reason to assert
    # nothing; it is a reason to assert the refusal.
    if [ -f "$CLOUDFLARED_CONFIG" ] && [ -n "$(ls -A "$CLOUDFLARED_CREDS_DIR" 2> /dev/null)" ]; then
        check "$CLOUDFLARED_UNIT enabled (credentials are present)" \
            "systemctl is-enabled $CLOUDFLARED_UNIT"
    else
        check "the tunnel is NOT enabled while credentials are absent" \
            '[ "$(systemctl is-enabled "$CLOUDFLARED_UNIT" 2>&1)" != enabled ]'
        # The behavioural half, and the whole point of AC 4: a unit that
        # restarts forever against missing credentials floods the journal
        # (capped since #287, but still) and buries the real problem.
        #
        # Asking it to start is safe precisely because the credentials are
        # absent - there is no tunnel to disturb. A unit whose conditions are
        # unmet is SKIPPED: the start job succeeds, the unit stays inactive and
        # is never marked failed, so Restart= is never reached. A unit that
        # tried and failed would be `failed` or stuck `activating`, and both
        # are caught here.
        check "starting it without credentials refuses rather than looping" \
            'sudo -n systemctl start "$CLOUDFLARED_UNIT" > /dev/null 2>&1;
             sleep 2;
             [ "$(systemctl is-active "$CLOUDFLARED_UNIT" 2>&1)" = inactive ] \
             && [ "$(systemctl is-failed "$CLOUDFLARED_UNIT" 2>&1)" != failed ]'
    fi

    # The third corner of the triangle. The sudoers section above proves
    # deploy.sh and the sudoers drop-in name the same unit; this proves the
    # unit that actually exists is that same one. Without it all three could
    # agree on a name that nothing installed.
    # Same rule as the other two sections - #311.
    if deploy_script_expected; then
        check "the unit deploy.sh restarts is the unit that is installed" \
            'want=$(sed -n "s/^CLOUDFLARED_UNIT=\"\([^\"]*\)\".*/\1/p" "$DEPLOY_SCRIPT" | head -1);
             [ -n "$want" ] && [ -f "/usr/local/lib/systemd/system/$want" ]'
    else
        sk "the unit deploy.sh restarts is the unit that is installed" "$deploy_skip_reason"
    fi
else
    sk "cloudflared installed"                  "setup-server-environment.sh installs it"
    sk "cloudflare apt keyring present"         "setup-server-environment.sh fetches it"
    sk "exactly one cloudflared apt source"     "setup-server-environment.sh writes it"
    sk "cloudflared is dpkg-owned, not a manual binary drop" "setup-server-environment.sh installs it"
    sk "/usr/local/bin/cloudflared is the package symlink, not a binary" "setup-server-environment.sh installs it"
    sk "$CLOUDFLARED_UNIT installed in /usr/local/lib/systemd/system" "setup-server-environment.sh writes it"
    sk "the tunnel reads config.yml from the checkout" "setup-developer-environment.sh writes the unit"
    sk "the tunnel runs in the checkout's cloudflared directory" "setup-developer-environment.sh writes the unit"
    sk "the tunnel does not self-update"        "setup-server-environment.sh writes the unit"
    sk "no other cloudflared unit is enabled"   "setup-server-environment.sh disables them"
    sk "credentials directory exists"           "setup-server-environment.sh creates it"
    sk "credentials directory is mode 700"      "setup-server-environment.sh creates it"
    sk "credentials directory belongs to $DEPLOY_USER" "setup-server-environment.sh creates it"
    # Both names, because which of the two runs depends on whether the machine has
    # credentials and a reader of a firstboot log should be able to find either.
    sk "$CLOUDFLARED_UNIT enabled (credentials are present)" "setup-server-environment.sh decides this"
    sk "the tunnel is NOT enabled while credentials are absent" "setup-server-environment.sh decides this"
    sk "starting it without credentials refuses rather than looping" "setup-server-environment.sh writes the unit"
    sk "the unit deploy.sh restarts is the unit that is installed" "setup-server-environment.sh writes the unit"
fi

# REQ-NETWORK-005 - remote SSH through ngrok, #317.
#
# Like the tunnel, no VM has an authtoken and none ever will, so nothing here
# proves the agent connects or that a login from off the LAN works - the first
# proof of that is the machine itself. What it proves: the binary is a package,
# one agent at most, runs unprivileged, never gives up once it has a token,
# and without one refuses rather than loops. Plus the sshd half, which a VM
# CAN prove: loopback, where every ngrok login comes from, is exempt from
# sshd's per-source penalties.
echo
echo "== ngrok ssh tunnel (REQ-NETWORK-005) =="
NGROK_UNIT=custom-ngrok.service
NGROK_CONFIG="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)/.config/ngrok/ngrok.yml"
if [ "$PHASE" = provisioned ]; then
    check "ngrok installed" \
        'dpkg-query -W -f="\${Status}" ngrok 2>/dev/null | grep -q "^install ok installed"'
    check "exactly one ngrok apt source" \
        '[ "$(grep -rhs "ngrok-agent.s3.amazonaws.com" /etc/apt/sources.list /etc/apt/sources.list.d/ | grep -vc "^#")" = 1 ]'
    # The package itself installs /usr/local/bin/ngrok, so the path proves
    # nothing; who owns it does. A hand-dropped binary there is #135.
    check "ngrok is dpkg-owned, not a manual binary drop" \
        'dpkg -S /usr/local/bin/ngrok 2>/dev/null | grep -q "^ngrok:"'
    check "$NGROK_UNIT installed in /usr/local/lib/systemd/system" \
        "[ -f /usr/local/lib/systemd/system/$NGROK_UNIT ]"
    check "ngrok runs as $DEPLOY_USER" \
        "[ \"\$(systemctl show -p User --value $NGROK_UNIT)\" = '$DEPLOY_USER' ]"
    # The way back in must outlast an outage: no start limit, always restart.
    check "ngrok never stops retrying" \
        "[ \"\$(systemctl show -p StartLimitIntervalUSec --value $NGROK_UNIT)\" = 0 ] \
         && [ \"\$(systemctl show -p Restart --value $NGROK_UNIT)\" = always ]"
    check "no other ngrok unit is enabled" \
        'for u in ngrok.service ngrok-custom.service; do
             if systemctl is-enabled "$u" 2>/dev/null | grep -qx enabled; then exit 1; fi
         done; true'
    check "ngrok config directory is private to $DEPLOY_USER" \
        "[ \"\$(sudo -n stat -c '%a %U' \"\$(dirname '$NGROK_CONFIG')\" 2>/dev/null)\" = '700 $DEPLOY_USER' ]"
    if sudo -n grep -qs authtoken "$NGROK_CONFIG"; then
        check "$NGROK_UNIT enabled (authtoken present)" "systemctl is-enabled $NGROK_UNIT"
    else
        check "ngrok is NOT enabled while the authtoken is absent" \
            '[ "$(systemctl is-enabled "$NGROK_UNIT" 2>&1)" != enabled ]'
        # Safe to start: with no token there is no tunnel to disturb.
        check "starting ngrok without an authtoken refuses rather than looping" \
            'sudo -n systemctl start "$NGROK_UNIT" > /dev/null 2>&1;
             sleep 2;
             [ "$(systemctl is-active "$NGROK_UNIT" 2>&1)" = inactive ] \
             && [ "$(systemctl is-failed "$NGROK_UNIT" 2>&1)" != failed ]'
    fi
    check "tailscale installed" \
        'dpkg-query -W -f="\${Status}" tailscale 2>/dev/null | grep -q "^install ok installed"'
    check "tailscaled enabled"        'systemctl is-enabled tailscaled'
    check "tailscaled active"         'systemctl is-active tailscaled'
    # Logged in or not, the daemon must be healthy. A machine with no account
    # yet reports "Logged out", which is a normal state rather than a fault.
    check "tailscale reports its state" \
        'sudo -n tailscale status 2>&1 | grep -qE "Logged out|^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"'

    # Asked of sshd, not of the drop-in (#313's lesson). Skipped, not passed,
    # where sshd predates per-source penalties: there is nothing to exempt.
    # `case`, not `| grep -q`, for the pipefail/SIGPIPE reason in setup-server-environment.sh.
    case "$(sudo -n sshd -T 2> /dev/null || true)" in
        *persourcepenaltyexemptlist*) sshd_has_penalties=yes ;;
        *) sshd_has_penalties=no ;;
    esac
    echo "      sshd reports: $(sudo -n sshd -T 2> /dev/null | grep -i '^persourcepenalt' | tr '\n' ';' || true)"
    if [ "$sshd_has_penalties" = yes ]; then
        check "sshd exempts loopback from per-source penalties" \
            '[ "$(sshd_effective PerSourcePenaltyExemptList)" = "127.0.0.1,::1" ]'
    else
        sk "sshd exempts loopback from per-source penalties" "this sshd has no per-source penalties"
    fi
else
    sk "ngrok installed"                            "setup-server-environment.sh installs it"
    sk "exactly one ngrok apt source"               "setup-server-environment.sh writes it"
    sk "ngrok is dpkg-owned, not a manual binary drop" "setup-server-environment.sh installs it"
    sk "$NGROK_UNIT installed in /usr/local/lib/systemd/system" "setup-server-environment.sh writes it"
    sk "ngrok runs as $DEPLOY_USER"                 "setup-server-environment.sh writes the unit"
    sk "ngrok never stops retrying"                 "setup-server-environment.sh writes the unit"
    sk "no other ngrok unit is enabled"             "setup-server-environment.sh disables them"
    sk "ngrok config directory is private to $DEPLOY_USER" "setup-server-environment.sh creates it"
    sk "$NGROK_UNIT enabled (authtoken present)"    "setup-server-environment.sh decides this"
    sk "ngrok is NOT enabled while the authtoken is absent" "setup-server-environment.sh decides this"
    sk "starting ngrok without an authtoken refuses rather than looping" "setup-server-environment.sh writes the unit"
    sk "tailscale installed"          "setup-developer-environment.sh installs it"
    sk "tailscaled enabled"           "setup-developer-environment.sh enables it"
    sk "tailscaled active"            "setup-developer-environment.sh enables it"
    sk "tailscale reports its state"  "setup-developer-environment.sh installs it"
    sk "sshd exempts loopback from per-source penalties" "setup-server-environment.sh writes the drop-in"
fi

# REQ-SERVER-010 - the deploy user's shell, #290.
echo
echo "== interactive shell (REQ-SERVER-010) =="
if [ "$PHASE" = provisioned ]; then
    check "deploy user shell is zsh" \
        '[ "$(getent passwd "$DEPLOY_USER" | cut -d: -f7)" = "$(command -v zsh)" ]'
    check "oh-my-zsh and both plugins present" \
        'h=$(getent passwd "$DEPLOY_USER" | cut -d: -f6);
         sudo -n test -f "$h/.oh-my-zsh/oh-my-zsh.sh" \
         && sudo -n test -d "$h/.oh-my-zsh/custom/plugins/zsh-autosuggestions" \
         && sudo -n test -d "$h/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting"'
    # The VM harness hashes .zshrc either side of a second postinstall run and
    # leaves both lines here. On metal there is no second run, so no file.
    if [ -r /var/tmp/debbie-rerun ]; then
        check "shell config is idempotent" \
            '[ "$(wc -l < /var/tmp/debbie-rerun)" -eq 2 ] \
             && [ "$(sed -n 1p /var/tmp/debbie-rerun)" = "$(sed -n 2p /var/tmp/debbie-rerun)" ]'
    else
        sk "shell config is idempotent" "no second provisioning run on this host (the VM harness does one)"
    fi
    check "zsh starts cleanly with that config" \
        "sudo -n -u '$DEPLOY_USER' -i zsh -ic exit 2>&1 | grep -qiE 'error|not found|no such' && exit 1; true"
else
    sk "deploy user shell is zsh"            "setup-developer-environment.sh sets it"
    sk "oh-my-zsh and both plugins present"  "setup-developer-environment.sh installs them"
    sk "shell config is idempotent"          "setup-developer-environment.sh writes it"
    sk "zsh starts cleanly with that config" "setup-developer-environment.sh writes it"
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
# real machine: `find /etc/systemd/system -maxdepth 1 -type f` returns nothing.
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
# ufw is installed and enabled by setup-server-environment.sh, on purpose: enabling it
# during the install would close 22 before anything could provision the machine.
#
# READING `ufw status` IS NOT ENOUGH, and until #300 that is all this section
# did. Docker writes its own chains into `nat` and `filter`, and a container
# published with `-p 4000:4000` gets a DNAT rule consulted BEFORE ufw's - so
# the port answers from the LAN and `ufw status` never mentions it. The old
# "no other ports open" check therefore did not merely miss the hole: it
# reported green over it, because the tool it asked was not the tool that knew.
#
# The checks below are ordered from what the machine is CONFIGURED to do to what it
# is OBSERVED doing, and the later ones do not trust the earlier ones. The
# daemon default is a default, and an explicit `0.0.0.0:` in a compose file
# walks straight past it - measured, not assumed - so the socket, chain and
# probe checks all read the running system instead.
echo
echo "== firewall (REQ-SERVER-002) =="

# Every TCP socket listening on an address that is not loopback, minus the
# ports REQ-SERVER-002 opens. Printed as "addr:port", one per line; empty is
# the passing state.
#
# TCP only, deliberately. A DHCP client on 0.0.0.0:68, avahi's query socket and
# an NTP client all bind wildcard UDP for legitimate reasons, and enumerating
# them would make this red on a correct machine - the fastest way to get a security
# assertion switched off. Every port Docker publishes for this repository is
# TCP, and the nat-chain check below covers a UDP publish regardless.
# A webserver WITHOUT the tunnel role publishes its apps on the LAN on
# purpose (#329) - that is the only reason to run one - so on such a machine the
# app range 4000-4999 is expected off-loopback. Everywhere else, including the
# tunnel machine, nothing in it may be.
if [ -e /etc/seanorepo/roles/webserver ] && [ ! -e /etc/seanorepo/roles/tunnel ]; then
    LAN_APPS=yes
else
    LAN_APPS=no
fi
lan_tcp_listeners() {
    ss -H -ltn 2> /dev/null | awk -v lan_apps="$LAN_APPS" '
        {
            a = $4
            if (match(a, /:[0-9]+$/) == 0) next
            port = substr(a, RSTART + 1)
            addr = substr(a, 1, RSTART - 1)
            gsub(/^\[|\]$/, "", addr)
            if (port == "22" || port == "80" || port == "443") next
            if (lan_apps == "yes" && port >= 4000 && port <= 4999) next
            if (addr ~ /^127\./) next
            if (addr == "::1") next
            if (addr ~ /^::ffff:127\./) next
            print addr ":" port
        }'
}

# Every DNAT rule in the nat table's DOCKER chain that is NOT restricted to a
# loopback destination. That is exactly the shape of a port published to the
# LAN: with the daemon default in place the rule carries `-d 127.0.0.1/32`,
# and without it the rule has no `-d` at all and matches every address the machine
# holds. The chain not existing is vacuously fine - nothing has published yet.
#
# This is the half that survives `"userland-proxy": false`, under which a
# published port has no listening socket for the check above to see and the
# DNAT rule is the only evidence there is.
docker_lan_dnat() {
    sudo -n iptables -t nat -S DOCKER 2> /dev/null \
        | grep -- '-j DNAT' \
        | grep -v -- '-d 127\.' \
        | if [ "$LAN_APPS" = yes ]; then grep -vE -- '--dport 4[0-9]{3}( |$)'; else cat; fi
}

if [ "$PHASE" = provisioned ]; then
    check "ufw active"                'sudo -n ufw status | grep -q "Status: active"'
    check "22 open"                   'sudo -n ufw status | grep -q "^22/tcp"'
    check "80 open"                   'sudo -n ufw status | grep -q "^80/tcp"'
    check "443 open"                  'sudo -n ufw status | grep -q "^443/tcp"'
    check "5353 open"                 'sudo -n ufw status | grep -q "^5353/udp"'
    # ufw prints a v4 rule and a matching "(v6)" rule for every allow, so a
    # naive line count sees eight where four were asked for. Count v4 only.
    #
    # Renamed from "no other ports open", which is a claim this cannot make.
    # It says what ufw was asked for, and nothing about what Docker does behind
    # it - that is the next four checks.
    check "41641 open for tailscale"  'sudo -n ufw status | grep -q "^41641/udp"'
    check "the tailscale interface is trusted" \
        'sudo -n ufw status | grep -q "Anywhere on tailscale0"'
    check "ufw allows no port beyond the five" \
        '[ "$(sudo -n ufw status | grep -E "^[0-9]+/(tcp|udp)" | grep -vc "(v6)")" -eq 5 ]'

    # The configured default. `ip` is dockerd's `--ip`, "Host IP for port
    # publishing". Parsed with node rather than grepped, which also proves the
    # file is valid JSON - dockerd refuses to start on one that is not, so a
    # malformed daemon.json is a machine with no Docker rather than a machine with a
    # wrong default. node is on the machine by REQ-DEPLOY-004.
    check "docker publishes to loopback by default" \
        'node -e "process.exit(JSON.parse(require(\"fs\").readFileSync(\"/etc/docker/daemon.json\",\"utf8\")).ip === \"127.0.0.1\" ? 0 : 1)"'
    # Guards this section's own ground truth rather than the machine's security.
    # With the userland proxy on - the default - every published port shows as
    # a listening socket, which is what the next check reads. Turning it off
    # would not open anything, but it would make that check blind, and a check
    # that has quietly stopped looking is worse than one that is absent.
    check "docker's userland proxy is not disabled" \
        '[ -f /etc/docker/daemon.json ] \
         && ! grep -qE "\"userland-proxy\"[[:space:]]*:[[:space:]]*false" /etc/docker/daemon.json'

    # The two observed checks. Offenders are printed before the check runs,
    # because check() sends its output to /dev/null and a red line reading
    # "something listens on the LAN" with no name attached is a bad afternoon.
    lan_listeners="$(lan_tcp_listeners)"
    if [ -n "$lan_listeners" ]; then
        echo "  non-loopback TCP listeners:"
        # sed rather than an unquoted printf: ss writes a wildcard address as
        # `*:2375`, and an unquoted expansion would hand that to the glob.
        echo "$lan_listeners" | sed 's/^/    /'
    fi
    # The `grep :22` is not decoration. An `ss` that is missing, or that fails,
    # yields nothing, and "nothing" is indistinguishable from "no offenders" -
    # which is the precise failure this whole ticket is about: a check that
    # reports green because it asked something that could not answer. sshd
    # always listens on 22, so an empty result means the tool is broken rather
    # than the machine is clean, and this goes red instead.
    # Matched on the LOCAL ADDRESS column rather than on the whole line: `ss`
    # prints the peer column last, so every line ends "0.0.0.0:*" and anchoring
    # `:22$` against the line never matches. Found by writing it that way first.
    check "nothing outside the four ports listens on a non-loopback address" \
        'ss -H -ltn 2>/dev/null | awk "\$4 ~ /:22\$/" | grep -q . \
         && [ -z "$(lan_tcp_listeners)" ]'

    lan_dnat="$(docker_lan_dnat)"
    if [ -n "$lan_dnat" ]; then
        echo "  docker DNAT rules not restricted to loopback:"
        echo "$lan_dnat" | sed 's/^/    /'
    fi
    # Same guard, same reason. `iptables -t nat -S DOCKER` prints nothing when
    # the chain does not exist AND when the command could not run at all -
    # no binary, no privilege, or a Docker configured onto a firewall backend
    # this does not read. Requiring the wider `-t nat -S` to succeed first
    # separates "there is nothing to find" from "I could not look".
    check "no docker DNAT rule reaches a non-loopback address" \
        'sudo -n iptables -t nat -S > /dev/null 2>&1 && [ -z "$(docker_lan_dnat)" ]'

    #--------------------------------------------------------------------------
    # The live probe - #300 AC 4.
    #
    # Everything above reads a machine that may simply have nothing published on it,
    # and on a freshly provisioned VM that is exactly the case: no `release`
    # branch, no deploy, no containers. Three green checks against an empty
    # `nat` table prove nothing at all about what happens when a container does
    # publish a port, which is the only moment that matters.
    #
    # So publish one, deliberately, and look. A high port outside 4000-4061 so
    # it cannot collide with a real service, for the two seconds it takes.
    #
    # The two halves are asserted together and neither is sufficient alone. A
    # refused connection to the machine's own LAN address is also what you get from
    # a probe that never started, so "the socket exists, and it is loopback" is
    # what makes the refusal mean something.
    #
    # NOT AN OFF-HOST TEST, and the README says so in as many words. The
    # connection below leaves from the machine and arrives at the machine. What it
    # proves is the BINDING: a socket bound to 127.0.0.1 does not accept a
    # connection addressed to 10.0.2.15, whoever sends it. Whether a packet
    # from another machine is also refused at the wire is the metal run's to
    # prove - QEMU's slirp networking gives the guest no LAN peer to be refused
    # from.
    #--------------------------------------------------------------------------
    PROBE_PORT="${PROBE_PORT:-49231}"
    PROBE_IMAGE="${PROBE_IMAGE:-busybox}"
    PROBE_NAME=assert-port-probe

    probe_ready=0
    probe_pulled=0
    if docker image inspect "$PROBE_IMAGE" > /dev/null 2>&1; then
        probe_ready=1
    elif docker pull -q "$PROBE_IMAGE" > /dev/null 2>&1; then
        probe_ready=1
        probe_pulled=1
    fi

    if [ "$probe_ready" = 1 ]; then
        docker rm -f "$PROBE_NAME" > /dev/null 2>&1
        # No host address on the -p, on purpose: this is the exact shape every
        # apps/*/docker-compose.yml uses, so what is measured here is what the
        # deploy will do.
        #
        # A REAL LISTENER INSIDE, not `sleep`. Publishing alone binds the host
        # socket, so `sleep` is enough for the binding check - but it is not
        # enough for the connection check below, and that difference was found
        # by running this against a deliberately LAN-published port: with an
        # empty container the connection is refused by the BACKEND, so the
        # check passed while the port was wide open. busybox's httpd answers,
        # which makes a refusal mean the host-side binding and nothing else.
        docker run -d --name "$PROBE_NAME" -p "$PROBE_PORT:$PROBE_PORT" \
            "$PROBE_IMAGE" httpd -f -p "$PROBE_PORT" -h /tmp > /dev/null 2>&1
        sleep 2

        probe_bound="$(ss -H -ltn "sport = :$PROBE_PORT" 2> /dev/null | awk '{print $4}')"

        # The machine's own routable address - 10.0.2.15 under slirp, the LAN
        # address on metal. `scope global` excludes 127.0.0.1, which would
        # answer and prove nothing.
        probe_lan_addr="$(ip -4 -o addr show scope global 2> /dev/null \
            | awk '{print $4}' | cut -d/ -f1 | head -1)"
        probe_lan=unknown
        if [ -n "$probe_lan_addr" ]; then
            if timeout 4 bash -c "exec 3<>/dev/tcp/$probe_lan_addr/$PROBE_PORT" 2> /dev/null; then
                probe_lan=open
            else
                probe_lan=refused
            fi
        fi

        docker rm -f "$PROBE_NAME" > /dev/null 2>&1
        # Only if we brought it. Removing an image the machine already had would be
        # an assertion with a side effect on the thing it is asserting about.
        if [ "$probe_pulled" = 1 ]; then
            docker rmi -f "$PROBE_IMAGE" > /dev/null 2>&1
        fi

        if [ -n "$probe_bound" ]; then
            echo "  probe on $PROBE_PORT bound: $(printf '%s' "$probe_bound" | tr '\n' ' ')"
        fi
        echo "  probe reached at ${probe_lan_addr:-no routable address}: $probe_lan"
        # Non-empty is half the claim - an empty result is a probe that never
        # published, not a port that is closed.
        check "a deliberately published port binds loopback and nothing else" \
            '[ -n "$probe_bound" ] \
             && ! printf "%s\n" "$probe_bound" | grep -qvE "^(127\.[0-9.]+|\[::1\]):[0-9]+$"'
        if [ -n "$probe_lan_addr" ]; then
            check "that port refuses a connection to the host's own routable address" \
                '[ "$probe_lan" = refused ]'
        else
            sk "that port refuses a connection to the host's own routable address" \
                "no globally scoped address on this host"
        fi
    else
        # Honest rather than silent. The probe needs one small image and the
        # machine may have no route to a registry; saying so beats a green run that
        # quietly asserted nothing.
        sk "a deliberately published port binds loopback and nothing else" \
            "could not obtain the $PROBE_IMAGE image to publish a port with"
        sk "that port refuses a connection to the host's own routable address" \
            "could not obtain the $PROBE_IMAGE image to publish a port with"
    fi
else
    sk "ufw active" "setup-server-environment.sh installs and enables it"
    sk "22 open"    "setup-server-environment.sh installs and enables it"
    sk "80 open"    "setup-server-environment.sh installs and enables it"
    sk "443 open"   "setup-server-environment.sh installs and enables it"
    sk "5353 open"  "setup-server-environment.sh installs and enables it"
    sk "41641 open for tailscale"     "setup-server-environment.sh opens it"
    sk "the tailscale interface is trusted" "setup-server-environment.sh allows it"
    sk "ufw allows no port beyond the five" "setup-server-environment.sh installs and enables it"
    sk "docker publishes to loopback by default" "setup-server-environment.sh writes daemon.json"
    sk "docker's userland proxy is not disabled" "setup-server-environment.sh writes daemon.json"
    sk "nothing outside the four ports listens on a non-loopback address" \
        "setup-developer-environment.sh installs docker and the firewall"
    sk "no docker DNAT rule reaches a non-loopback address" "setup-server-environment.sh installs docker"
    sk "a deliberately published port binds loopback and nothing else" "setup-server-environment.sh installs docker"
    sk "that port refuses a connection to the host's own routable address" "setup-developer-environment.sh installs docker"
fi

echo
if [ "$skip" -gt 0 ]; then
    echo "passed $pass, failed $fail, skipped $skip"
else
    echo "passed $pass, failed $fail"
fi
[ "$fail" -eq 0 ]
