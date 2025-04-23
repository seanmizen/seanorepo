cat > ~/postinstall.sh <<'EOF'
#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

log=~/hello.txt
echo "postinstall.sh run at $(date)" > $log

echo "updating apt + installing essentials" >> $log
sudo apt update -y && sudo apt upgrade -y
sudo apt install -y \
  ufw git curl ca-certificates gnupg lsb-release \
  build-essential make unattended-upgrades fail2ban

echo "configuring unattended upgrades + fail2ban" >> $log
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
sudo systemctl enable --now fail2ban

echo "configuring ufw" >> $log
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose >> $log

echo "installing node & yarn" >> $log
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g yarn

echo "setting up wifi creds" >> $log
sudo mkdir -p /etc/wpa_supplicant
echo 'network={
  ssid="mojodojo"
  psk="casahouse"
}' | sudo tee /etc/wpa_supplicant/wpa_supplicant.conf > /dev/null
sudo chmod 600 /etc/wpa_supplicant/wpa_supplicant.conf
sudo systemctl enable --now wpa_supplicant@wlan0 || true

echo "installing docker" >> $log
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | \
  sudo tee /etc/apt/keyrings/docker.asc > /dev/null
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER

echo "installing golang" >> $log
sudo apt install -y golang

echo "installing zsh + oh-my-zsh" >> $log
sudo apt install -y zsh
sudo chsh -s $(which zsh) $USER
export RUNZSH=no
export CHSH=no
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"

sed -i 's/plugins=(git)/plugins=(git docker node yarn zsh-autosuggestions zsh-syntax-highlighting)/' ~/.zshrc

git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
git clone https://github.com/zsh-users/zsh-syntax-highlighting ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
echo "zsh setup complete" >> $log

echo "disabling lid sleep" >> $log
sudo sed -i 's/^#HandleLidSwitch=.*/HandleLidSwitch=ignore/' /etc/systemd/logind.conf
sudo sed -i 's/^HandleLidSwitch=.*/HandleLidSwitch=ignore/' /etc/systemd/logind.conf
sudo systemctl restart systemd-logind

echo "cloning seanorepo and installing deps" >> $log
mkdir -p ~/projects
cd ~/projects
[ -d seanorepo/.git ] || git clone https://github.com/seanmizen/seanorepo

cd seanorepo
echo "setting up corepack with user-local shims" >> $log
mkdir -p ~/.local/bin
export PATH="$HOME/.local/bin:$PATH"
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile

corepack enable --install-directory ~/.local/bin || true
yarn

echo "creating deployment.service" >> $log
sudo tee /etc/systemd/system/deployment.service > /dev/null <<EOL
[Unit]
Description=One-shot deploy of latest production code
After=network.target docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=$USER
Environment=PATH=/home/$USER/.local/bin:/usr/local/bin:/usr/bin:/bin
WorkingDirectory=/home/$USER/projects/seanorepo
ExecStart=/bin/bash -c 'git fetch --all && git reset --hard origin/main && yarn prod:docker'

[Install]
WantedBy=multi-user.target
EOL

sudo systemctl daemon-reexec
sudo systemctl daemon-reload
sudo systemctl enable deployment.service
sudo systemctl start deployment.service

echo "Done and done. $(date)" >> $log
echo "Done! triggering a reboot."
sudo reboot
EOF
