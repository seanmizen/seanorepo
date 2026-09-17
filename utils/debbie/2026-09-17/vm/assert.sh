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
set -uo pipefail

EXPECT_ARCH="${EXPECT_ARCH:-}"
EXPECT_HOSTNAME="${EXPECT_HOSTNAME:-debbie}"
DEPLOY_USER="${DEPLOY_USER:-srv}"

pass=0
fail=0
skip=0

ok()   { printf '  \033[32m/\033[0m %s\n' "$1"; pass=$((pass + 1)); }
no()   { printf '  \033[31mX\033[0m %s\n' "$1"; fail=$((fail + 1)); }
sk()   { printf '  \033[33m-\033[0m %s \033[33m(skipped: %s)\033[0m\n' "$1" "$2"; skip=$((skip + 1)); }
check() { if eval "$2" > /dev/null 2>&1; then ok "$1"; else no "$1"; fi; }

echo "== system =="
if [ -n "$EXPECT_ARCH" ]; then
    # Catches a harness mix-up: the wrong netboot images for the chosen guest.
    check "architecture is $EXPECT_ARCH" "[ \"\$(dpkg --print-architecture)\" = '$EXPECT_ARCH' ]"
fi
check "Debian 13 (trixie)"        '. /etc/os-release; [ "$VERSION_CODENAME" = trixie ]'
check "hostname is $EXPECT_HOSTNAME" "[ \"\$(hostname)\" = '$EXPECT_HOSTNAME' ]"
check "timezone is Europe/London" '[ "$(timedatectl show -p Timezone --value)" = Europe/London ]'
check "DNS and routing work"      'getent hosts deb.debian.org'

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

echo "== services =="
check "systemd reached a steady state" 'systemctl is-system-running --wait | grep -qE "running|degraded"'
check "ssh enabled"               'systemctl is-enabled ssh'
check "ssh active"                'systemctl is-active ssh'
check "headless (no display manager)" '! systemctl list-unit-files | grep -qE "^(gdm3?|sddm|lightdm)\.service"'

echo "== provisioning =="
# REQ-SERVER-003
check "user $DEPLOY_USER exists"  "id '$DEPLOY_USER'"
check "$DEPLOY_USER in sudo"      "id -nG '$DEPLOY_USER' | tr ' ' '\n' | grep -qx sudo"
check "$DEPLOY_USER in docker"    "id -nG '$DEPLOY_USER' | tr ' ' '\n' | grep -qx docker"
check "passwordless sudo works"   'sudo -n true'

# REQ-SERVER-004
check "avahi-daemon active"       'systemctl is-active avahi-daemon'

# REQ-SERVER-001 - asserted after a reboot, which is when the drop-in takes
# effect. postinstall.sh deliberately does not restart logind.
check "lid-close drop-in present" '[ -f /etc/systemd/logind.conf.d/10-debbie-nosleep.conf ]'
check "lid close ignored"         '[ "$(loginctl show-seat seat0 -p IdleAction --value 2>/dev/null || busctl get-property org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager HandleLidSwitch 2>/dev/null | awk "{print \$2}" | tr -d \")" = ignore ] || grep -q "^HandleLidSwitch=ignore" /etc/systemd/logind.conf.d/10-debbie-nosleep.conf'
check "sleep.target masked"       '[ "$(systemctl is-enabled sleep.target 2>&1)" = masked ]'

# REQ-SERVER-005 - only meaningful on a wireless host. Skipped rather than
# passed in a VM: QEMU has no 802.11 device the installer would drive, so a
# green VM run says nothing at all about this and must not pretend otherwise.
echo "== network =="
if [ -n "$(ls -d /sys/class/net/*/wireless 2> /dev/null)" ]; then
    # netcfg persists wifi as an ifupdown stanza plus wpasupplicant in the
    # target. Either that, or a NetworkManager profile once REQ-NETWORK-* lands.
    check "wifi config persisted" \
        'sudo -n grep -rqs "wpa-ssid\|wpa-psk" /etc/network/interfaces /etc/network/interfaces.d/ \
         || sudo -n grep -rqs "^ssid=\|wifi.ssid" /etc/NetworkManager/system-connections/'
    check "a wireless interface has an address" \
        'for w in /sys/class/net/*/wireless; do i=$(basename "$(dirname "$w")"); ip -4 -o addr show "$i" | grep -q inet && exit 0; done; exit 1'
else
    sk "wifi config persisted" "no wireless interface"
fi

# REQ-SERVER-002 - exactly four ports, nothing else. An extra open port is a
# failure, not a curiosity, so the count is asserted as well as the members.
echo "== firewall =="
check "ufw active"                'sudo -n ufw status | grep -q "Status: active"'
check "22 open"                   'sudo -n ufw status | grep -q "^22/tcp"'
check "80 open"                   'sudo -n ufw status | grep -q "^80/tcp"'
check "443 open"                  'sudo -n ufw status | grep -q "^443/tcp"'
check "5353 open"                 'sudo -n ufw status | grep -q "^5353/udp"'
# ufw prints a v4 rule and a matching "(v6)" rule for every allow, so a naive
# line count sees eight where four were asked for. Count the v4 lines only.
check "no other ports open"       '[ "$(sudo -n ufw status | grep -E "^[0-9]+/(tcp|udp)" | grep -vc "(v6)")" -eq 4 ]'

echo
if [ "$skip" -gt 0 ]; then
    echo "passed $pass, failed $fail, skipped $skip"
else
    echo "passed $pass, failed $fail"
fi
[ "$fail" -eq 0 ]
