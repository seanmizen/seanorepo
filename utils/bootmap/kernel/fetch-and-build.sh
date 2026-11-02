#!/usr/bin/env bash
# Build a Linux kernel with bootmap.
#
#   kernel/fetch-and-build.sh        -> working/linux/arch/x86/boot/bzImage
#
# 1. Clone the pinned stable tag into working/linux (once).
# 2. Copy bootmap.c, bootmap_layout.[ch], Kconfig and Makefile into
#    drivers/video/bootmap/.
# 3. Apply 0001-bootmap-hooks.patch (the Kconfig and Makefile hooks).
# 4. Configure: x86_64_defconfig + kvm_guest.config + bootmap.config.
# 5. Build bzImage.
#
# Run it again after each change: steps 2 to 5 are safe to repeat.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
SRC="$ROOT/working/linux"
TAG="${BOOTMAP_KERNEL_TAG:-v6.12.113}"

if [ ! -d "$SRC/.git" ]; then
    git clone --depth 1 --branch "$TAG" \
        https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git "$SRC"
fi

mkdir -p "$SRC/drivers/video/bootmap"
cp "$HERE/bootmap.c" "$HERE/bootmap_layout.c" "$HERE/bootmap_layout.h" \
    "$HERE/Kconfig" "$HERE/Makefile" "$SRC/drivers/video/bootmap/"

cd "$SRC"
if git apply --check "$HERE/0001-bootmap-hooks.patch" 2> /dev/null; then
    git apply "$HERE/0001-bootmap-hooks.patch"
elif ! git apply --check --reverse "$HERE/0001-bootmap-hooks.patch" 2> /dev/null; then
    echo "fetch-and-build: 0001-bootmap-hooks.patch does not apply to $TAG" >&2
    exit 1
fi

make -s defconfig
make -s kvm_guest.config
scripts/kconfig/merge_config.sh -m -O . .config "$HERE/bootmap.config" > /dev/null
make -s olddefconfig
for opt in CONFIG_BOOTMAP=y CONFIG_TRACEPOINTS=y CONFIG_DRM_SIMPLEDRM=y; do
    grep -qx "$opt" .config || { echo "fetch-and-build: $opt is not in .config" >&2; exit 1; }
done

make -s -j"$(nproc)" bzImage
echo "fetch-and-build: $SRC/arch/x86/boot/bzImage"
