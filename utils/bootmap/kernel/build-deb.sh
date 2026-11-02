#!/usr/bin/env bash
# Build a bootmap kernel as Debian packages for a real machine.
#
#   kernel/build-deb.sh <machine>
#
# Needs working/<machine>/config (the machine's /boot/config-*) and
# working/<machine>/lsmod (its lsmod output). The build:
#   1. a second worktree of working/linux, so the QEMU kernel stays,
#   2. the machine's config, cut to the modules it loads (localmodconfig),
#   3. kernel/bootmap-hw.config on top,
#   4. make bindeb-pkg: working/<machine>/linux-image-*-bootmap*.deb.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
M="${1:?usage: kernel/build-deb.sh <machine>}"
OUT="$ROOT/working/$M"
SRC="$ROOT/working/linux-hw"

[ -f "$OUT/config" ] && [ -f "$OUT/lsmod" ] || { echo "build-deb: need $OUT/config and $OUT/lsmod" >&2; exit 1; }
[ -d "$ROOT/working/linux/.git" ] || { echo "build-deb: run kernel/fetch-and-build.sh first" >&2; exit 1; }
if [ ! -d "$SRC" ]; then
    git -C "$ROOT/working/linux" worktree add --detach "$SRC" HEAD
fi

mkdir -p "$SRC/drivers/video/bootmap"
cp "$HERE/bootmap.c" "$HERE/bootmap_layout.c" "$HERE/bootmap_layout.h" \
    "$HERE/bootmap_palette.h" "$HERE/bootmap_font.h" \
    "$HERE/Kconfig" "$HERE/Makefile" "$SRC/drivers/video/bootmap/"
cd "$SRC"
git apply --check "$HERE/0001-bootmap-hooks.patch" 2> /dev/null && git apply "$HERE/0001-bootmap-hooks.patch"

cp "$OUT/config" .config
# Debian's config names Debian's signing keys. This kernel is unsigned.
scripts/config --set-str SYSTEM_TRUSTED_KEYS "" --set-str SYSTEM_REVOCATION_KEYS "" \
    --disable MODULE_SIG_ALL --set-str MODULE_SIG_KEY "certs/signing_key.pem"
make -s olddefconfig
make -s LSMOD="$OUT/lsmod" localmodconfig < <(yes '') > /dev/null
scripts/kconfig/merge_config.sh -m -O . .config "$HERE/bootmap-hw.config" > /dev/null
make -s olddefconfig
for opt in CONFIG_BOOTMAP=y CONFIG_DRM_SIMPLEDRM=y CONFIG_FRAMEBUFFER_CONSOLE_DEFERRED_TAKEOVER=y; do
    grep -qx "$opt" .config || { echo "build-deb: $opt is not in .config" >&2; exit 1; }
done
if grep -q '^CONFIG_DRM_I915=' .config; then
    echo "build-deb: i915 is still in .config" >&2
    exit 1
fi

# Compile first: bindeb-pkg checks its build packages (debhelper, rsync)
# before it compiles, so a missing package costs no compile time.
make -s -j"$(nproc)" LOCALVERSION=-bootmap bzImage modules
make -s -j"$(nproc)" bindeb-pkg LOCALVERSION=-bootmap KDEB_PKGVERSION="$(date +%Y%m%d%H%M)"
mv ../linux-image-*-bootmap*.deb "$OUT/" 2> /dev/null || true
rm -f ../linux-*.buildinfo ../linux-*.changes
ls -la "$OUT"/*.deb
