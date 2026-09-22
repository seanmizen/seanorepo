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
# Roles (#329). None by default, like a machine whose .env sets none: the VM then
# proves that a machine with no role tracks `release` and runs nothing. Set either
# in the environment to provision the guest with it.
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
# The guest architecture is DERIVED from the host, through this one table. The
# December 2025 harness kept them as two independent settings and passed hvf to
# an x86_64 binary on an arm64 Mac, which cannot work. Deriving one from the
# other makes that pair unrepresentable rather than merely unlikely.
#==============================================================================
resolve_target() {
    local os arch
    os="$(uname -s)"; arch="$(uname -m)"
    case "$os/$arch" in
        Darwin/arm64)  HOST_QARCH=aarch64; GUEST_ARCH=arm64; NATIVE_ACCEL=hvf ;;
        Darwin/x86_64) HOST_QARCH=x86_64;  GUEST_ARCH=amd64; NATIVE_ACCEL=hvf ;;
        Linux/aarch64) HOST_QARCH=aarch64; GUEST_ARCH=arm64; NATIVE_ACCEL=kvm ;;
        Linux/x86_64)  HOST_QARCH=x86_64;  GUEST_ARCH=amd64; NATIVE_ACCEL=kvm ;;
        # A POSIX shell on Windows - MSYS2, Cygwin and the like - which is what
        # makes this a QEMU built for Windows. That is the only place whpx
        # exists at all: inside WSL2 you are on a Linux build, whose
        # accelerators are kvm and tcg whatever Windows itself offers.
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
        || die "$QEMU_BIN not found. macOS: brew install qemu. Debian/WSL2: sudo apt install qemu-system-arm qemu-system-x86 qemu-utils. Windows-native: winget install SoftwareFreedomConservancy.QEMU - but that path is unproven here, see the README; on Windows prefer WSL2"
}

# Ask the BINARY what it supports. Asking the host is the bug this guards.
accel_in_binary() {
    "$QEMU_BIN" -accel help 2> /dev/null | tail -n +2 | tr -d ' ' | grep -qx "$1"
}

accel_usable() {
    case "$1" in
        hvf) [ "$(uname -s)" = Darwin ] && [ "$(sysctl -n kern.hv_support 2> /dev/null)" = 1 ] ;;
        kvm) [ -r /dev/kvm ] && [ -w /dev/kvm ] ;;
        # whpx is the Windows Hypervisor Platform, so it exists only for a QEMU
        # built for Windows. There is no device node to probe - the -accel help
        # check is what actually establishes support, and this only rules out
        # asking for it somewhere it cannot possibly be.
        whpx) case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) true ;; *) false ;; esac ;;
        tcg) true ;;
        *)   false ;;
    esac
}

accel_hint() {
    case "$1" in
        kvm) echo "On Windows 11, WSL2 needs nestedVirtualization=true in .wslconfig plus 'wsl --shutdown', then 'sudo usermod -aG kvm \$USER'. On Windows 10 there is no kvm to enable: nested virtualisation is disabled unconditionally (microsoft/WSL#40735), so .wslconfig is ignored and tcg is the practical answer. whpx is not a way out - it needs a Windows-native QEMU, and is reported broken with the pflash firmware this harness requires. See the README." ;;
        whpx) echo "Enable the 'Windows Hypervisor Platform' Windows feature and reboot. whpx cannot be reached from inside WSL2: that is a Linux QEMU build, which has no whpx accelerator compiled in." ;;
        hvf) echo "Another hypervisor may hold the HV interface - quit VirtualBox or Docker Desktop and retry." ;;
        *)   echo "" ;;
    esac
}

