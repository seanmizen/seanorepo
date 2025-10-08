#!/bin/bash
set -e

# Connect your server (this) mac to wifi.
# Connect client (target) to mac via Ethernet. Run this script. Then PXE boot the client.

IFACE="en8"
STATIC_IP="192.168.88.1"
# by default, PXE setup on your client uses port 80. try to stick to it.
HTTP_PORT=80
NETBOOT_URL="https://deb.debian.org/debian/dists/stable/main/installer-amd64/current/images/netboot/netboot.tar.gz"

echo "[*] Enabling IP forwarding. This allows netboot when the client (target) machine has no internet."
sudo sysctl -w net.inet.ip.forwarding=1

# NAT disabled.
# # Write a working PF anchor rule (assumes static 192.168.88.0/24 PXE subnet)
# PXE_SUBNET="192.168.88.0/24"
# sudo mkdir -p /etc/pf.anchors
# sudo bash -c "echo 'nat on $INET_IF from $PXE_SUBNET to any -> ($INET_IF)' > /etc/pf.anchors/pxe-nat"

# # Write the top-level ruleset to include the anchor
# cat > nat-rules.conf <<EOF
# nat-anchor "pxe-nat"
# load anchor "pxe-nat" from "/etc/pf.anchors/pxe-nat"
# pass out all keep state
# EOF

# # Load it and enable PF
# sudo pfctl -f nat-rules.conf
# sudo pfctl -e

echo "[*] Cleaning root artifacts..."
sudo rm -rf pxe
sudo rm -f ldlinux.c32 libutil.c32 pxelinux.0 version.cfg boot.cat isolinux.bin pxelinux.cfg
echo "[*] Creating directory structure..."
mkdir -p pxe/ipxe config

echo "[*] Setting static IP on $IFACE..."
sudo ifconfig "$IFACE" inet "$STATIC_IP" netmask 255.255.255.0 alias

echo "[*] Downloading Debian netboot files..."
curl -L "$NETBOOT_URL" -o netboot.tar.gz
mkdir -p pxe/tmp-netboot
tar -xzf netboot.tar.gz -C pxe/tmp-netboot
mv pxe/tmp-netboot/debian-installer/amd64/linux pxe/ipxe/vmlinuz
mv pxe/tmp-netboot/debian-installer/amd64/initrd.gz pxe/ipxe/initrd.gz
rm -rf pxe/tmp-netboot netboot.tar.gz

echo "[*] Downloading iPXE bootstrap..."
curl -Lo pxe/undionly.kpxe https://boot.ipxe.org/undionly.kpxe

echo "[*] Creating boot.ipxe..."
cat > pxe/boot.ipxe <<EOF
#!ipxe
initrd http://$STATIC_IP:$HTTP_PORT/ipxe/initrd.gz
kernel http://$STATIC_IP:$HTTP_PORT/ipxe/vmlinuz auto=true priority=critical preseed/url=http://$STATIC_IP:$HTTP_PORT/ipxe/preseed.cfg
boot
EOF

# d-i mirror/http/hostname string deb.debian.org
# d-i mirror/http/directory string /debian
# d-i partman-auto/disk string /dev/sda

echo "[*] Creating preseed.cfg..."
cat > pxe/ipxe/preseed.cfg <<EOF
d-i debian-installer/locale string en_GB.UTF-8
d-i debian-installer/language string en
d-i debian-installer/country string GB
d-i keyboard-configuration/xkb-keymap select gb

d-i netcfg/choose_interface select wlan0
d-i netcfg/wireless_essid string mojodojo
d-i netcfg/wireless_passphrase string casahouse
# d-i netcfg/choose_interface select auto
d-i netcfg/disable_dhcp boolean false
d-i netcfg/get_hostname string debbie2
d-i netcfg/get_domain string local

d-i mirror/country string manual
d-i mirror/http/hostname string deb.debian.org
d-i mirror/http/directory string /debian
d-i mirror/http/proxy string

d-i passwd/root-login boolean false
d-i passwd/user-fullname string Sean
d-i passwd/username string sean
d-i passwd/user-password password debbie
d-i passwd/user-password-again password debbie
d-i user-setup/allow-password-weak boolean true

d-i clock-setup/utc boolean true
d-i time/zone string Europe/London

d-i partman-auto/method string regular
d-i partman-auto/choose_recipe select atomic
d-i partman/confirm boolean true
d-i partman/confirm_nooverwrite boolean true

tasksel tasksel/first multiselect standard
d-i pkgsel/include string sudo openssh-server vim curl wget

d-i grub-installer/only_debian boolean true
d-i grub-installer/with_other_os boolean false

