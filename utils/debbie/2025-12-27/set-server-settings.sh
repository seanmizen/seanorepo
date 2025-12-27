#!/bin/bash
#===============================================================================
# set-server-settings.sh
# 
# Configures server-specific settings: hostname, static IP, firewall, 
# security hardening, power management, and systemd services.
# Designed to be idempotent - safe to run multiple times.
#
# Usage: 
#   sudo ./set-server-settings.sh                    # Use defaults
#   sudo ./set-server-settings.sh --hostname mybox  # Override hostname
#   sudo ./set-server-settings.sh --help            # Show all options
#===============================================================================
set -euo pipefail
IFS=$'\n\t'
export DEBIAN_FRONTEND=noninteractive

#===============================================================================
# DEFAULT CONFIGURATION - Edit these values for your setup
#===============================================================================
DEFAULT_HOSTNAME="server"
DEFAULT_STATIC_IP="192.168.1.100"
DEFAULT_GATEWAY="192.168.1.1"
DEFAULT_DNS="1.1.1.1 8.8.8.8"
DEFAULT_SUBNET_MASK="24"

# Set to "yes" to automatically reboot after configuration
DEFAULT_AUTO_REBOOT="no"

# Set to "yes" to enable and start services immediately
DEFAULT_ENABLE_SERVICES="no"

# Service user (for systemd services that need a specific user)
DEFAULT_SERVICE_USER=""  # Empty = use current user

# Git repository to clone (leave empty to skip)
DEFAULT_GIT_REPO=""
DEFAULT_GIT_DEST=""

#===============================================================================
# Parse command line arguments
#===============================================================================
HOSTNAME_ARG=""
STATIC_IP_ARG=""
GATEWAY_ARG=""
DNS_ARG=""
AUTO_REBOOT_ARG=""
ENABLE_SERVICES_ARG=""
SERVICE_USER_ARG=""
GIT_REPO_ARG=""
GIT_DEST_ARG=""
SKIP_NETWORK="no"
SKIP_FIREWALL="no"
SKIP_SERVICES="no"

print_help() {
    cat <<EOF
Usage: sudo $0 [OPTIONS]

Server Configuration Options:
  --hostname NAME         Set the server hostname (default: $DEFAULT_HOSTNAME)
  --ip ADDRESS            Set static IP address (default: $DEFAULT_STATIC_IP)
  --gateway ADDRESS       Set gateway address (default: $DEFAULT_GATEWAY)
  --dns "SERVERS"         Set DNS servers, space-separated (default: $DEFAULT_DNS)
  --subnet MASK           Set subnet mask bits (default: $DEFAULT_SUBNET_MASK)

Behavior Options:
  --auto-reboot           Automatically reboot after configuration
  --enable-services       Enable and start systemd services immediately
  --service-user USER     User for systemd services (default: current user)

Repository Options:
  --git-repo URL          Git repository to clone
  --git-dest PATH         Destination path for git clone

Skip Options:
  --skip-network          Skip network/IP configuration
  --skip-firewall         Skip firewall configuration
  --skip-services         Skip systemd service creation

Other:
  --help                  Show this help message

Examples:
  sudo $0 --hostname myserver --ip 192.168.1.50
  sudo $0 --hostname webbox --ip 192.168.1.10 --auto-reboot
  sudo $0 --skip-network --hostname devbox
  
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --hostname)
            HOSTNAME_ARG="$2"
            shift 2
            ;;
        --ip)
            STATIC_IP_ARG="$2"
            shift 2
            ;;
        --gateway)
            GATEWAY_ARG="$2"
            shift 2
            ;;
        --dns)
            DNS_ARG="$2"
            shift 2
            ;;
        --subnet)
            SUBNET_MASK="$2"
            shift 2
            ;;
        --auto-reboot)
            AUTO_REBOOT_ARG="yes"
            shift
            ;;
        --enable-services)
            ENABLE_SERVICES_ARG="yes"
            shift
            ;;
        --service-user)
            SERVICE_USER_ARG="$2"
            shift 2
            ;;
        --git-repo)
            GIT_REPO_ARG="$2"
            shift 2
            ;;
        --git-dest)
            GIT_DEST_ARG="$2"
            shift 2
            ;;
        --skip-network)
            SKIP_NETWORK="yes"
            shift
            ;;
        --skip-firewall)
            SKIP_FIREWALL="yes"
            shift
            ;;
        --skip-services)
            SKIP_SERVICES="yes"
            shift
            ;;
        --help|-h)
            print_help
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Apply defaults where arguments not provided
SERVER_HOSTNAME="${HOSTNAME_ARG:-$DEFAULT_HOSTNAME}"
STATIC_IP="${STATIC_IP_ARG:-$DEFAULT_STATIC_IP}"
GATEWAY="${GATEWAY_ARG:-$DEFAULT_GATEWAY}"
DNS="${DNS_ARG:-$DEFAULT_DNS}"
SUBNET_MASK="${SUBNET_MASK:-$DEFAULT_SUBNET_MASK}"
AUTO_REBOOT="${AUTO_REBOOT_ARG:-$DEFAULT_AUTO_REBOOT}"
ENABLE_SERVICES="${ENABLE_SERVICES_ARG:-$DEFAULT_ENABLE_SERVICES}"
GIT_REPO="${GIT_REPO_ARG:-$DEFAULT_GIT_REPO}"
GIT_DEST="${GIT_DEST_ARG:-$DEFAULT_GIT_DEST}"

