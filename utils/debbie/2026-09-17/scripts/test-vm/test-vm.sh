#!/bin/bash
# test-vm.sh: installs Debian 13 in a VM on your computer, configures it with
# setup-server-environment.sh, and checks it with assert.sh.
#
# Where: your computer, with QEMU.
# When:  after every change to preseed.cfg, setup-server-environment.sh or assert.sh, and
#        before any hardware install.
# Why:   it tests a change in minutes, with no hardware and no console to
#        watch. The result is an exit code. ../../README.md lists what a VM
#        run cannot test.
#
# Usage:
#   ./test-vm.sh --full      install, boot, configure, check (the usual one)
#   ./test-vm.sh --install   install only
#   ./test-vm.sh --assert    boot the cached install, configure it, check it
#   ./test-vm.sh --clean     delete the cached images and runs
#
# Exit codes (REQ-EMU-003):
#   0   every check passed
#   1   a check failed
#   2   the install failed
#   3   no SSH, or the reboot was not proved (see wait_for_ssh)
#   124 a stage hit its time limit
set -euo pipefail
IFS=$'\n\t'

HERE="$(cd "$(dirname "$0")" && pwd)"
GEN_DIR="$(dirname "$(dirname "$HERE")")"   # scripts/test-vm -> the generation
WORK="$GEN_DIR/working/vm"
CACHE="$WORK/cache"

SUITE="${SUITE:-trixie}"
RAM="${RAM:-2048}"
DISK_SIZE="${DISK_SIZE:-20G}"
DEPLOY_USER="${DEPLOY_USER:-srv}"
SERVER_NAME="${SERVER_NAME:-debbie}"
# Roles (REQ-SERVER-014). None by default, like a machine whose .env sets
# none: the VM then proves that a machine with no role tracks `release` and
# runs nothing. Set either one in the environment to give the guest that role.
ROLE_WEBSERVER="${ROLE_WEBSERVER:-}"
ROLE_TUNNEL="${ROLE_TUNNEL:-}"
EXPECT_ROLES="$( { [ "$ROLE_WEBSERVER" = yes ] && echo webserver; [ "$ROLE_TUNNEL" = yes ] && echo tunnel; true; } | tr '\n' ' ' | sed 's/ $//')"
INSTALL_TIMEOUT="${INSTALL_TIMEOUT:-3600}"
SSH_TIMEOUT="${SSH_TIMEOUT:-180}"

die_code() { local c=$1; shift; echo "ERROR: $*" >&2; exit "$c"; }
# log, warn, die, installer_params and write_overrides, shared with the
# hardware steps so a VM install and a hardware install cannot differ.
# shellcheck source=../lib.sh
. "$GEN_DIR/scripts/lib.sh"

# GNU coreutils timeout is `gtimeout` under Homebrew, `timeout` on Debian.
if command -v gtimeout > /dev/null 2>&1; then TIMEOUT=gtimeout
elif command -v timeout > /dev/null 2>&1; then TIMEOUT=timeout
else die "no timeout(1) found. macOS: brew install coreutils. A POSIX shell on Windows ships neither timeout nor python3, both of which this needs - install MSYS2 coreutils and python, or use WSL2"; fi

#==============================================================================
# Host -> guest -> accelerator - REQ-EMU-001
#
# The guest architecture comes FROM the host, through this one table. Two
# separate settings would allow a pair that cannot work, such as hvf for an
# x86_64 binary on an arm64 Mac. With one derived from the other, that pair
# cannot exist.
#==============================================================================
resolve_target() {
    local os arch
    os="$(uname -s)"; arch="$(uname -m)"
    case "$os/$arch" in
        Darwin/arm64)  HOST_QARCH=aarch64; GUEST_ARCH=arm64; NATIVE_ACCEL=hvf ;;
        Darwin/x86_64) HOST_QARCH=x86_64;  GUEST_ARCH=amd64; NATIVE_ACCEL=hvf ;;
        Linux/aarch64) HOST_QARCH=aarch64; GUEST_ARCH=arm64; NATIVE_ACCEL=kvm ;;
        Linux/x86_64)  HOST_QARCH=x86_64;  GUEST_ARCH=amd64; NATIVE_ACCEL=kvm ;;
        # A POSIX shell on Windows (MSYS2, Cygwin and similar), so this is a
        # QEMU built for Windows. That is the only place where whpx exists.
        # Inside WSL2, QEMU is a Linux build, whose accelerators are kvm and
        # tcg, whatever Windows offers.
        MINGW*/x86_64 | MSYS*/x86_64 | CYGWIN*/x86_64)
                       HOST_QARCH=x86_64;  GUEST_ARCH=amd64; NATIVE_ACCEL=whpx ;;
        *) die "unsupported host $os/$arch" ;;
    esac

    # Opt in to a cross-architecture guest deliberately, never by accident.
    GUEST_ARCH="${DEBBIE_GUEST_ARCH:-$GUEST_ARCH}"
    case "$GUEST_ARCH" in
        arm64) GUEST_QARCH=aarch64; QEMU_BIN=qemu-system-aarch64; CONSOLE=ttyAMA0 ;;
        amd64) GUEST_QARCH=x86_64;  QEMU_BIN=qemu-system-x86_64;  CONSOLE=ttyS0 ;;
        *) die "unknown guest arch '$GUEST_ARCH' (expected arm64 or amd64)" ;;
    esac

    command -v "$QEMU_BIN" > /dev/null \
        || die "$QEMU_BIN not found. macOS: brew install qemu. Debian/WSL2: sudo apt install qemu-system-arm qemu-system-x86 qemu-utils. Windows-native: winget install SoftwareFreedomConservancy.QEMU, but that path is not proven here (see the README). On Windows, prefer WSL2."
}