d-i finish-install/reboot_in_progress note
d-i preseed/late_command string \
  wget http://$STATIC_IP:8000/ipxe/postinstall.sh -O /root/postinstall.sh; \
  chmod +x /root/postinstall.sh; \
  in-target /root/postinstall.sh
EOF

cat > ~/postinstall.sh <<'EOF'
#!/bin/bash
set -euo pipefail
IFS=$'\n\t'
export DEBIAN_FRONTEND=noninteractive

ORIG_USER="${SUDO_USER:-$USER}"                         # actual login user
USER_HOME="$(getent passwd "$ORIG_USER" | cut -d: -f6)"
LOG="$USER_HOME/hello.txt"

echo "postinstall.sh run at $(date)" > "$LOG"

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
sudo ufw --force enable
sudo ufw status verbose >> "$LOG"

##############################################################################
# Network Manager with static IPs (MAC-based)
##############################################################################
echo "Installing & enabling NetworkManager" | tee -a "$LOG"
sudo apt-get install -y network-manager
sudo systemctl enable --now NetworkManager

echo "Creating static NM profiles" | tee -a "$LOG"

# Ethernet — MAC 9C:EB:E8:4A:A5:79 → 192.168.1.4
if ! nmcli -g NAME connection | grep -q '^static-ethernet$'; then
  sudo nmcli connection add type ethernet con-name static-ethernet \
    connection.interface-name "*" \
    802-3-ethernet.mac-address 9C:EB:E8:4A:A5:79 \
    ipv4.method manual \
    ipv4.addresses 192.168.1.4/24 \
    ipv4.gateway 192.168.1.1 \
    ipv4.dns "1.1.1.1 8.8.8.8" \
    autoconnect yes
fi

# Wi-Fi — MAC 48:45:20:40:E4:E9, SSID mojodojo → 192.168.1.5
if ! nmcli -g NAME connection | grep -q '^static-wifi$'; then
  sudo nmcli connection add type wifi con-name static-wifi \
    connection.interface-name "*" \
    802-11-wireless.ssid "mojodojo" \
    802-11-wireless.mac-address 48:45:20:40:E4:E9 \
    wifi-sec.key-mgmt wpa-psk wifi-sec.psk "casahouse" \
    ipv4.method manual \
    ipv4.addresses 192.168.1.5/24 \
    ipv4.gateway 192.168.1.1 \
    ipv4.dns "1.1.1.1 8.8.8.8" \
    autoconnect yes
fi

sudo nmcli connection modify static-ethernet ipv4.route-metric 100
sudo nmcli connection modify static-wifi     ipv4.route-metric 200
sudo nmcli connection up static-ethernet || true
sudo nmcli connection up static-wifi     || true

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

echo "Setting up Corepack + deps" | tee -a "$LOG"
sudo -u "$ORIG_USER" mkdir -p "$USER_HOME/.local/bin"
if ! grep -q '\.local/bin' "$USER_HOME/.profile"; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' | sudo tee -a "$USER_HOME/.profile" > /dev/null
fi
sudo -u "$ORIG_USER" bash -c \
  'corepack enable --install-directory "$HOME/.local/bin" || true'
sudo -u "$ORIG_USER" bash -c \
  'cd "$HOME/projects/seanorepo" && yarn'

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
# Enable & start services
##############################################################################
echo "Reloading systemd & enabling services" | tee -a "$LOG"
sudo systemctl daemon-reload
sudo systemctl enable deployment-custom.service cloudflared-custom.service
sudo systemctl start deployment-custom.service cloudflared-custom.service

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

echo "All done at $(date)" | tee -a "$LOG"
echo "Rebooting…" | tee -a "$LOG"
sudo reboot
EOF

chmod +x ~/postinstall.sh

echo "[*] Writing dnsmasq config..."
cat > config/dnsmasq.conf <<EOF
interface=$IFACE
bind-interfaces
dhcp-range=192.168.88.100,192.168.88.150,12h
enable-tftp
tftp-root=$(pwd)/pxe
dhcp-match=set:ipxe,175
dhcp-boot=tag:ipxe,boot.ipxe
dhcp-boot=undionly.kpxe
EOF
# pxe-service=x86PC, "PXE Boot", undionly.kpxe
# pxe-service=x86PC, "PXE Boot", undionly.kpxe

echo "[*] Restarting dnsmasq..."
sudo pkill dnsmasq || true
sudo dnsmasq --conf-file="$(pwd)/config/dnsmasq.conf"

echo "[*] Launching HTTP server from pxe/"
cd pxe
python3 -m http.server "$HTTP_PORT"

# for some reason this is working now.
# set forwarding on:
# sudo sysctl -w net.inet.ip.forwarding=1
# get forwarding setting:
# sysctl net.inet.ip.forwarding
# I think I accidentally turned this on and it's allowing netboot to work via my ethernet + wifi
