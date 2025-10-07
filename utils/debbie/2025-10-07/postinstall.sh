#!/bin/bash
set -euo pipefail
IFS=$'\n\t'
export DEBIAN_FRONTEND=noninteractive

ORIG_USER="${SUDO_USER:-$USER}"                         # actual login user
USER_HOME="$(getent passwd "$ORIG_USER" | cut -d: -f6)"
LOG="$USER_HOME/postinstall.txt"

# Detect which server this is (debbie or trixie)
# Can be overridden with: sudo SERVER=trixie ./postinstall.sh
if [ -z "${SERVER:-}" ]; then
    # Try to detect based on MAC address
    ETH_MAC=$(ip link show | grep -A1 "state UP" | grep "link/ether" | awk '{print $2}' | head -n1 | tr '[:lower:]' '[:upper:]')
    WIFI_MAC=$(ip link show | grep -A1 "wlan" | grep "link/ether" | awk '{print $2}' | head -n1 | tr '[:lower:]' '[:upper:]')
    
    if [ "$ETH_MAC" = "9C:EB:E8:4A:A5:79" ] || [ "$WIFI_MAC" = "48:45:20:40:E4:E9" ]; then
        SERVER="debbie"
    else
        # Default to trixie for new servers
        SERVER="trixie"
    fi
fi

echo "========================================" | tee "$LOG"
echo "Configuring server: $SERVER" | tee -a "$LOG"
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
echo "Setting hostname to $SERVER" | tee -a "$LOG"
sudo hostnamectl set-hostname "$SERVER"
echo "$SERVER" | sudo tee /etc/hostname > /dev/null

# Update /etc/hosts
sudo sed -i '/^127\.0\.1\.1/d' /etc/hosts
echo "127.0.1.1       $SERVER" | sudo tee -a /etc/hosts > /dev/null

echo "Installing Avahi for mDNS support" | tee -a "$LOG"
sudo apt-get install -y avahi-daemon avahi-utils libnss-mdns
sudo systemctl enable avahi-daemon
sudo systemctl start avahi-daemon

echo "Hostname '$SERVER' is now accessible as '$SERVER.local' on the network" | tee -a "$LOG"

##############################################################################
# Network Manager with static IPs
##############################################################################
echo "Installing & enabling NetworkManager" | tee -a "$LOG"
sudo apt-get install -y network-manager
sudo systemctl enable --now NetworkManager

echo "Creating static NM profiles for $SERVER" | tee -a "$LOG"

if [ "$SERVER" = "debbie" ]; then
    # Debbie configuration (MAC-based)
    # Ethernet — MAC 9C:EB:E8:4A:A5:79 → 192.168.1.6
    if ! nmcli -g NAME connection | grep -q '^static-ethernet$'; then
        sudo nmcli connection add type ethernet con-name static-ethernet \
            connection.interface-name "*" \
            802-3-ethernet.mac-address 9C:EB:E8:4A:A5:79 \
            ipv4.method manual \
            ipv4.addresses 192.168.1.6/24 \
            ipv4.gateway 192.168.1.1 \
            ipv4.dns "1.1.1.1 8.8.8.8" \
            autoconnect yes
    fi

    # Wi-Fi — MAC 48:45:20:40:E4:E9, SSID mojodojo → 192.168.1.7
    if ! nmcli -g NAME connection | grep -q '^static-wifi$'; then
        sudo nmcli connection add type wifi con-name static-wifi \
            connection.interface-name "*" \
            802-11-wireless.ssid "mojodojo" \
            802-11-wireless.mac-address 48:45:20:40:E4:E9 \
            wifi-sec.key-mgmt wpa-psk wifi-sec.psk "casahouse" \
            ipv4.method manual \
            ipv4.addresses 192.168.1.7/24 \
            ipv4.gateway 192.168.1.1 \
            ipv4.dns "1.1.1.1 8.8.8.8" \
            autoconnect yes
    fi

    sudo nmcli connection modify static-ethernet ipv4.route-metric 100
    sudo nmcli connection modify static-wifi     ipv4.route-metric 200
    sudo nmcli connection up static-ethernet || true
    sudo nmcli connection up static-wifi     || true

elif [ "$SERVER" = "trixie" ]; then
    # Trixie configuration (auto-detect interface, static IP 192.168.1.10)
    PRIMARY_IFACE=$(ip route | grep default | awk '{print $5}' | head -n1)
    if [ -z "$PRIMARY_IFACE" ]; then
        echo "WARNING: Could not detect primary network interface" | tee -a "$LOG"
        echo "You'll need to configure static IP manually" | tee -a "$LOG"
    else
        echo "Detected primary interface: $PRIMARY_IFACE" | tee -a "$LOG"
        
        # Get current connection name
        CURRENT_CONN=$(nmcli -t -f NAME,DEVICE connection show --active | grep "$PRIMARY_IFACE" | cut -d: -f1)
        
        if [ -n "$CURRENT_CONN" ]; then
            echo "Modifying connection: $CURRENT_CONN" | tee -a "$LOG"
            sudo nmcli connection modify "$CURRENT_CONN" \
                ipv4.method manual \
                ipv4.addresses 192.168.1.10/24 \
                ipv4.gateway 192.168.1.1 \
                ipv4.dns "1.1.1.1 8.8.8.8"
            sudo nmcli connection up "$CURRENT_CONN"
        else
            echo "Creating new static connection" | tee -a "$LOG"
            sudo nmcli connection add type ethernet con-name static-trixie \
                ifname "$PRIMARY_IFACE" \
                ipv4.method manual \
                ipv4.addresses 192.168.1.10/24 \
                ipv4.gateway 192.168.1.1 \
                ipv4.dns "1.1.1.1 8.8.8.8" \
                autoconnect yes
            sudo nmcli connection up static-trixie
        fi
        
        echo "Static IP 192.168.1.10 configured on $PRIMARY_IFACE" | tee -a "$LOG"
    fi
