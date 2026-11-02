#!/usr/bin/env bash
# Boot the bootmap kernel one time, then reboot. The next boot after that is
# the stock kernel again, so a power cycle always gets the machine back.
#
#   hw/boot-once.sh <host> [machine]
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

"${SSH[@]}" sudo bash -s << 'REMOTE'
set -euo pipefail
K="$(ls /boot/vmlinuz-*-bootmap | sed 's|/boot/vmlinuz-||' | sort -V | tail -1)"
grub-reboot "Debian GNU/Linux, with Linux $K"
echo "boot-once: next boot: $K. Rebooting."
systemd-run --on-active=2 systemctl reboot
REMOTE
