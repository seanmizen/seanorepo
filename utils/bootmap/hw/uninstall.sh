#!/usr/bin/env bash
# Remove everything that hw/install.sh added.
#
#   hw/uninstall.sh <host> [machine]
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

"${SSH[@]}" sudo bash -s << 'REMOTE'
set -euo pipefail
systemctl disable bootmapd.service 2> /dev/null || true
rm -f /etc/systemd/system/bootmapd.service /usr/local/lib/bootmap/bootmapd
rmdir /usr/local/lib/bootmap 2> /dev/null || true
systemctl daemon-reload
rm -f /etc/default/grub.d/bootmap.cfg /etc/grub.d/01_bootmap
rm -f /boot/grub/themes/bootmap/*
rmdir /boot/grub/themes/bootmap 2> /dev/null || true
dpkg -l 'linux-image-*-bootmap' 2> /dev/null | awk '/^ii/ {print $2}' | xargs -r apt-get remove -y
update-grub
grub-set-default 0
echo "uninstall: done"
REMOTE