resolve_accel() {
    CROSS_ARCH=0
    [ "$GUEST_QARCH" = "$HOST_QARCH" ] || CROSS_ARCH=1

    if [ -n "${DEBBIE_ACCEL:-}" ]; then
        # Explicitly requested and unsatisfiable is a hard failure. Silently
        # downgrading turns a five-minute mistake into a two-hour one.
        ACCEL="$DEBBIE_ACCEL"
        if [ "$ACCEL" != tcg ] && [ "$CROSS_ARCH" = 1 ]; then
            die "REFUSING: -accel $ACCEL cannot run a $GUEST_ARCH guest on a $(uname -m) host. Hardware virtualisation is same-architecture only."
        fi
        accel_in_binary "$ACCEL" \
            || die "REFUSING: $QEMU_BIN does not support '$ACCEL'. It supports: $("$QEMU_BIN" -accel help | tail -n +2 | tr -d ' ' | tr '\n' ' ')"
        accel_usable "$ACCEL" \
            || die "REFUSING: '$ACCEL' is supported by the binary but unavailable right now. $(accel_hint "$ACCEL")"
    elif [ "$CROSS_ARCH" = 1 ]; then
        # Do not even probe hvf/kvm here - they cannot apply, and probing them
        # is precisely how the previous harness talked itself into a bad flag.
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
        # UNPROVEN. QEMU issue #513 reports whpx failing on -drive if=pflash
        # with "Failed to emulate MMIO access", unfixed since 2020, and the
        # documented workaround is -bios - which REQ-EMU-004 forbids, because a
        # read-only variable store loses the installer's boot entry. So this
        # profile is correct if that bug is ever fixed, and is reachable only
        # from a Windows-native QEMU, never from inside WSL2.
        amd64/whpx) MACHINE="q35";                  CPU=max;         SMP=4 ;;
        # SMP is not clamped here: an amd64 guest on an amd64 host can use
        # MTTCG, and the single-thread override below drops it to 1 only for
        # the x86-on-ARM case that genuinely cannot. This is the path a Windows
        # 10 WSL2 machine takes, where no accelerator exists at all.
        amd64/tcg) MACHINE="q35";                   CPU=max;         SMP=4 ;;
        *) die "no machine profile for $GUEST_ARCH/$ACCEL" ;;
    esac

    if [ "$ACCEL" = tcg ]; then
        ACCEL_ARG="tcg,thread=$TCG_THREAD"
        # A plain `if`, not `[ ... ] && SMP=1`. As the last statement of this
        # function, a false test would make the whole function return 1, and
        # `set -e` would kill the script silently - no error, no output, right
        # after the accelerator warning. That fired only for same-architecture
        # TCG, because cross-arch sets thread=single and makes the test true,
        # so every run on an accelerated host passed straight over it.
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
#   Expect an install to take roughly 60-150 minutes rather
#   than 6-12. For the fast loop, drop DEBBIE_GUEST_ARCH and
#   use this host's native architecture.
################################################################

EOF
}

#==============================================================================
# Firmware - REQ-EMU-004
#
# pflash, never -bios. The installer writes its GRUB entry into UEFI NVRAM; with
# -bios that store is read-only, the write is discarded, and the installed disk
# will not boot in the assert phase.
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
            # firmware beside itself rather than in a distribution package.
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
# file of the right size is correct: EDK2 formats an unformatted varstore on
# first boot. Do NOT substitute edk2-arm-vars.fd - it is 32-bit ARM.
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
# Netboot images - fetched loose, not as the tarball. Only two files are needed
# and skipping the tar step removes a whole class of partial-extract failure.
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

# Serve the preseed over HTTP. Embedding it in the initrd is what forced the
# previous attempt into hand-written cpio; over HTTP an edit costs nothing.
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
# The VM's password hash is a throwaway, and being public is fine: nothing but
# a disposable guest ever uses it. Real hardware supplies its own from an
# untracked file - see scripts/README.md.
VM_PASSWORD_CRYPTED='$6$debbievmtest$iLHeK/mfyeqbwDyW9O6Khy8qQknk/sM.dPztrhTcIOmWL6l60/5FTzjeJQTgEmn1JGPzCEZm7nwVetbN/ZcR70'

cleanup() {
    [ -n "${HTTP_PID:-}" ] && kill "$HTTP_PID" 2> /dev/null || true
    [ -n "${QEMU_PID:-}" ] && kill "$QEMU_PID" 2> /dev/null || true
    # The monitor socket lives in /tmp rather than the run directory, so it is
    # not removed with the rest of the run's output.
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

    # The preseed powers the machine off on success, so reaching here with 0
    # means the install genuinely finished rather than merely stopped.
    log "install finished"
    mkdir -p "$CACHE"
    # Move, then re-create the run disk as a thin overlay backed by the cache.
    # Copying cost a real 2G per run - APFS does not clone a file written this
    # way - so the pair occupied 4G where 2G plus a few hundred KB will do, and
    # re-asserting no longer pays for another copy of the image.
    mv "$DISK" "$BASE_IMG"
    qemu-img create -f qcow2 -F qcow2 -b "$BASE_IMG" "$DISK" > /dev/null
    log "cached installed image -> $BASE_IMG"
}