#-------------------------------------------------------------------------------
# Logging setup
#-------------------------------------------------------------------------------
SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/${SCRIPT_NAME}.log"
STEP_COUNT=0
FAILED_STEPS=()

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg" | tee -a "$LOG_FILE"
}

log_step() {
    STEP_COUNT=$((STEP_COUNT + 1))
    log "=== STEP $STEP_COUNT: $1 ==="
}

log_success() {
    log "✓ $1 - COMPLETE"
}

log_skip() {
    log "⊘ $1 - SKIPPED (already configured)"
}

log_fail() {
    log "✗ $1 - FAILED"
    FAILED_STEPS+=("Step $STEP_COUNT: $1")
}

#-------------------------------------------------------------------------------
# Helpers
#-------------------------------------------------------------------------------
command_exists() {
    command -v "$1" &>/dev/null
}

get_orig_user() {
    if [ -n "${SUDO_USER:-}" ]; then
        echo "$SUDO_USER"
    else
        echo "$USER"
    fi
}

get_user_home() {
    local user="$1"
    getent passwd "$user" | cut -d: -f6
}

run_as_user() {
    local user="$1"
    shift
    sudo -u "$user" bash -c "$*"
}

service_exists() {
    systemctl list-unit-files "$1" &>/dev/null
}

#-------------------------------------------------------------------------------
# Preflight checks
#-------------------------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
    echo "This script must be run with sudo"
    exit 1
fi

ORIG_USER="$(get_orig_user)"
USER_HOME="$(get_user_home "$ORIG_USER")"
SERVICE_USER="${SERVICE_USER_ARG:-$ORIG_USER}"

log "========================================"
log "Server Settings Configuration"
log "Started: $(date)"
log "========================================"
log "Configuration:"
log "  Hostname:    $SERVER_HOSTNAME"
log "  Static IP:   $STATIC_IP/$SUBNET_MASK"
log "  Gateway:     $GATEWAY"
log "  DNS:         $DNS"
log "  User:        $ORIG_USER"
log "  Service User: $SERVICE_USER"
log "========================================"

#-------------------------------------------------------------------------------
# Step: Security packages
#-------------------------------------------------------------------------------
log_step "Security packages"
{
    apt-get update -y
    apt-get install -y ufw unattended-upgrades fail2ban
    
    # Configure unattended-upgrades
    dpkg-reconfigure -f noninteractive unattended-upgrades
    
    # Enable fail2ban
    if ! systemctl is-enabled fail2ban &>/dev/null; then
        systemctl enable --now fail2ban
    fi
    
    log_success "Security packages installed"
} || log_fail "Security packages"

