#!/bin/bash
#===============================================================================
# test-preseed.sh
#
# Rapid prototyping script for testing Debian preseed configurations.
# Works on macOS (with Homebrew QEMU) and Linux.
#
# REQUIREMENTS:
#   macOS:  brew install qemu wget
#   Linux:  apt install qemu-system-x86 qemu-utils wget python3
#   WSL2:   Same as Linux, but GUI requires X server (VcXsrv/WSLg)
#
# USAGE:
#   ./test-preseed.sh                    # Run with defaults
#   ./test-preseed.sh --vnc              # Enable VNC for GUI viewing
#   ./test-preseed.sh --preseed my.cfg   # Use custom preseed file
#   ./test-preseed.sh --clean            # Remove downloaded files and start fresh
#===============================================================================
set -euo pipefail

#===============================================================================
# CONFIGURATION - Edit these as needed
#===============================================================================

# Debian version and architecture
DEBIAN_VERSION="trixie"
DEBIAN_ARCH="amd64"

# Download URLs
DEBIAN_MIRROR="https://deb.debian.org/debian/dists/${DEBIAN_VERSION}/main/installer-${DEBIAN_ARCH}/current/images"
NETBOOT_URL="${DEBIAN_MIRROR}/netboot/netboot.tar.gz"
ISO_URL="https://cdimage.debian.org/cdimage/weekly-builds/${DEBIAN_ARCH}/iso-cd/debian-testing-${DEBIAN_ARCH}-netinst.iso"

# VM settings
VM_RAM="2048"          # RAM in MB (2GB minimum for desktop installs)
VM_CPUS="2"            # Number of CPU cores
VM_DISK_SIZE="20G"     # Disk size (20G minimum for desktop)
VM_DISK_FILE="debian-test.qcow2"

# Preseed settings
PRESEED_FILE="preseed.cfg"
HTTP_PORT="8888"

# Working directory
WORK_DIR="$(pwd)/preseed-test"

#===============================================================================
# Parse command line arguments
#===============================================================================
USE_VNC="no"
VNC_DISPLAY=":1"
CLEAN_START="no"
BOOT_METHOD="http"  # http, initrd, or iso

while [[ $# -gt 0 ]]; do
    case $1 in
        --vnc)
            USE_VNC="yes"
            shift
            ;;
        --vnc-display)
            VNC_DISPLAY="$2"
            shift 2
            ;;
        --preseed)
            PRESEED_FILE="$2"
            shift 2
            ;;
        --ram)
            VM_RAM="$2"
            shift 2
            ;;
        --disk)
            VM_DISK_SIZE="$2"
            shift 2
            ;;
        --clean)
            CLEAN_START="yes"
            shift
            ;;
        --method)
            BOOT_METHOD="$2"
            shift 2
            ;;
        --help|-h)
            cat <<EOF
Usage: $0 [OPTIONS]

Options:
  --vnc                 Enable VNC display (connect with VNC client to localhost:5901)
  --vnc-display DISP    VNC display number (default: :1)
  --preseed FILE        Path to preseed.cfg file (default: preseed.cfg)
  --ram MB              VM RAM in megabytes (default: 2048)
  --disk SIZE           VM disk size (default: 20G)
  --method METHOD       Boot method: http, initrd (default: http)
  --clean               Remove cached downloads and disk images
  --help                Show this help

Examples:
  $0                           # Basic test with serial console
  $0 --vnc                     # Test with VNC display
  $0 --preseed custom.cfg      # Test custom preseed file
  $0 --clean --vnc             # Fresh start with VNC

Requirements:
  macOS:  brew install qemu wget
  Linux:  apt install qemu-system-x86 qemu-utils wget python3
  WSL2:   Same as Linux (GUI requires X server)

EOF
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

#===============================================================================
# Helper functions
#===============================================================================

log() {
    echo "[$(date '+%H:%M:%S')] $1"
}

check_dependencies() {
    local missing=()
    
    for cmd in qemu-system-x86_64 qemu-img wget python3; do
        if ! command -v "$cmd" &>/dev/null; then
            missing+=("$cmd")
        fi
    done
    
    if [ ${#missing[@]} -gt 0 ]; then
        echo "ERROR: Missing required commands: ${missing[*]}"
        echo ""
        echo "Install with:"
        echo "  macOS:  brew install qemu wget python3"
        echo "  Debian: sudo apt install qemu-system-x86 qemu-utils wget python3"
        exit 1
    fi
}

detect_platform() {
    case "$(uname -s)" in
        Darwin)
            PLATFORM="macos"
            # Check for Hypervisor.framework support
            if sysctl kern.hv_support 2>/dev/null | grep -q "1"; then
                ACCEL="-accel hvf"
            else
                ACCEL=""
                log "WARNING: Hardware virtualization not available, VM will be slow"
            fi
            ;;
        Linux)
            PLATFORM="linux"
            if [ -r /dev/kvm ]; then
                ACCEL="-enable-kvm"
            else
                ACCEL=""
                log "WARNING: KVM not available, VM will be slow"
                log "  Try: sudo usermod -aG kvm $USER && newgrp kvm"
            fi
            ;;
        *)
            PLATFORM="unknown"
            ACCEL=""
            log "WARNING: Unknown platform, hardware acceleration disabled"
            ;;
    esac
}

setup_work_dir() {
    mkdir -p "$WORK_DIR"
    cd "$WORK_DIR"
    
    if [ "$CLEAN_START" = "yes" ]; then
        log "Cleaning work directory..."
        rm -rf netboot tftp "$VM_DISK_FILE" *.iso *.kernel *.initrd 2>/dev/null || true
    fi
}

