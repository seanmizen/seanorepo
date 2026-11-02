#!/usr/bin/env bash
# Install bootmap on a real Debian machine, over SSH. Nothing is reinstalled:
# this adds a kernel, a daemon and a GRUB theme, and keeps the stock kernel
# as the default. hw/boot-once.sh boots the bootmap kernel one time.
#
#   hw/install.sh <host> [machine]        machine: working/<machine>/ (surface)
#
# Before: kernel/build-deb.sh <machine>. Set BOOTMAP_THEME_SCALE (default 2,
# for a HiDPI screen), BOOTMAP_ARGS (more kernel parameters), BOOTMAP_GPU (the
# GPU driver modules to hold back, default i915), and BOOTMAP_DEFAULT=1 to
# make the bootmap kernel the default boot.
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
    # The key's SHA1 fingerprint, as mokutil --list-enrolled prints it.
    MOK_FP="$(openssl x509 -inform DER -in "$MOK/MOK.der" -noout -fingerprint -sha1 | cut -d= -f2 | tr 'A-F' 'a-f')"
fi
"${SSH[@]}" mkdir -p "$DIR/theme" "$DIR/initramfs"
"${SCP[@]}" "$HW_HERE"/initramfs/* "$SSH_USER@$HOST:$DIR/initramfs/"
"${SCP[@]}" "$THEME"/* "$SSH_USER@$HOST:$DIR/theme/"

GPU="${BOOTMAP_GPU:-i915}"
ARGS="quiet loglevel=3 bootmap.daemon=1 bootmap.stages=0,0,30,10,60 bootmap.gpu=$GPU ${BOOTMAP_ARGS:-}"
"${SSH[@]}" sudo DIR="$DIR" ARGS="'$ARGS'" MOK_FP="${MOK_FP:-}" GPU="$GPU" DEFAULT="${BOOTMAP_DEFAULT:-0}" SIGNED="$SIGNED" MOK_PASSWORD="'${MOK_PASSWORD:-bootmap}'" bash -s << 'REMOTE'
set -euo pipefail
STOCK="$(ls /boot/vmlinuz-* | grep -v bootmap | sed 's|/boot/vmlinuz-||' | sort -V | tail -1)"


install -D -m 755 "$DIR/bootmapd" /usr/local/lib/bootmap/bootmapd
cat > /etc/systemd/system/bootmapd.service << UNIT
[Unit]
Description=bootmap: draw the boot as a live treemap
DefaultDependencies=no
ConditionKernelCommandLine=bootmap.daemon=1
ConditionPathExists=/proc/bootmap
# The initramfs started bootmapd already (hw/initramfs/init-top).
ConditionPathExists=!/run/bootmap.pid
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
# A short menu: no recovery entries (the stock kernel stays as a fallback).
GRUB_DISABLE_RECOVERY=true
GRUB_DEFAULT=saved
GRUB_CMDLINE_LINUX_DEFAULT="$ARGS"
# No menu: boot the default entry at once. Before it boots, GRUB reads one
# key. A held F4 (or Esc) opens the menu. On a Surface, the firmware takes
# a held Esc and opens its setup, so use F4.
GRUB_TIMEOUT=0
GRUB_TIMEOUT_STYLE=hidden
CFG
# The GPU driver waits on the bootmap kernel until bootmapd has given the
# screen to the console: a GPU driver takes the screen from simpledrm. The
# rule is in the initramfs too (dpkg -i below makes it). Other kernels load
# the driver as usual.
: > /etc/modprobe.d/bootmap-gpu.conf
echo "# bootmap (hw/install.sh): on the bootmap kernel, wait for bootmapd." >> /etc/modprobe.d/bootmap-gpu.conf
for m in $(echo "$GPU" | tr ',' ' '); do
    echo "install $m /bin/sh -c 'case \"\$(uname -r)\" in *-bootmap) [ -e /run/bootmap-gpu ] || exit 0 ;; esac; exec /sbin/modprobe --ignore-install $m \$CMDLINE_OPTS'" >> /etc/modprobe.d/bootmap-gpu.conf
done

# bootmapd in the initramfs, from its start (hw/initramfs/). dpkg -i below
# makes the bootmap initramfs with them.
install -D -m 755 "$DIR/initramfs/hook" /etc/initramfs-tools/hooks/bootmap
install -D -m 755 "$DIR/initramfs/init-top" /etc/initramfs-tools/scripts/init-top/bootmap
install -D -m 755 "$DIR/initramfs/init-bottom" /etc/initramfs-tools/scripts/init-bottom/bootmap

# The kernel package runs update-grub itself, so the theme and the snippet
# above must exist before it. dpkg --configure -a finishes an install that
# an earlier run left half done.
dpkg --configure -a
dpkg -i "$DIR"/linux-image-*.deb
# A reinstall of the same package version can keep the old initramfs.
update-initramfs -u -k "$(ls /boot/vmlinuz-*-bootmap | sed 's|/boot/vmlinuz-||' | sort -V | tail -1)"
if [ "$SIGNED" = 1 ]; then
    V="$(ls /boot/vmlinuz-*-bootmap | sed 's|/boot/vmlinuz-||' | sort -V | tail -1)"
    install -m 644 "$DIR/vmlinuz.signed" "/boot/vmlinuz-$V"
    # Compare fingerprints. mokutil --test-key gives different words (on
    # stderr) when the running kernel was built with the key.
    # No "| grep -q" here: with pipefail, grep -q stops early, mokutil gets
    # SIGPIPE, and the test fails although the key is there.
    ENROLLED="$(mokutil --list-enrolled 2> /dev/null | tr 'A-F' 'a-f' || true)"
    if [ -n "$MOK_FP" ] && [ "${ENROLLED#*"$MOK_FP"}" != "$ENROLLED" ]; then
        echo "install: the MOK key is enrolled"
    else
        mokutil --generate-hash="$MOK_PASSWORD" > "$DIR/mok.hash"
        mokutil --import "$DIR/MOK.der" --hash-file "$DIR/mok.hash"
        echo "install: the MOK key waits for enrolment at the next boot (MokManager)"
    fi
fi
update-grub
BM="$(ls /boot/vmlinuz-*-bootmap | sed 's|/boot/vmlinuz-||' | sort -V | tail -1)"
if [ "$DEFAULT" = 1 ]; then
    grub-set-default "Debian GNU/Linux, with Linux $BM"
    echo "install: done. The default is the bootmap kernel $BM. The stock kernel $STOCK is in the menu."
else
    grub-set-default "Debian GNU/Linux, with Linux $STOCK"
    echo "install: done. The default stays Debian GNU/Linux, with Linux $STOCK."
fi
rm -rf "$DIR"
grep -o "menuentry '[^']*'" /boot/grub/grub.cfg
REMOTE