# Ask the BINARY what it supports. The host's answer can be wrong for the
# binary.
accel_in_binary() {
    "$QEMU_BIN" -accel help 2> /dev/null | tail -n +2 | tr -d ' ' | grep -qx "$1"
}

accel_usable() {
    case "$1" in
        hvf) [ "$(uname -s)" = Darwin ] && [ "$(sysctl -n kern.hv_support 2> /dev/null)" = 1 ] ;;
        kvm) [ -r /dev/kvm ] && [ -w /dev/kvm ] ;;
        # whpx is the Windows Hypervisor Platform, so it exists only for a QEMU
        # built for Windows. There is no device node to probe. The -accel help
        # check proves support, and this test only refuses whpx where it cannot
        # exist.
        whpx) case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) true ;; *) false ;; esac ;;
        tcg) true ;;
        *)   false ;;
    esac
}

accel_hint() {
    case "$1" in
        kvm) echo "On Windows 11, WSL2 needs nestedVirtualization=true in .wslconfig and 'wsl --shutdown', then 'sudo usermod -aG kvm \$USER'. On Windows 10 there is no kvm to enable: nested virtualisation is always off (microsoft/WSL#40735), so .wslconfig has no effect and tcg is the practical choice. whpx does not help: it needs a Windows-native QEMU, and reports say it fails with the pflash firmware that this harness requires. See the README." ;;
        whpx) echo "Enable the 'Windows Hypervisor Platform' Windows feature and reboot. whpx cannot be reached from inside WSL2: that is a Linux QEMU build, which has no whpx accelerator compiled in." ;;
        hvf) echo "Another hypervisor may hold the HV interface. Quit VirtualBox or Docker Desktop and try again." ;;
        *)   echo "" ;;
    esac
}

resolve_accel() {
    CROSS_ARCH=0
    [ "$GUEST_QARCH" = "$HOST_QARCH" ] || CROSS_ARCH=1

    if [ -n "${DEBBIE_ACCEL:-}" ]; then
        # An accelerator that was asked for and is not available is a hard
        # failure. A silent change to tcg would turn a five-minute mistake into
        # a two-hour one.
        ACCEL="$DEBBIE_ACCEL"
        if [ "$ACCEL" != tcg ] && [ "$CROSS_ARCH" = 1 ]; then
            die "REFUSING: -accel $ACCEL cannot run a $GUEST_ARCH guest on a $(uname -m) host. Hardware virtualisation is same-architecture only."
        fi
        accel_in_binary "$ACCEL" \
            || die "REFUSING: $QEMU_BIN does not support '$ACCEL'. It supports: $("$QEMU_BIN" -accel help | tail -n +2 | tr -d ' ' | tr '\n' ' ')"
        accel_usable "$ACCEL" \
            || die "REFUSING: '$ACCEL' is supported by the binary but unavailable right now. $(accel_hint "$ACCEL")"
    elif [ "$CROSS_ARCH" = 1 ]; then
        # Do not probe hvf or kvm here. They cannot apply, and a probe could
        # select a flag that cannot work.
        ACCEL=tcg
        warn_cross_arch
    elif accel_in_binary "$NATIVE_ACCEL" && accel_usable "$NATIVE_ACCEL"; then
        ACCEL="$NATIVE_ACCEL"
    else
        ACCEL=tcg
        warn "no hardware acceleration ($NATIVE_ACCEL unavailable). $(accel_hint "$NATIVE_ACCEL")"
    fi

    # MTTCG cannot be used for an x86 guest on an ARM host: the guest memory
    # model is stronger than the host's. Extra vCPUs would slow it down.
    TCG_THREAD=multi
    if [ "$GUEST_QARCH" = x86_64 ] && [ "$HOST_QARCH" = aarch64 ]; then
        TCG_THREAD=single
    fi

    case "$GUEST_ARCH/$ACCEL" in
        arm64/hvf) MACHINE="virt,gic-version=3";    CPU=host;        SMP=2 ;;
        arm64/kvm) MACHINE="virt,gic-version=host"; CPU=host;        SMP=4 ;;
        arm64/tcg) MACHINE="virt,gic-version=3";    CPU=cortex-a72;  SMP=4 ;;
        amd64/kvm) MACHINE="q35";                   CPU=host;        SMP=4 ;;
        amd64/hvf) MACHINE="q35";                   CPU=host;        SMP=2 ;;
        # whpx does not support -cpu host passthrough the way kvm and hvf do.
        #
        # NOT PROVEN. QEMU issue 513 reports that whpx fails on -drive
        # if=pflash with "Failed to emulate MMIO access". The documented
        # workaround is -bios, which REQ-EMU-004 forbids, because a read-only
        # variable store loses the installer's boot entry. So this profile is
        # correct if that bug is fixed, and only a Windows-native QEMU can
        # reach it, never one inside WSL2.
        amd64/whpx) MACHINE="q35";                  CPU=max;         SMP=4 ;;
        # SMP is not limited here. An amd64 guest on an amd64 host can use
        # MTTCG, and the single-thread override below sets 1 only for x86 on
        # ARM, which cannot. A Windows 10 WSL2 machine takes this path, because
        # it has no accelerator at all.
        amd64/tcg) MACHINE="q35";                   CPU=max;         SMP=4 ;;
        *) die "no machine profile for $GUEST_ARCH/$ACCEL" ;;
    esac

    if [ "$ACCEL" = tcg ]; then
        ACCEL_ARG="tcg,thread=$TCG_THREAD"
        # A plain `if`, not `[ ... ] && SMP=1`. As the last statement of this
        # function, a false test would make the whole function return 1, and
        # `set -e` would stop the script with no error and no output, right
        # after the accelerator warning. Only same-architecture TCG reaches
        # that case, because cross-arch sets thread=single and makes the test
        # true, so a run on an accelerated host does not show it.
        if [ "$TCG_THREAD" = single ]; then
            SMP=1
        fi
    else
        ACCEL_ARG="$ACCEL"
    fi
}

