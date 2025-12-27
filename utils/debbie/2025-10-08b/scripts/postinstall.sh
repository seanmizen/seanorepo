#!/bin/bash
set -euo pipefail
IFS=$'\n\t'
export DEBIAN_FRONTEND=noninteractive

# Main postinstall script - idempotent configuration of Debian server
# This script can be run multiple times safely
# 
# Usage: 
#   sudo ./postinstall.sh
# Or with custom config:
#   cp env.example .env
#   nano .env  # customize settings
#   sudo ./postinstall.sh

ORIG_USER="${SUDO_USER:-$USER}"
USER_HOME="$(getent passwd "$ORIG_USER" | cut -d: -f6)"
LOG="$USER_HOME/postinstall.log"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

# Load environment variables if .env exists
if [ -f "$ENV_FILE" ]; then
    echo "Loading configuration from $ENV_FILE"
    set -a
    source "$ENV_FILE"
    set +a
else
    echo "No .env file found, using defaults from env.example"
    echo "To customize: cp env.example .env && nano .env"
    SERVER_NAME="${SERVER:-debbie}"
fi

# Detect server if not set in env
if [ -z "${SERVER_NAME:-}" ]; then
    ETH_MAC=$(ip link show | grep -A1 "state UP" | grep "link/ether" | awk '{print $2}' | head -n1 | tr '[:lower:]' '[:upper:]' || true)
    WIFI_MAC=$(ip link show | grep -A1 "wlan" | grep "link/ether" | awk '{print $2}' | head -n1 | tr '[:lower:]' '[:upper:]' || true)
    
    if [ "$ETH_MAC" = "9C:EB:E8:4A:A5:79" ] || [ "$WIFI_MAC" = "48:45:20:40:E4:E9" ]; then
        SERVER_NAME="debbie"
    else
        SERVER_NAME="trixie"
    fi
fi

echo "========================================" | tee "$LOG"
echo "Configuring server: $SERVER_NAME" | tee -a "$LOG"
echo "postinstall.sh run at $(date)" | tee -a "$LOG"
echo "========================================" | tee -a "$LOG"

##############################################################################
# Base packages
##############################################################################
echo "Updating apt + installing essentials" | tee -a "$LOG"
sudo apt-get update -y
sudo apt-get dist-upgrade -y
sudo apt-get install -y \
  ufw git curl ca-certificates gnupg lsb-release \
  build-essential make unattended-upgrades fail2ban

echo "Configuring unattended-upgrades & fail2ban" | tee -a "$LOG"
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
sudo systemctl enable --now fail2ban

##############################################################################
# Power-management tweaks
##############################################################################
echo "Disabling lid-sleep & idle actions" | tee -a "$LOG"
sudo sed -i \
  -e 's/^#\?HandleLidSwitch=.*/HandleLidSwitch=ignore/' \
  -e 's/^#\?HandleLidSwitchExternalPower=.*/HandleLidSwitchExternalPower=ignore/' \
  -e 's/^#\?HandleLidSwitchDocked=.*/HandleLidSwitchDocked=ignore/' \
  -e 's/^#\?IdleAction=.*/IdleAction=ignore/' \
  -e 's/^#\?IdleActionSec=.*/IdleActionSec=0/' \
  /etc/systemd/logind.conf
sudo systemctl restart systemd-logind

##############################################################################
# Firewall
##############################################################################
echo "Configuring UFW" | tee -a "$LOG"
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 5353/udp  # mDNS
sudo ufw --force enable
sudo ufw status verbose >> "$LOG"

##############################################################################
# Set hostname & install Avahi for mDNS
##############################################################################
echo "Setting hostname to $SERVER_NAME" | tee -a "$LOG"
sudo hostnamectl set-hostname "$SERVER_NAME"
echo "$SERVER_NAME" | sudo tee /etc/hostname > /dev/null

# Update /etc/hosts
sudo sed -i '/^127\.0\.1\.1/d' /etc/hosts
echo "127.0.1.1       $SERVER_NAME" | sudo tee -a /etc/hosts > /dev/null

echo "Installing Avahi for mDNS support" | tee -a "$LOG"
sudo apt-get install -y avahi-daemon avahi-utils libnss-mdns
sudo systemctl enable avahi-daemon
sudo systemctl start avahi-daemon

echo "Hostname '$SERVER_NAME' is now accessible as '$SERVER_NAME.local' on the network" | tee -a "$LOG"

##############################################################################
# Network Manager with static IPs
##############################################################################
echo "Installing & enabling NetworkManager" | tee -a "$LOG"
sudo apt-get install -y network-manager
sudo systemctl enable --now NetworkManager

echo "Creating static NM profiles for $SERVER_NAME" | tee -a "$LOG"