#-------------------------------------------------------------------------------
# Step: Set hostname
#-------------------------------------------------------------------------------
log_step "Set hostname to '$SERVER_HOSTNAME'"
{
    CURRENT_HOSTNAME=$(hostnamectl --static)
    if [ "$CURRENT_HOSTNAME" != "$SERVER_HOSTNAME" ]; then
        hostnamectl set-hostname "$SERVER_HOSTNAME"
        echo "$SERVER_HOSTNAME" > /etc/hostname
        
        # Update /etc/hosts
        sed -i '/^127\.0\.1\.1/d' /etc/hosts
        echo "127.0.1.1       $SERVER_HOSTNAME" >> /etc/hosts
        
        log_success "Hostname set to '$SERVER_HOSTNAME'"
    else
        log_skip "Hostname already '$SERVER_HOSTNAME'"
    fi
} || log_fail "Set hostname"

#-------------------------------------------------------------------------------
# Step: Avahi/mDNS
#-------------------------------------------------------------------------------
log_step "Avahi mDNS setup"
{
    if ! dpkg -l avahi-daemon &>/dev/null; then
        apt-get install -y avahi-daemon avahi-utils libnss-mdns
        log "  - Avahi packages installed"
    fi
    
    if ! systemctl is-enabled avahi-daemon &>/dev/null; then
        systemctl enable avahi-daemon
    fi
    
    if ! systemctl is-active avahi-daemon &>/dev/null; then
        systemctl start avahi-daemon
    fi
    
    log_success "mDNS configured ($SERVER_HOSTNAME.local)"
} || log_fail "Avahi mDNS setup"

#-------------------------------------------------------------------------------
# Step: Firewall configuration
#-------------------------------------------------------------------------------
if [ "$SKIP_FIREWALL" = "no" ]; then
    log_step "Firewall configuration"
    {
        # Check if UFW is already configured with our rules
        UFW_STATUS=$(ufw status 2>/dev/null || echo "inactive")
        
        if echo "$UFW_STATUS" | grep -q "Status: active"; then
            # Check if our key rules exist
            if echo "$UFW_STATUS" | grep -q "22/tcp" && \
               echo "$UFW_STATUS" | grep -q "80/tcp" && \
               echo "$UFW_STATUS" | grep -q "443/tcp"; then
                log_skip "Firewall already configured"
            else
                # Reconfigure
                ufw --force reset
                ufw default deny incoming
                ufw default allow outgoing
                ufw allow ssh
                ufw allow 80/tcp
                ufw allow 443/tcp
                ufw allow 5353/udp  # mDNS
                ufw --force enable
                log_success "Firewall configured"
            fi
        else
            ufw default deny incoming
            ufw default allow outgoing
            ufw allow ssh
            ufw allow 80/tcp
            ufw allow 443/tcp
            ufw allow 5353/udp  # mDNS
            ufw --force enable
            log_success "Firewall configured"
        fi
        
        ufw status verbose >> "$LOG_FILE"
    } || log_fail "Firewall configuration"
else
    log "Skipping firewall configuration (--skip-firewall)"
fi