warn_cross_arch() {
    cat >&2 <<EOF

################################################################
# NO HARDWARE ACCELERATION - cross-architecture guest
#
#   host   : $(uname -s) $(uname -m)        guest : $GUEST_ARCH
#   reason : $NATIVE_ACCEL accelerates same-architecture guests only.
#
#   Expect an install to take about 60-150 minutes, not
#   6-12. For the fast loop, remove DEBBIE_GUEST_ARCH and
#   use this host's native architecture.
################################################################

EOF
}

#==============================================================================
# Firmware - REQ-EMU-004
#
# pflash, never -bios. The installer writes its GRUB entry into UEFI NVRAM.
# With -bios, that store is read-only, the write is lost, and the installed
# disk does not boot in the assert phase.
#==============================================================================
resolve_firmware() {
    local c v
    FW_CODE=""; FW_VARS_TMPL=""
    case "$GUEST_ARCH" in
        arm64)
            for c in /opt/homebrew/share/qemu/edk2-aarch64-code.fd \
                     /usr/share/AAVMF/AAVMF_CODE.fd \
                     /usr/share/qemu-efi-aarch64/QEMU_EFI.fd; do
                [ -f "$c" ] && { FW_CODE="$c"; break; }
            done
            for v in /usr/share/AAVMF/AAVMF_VARS.fd; do
                [ -f "$v" ] && { FW_VARS_TMPL="$v"; break; }
            done
            FW_SIZE=67108864   # 64 MiB - AAVMF flash size; both drives must match
            FW_HINT="macOS: brew install qemu   Debian/WSL2: sudo apt install qemu-efi-aarch64"
            ;;
        amd64)
            # The last candidate in each list is QEMU for Windows, which keeps
            # firmware beside itself, not in a distribution package.
            for c in /usr/share/OVMF/OVMF_CODE_4M.fd \
                     /usr/share/OVMF/OVMF_CODE.fd \
                     /opt/homebrew/share/qemu/edk2-x86_64-code.fd \
                     "/c/Program Files/qemu/share/edk2-x86_64-code.fd"; do
                [ -f "$c" ] && { FW_CODE="$c"; break; }
            done
            for v in /usr/share/OVMF/OVMF_VARS_4M.fd \
                     /usr/share/OVMF/OVMF_VARS.fd \
                     /opt/homebrew/share/qemu/edk2-i386-vars.fd \
                     "/c/Program Files/qemu/share/edk2-i386-vars.fd"; do
                [ -f "$v" ] && { FW_VARS_TMPL="$v"; break; }
            done
            FW_SIZE=""
            FW_HINT="Debian/WSL2: sudo apt install ovmf   Windows: ships with QEMU, under its share/ directory"
            ;;
    esac
    [ -n "$FW_CODE" ] || die "no UEFI firmware for $GUEST_ARCH. $FW_HINT"
}

# Homebrew ships edk2-aarch64-code.fd with NO matching vars template. A zeroed
# file of the correct size works: EDK2 formats an unformatted varstore on the
# first boot. Do NOT use edk2-arm-vars.fd instead: it is 32-bit ARM.
make_vars() {
    local dest="$1"
    [ -f "$dest" ] && return 0
    if [ -n "$FW_VARS_TMPL" ]; then
        cp "$FW_VARS_TMPL" "$dest"
    else
        [ -n "$FW_SIZE" ] || die "no vars template for $GUEST_ARCH and no known flash size"
        qemu-img create -f raw "$dest" "$FW_SIZE" > /dev/null
    fi
}