fi

##############################################################################
# nosleep
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
# Clone repo & dependencies
##############################################################################
echo "Cloning seanorepo" | tee -a "$LOG"
sudo -u "$ORIG_USER" mkdir -p "$USER_HOME/projects"
if [ ! -d "$USER_HOME/projects/seanorepo/.git" ]; then
  sudo -u "$ORIG_USER" git clone https://github.com/seanmizen/seanorepo "$USER_HOME/projects/seanorepo"
fi

echo "Setting up Corepack" | tee -a "$LOG"
sudo -u "$ORIG_USER" mkdir -p "$USER_HOME/.local/bin"
if ! grep -q '\.local/bin' "$USER_HOME/.profile"; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' | sudo tee -a "$USER_HOME/.profile" > /dev/null
fi
sudo -u "$ORIG_USER" bash -c \
  'corepack enable --install-directory "$HOME/.local/bin" || true'

##############################################################################
# deployment-custom.service (one-shot deploy)
##############################################################################
echo "Creating deployment-custom.service" | tee -a "$LOG"
sudo tee /etc/systemd/system/deployment-custom.service > /dev/null <<EOL
[Unit]
Description=One-shot deploy of latest production code
After=network.target docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=$ORIG_USER
Environment=PATH=$USER_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
WorkingDirectory=$USER_HOME/projects/seanorepo
ExecStart=/bin/bash -c 'git fetch --all && git reset --hard origin/main && yarn prod:docker'

[Install]
WantedBy=multi-user.target
EOL

##############################################################################
# cloudflared-custom.service
##############################################################################
echo "Creating cloudflared-custom.service" | tee -a "$LOG"
sudo tee /etc/systemd/system/cloudflared-custom.service > /dev/null <<'EOL'
[Unit]
Description=Cloudflare Tunnel (manual, custom config)
After=network.target

[Service]
Type=simple
User=srv
WorkingDirectory=/home/srv/projects/seanorepo/apps/cloudflared
ExecStartPre=/usr/bin/test -f /home/srv/projects/seanorepo/apps/cloudflared/config.yml
ExecStart=/usr/local/bin/cloudflared tunnel --config /home/srv/projects/seanorepo/apps/cloudflared/config.yml run
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOL

##############################################################################
# Create services (but do not enable or start)
##############################################################################
echo "Reloading systemd" | tee -a "$LOG"
sudo systemctl daemon-reload
echo "Services created but not enabled or started" | tee -a "$LOG"
echo "To enable and start services later, run:" | tee -a "$LOG"
echo "  sudo systemctl enable --now deployment-custom.service" | tee -a "$LOG"
echo "  sudo systemctl enable --now cloudflared-custom.service" | tee -a "$LOG"

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
echo "Zsh setup complete" >> "$LOG"

##############################################################################
# Custom .zshrc configuration
##############################################################################
echo "Applying custom .zshrc configuration" | tee -a "$LOG"

# Append custom prompt configuration to .zshrc
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

echo "Setting up Corepack and Yarn (user-local)" | tee -a "$LOG"

# Ensure ~/.local/bin is prioritized in PATH
if ! grep -q 'export PATH="$HOME/.local/bin:$PATH"' "$USER_HOME/.zshrc"; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$USER_HOME/.zshrc"
fi
if ! grep -q 'export PATH="$HOME/.local/bin:$PATH"' "$USER_HOME/.profile"; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$USER_HOME/.profile"
fi

# Enable Corepack user-locally
sudo -u "$ORIG_USER" corepack enable --install-directory "$USER_HOME/.local/bin"

# Prepare and activate exact Yarn version
sudo -u "$ORIG_USER" corepack prepare yarn@4.8.1 --activate

##############################################################################
# Summary
##############################################################################
echo "" | tee -a "$LOG"
echo "========================================" | tee -a "$LOG"
echo "Setup complete at $(date)" | tee -a "$LOG"
echo "========================================" | tee -a "$LOG"
echo "" | tee -a "$LOG"

if [ "$SERVER" = "debbie" ]; then
    echo "Server: debbie" | tee -a "$LOG"
    echo "mDNS name: debbie.local" | tee -a "$LOG"
    echo "Ethernet IP: 192.168.1.6" | tee -a "$LOG"
    echo "WiFi IP: 192.168.1.7" | tee -a "$LOG"
    echo "" | tee -a "$LOG"
    echo "Access via:" | tee -a "$LOG"
    echo "  ssh srv@debbie.local" | tee -a "$LOG"
    echo "  ssh srv@192.168.1.4" | tee -a "$LOG"
elif [ "$SERVER" = "trixie" ]; then
    echo "Server: trixie" | tee -a "$LOG"
    echo "mDNS name: trixie.local" | tee -a "$LOG"
    echo "Static IP: 192.168.1.10" | tee -a "$LOG"
    echo "" | tee -a "$LOG"
    echo "Access via:" | tee -a "$LOG"
    echo "  ssh srv@trixie.local" | tee -a "$LOG"
    echo "  ssh srv@192.168.1.10" | tee -a "$LOG"
fi

echo "" | tee -a "$LOG"
echo "Rebooting in 5 seconds…" | tee -a "$LOG"

sleep 5
sudo reboot