download_netboot() {
    if [ ! -d "tftp" ]; then
        log "Downloading Debian netboot files..."
        wget -q --show-progress -O netboot.tar.gz "$NETBOOT_URL"
        mkdir -p tftp
        tar -xzf netboot.tar.gz -C tftp
        rm netboot.tar.gz
        log "Netboot files extracted to tftp/"
    else
        log "Using cached netboot files"
    fi
}

download_iso() {
    local iso_file="debian-${DEBIAN_VERSION}-${DEBIAN_ARCH}-netinst.iso"
    if [ ! -f "$iso_file" ]; then
        log "Downloading Debian ISO..."
        wget -q --show-progress -O "$iso_file" "$ISO_URL" || {
            # Fallback to stable if testing ISO not available
            log "Testing ISO not found, trying stable..."
            wget -q --show-progress -O "$iso_file" \
                "https://cdimage.debian.org/debian-cd/current/${DEBIAN_ARCH}/iso-cd/debian-*-${DEBIAN_ARCH}-netinst.iso" || true
        }
    fi
    echo "$iso_file"
}

create_disk() {
    if [ ! -f "$VM_DISK_FILE" ]; then
        log "Creating disk image: $VM_DISK_FILE ($VM_DISK_SIZE)"
        qemu-img create -f qcow2 "$VM_DISK_FILE" "$VM_DISK_SIZE"
    else
        log "Using existing disk image (delete to start fresh)"
    fi
}

start_http_server() {
    local preseed_src="$1"
    
    # Copy preseed to work directory
    cp "$preseed_src" preseed.cfg
    
    # Kill any existing server on our port
    pkill -f "python3 -m http.server $HTTP_PORT" 2>/dev/null || true
    sleep 1
    
    log "Starting HTTP server on port $HTTP_PORT..."
    python3 -m http.server "$HTTP_PORT" &>/dev/null &
    HTTP_PID=$!
    
    # Give it a moment to start
    sleep 1
    
    if ! kill -0 "$HTTP_PID" 2>/dev/null; then
        log "ERROR: Failed to start HTTP server"
        exit 1
    fi
    
    log "HTTP server started (PID: $HTTP_PID)"
}

cleanup() {
    log "Cleaning up..."
    if [ -n "${HTTP_PID:-}" ]; then
        kill "$HTTP_PID" 2>/dev/null || true
    fi
}

run_vm() {
    local kernel="tftp/debian-installer/${DEBIAN_ARCH}/linux"
    local initrd="tftp/debian-installer/${DEBIAN_ARCH}/initrd.gz"
    
    # Determine host IP for preseed URL
    # In QEMU user networking, host is accessible at 10.0.2.2
    local preseed_url="http://10.0.2.2:${HTTP_PORT}/preseed.cfg"
    
    # Build kernel command line
    local append="auto=true priority=critical"
    append+=" preseed/url=${preseed_url}"
    append+=" debian-installer/locale=en_GB.UTF-8"
    append+=" keyboard-configuration/xkb-keymap=gb"
    append+=" netcfg/choose_interface=auto"
    append+=" netcfg/get_hostname=debian-test"
    append+=" netcfg/get_domain=local"
    
    # Add console for serial output
    append+=" console=ttyS0,115200n8"
    
    # Build QEMU command
    local qemu_cmd=(
        qemu-system-x86_64
        $ACCEL
        -m "$VM_RAM"
        -smp "$VM_CPUS"
        -drive "file=${VM_DISK_FILE},format=qcow2,if=virtio"
        -netdev "user,id=net0,hostfwd=tcp::2222-:22"
        -device "virtio-net-pci,netdev=net0"
        -kernel "$kernel"
        -initrd "$initrd"
        -append "$append"
    )
    
    # Add UEFI firmware for modern boot
    if [ "$PLATFORM" = "macos" ]; then
        # macOS Homebrew QEMU location
        local ovmf_code="/opt/homebrew/share/qemu/edk2-x86_64-code.fd"
        if [ -f "$ovmf_code" ]; then
            qemu_cmd+=(-bios "$ovmf_code")
        fi
    elif [ "$PLATFORM" = "linux" ]; then
        local ovmf_code="/usr/share/OVMF/OVMF_CODE.fd"
        if [ -f "$ovmf_code" ]; then
            qemu_cmd+=(-bios "$ovmf_code")
        fi
    fi
    
    # Display options
    if [ "$USE_VNC" = "yes" ]; then
        qemu_cmd+=(-vnc "${VNC_DISPLAY}")
        log "VNC enabled - connect to localhost:590${VNC_DISPLAY#:}"
    else
        # Serial console in terminal
        qemu_cmd+=(-nographic)
    fi
    
    log "Starting QEMU..."
    log "  RAM: ${VM_RAM}MB, CPUs: ${VM_CPUS}, Disk: ${VM_DISK_SIZE}"
    log "  Preseed URL: ${preseed_url}"
    log ""
    log "To exit: Ctrl-A X (serial) or close VNC window"
    log "SSH after install: ssh -p 2222 admin@localhost"
    log ""
    
    "${qemu_cmd[@]}"
}

#===============================================================================
# Main execution
#===============================================================================

trap cleanup EXIT

log "=== Debian Preseed Test Environment ==="

# Validate preseed file exists
if [ ! -f "$PRESEED_FILE" ]; then
    log "ERROR: Preseed file not found: $PRESEED_FILE"
    exit 1
fi
log "Using preseed: $PRESEED_FILE"

check_dependencies
detect_platform
log "Platform: $PLATFORM (acceleration: ${ACCEL:-none})"

setup_work_dir
download_netboot
create_disk
start_http_server "$(cd "$(dirname "$PRESEED_FILE")" && pwd)/$(basename "$PRESEED_FILE")"

log ""
log "=== Starting Installation ==="
run_vm

log "Installation complete or VM exited"