#==============================================================================
# Phase 2 - boot the installed disk and assert
#==============================================================================
# The boot id - #295 on metal, #298 here.
#
# /proc/sys/kernel/random/boot_id is a random UUID the kernel generates once per
# boot. It changes on a boot and on nothing else, which makes it the one thing a
# script can read to tell "the guest came back" apart from "the guest has not
# finished going down yet".
BOOT_ID_PATH=/proc/sys/kernel/random/boot_id

# wait_for_ssh [boot-id-to-beat]
#
# Called only from do_assert, and it reads that function's ssh_opts, target and
# QEMU_PID - a bash function sees its caller's locals. The metal sibling
# (scripts/3-provision/provision.sh wait_for_ssh) reads globals instead; the mechanism below
# is the same one, minus the candidate list. There is one fixed target here: no
# mDNS name, no DHCP lease that can move under us, so nothing to loop over.
#
# With NO argument, any SSH answer satisfies the wait. That is the first boot,
# where there is no reboot to prove.
#
# With an argument, that argument is the boot id read BEFORE the reboot, and the
# wait is satisfied only by a DIFFERENT one. A connection that answers with the
# same boot id is the pre-reboot guest - still up, because it has not finished
# shutting down - and polling continues. Before this, `sleep 5` and a plain
# `ssh ... true` ended the wait, and the PHASE=provisioned assertions then ran
# against a guest that had not rebooted: `lid close ignored` and `sleep.target
# masked` (REQ-SERVER-001) went red on a guest that was fine. A live SSH socket
# is not evidence that a reboot happened.
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
            # One connection, three outcomes: empty means SSH did not answer at
            # all, the sentinel means it answered but the file would not read
            # (no proof either way), anything else is a boot id. The `|| echo`
            # runs in the GUEST, so the two cases stay distinguishable without
            # paying for a second probe on every round the guest is down.
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

        # Without this the harness burns the full timeout on a VM that died
        # instantly, every single run. Metal has no equivalent because metal has
        # no guest process to lose: there, a machine that never comes back is a machine
        # that is simply not answering.
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

    # Out of time. Which message depends on what was seen, because the three
    # failures have three different fixes.
    if [ "$saw_old_boot" = yes ]; then
        echo >&2
        echo "ERROR: the guest answered SSH within ${SSH_TIMEOUT}s, but never rebooted." >&2
        echo "       It kept reporting boot id $want_new_boot - the same boot this" >&2
        echo "       run started against." >&2
        echo >&2
        echo "The reboot request did not take effect, or the guest is taking longer" >&2
        echo "than ${SSH_TIMEOUT}s to shut down and come back. Either way the" >&2
        echo "PHASE=provisioned assertions would have been meaningless: the" >&2
        echo "REQ-SERVER-001 settings only apply on a fresh boot." >&2
        echo "See $RUN_DIR/boot.log; if it is simply slow, raise SSH_TIMEOUT." >&2
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

    # Two extra NICs and a monitor socket, for REQ-NETWORK-003 - #281. Only on
    # this phase: the installer would have three interfaces to choose between,
    # and which one netcfg picks is not what this harness tests.
    #
    # n0 is the management path and is never touched. Blackholing or unplugging
    # the interface under test must not cut this script off from the machine it
    # is testing, which is the one mistake that makes a failover test unreadable.
    #
    # Each netdev gets its own /24, so each interface has a DIFFERENT gateway.
    # One shared gateway would let a probe through the wrong interface succeed
    # and the watchdog would look healthy while routing through a dead link.
    # /tmp, not $RUN_DIR, and not by preference. A unix socket path is capped
    # at 104 bytes by sockaddr_un, and $RUN_DIR under a worktree or a deep
    # checkout is longer than that on its own - QEMU refuses to start with
    # "UNIX socket path is too long". The short name is the only thing that
    # makes this work from any checkout.
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

    # ssh takes -p for the port, scp takes -P. Sharing one array between them
    # made scp read the port number as a local filename and exit 255, which is
    # not one of this script's documented codes - so the two are built
    # separately from a common base rather than aliased.
    local common_opts=(-i "$KEY"
        -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
        -o LogLevel=ERROR -o ConnectTimeout=5 -o BatchMode=yes)
    local ssh_opts=(-p "$SSH_PORT" "${common_opts[@]}")
    local scp_opts=(-P "$SSH_PORT" "${common_opts[@]}")
    local target="$DEPLOY_USER@127.0.0.1"

    # No reboot to prove yet: this is the first boot, so any answer will do.
    wait_for_ssh ""

    # REQ-SERVER-004, #285. Assert the INSTALLER's work before anything has
    # been run on the machine by hand. This is the run that can tell "the preseed
    # set it" from "setup-server-environment.sh repaired it": the machine has booted once and
    # setup-server-environment.sh has not touched it, so a green identity section here means
    # the install produced a usable hostname and a working .local name on its
    # own. The old harness only ever asserted after provisioning, which is why
    # a machine that came up as `192` looked perfect in every run.
    #
    # A failure here is fatal rather than advisory. Carrying on would run
    # setup-server-environment.sh, repair the machine, and report a pass - which is the exact
    # shape of the bug this exists to prevent.
    log "asserting first boot (before configuration)"
    local firstboot_rc=0
    ssh "${ssh_opts[@]}" "$target" \
        "EXPECT_ARCH=$GUEST_ARCH EXPECT_HOSTNAME=$SERVER_NAME DEPLOY_USER=$DEPLOY_USER PHASE=firstboot bash -s" \
        < "$GEN_DIR/payload/assert.sh" || firstboot_rc=$?
    [ "$firstboot_rc" = 0 ] \
        || die_code 1 "first-boot assertions failed - the INSTALL is wrong, not the provisioning. Do not read a later pass as a fix; setup-server-environment.sh repairs the hostname and mDNS, so it would go green regardless."

    log "provisioning"
    # payload/ AND services/, because the unit templates travel with the script
    # that installs them since #359 - the VM's checkout is on `release` and does
    # not hold a unit from a feature branch.
    tar czf - -C "$GEN_DIR" payload services \
        | ssh "${ssh_opts[@]}" "$target" 'rm -rf /tmp/debbie-payload && mkdir -p /tmp/debbie-payload && tar xzf - -C /tmp/debbie-payload' \
        || die_code 2 "could not copy the setup scripts into the guest"
    run_setup() {
        ssh "${ssh_opts[@]}" "$target" "sudo -n DEV_USER=$DEPLOY_USER bash /tmp/debbie-payload/payload/setup-developer-environment.sh ${1:-}" \
            || die_code 2 "setup-developer-environment.sh failed${2:-}"
        # EXTRA_AUTHORIZED_KEYS keeps this harness's throwaway key in
        # authorized_keys - #369 makes that file authoritative, so without this
        # the first provisioning run locks the harness out of its own guest.
        ssh "${ssh_opts[@]}" "$target" "sudo -n SERVER_NAME=$SERVER_NAME DEPLOY_USER=$DEPLOY_USER ROLE_WEBSERVER=$ROLE_WEBSERVER ROLE_TUNNEL=$ROLE_TUNNEL EXTRA_AUTHORIZED_KEYS='$(cat "$KEY.pub")' bash /tmp/debbie-payload/payload/setup-server-environment.sh ${1:-}" \
            || die_code 2 "setup-server-environment.sh failed${2:-}"
    }
    run_setup

    # Run both AGAIN - REQ-SERVER-010. Every re-provisioning step this
    # generation documents (adding tunnel credentials, an ngrok token) is
    # "run provision.sh again", so a second run must succeed and change
    # nothing the scripts own.
    # The deploy user's .zshrc is hashed either side of it, and assert.sh
    # compares the two: the previous generation appended its prompt on every run
    # while calling itself idempotent. /var/tmp, because /tmp does not survive
    # the reboot below.
    log "provisioning again, to prove a re-run changes nothing"
    ssh "${ssh_opts[@]}" "$target" "sudo -n sha256sum ~$DEPLOY_USER/.zshrc | cut -d' ' -f1 | sudo -n tee /var/tmp/debbie-rerun > /dev/null" \
        || die_code 2 "could not hash .zshrc before the second run"
    run_setup "> /dev/null" " on its second run - it is not safe to re-run"
    ssh "${ssh_opts[@]}" "$target" "sudo -n sha256sum ~$DEPLOY_USER/.zshrc | cut -d' ' -f1 | sudo -n tee -a /var/tmp/debbie-rerun > /dev/null" \
        || die_code 2 "could not hash .zshrc after the second run"

    # The lid-close drop-in is only read at boot, so assert after a restart.
    #
    # Read the boot id BEFORE asking for the reboot - #298. Nothing after this
    # point may treat a live SSH socket as proof the guest went down; only a
    # boot id different from this one is.
    #
    # Unreadable here is fatal, where metal only warns. The difference is what
    # the two are for: metal is pointed at a machine someone already owns and a
    # repair run against a half-broken machine is legitimate, while this guest was
    # built by this harness minutes ago, so a boot_id that will not read is
    # itself a fault - and a green VM run is what gates the metal run.
    local boot_id_before
    boot_id_before="$(ssh "${ssh_opts[@]}" "$target" "cat $BOOT_ID_PATH" 2> /dev/null || true)"
    [ -n "$boot_id_before" ] \
        || die_code 3 "could not read $BOOT_ID_PATH before the reboot, so the reboot cannot be proved. See $RUN_DIR/boot.log"
    log "boot id before reboot: $boot_id_before"

    log "rebooting to apply boot-time settings"
    ssh "${ssh_opts[@]}" "$target" "sudo -n systemctl reboot" 2> /dev/null || true

    # Not load-bearing any more: the boot id decides whether the guest is back.
    # It only saves a first polling round against a guest that is certainly
    # still up.
    sleep 5
    wait_for_ssh "$boot_id_before"

    log "asserting"
    local rc=0
    # The deploy scripts of the commit under test, so their behaviour checks
    # prove THIS commit rather than whatever \`release\` the guest cloned - #307.
    # Not installed anywhere: assert.sh runs them only against a scratch repo.
    ssh "${ssh_opts[@]}" "$target" "mkdir -p /tmp/under-test" 2> /dev/null || true
    scp "${scp_opts[@]}" "$GEN_DIR/services/deploy.sh" "$GEN_DIR/services/release-poll.sh" \
        "$target:/tmp/under-test/" > /dev/null 2>&1 || true
    ssh "${ssh_opts[@]}" "$target" \
        "EXPECT_ARCH=$GUEST_ARCH EXPECT_HOSTNAME=$SERVER_NAME DEPLOY_USER=$DEPLOY_USER UNDER_TEST_DIR=/tmp/under-test EXPECT_ROLES='$EXPECT_ROLES' PHASE=provisioned bash -s" \
        < "$GEN_DIR/payload/assert.sh" || rc=$?

    #--------------------------------------------------------------------------
    # Case 5 of the failover matrix: a cable pulled out - REQ-NETWORK-003, #281.
    #
    # This one cannot live in assert.sh. Carrier is a property of the emulated
    # link, so only QEMU can take it away, and assert.sh runs inside the guest.
    # `set_link off` drops the carrier while leaving the interface
    # administratively up, which is what an unplugged cable looks like and is a
    # different failure from the blackholed gateway assert.sh covers.
    #
    # n1, never n0: n0 carries this script's SSH session.
    #--------------------------------------------------------------------------
    if [ "$rc" = 0 ] && [ -S "$MONITOR_SOCK" ]; then
        log "case 5: pulling the cable on n1"
        local dev_before dev_after
        dev_before="$(ssh "${ssh_opts[@]}" "$target" \
            "ip -4 route show default | awk '{for(i=1;i<NF;i++) if(\$i==\"dev\"){print \$(i+1);exit}}'" 2> /dev/null || true)"

        monitor "set_link n1 off"
        # Long enough for the kernel to report carrier 0 and NetworkManager to
        # notice, short enough that a hung guest is still a failed test.
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
            # The route may already have been on a healthy interface, in which
            # case not moving is correct. Only a route on the dead one is a fail.
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