#==============================================================================
# Netboot images, fetched as files, not as the tarball. Only two files are
# needed, and without the tar step there is no partial-extract failure.
#==============================================================================
fetch_netboot() {
    NB_DIR="$CACHE/netboot-$SUITE-$GUEST_ARCH"
    mkdir -p "$NB_DIR"
    local base="https://deb.debian.org/debian/dists/$SUITE/main/installer-$GUEST_ARCH/current/images/netboot/debian-installer/$GUEST_ARCH"
    local f
    for f in linux initrd.gz; do
        if [ -s "$NB_DIR/$f" ]; then
            log "netboot $f cached"
        else
            log "fetching netboot $f"
            curl -fL --retry 3 --progress-bar -o "$NB_DIR/$f.part" "$base/$f" \
                || die "could not fetch $base/$f"
            mv "$NB_DIR/$f.part" "$NB_DIR/$f"
        fi
    done
}

#==============================================================================
# Per-run state
#==============================================================================
free_port() {
    python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
}

prepare_run() {
    RUN_DIR="$WORK/run"
    mkdir -p "$RUN_DIR"
    BASE_IMG="$CACHE/base-$GUEST_ARCH.qcow2"
    DISK="$RUN_DIR/disk.qcow2"
    VARS="$RUN_DIR/efivars.fd"
    KEY="$RUN_DIR/id_ed25519"

    [ -f "$KEY" ] || ssh-keygen -t ed25519 -N '' -C 'debbie-vmtest' -f "$KEY" > /dev/null
    make_vars "$VARS"
    SSH_PORT="$(free_port)"
}

# Serve the preseed over HTTP. A preseed in the initrd needs a hand-written
# cpio archive. Over HTTP, an edit costs nothing.
start_http() {
    HTTP_ROOT="$RUN_DIR/http"
    mkdir -p "$HTTP_ROOT"
    cp "$GEN_DIR/payload/preseed.cfg" "$HTTP_ROOT/preseed.cfg"
    SSH_PUBKEY_FILE="$KEY.pub" PASSWORD_CRYPTED="$VM_PASSWORD_CRYPTED" \
        write_overrides > "$HTTP_ROOT/overrides.cfg"

    HTTP_PORT="$(free_port)"
    ( cd "$HTTP_ROOT" && python3 -m http.server "$HTTP_PORT" --bind 0.0.0.0 > /dev/null 2>&1 ) &
    HTTP_PID=$!
    sleep 1
    kill -0 "$HTTP_PID" 2> /dev/null || die "preseed HTTP server failed to start"
    log "serving preseed on :$HTTP_PORT"
}

# Everything architecture- or run-specific is generated by the shared script in
# ../scripts, so the tracked preseed stays free of conditionals (REQ-EMU-005)
# and a VM run cannot drift from a real install.
#
# The VM's password hash is a throwaway, and it can be public: only a
# disposable guest uses it. Real hardware gets its own from an untracked file.
# See scripts/README.md.
VM_PASSWORD_CRYPTED='$6$debbievmtest$iLHeK/mfyeqbwDyW9O6Khy8qQknk/sM.dPztrhTcIOmWL6l60/5FTzjeJQTgEmn1JGPzCEZm7nwVetbN/ZcR70'

cleanup() {
    [ -n "${HTTP_PID:-}" ] && kill "$HTTP_PID" 2> /dev/null || true
    [ -n "${QEMU_PID:-}" ] && kill "$QEMU_PID" 2> /dev/null || true
    # The monitor socket is in /tmp, not in the run directory, so the removal of
    # the run's output does not remove it.
    [ -n "${MONITOR_SOCK:-}" ] && rm -f "$MONITOR_SOCK" || true
}
trap cleanup EXIT

# Send one command to QEMU's human monitor. Used only by the failover test.
monitor() {
    [ -S "${MONITOR_SOCK:-}" ] || return 0
    printf '%s\n' "$1" | nc -U "$MONITOR_SOCK" > /dev/null 2>&1 || true
}

qemu_common() {
    printf '%s\n' \
        -machine "$MACHINE" -accel "$ACCEL_ARG" -cpu "$CPU" -smp "$SMP" -m "$RAM" \
        -device virtio-rng-pci \
        -netdev "user,id=n0,hostfwd=tcp:127.0.0.1:$SSH_PORT-:22" \
        -device virtio-net-pci,netdev=n0 \
        -drive "file=$DISK,format=qcow2,if=none,id=hd0" \
        -device virtio-blk-pci,drive=hd0,bootindex=0 \
        -drive "if=pflash,unit=0,format=raw,readonly=on,file=$FW_CODE" \
        -drive "if=pflash,unit=1,format=raw,file=$VARS" \
        -display none
}