if [ "$SERVER_NAME" = "debbie" ]; then
    # Debbie configuration (MAC-based)
    if ! nmcli -g NAME connection | grep -q '^static-ethernet$'; then
        sudo nmcli connection add type ethernet con-name static-ethernet \
            connection.interface-name "*" \
            802-3-ethernet.mac-address "${ETH_MAC:-9C:EB:E8:4A:A5:79}" \
            ipv4.method manual \
            ipv4.addresses "${ETH_IP:-192.168.1.6}/24" \
            ipv4.gateway "${GATEWAY:-192.168.1.1}" \
            ipv4.dns "${DNS_SERVERS:-1.1.1.1 8.8.8.8}" \
            autoconnect yes
    fi

    if ! nmcli -g NAME connection | grep -q '^static-wifi$'; then
        sudo nmcli connection add type wifi con-name static-wifi \
            connection.interface-name "*" \
            802-11-wireless.ssid "${WIFI_SSID:-mojodojo}" \
            802-11-wireless.mac-address "${WIFI_MAC:-48:45:20:40:E4:E9}" \
            wifi-sec.key-mgmt wpa-psk wifi-sec.psk "${WIFI_PSK:-casahouse}" \
            ipv4.method manual \
            ipv4.addresses "${WIFI_IP:-192.168.1.7}/24" \
            ipv4.gateway "${GATEWAY:-192.168.1.1}" \
            ipv4.dns "${DNS_SERVERS:-1.1.1.1 8.8.8.8}" \
            autoconnect yes
    fi

    sudo nmcli connection modify static-ethernet ipv4.route-metric 100
    sudo nmcli connection modify static-wifi     ipv4.route-metric 200
    sudo nmcli connection up static-ethernet || true
    sudo nmcli connection up static-wifi     || true

elif [ "$SERVER_NAME" = "trixie" ]; then
    # Trixie configuration (auto-detect interface, static IP)
    PRIMARY_IFACE=$(ip route | grep default | awk '{print $5}' | head -n1 || true)
    if [ -z "$PRIMARY_IFACE" ]; then
        echo "WARNING: Could not detect primary network interface" | tee -a "$LOG"
    else
        echo "Detected primary interface: $PRIMARY_IFACE" | tee -a "$LOG"
        CURRENT_CONN=$(nmcli -t -f NAME,DEVICE connection show --active | grep "$PRIMARY_IFACE" | cut -d: -f1 || true)
        
        if [ -n "$CURRENT_CONN" ]; then
            echo "Modifying connection: $CURRENT_CONN" | tee -a "$LOG"
            sudo nmcli connection modify "$CURRENT_CONN" \
                ipv4.method manual \
                ipv4.addresses "${STATIC_IP:-192.168.1.10}/24" \
                ipv4.gateway "${GATEWAY:-192.168.1.1}" \
                ipv4.dns "${DNS_SERVERS:-1.1.1.1 8.8.8.8}"
            sudo nmcli connection up "$CURRENT_CONN"
        else
            echo "Creating new static connection" | tee -a "$LOG"
            sudo nmcli connection add type ethernet con-name static-trixie \
                ifname "$PRIMARY_IFACE" \
                ipv4.method manual \
                ipv4.addresses "${STATIC_IP:-192.168.1.10}/24" \
                ipv4.gateway "${GATEWAY:-192.168.1.1}" \
                ipv4.dns "${DNS_SERVERS:-1.1.1.1 8.8.8.8}" \
                autoconnect yes
            sudo nmcli connection up static-trixie || true
        fi
    fi
fi

##############################################################################
# Disable sleep targets
##############################################################################
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

##############################################################################
# Node 20 + Yarn
##############################################################################
echo "Installing Node 20 & Yarn" | tee -a "$LOG"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g yarn

##############################################################################
# Docker CE
##############################################################################
echo "Installing Docker" | tee -a "$LOG"
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$ORIG_USER"

##############################################################################
# Go
##############################################################################
echo "Installing Go" | tee -a "$LOG"
sudo apt-get install -y golang

##############################################################################
# Clone/update repo & dependencies
##############################################################################
echo "Setting up seanorepo" | tee -a "$LOG"
REPO_DIR="${REPO_PATH:-$USER_HOME/projects/seanorepo}"
sudo -u "$ORIG_USER" mkdir -p "$(dirname "$REPO_DIR")"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "Cloning repository" | tee -a "$LOG"
  sudo -u "$ORIG_USER" git clone "${REPO_URL:-https://github.com/seanmizen/seanorepo}" "$REPO_DIR"
else
  echo "Repository exists, pulling latest" | tee -a "$LOG"
  cd "$REPO_DIR"
  sudo -u "$ORIG_USER" git fetch --all
  sudo -u "$ORIG_USER" git reset --hard origin/main
fi