#-------------------------------------------------------------------------------
# Step: Power management
#-------------------------------------------------------------------------------
log_step "Power management (disable sleep/suspend)"
{
    LOGIND_CONF="/etc/systemd/logind.conf"
    NEEDS_UPDATE="no"
    
    # Check current settings
    for setting in "HandleLidSwitch=ignore" "HandleLidSwitchExternalPower=ignore" \
                   "HandleLidSwitchDocked=ignore" "IdleAction=ignore"; do
        key="${setting%%=*}"
        if ! grep -q "^${setting}$" "$LOGIND_CONF" 2>/dev/null; then
            NEEDS_UPDATE="yes"
            break
        fi
    done
    
    if [ "$NEEDS_UPDATE" = "yes" ]; then
        sed -i \
            -e 's/^#\?HandleLidSwitch=.*/HandleLidSwitch=ignore/' \
            -e 's/^#\?HandleLidSwitchExternalPower=.*/HandleLidSwitchExternalPower=ignore/' \
            -e 's/^#\?HandleLidSwitchDocked=.*/HandleLidSwitchDocked=ignore/' \
            -e 's/^#\?IdleAction=.*/IdleAction=ignore/' \
            -e 's/^#\?IdleActionSec=.*/IdleActionSec=0/' \
            "$LOGIND_CONF"
        systemctl restart systemd-logind || true
        log_success "Power management configured"
    else
        log_skip "Power management already configured"
    fi
    
    # Mask sleep targets
    for target in sleep.target suspend.target hibernate.target hybrid-sleep.target; do
        if ! systemctl is-enabled "$target" 2>&1 | grep -q "masked"; then
            systemctl mask "$target" 2>/dev/null || true
        fi
    done
} || log_fail "Power management"

#-------------------------------------------------------------------------------
# Step: Network Manager and Static IP
#-------------------------------------------------------------------------------
if [ "$SKIP_NETWORK" = "no" ]; then
    log_step "NetworkManager and static IP ($STATIC_IP)"
    {
        # Install NetworkManager if not present
        if ! command_exists nmcli; then
            apt-get install -y network-manager
            systemctl enable --now NetworkManager
            sleep 2  # Give NM time to start
        fi
        
        # Detect primary interface
        PRIMARY_IFACE=$(ip route | grep default | awk '{print $5}' | head -n1 || true)
        
        if [ -z "$PRIMARY_IFACE" ]; then
            log "  WARNING: Could not detect primary interface"
            log "  You may need to configure static IP manually"
        else
            log "  Primary interface: $PRIMARY_IFACE"
            
            # Get current connection
            CURRENT_CONN=$(nmcli -t -f NAME,DEVICE connection show --active 2>/dev/null | \
                           grep "$PRIMARY_IFACE" | cut -d: -f1 || true)
            
            # Check if already configured with correct IP
            CURRENT_IP=$(nmcli -g IP4.ADDRESS connection show "$CURRENT_CONN" 2>/dev/null | \
                        head -n1 || true)
            
            if [ "$CURRENT_IP" = "$STATIC_IP/$SUBNET_MASK" ]; then
                log_skip "Static IP already configured"
            else
                if [ -n "$CURRENT_CONN" ]; then
                    nmcli connection modify "$CURRENT_CONN" \
                        ipv4.method manual \
                        ipv4.addresses "$STATIC_IP/$SUBNET_MASK" \
                        ipv4.gateway "$GATEWAY" \
                        ipv4.dns "$DNS"
                    nmcli connection up "$CURRENT_CONN" || true
                    log_success "Static IP configured on existing connection"
                else
                    CONN_NAME="static-$SERVER_HOSTNAME"
                    if nmcli -g NAME connection | grep -q "^${CONN_NAME}$"; then
                        nmcli connection delete "$CONN_NAME" || true
                    fi
                    nmcli connection add type ethernet con-name "$CONN_NAME" \
                        ifname "$PRIMARY_IFACE" \
                        ipv4.method manual \
                        ipv4.addresses "$STATIC_IP/$SUBNET_MASK" \
                        ipv4.gateway "$GATEWAY" \
                        ipv4.dns "$DNS" \
                        autoconnect yes
                    nmcli connection up "$CONN_NAME" || true
                    log_success "Static IP configured (new connection)"
                fi
            fi
        fi
    } || log_fail "NetworkManager and static IP"
else
    log "Skipping network configuration (--skip-network)"
fi