#==============================================================================
# Phase 1 - install
#==============================================================================
do_install() {
    fetch_netboot
    log "creating $DISK_SIZE disk"
    rm -f "$DISK" "$VARS"
    make_vars "$VARS"
    qemu-img create -f qcow2 "$DISK" "$DISK_SIZE" > /dev/null

    start_http

    # The same boot line as the hardware (installer_params), plus the serial
    # console. netcfg reads the hostname from here: it runs before the preseed
    # arrives, so a netcfg key in preseed.cfg comes too late (REQ-SERVER-004).
    local append
    append="$(installer_params "http://10.0.2.2:$HTTP_PORT/preseed.cfg") console=$CONSOLE,115200n8"

    log "installing ($GUEST_ARCH, accel=$ACCEL_ARG, smp=$SMP) - log: $RUN_DIR/install.log"
    local rc=0
    "$TIMEOUT" "$INSTALL_TIMEOUT" "$QEMU_BIN" $(qemu_common) \
        -kernel "$NB_DIR/linux" -initrd "$NB_DIR/initrd.gz" -append "$append" \
        -serial "file:$RUN_DIR/install.log" -monitor none || rc=$?

    if [ "$rc" = 124 ]; then
        die_code 124 "installer did not finish within ${INSTALL_TIMEOUT}s. See $RUN_DIR/install.log"
    elif [ "$rc" != 0 ]; then
        die_code 2 "installer exited $rc. See $RUN_DIR/install.log"
    fi

    # The preseed powers the machine off on success, so an exit status of 0
    # here means that the install finished, not only that it stopped.
    log "install finished"
    mkdir -p "$CACHE"
    # Move, then make the run disk again as a thin overlay on the cache. A copy
    # costs 2G for each run (APFS does not clone a file written this way), so
    # the pair would use 4G where 2G and a few hundred KB are enough. An
    # assert-only run then needs no new copy of the image.
    mv "$DISK" "$BASE_IMG"
    qemu-img create -f qcow2 -F qcow2 -b "$BASE_IMG" "$DISK" > /dev/null
    log "cached installed image -> $BASE_IMG"
}

#==============================================================================
# Phase 2 - boot the installed disk and assert
#==============================================================================
# The boot id.
#
# /proc/sys/kernel/random/boot_id is a random UUID that the kernel makes once
# for each boot. It changes on a boot and on nothing else. So it is the one
# thing a script can read to tell "the guest came back" apart from "the guest
# has not finished its shutdown".
BOOT_ID_PATH=/proc/sys/kernel/random/boot_id

# wait_for_ssh [boot-id-to-beat]
#
# Only do_assert calls it, and it reads that function's ssh_opts, target and
# QEMU_PID: a bash function sees its caller's locals. The hardware version
# (wait_for_ssh in scripts/3-provision/provision.sh) reads globals. The
# mechanism below is the same, without the candidate list. There is one fixed
# target here: no mDNS name and no DHCP lease that can move, so there is
# nothing to loop over.
#
# With NO argument, any SSH answer satisfies the wait. That is the first boot,
# where there is no reboot to prove.
#
# With an argument, that argument is the boot id from BEFORE the reboot, and
# only a DIFFERENT one satisfies the wait. A connection that answers with the
# same boot id is the guest before the reboot, which is up because its
# shutdown has not finished. Polling continues. If a plain `ssh ... true` ended
# the wait, the PHASE=provisioned assertions would run against a guest that
# did not reboot: `lid close ignored` and `sleep.target masked`
# (REQ-SERVER-001) would go red on a guest that is fine. A live SSH socket is
# no proof of a reboot.
wait_for_ssh() {
    local want_new_boot="${1:-}"
    local waited=0 id
    local saw_old_boot=no saw_unreadable=no

    if [ -n "$want_new_boot" ]; then
        log "waiting for a boot id other than $want_new_boot"
    fi

    while :; do
        if [ -z "$want_new_boot" ]; then
            if ssh "${ssh_opts[@]}" "$target" true 2> /dev/null; then
                log "ssh up after ${waited}s"
                return 0
            fi
        else
            # One connection, three results. Empty means that SSH did not
            # answer. The sentinel means that it answered but could not read the
            # file (no proof either way). Anything else is a boot id. The
            # `|| echo` runs in the GUEST, so the two cases stay separate with no
            # second probe on every round that the guest is down.
            id="$(ssh "${ssh_opts[@]}" "$target" \
                "cat $BOOT_ID_PATH 2> /dev/null || echo unreadable" 2> /dev/null || true)"
            if [ -z "$id" ]; then
                : # not back yet
            elif [ "$id" = unreadable ]; then
                saw_unreadable=yes
            elif [ "$id" = "$want_new_boot" ]; then
                # Reachable, but it is the boot this run started against.
                saw_old_boot=yes
            else
                log "back up after ${waited}s (boot id $id)"
                return 0
            fi
        fi

        # Without this, the harness waits the full timeout on a VM that stopped
        # at once, on every run. Hardware has no equivalent, because it has no
        # guest process to lose: there, a machine that does not come back is a
        # machine that does not answer.
        kill -0 "$QEMU_PID" 2> /dev/null || {
            if [ -n "$want_new_boot" ]; then
                die_code 3 "VM exited during reboot. See $RUN_DIR/boot.log"
            fi
            die_code 3 "VM exited before SSH came up. See $RUN_DIR/boot.log"
        }
        [ "$waited" -lt "$SSH_TIMEOUT" ] || break
        sleep 3
        waited=$((waited + 3))
    done

    # Out of time. The message depends on what the wait saw, because the three
    # failures have three different fixes.
    if [ "$saw_old_boot" = yes ]; then
        echo >&2
        echo "ERROR: the guest answered SSH within ${SSH_TIMEOUT}s, but never rebooted." >&2
        echo "       It kept reporting boot id $want_new_boot - the same boot this" >&2
        echo "       run started against." >&2
        echo >&2
        echo "The reboot request had no effect, or the guest takes longer than" >&2
        echo "${SSH_TIMEOUT}s to shut down and come back. Either way, the" >&2
        echo "PHASE=provisioned assertions would prove nothing: the" >&2
        echo "REQ-SERVER-001 settings apply only after a new boot." >&2
        echo "See $RUN_DIR/boot.log. If it is only slow, increase SSH_TIMEOUT." >&2
        exit 3
    fi
    if [ "$saw_unreadable" = yes ]; then
        die_code 3 "the guest answered SSH within ${SSH_TIMEOUT}s, but $BOOT_ID_PATH could not be read, so the reboot could not be proved. See $RUN_DIR/boot.log"
    fi
    if [ -n "$want_new_boot" ]; then
        die_code 3 "no SSH after reboot within ${SSH_TIMEOUT}s. See $RUN_DIR/boot.log"
    fi
    die_code 3 "no SSH within ${SSH_TIMEOUT}s. See $RUN_DIR/boot.log"
}

