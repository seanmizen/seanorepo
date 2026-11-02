#!/usr/bin/env bash
# Install bootmap on a real Debian machine, over SSH. Nothing is reinstalled:
# this adds a kernel, a daemon and a GRUB theme, and keeps the stock kernel
# as the default. hw/boot-once.sh boots the bootmap kernel one time.
#
#   hw/install.sh <host> [machine]        machine: working/<machine>/ (surface)
#
# Before: kernel/build-deb.sh <machine>. Set BOOTMAP_THEME_SCALE (default 2,
# for a HiDPI screen) and BOOTMAP_ARGS (more kernel parameters).
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

DEB="$(ls "$HW_ROOT/working/$MACHINE"/linux-image-*-bootmap_*.deb 2> /dev/null | grep -v -- -dbg | tail -1 || true)"
[ -n "$DEB" ] || die "no kernel package in working/$MACHINE. Run kernel/build-deb.sh $MACHINE"

(cd "$HW_ROOT" && zig build)
THEME="$HW_ROOT/working/$MACHINE/theme"
python3 "$HW_ROOT/grub/make-theme.py" "$THEME" --scale "${BOOTMAP_THEME_SCALE:-2}"

DIR="$("${SSH[@]}" mktemp -d /tmp/bootmap-install.XXXXXX)"
"${SCP[@]}" "$DEB" "$HW_ROOT/zig-out/bin/bootmapd" "$SSH_USER@$HOST:$DIR/"
# Secure Boot: the signed kernel image, and the key to enrol (see
# kernel/build-deb.sh). MOK_PASSWORD is typed one time at the machine, in
# MokManager, at the next boot.
MOK="$HW_ROOT/working/$MACHINE/mok"
SIGNED=0
if [ -f "$HW_ROOT/working/$MACHINE/vmlinuz.signed" ] && [ -f "$MOK/MOK.der" ]; then
    "${SCP[@]}" "$HW_ROOT/working/$MACHINE/vmlinuz.signed" "$MOK/MOK.der" "$SSH_USER@$HOST:$DIR/"
    SIGNED=1
fi
"${SSH[@]}" mkdir -p "$DIR/theme"
"${SCP[@]}" "$THEME"/* "$SSH_USER@$HOST:$DIR/theme/"

ARGS="quiet loglevel=3 bootmap.daemon=1 bootmap.stages=0,0,30,10,60 ${BOOTMAP_ARGS:-}"
"${SSH[@]}" sudo DIR="$DIR" ARGS="'$ARGS'" SIGNED="$SIGNED" MOK_PASSWORD="'${MOK_PASSWORD:-bootmap}'" bash -s << 'REMOTE'
set -euo pipefail
STOCK="$(ls /boot/vmlinuz-* | grep -v bootmap | sed 's|/boot/vmlinuz-||' | sort -V | tail -1)"


install -D -m 755 "$DIR/bootmapd" /usr/local/lib/bootmap/bootmapd
cat > /etc/systemd/system/bootmapd.service << UNIT
[Unit]
Description=bootmap: draw the boot as a live treemap
DefaultDependencies=no
ConditionKernelCommandLine=bootmap.daemon=1
ConditionPathExists=/proc/bootmap
Before=sysinit.target
[Service]
Type=simple
ExecStart=/usr/local/lib/bootmap/bootmapd
[Install]
WantedBy=sysinit.target
UNIT
systemctl daemon-reload
systemctl enable bootmapd.service

mkdir -p /boot/grub/themes/bootmap
cp "$DIR"/theme/* /boot/grub/themes/bootmap/
cat > /etc/default/grub.d/bootmap.cfg << CFG
# bootmap (utils/bootmap/hw/install.sh). hw/uninstall.sh removes it.
GRUB_THEME=/boot/grub/themes/bootmap/theme.txt
GRUB_TERMINAL_OUTPUT=gfxterm
GRUB_GFXMODE=auto
# The kernel keeps GRUB's screen mode: the treemap comes next, in the same mode.
GRUB_GFXPAYLOAD_LINUX=keep
# One entry for each kernel, so the stock kernel can be the saved default.
GRUB_DISABLE_SUBMENU=y
GRUB_DEFAULT=saved
GRUB_CMDLINE_LINUX_DEFAULT="$ARGS"
CFG
# The kernel package runs update-grub itself, so the theme and the snippet
# above must exist before it. dpkg --configure -a finishes an install that
# an earlier run left half done.
dpkg --configure -a
dpkg -i "$DIR"/linux-image-*.deb
if [ "$SIGNED" = 1 ]; then
    V="$(ls /boot/vmlinuz-*-bootmap | sed 's|/boot/vmlinuz-||' | sort -V | tail -1)"
    install -m 644 "$DIR/vmlinuz.signed" "/boot/vmlinuz-$V"
    if mokutil --test-key "$DIR/MOK.der" 2> /dev/null | grep -q "is already enrolled"; then
        echo "install: the MOK key is enrolled"
    else
        mokutil --generate-hash="$MOK_PASSWORD" > "$DIR/mok.hash"
        mokutil --import "$DIR/MOK.der" --hash-file "$DIR/mok.hash"
        echo "install: the MOK key waits for enrolment at the next boot (MokManager)"
    fi
fi
update-grub
grub-set-default "Debian GNU/Linux, with Linux $STOCK"
rm -rf "$DIR"
echo "install: done. The default stays Debian GNU/Linux, with Linux $STOCK."
grep -o "menuentry '[^']*'" /boot/grub/grub.cfg
REMOTE