echo "Setting up Corepack" | tee -a "$LOG"
sudo -u "$ORIG_USER" mkdir -p "$USER_HOME/.local/bin"
if ! grep -q '\.local/bin' "$USER_HOME/.profile"; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' | sudo tee -a "$USER_HOME/.profile" > /dev/null
fi
sudo -u "$ORIG_USER" bash -c \
  'corepack enable --install-directory "$HOME/.local/bin" || true'

##############################################################################
# Install systemd services
##############################################################################
echo "Installing systemd services" | tee -a "$LOG"
SERVICES_DIR="$SCRIPT_DIR/../services"

if [ -d "$SERVICES_DIR" ]; then
    for service_file in "$SERVICES_DIR"/*.service; do
        if [ -f "$service_file" ]; then
            service_name=$(basename "$service_file")
            echo "Installing $service_name" | tee -a "$LOG"
            sudo cp "$service_file" /etc/systemd/system/
        fi
    done
    sudo systemctl daemon-reload
    echo "Services installed (not enabled). Enable with: sudo systemctl enable --now <service>" | tee -a "$LOG"
else
    echo "Warning: Services directory not found at $SERVICES_DIR" | tee -a "$LOG"
fi

##############################################################################
# Zsh + Oh-My-Zsh
##############################################################################
echo "Installing Zsh & Oh-My-Zsh" | tee -a "$LOG"
sudo apt-get install -y zsh
sudo chsh -s "$(command -v zsh)" "$ORIG_USER"
export RUNZSH=no CHSH=no
sudo -u "$ORIG_USER" sh -c \
  "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" || true
sudo -u "$ORIG_USER" sed -i \
  's/plugins=(git)/plugins=(git docker node yarn zsh-autosuggestions zsh-syntax-highlighting)/' \
  "$USER_HOME/.zshrc"
sudo -u "$ORIG_USER" git clone https://github.com/zsh-users/zsh-autosuggestions \
  "${ZSH_CUSTOM:-$USER_HOME/.oh-my-zsh/custom}/plugins/zsh-autosuggestions" || true
sudo -u "$ORIG_USER" git clone https://github.com/zsh-users/zsh-syntax-highlighting \
  "${ZSH_CUSTOM:-$USER_HOME/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting" || true

##############################################################################
# Custom .zshrc configuration
##############################################################################
echo "Applying custom .zshrc configuration" | tee -a "$LOG"

cat >> "$USER_HOME/.zshrc" <<'ZSHRC_EOF'

# Custom prompt configuration (depth-based path display)
setopt promptsubst
autoload -U colors && colors

precmd() {
  if [[ $PWD == "/" ]]; then
    prompt_path="/"
  else
    depth=$(( $(echo "$PWD" | awk -F/ '{print NF-1}') - 1 ))
    dirname=$([[ $PWD == $HOME ]] && echo "~" || basename "$PWD")
    [[ $depth == 0 ]] && prompt_path="/$dirname" || prompt_path="/[$depth]/$dirname"
  fi
}

arrow='%(?:%F{green}➜%f:%F{red}➜%f)'
PROMPT='%B${arrow}%b %B%F{blue}%m%f%b %B%F{cyan}${prompt_path}%f%b $(git_prompt_info)'
ZSHRC_EOF

chown "$ORIG_USER:$ORIG_USER" "$USER_HOME/.zshrc"

# Ensure ~/.local/bin is in PATH
if ! grep -q 'export PATH="$HOME/.local/bin:$PATH"' "$USER_HOME/.zshrc"; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$USER_HOME/.zshrc"
fi
if ! grep -q 'export PATH="$HOME/.local/bin:$PATH"' "$USER_HOME/.profile"; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$USER_HOME/.profile"
fi

# Enable Corepack and prepare Yarn
sudo -u "$ORIG_USER" corepack enable --install-directory "$USER_HOME/.local/bin"
sudo -u "$ORIG_USER" corepack prepare yarn@4.8.1 --activate

##############################################################################
# Summary
##############################################################################
echo "" | tee -a "$LOG"
echo "========================================" | tee -a "$LOG"
echo "Setup complete at $(date)" | tee -a "$LOG"
echo "========================================" | tee -a "$LOG"
echo "" | tee -a "$LOG"
echo "Server: $SERVER_NAME" | tee -a "$LOG"
echo "mDNS name: $SERVER_NAME.local" | tee -a "$LOG"
echo "" | tee -a "$LOG"
echo "To enable services, run:" | tee -a "$LOG"
echo "  sudo systemctl enable --now deployment-custom.service" | tee -a "$LOG"
echo "  sudo systemctl enable --now cloudflared-custom.service" | tee -a "$LOG"
echo "" | tee -a "$LOG"
echo "Check status with: $REPO_DIR/utils/debbie/status.sh" | tee -a "$LOG"
echo "" | tee -a "$LOG"
echo "Log file: $LOG" | tee -a "$LOG"