do_assert() {
    if [ ! -f "$DISK" ]; then
        [ -f "$BASE_IMG" ] || die_code 2 "no installed disk. Run --install first."
        qemu-img create -f qcow2 -F qcow2 -b "$BASE_IMG" "$DISK" > /dev/null
    fi

    # Two extra NICs and a monitor socket, for REQ-NETWORK-003. Only in this
    # phase: the installer would have three interfaces to choose from, and the
    # choice of netcfg is not what this harness tests.
    #
    # n0 is the management path, and nothing touches it. A test that drops or
    # unplugs the interface under test must not cut this script off from the
    # machine, because then the result of a failover test cannot be read.
    #
    # Each netdev gets its own /24, so each interface has a DIFFERENT gateway.
    # With one shared gateway, a probe through the wrong interface would
    # succeed, and the watchdog would look healthy on a dead link.
    # /tmp, not $RUN_DIR, by necessity. sockaddr_un limits a unix socket path
    # to 104 bytes, and $RUN_DIR under a worktree or a deep checkout is longer
    # than that. QEMU then does not start ("UNIX socket path is too long"). The
    # short name makes this work from any checkout.
    MONITOR_SOCK="/tmp/dbvm-$$.sock"
    rm -f "$MONITOR_SOCK"
    log "booting installed system (ssh on :$SSH_PORT, 3 NICs, monitor on $(basename "$MONITOR_SOCK"))"
    "$QEMU_BIN" $(qemu_common) \
        -netdev "user,id=n1,net=10.0.3.0/24,host=10.0.3.2" \
        -device virtio-net-pci,netdev=n1 \
        -netdev "user,id=n2,net=10.0.4.0/24,host=10.0.4.2" \
        -device virtio-net-pci,netdev=n2 \
        -serial "file:$RUN_DIR/boot.log" \
        -monitor "unix:$MONITOR_SOCK,server,nowait" &
    QEMU_PID=$!

    # ssh takes -p for the port, and scp takes -P. With one shared array, scp
    # reads the port number as a local filename and exits 255, which is not
    # one of this script's documented codes. So the two arrays come from a
    # common base, and are not the same array.
    local common_opts=(-i "$KEY"
        -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
        -o LogLevel=ERROR -o ConnectTimeout=5 -o BatchMode=yes)
    local ssh_opts=(-p "$SSH_PORT" "${common_opts[@]}")
    local scp_opts=(-P "$SSH_PORT" "${common_opts[@]}")
    local target="$DEPLOY_USER@127.0.0.1"

    # No reboot to prove yet: this is the first boot, so any answer will do.
    wait_for_ssh ""

    # REQ-SERVER-004. Assert the INSTALLER's work before anything else runs on
    # the machine. Only this run can tell "the preseed set it" from
    # "setup-server-environment.sh repaired it": the machine booted once, and
    # setup-server-environment.sh has not touched it. So a green identity
    # section here means that the install made a usable hostname and a working
    # .local name without help. An assert only after provisioning would show a
    # machine named `192` as correct.
    #
    # A failure here is fatal, not advisory. Otherwise the run would continue
    # to setup-server-environment.sh, repair the machine, and report a pass,
    # which is the failure this check exists to prevent.
    log "asserting first boot (before configuration)"
    local firstboot_rc=0
    ssh "${ssh_opts[@]}" "$target" \
        "EXPECT_ARCH=$GUEST_ARCH EXPECT_HOSTNAME=$SERVER_NAME DEPLOY_USER=$DEPLOY_USER PHASE=firstboot bash -s" \
        < "$GEN_DIR/payload/assert.sh" || firstboot_rc=$?
    [ "$firstboot_rc" = 0 ] \
        || die_code 1 "first-boot assertions failed - the INSTALL is wrong, not the provisioning. A later pass is not a fix: setup-server-environment.sh repairs the hostname and mDNS, so it goes green either way."

    log "provisioning"
    # payload/ AND services/, because the unit templates travel with the script
    # that installs them. The VM's checkout is on `release` and does not have a
    # unit from a feature branch.
    tar czf - -C "$GEN_DIR" payload services \
        | ssh "${ssh_opts[@]}" "$target" 'rm -rf /tmp/debbie-payload && mkdir -p /tmp/debbie-payload && tar xzf - -C /tmp/debbie-payload' \
        || die_code 2 "could not copy the setup scripts into the guest"
    run_setup() {
        ssh "${ssh_opts[@]}" "$target" "sudo -n DEV_USER=$DEPLOY_USER bash /tmp/debbie-payload/payload/setup-developer-environment.sh ${1:-}" \
            || die_code 2 "setup-developer-environment.sh failed${2:-}"
        # EXTRA_AUTHORIZED_KEYS keeps this harness's throwaway key in
        # authorized_keys. setup-server-environment.sh writes that file whole
        # (REQ-SERVER-008), so without this the first provisioning run locks
        # the harness out of its own guest.
        ssh "${ssh_opts[@]}" "$target" "sudo -n SERVER_NAME=$SERVER_NAME DEPLOY_USER=$DEPLOY_USER ROLE_WEBSERVER=$ROLE_WEBSERVER ROLE_TUNNEL=$ROLE_TUNNEL EXTRA_AUTHORIZED_KEYS='$(cat "$KEY.pub")' bash /tmp/debbie-payload/payload/setup-server-environment.sh ${1:-}" \
            || die_code 2 "setup-server-environment.sh failed${2:-}"
    }
    run_setup

    # Run both AGAIN - REQ-SERVER-010. Every documented step after the first
    # provisioning (tunnel credentials, an ngrok token) is "run provision.sh
    # again", so a second run must succeed and change nothing that the scripts
    # own.
    # The deploy user's .zshrc is hashed before and after it, and assert.sh
    # compares the two: a script that appends its prompt on every run is not
    # idempotent. /var/tmp, because /tmp does not survive the reboot below.
    log "provisioning again, to prove a re-run changes nothing"
    ssh "${ssh_opts[@]}" "$target" "sudo -n sha256sum ~$DEPLOY_USER/.zshrc | cut -d' ' -f1 | sudo -n tee /var/tmp/debbie-rerun > /dev/null" \
        || die_code 2 "could not hash .zshrc before the second run"
    run_setup "> /dev/null" " on its second run - it is not safe to re-run"
    ssh "${ssh_opts[@]}" "$target" "sudo -n sha256sum ~$DEPLOY_USER/.zshrc | cut -d' ' -f1 | sudo -n tee -a /var/tmp/debbie-rerun > /dev/null" \
        || die_code 2 "could not hash .zshrc after the second run"

    # logind reads the lid-close drop-in only at boot, so assert after a
    # restart.
    #
    # Read the boot id BEFORE the reboot request. After this point, a live SSH
    # socket is no proof that the guest went down. Only a boot id different
    # from this one is.
    #
    # Unreadable here is fatal, where on hardware it is only a warning. The
    # two have different purposes. provision.sh runs against a machine that
    # someone owns, and a repair run on a half-broken machine is valid. This
    # harness built this guest minutes ago, so a boot_id that does not read is
    # a fault, and a green VM run is what permits the hardware run.
    local boot_id_before
    boot_id_before="$(ssh "${ssh_opts[@]}" "$target" "cat $BOOT_ID_PATH" 2> /dev/null || true)"
    [ -n "$boot_id_before" ] \
        || die_code 3 "could not read $BOOT_ID_PATH before the reboot, so the reboot cannot be proved. See $RUN_DIR/boot.log"
    log "boot id before reboot: $boot_id_before"

    log "rebooting to apply boot-time settings"
    ssh "${ssh_opts[@]}" "$target" "sudo -n systemctl reboot" 2> /dev/null || true

    # Not necessary: the boot id decides whether the guest is back. The sleep
    # only saves a first polling round against a guest that is certainly up.
    sleep 5
    wait_for_ssh "$boot_id_before"

    log "asserting"
    local rc=0
    # The deploy scripts of the commit under test, so their behaviour checks
    # prove THIS commit, not the \`release\` that the guest cloned.
    # Not installed anywhere: assert.sh runs them only against a scratch repo.
    ssh "${ssh_opts[@]}" "$target" "mkdir -p /tmp/under-test" 2> /dev/null || true
    scp "${scp_opts[@]}" "$GEN_DIR/services/deploy.sh" "$GEN_DIR/services/release-poll.sh" \
        "$target:/tmp/under-test/" > /dev/null 2>&1 || true
    ssh "${ssh_opts[@]}" "$target" \
        "EXPECT_ARCH=$GUEST_ARCH EXPECT_HOSTNAME=$SERVER_NAME DEPLOY_USER=$DEPLOY_USER UNDER_TEST_DIR=/tmp/under-test EXPECT_ROLES='$EXPECT_ROLES' PHASE=provisioned bash -s" \
        < "$GEN_DIR/payload/assert.sh" || rc=$?

    #--------------------------------------------------------------------------
    # Case 5 of the failover matrix: a cable pulled out - REQ-NETWORK-003.
    #
    # This case cannot be in assert.sh. Carrier is a property of the emulated
    # link, so only QEMU can remove it, and assert.sh runs inside the guest.
    # `set_link off` drops the carrier and leaves the interface
    # administratively up. That is what an unplugged cable looks like, and it
    # is a different failure from the dead gateway that assert.sh covers.
    #
    # n1, never n0: n0 carries this script's SSH session.
    #--------------------------------------------------------------------------
    if [ "$rc" = 0 ] && [ -S "$MONITOR_SOCK" ]; then
        log "case 5: pulling the cable on n1"
        local dev_before dev_after
        dev_before="$(ssh "${ssh_opts[@]}" "$target" \
            "ip -4 route show default | awk '{for(i=1;i<NF;i++) if(\$i==\"dev\"){print \$(i+1);exit}}'" 2> /dev/null || true)"

        monitor "set_link n1 off"
        # Long enough for the kernel to report carrier 0, short enough that a
        # hung guest is a failed test.
        sleep 5
        ssh "${ssh_opts[@]}" "$target" "sudo -n systemctl start custom-net-failover.service" 2> /dev/null || true
        sleep 2
        dev_after="$(ssh "${ssh_opts[@]}" "$target" \
            "ip -4 route show default | awk '{for(i=1;i<NF;i++) if(\$i==\"dev\"){print \$(i+1);exit}}'" 2> /dev/null || true)"

        local carrier
        carrier="$(ssh "${ssh_opts[@]}" "$target" \
            "for i in /sys/class/net/e*; do [ \"\$(cat \$i/carrier 2>/dev/null)\" = 0 ] && basename \$i; done" 2> /dev/null | tr -d '\r' || true)"
        monitor "set_link n1 on"

        if [ -z "$carrier" ]; then
            log "  SKIP: no interface lost carrier, so the guest did not see the unplug"
        elif [ -n "$dev_after" ] && [ "$dev_after" != "$dev_before" ]; then
            log "  PASS: default route moved from ${dev_before:-none} to $dev_after"
        elif [ -n "$dev_after" ]; then
            # The route can be on a healthy interface already, and then no move
            # is correct. Only a route on the dead interface is a failure.
            if printf '%s\n' "$carrier" | grep -qx "$dev_after"; then
                log "  FAIL: default route is still on $dev_after, which has no carrier"
                rc=1
            else
                log "  PASS: default route on $dev_after, which kept its carrier"
            fi
        else
            log "  FAIL: no default route at all after the unplug"
            rc=1
        fi
    fi

    mkdir -p "$RUN_DIR/artifacts"
    scp "${scp_opts[@]}" "$target:/etc/fstab" "$RUN_DIR/artifacts/" > /dev/null 2>&1 || true
    ssh "${ssh_opts[@]}" "$target" "sudo -n poweroff" 2> /dev/null || true

    [ "$rc" = 0 ] || die_code 1 "assertions failed"
    log "PASS"
}

#==============================================================================
main() {
    local mode=full
    while [ $# -gt 0 ]; do
        case "$1" in
            --full)    mode=full ;;
            --install) mode=install ;;
            --assert)  mode=assert ;;
            --clean)   rm -rf "$WORK"; echo "cleaned $WORK"; exit 0 ;;
            -h|--help) sed -n '2,20p' "$0" | sed 's/^# \?//'; exit 0 ;;
            *) die "unknown argument: $1 (see --help)" ;;
        esac
        shift
    done

    resolve_target
    resolve_accel
    resolve_firmware
    mkdir -p "$CACHE"
    prepare_run

    log "host $(uname -s)/$(uname -m) -> guest $GUEST_ARCH, accel $ACCEL_ARG, firmware $(basename "$FW_CODE")"

    case "$mode" in
        install) do_install ;;
        assert)  do_assert ;;
        full)    do_install; do_assert ;;
    esac
}

main "$@"