#-------------------------------------------------------------------------------
# Step: Clone git repository (optional)
#-------------------------------------------------------------------------------
if [ -n "$GIT_REPO" ] && [ -n "$GIT_DEST" ]; then
    log_step "Clone git repository"
    {
        if [ ! -d "$GIT_DEST/.git" ]; then
            run_as_user "$ORIG_USER" "mkdir -p '$(dirname "$GIT_DEST")'"
            run_as_user "$ORIG_USER" "git clone '$GIT_REPO' '$GIT_DEST'"
            log_success "Repository cloned to $GIT_DEST"
        else
            log_skip "Repository already exists at $GIT_DEST"
        fi
    } || log_fail "Clone git repository"
fi

#-------------------------------------------------------------------------------
# Step: Systemd service templates
#-------------------------------------------------------------------------------
if [ "$SKIP_SERVICES" = "no" ]; then
    log_step "Systemd service templates"
    {
        SERVICE_USER_HOME="$(get_user_home "$SERVICE_USER")"
        
        # Deployment service
        DEPLOY_SERVICE="/etc/systemd/system/deployment-custom.service"
        if [ ! -f "$DEPLOY_SERVICE" ]; then
            cat > "$DEPLOY_SERVICE" <<EOL
[Unit]
Description=One-shot deploy of latest production code
After=network.target docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=$SERVICE_USER
Environment=PATH=$SERVICE_USER_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
WorkingDirectory=$SERVICE_USER_HOME/projects
ExecStart=/bin/bash -c 'echo "Deployment service - configure WorkingDirectory and ExecStart"'

[Install]
WantedBy=multi-user.target
EOL
            log "  - deployment-custom.service created"
        else
            log "  - deployment-custom.service already exists"
        fi
        
        # Cloudflared service
        CF_SERVICE="/etc/systemd/system/cloudflared-custom.service"
        if [ ! -f "$CF_SERVICE" ]; then
            cat > "$CF_SERVICE" <<EOL
[Unit]
Description=Cloudflare Tunnel (custom config)
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$SERVICE_USER_HOME
ExecStartPre=/usr/bin/test -f /path/to/cloudflared/config.yml
ExecStart=/usr/local/bin/cloudflared tunnel --config /path/to/cloudflared/config.yml run
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOL
            log "  - cloudflared-custom.service created"
        else
            log "  - cloudflared-custom.service already exists"
        fi
        
        systemctl daemon-reload
        log_success "Systemd services created"
        
        if [ "$ENABLE_SERVICES" = "yes" ]; then
            log "  Enabling services..."
            systemctl enable deployment-custom.service || true
            systemctl enable cloudflared-custom.service || true
        else
            log "  Services created but not enabled"
            log "  To enable: sudo systemctl enable --now <service-name>"
        fi
    } || log_fail "Systemd service templates"
else
    log "Skipping service creation (--skip-services)"
fi

#-------------------------------------------------------------------------------
# Summary
#-------------------------------------------------------------------------------
log ""
log "========================================"
log "Server Settings Configuration Complete"
log "Finished: $(date)"
log "Total steps: $STEP_COUNT"
log "========================================"

if [ ${#FAILED_STEPS[@]} -gt 0 ]; then
    log ""
    log "⚠ FAILED STEPS:"
    for step in "${FAILED_STEPS[@]}"; do
        log "  - $step"
    done
    log ""
    log "Review log file for details: $LOG_FILE"
    exit 1
else
    log ""
    log "✓ All steps completed successfully!"
    log ""
    log "Server: $SERVER_HOSTNAME"
    log "mDNS:   $SERVER_HOSTNAME.local"
    if [ "$SKIP_NETWORK" = "no" ]; then
        log "IP:     $STATIC_IP"
    fi
    log ""
    log "Access via:"
    log "  ssh $ORIG_USER@$SERVER_HOSTNAME.local"
    if [ "$SKIP_NETWORK" = "no" ]; then
        log "  ssh $ORIG_USER@$STATIC_IP"
    fi
    log ""
fi

#-------------------------------------------------------------------------------
# Optional reboot
#-------------------------------------------------------------------------------
if [ "$AUTO_REBOOT" = "yes" ]; then
    log "Rebooting in 5 seconds..."
    sleep 5
    reboot
else
    log "Run 'sudo reboot' when ready to apply all changes"
fi
