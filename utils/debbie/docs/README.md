# Debbie Server Setup Utility

Automated configuration tool for Debian servers. This utility fully configures a fresh Debian installation with all necessary services and configurations.

## Overview

The Debbie harness provides:
- Idempotent setup scripts that can be run multiple times safely
- Automated installation of system packages, Docker, Node.js, and development tools
- Systemd service management for persistent services
- Network configuration with static IPs and mDNS
- Repository deployment automation

## Quick Start

### Step 1: Create Bootable USB (on your Mac/dev machine)

```bash
cd utils/debbie/setup
./build-usb.sh disk4  # Replace disk4 with your USB drive identifier
```

This creates a bootable Debian installer with preseed configuration for automated installation.

### Step 2: Install Debian

1. Boot the target server from the USB
2. The preseed will automatically:
   - Install Debian Bookworm
   - Create user `srv` with password `debbie`
   - Configure basic networking
   - Install essential packages

### Step 3: Run Post-Install Configuration

After the server boots, SSH in and run the postinstall script:

```bash
# SSH into the server
ssh srv@debbie.local  # or ssh srv@192.168.1.6

# Clone the repository (if not on USB)
mkdir -p ~/projects
cd ~/projects
git clone https://github.com/seanmizen/seanorepo
cd seanorepo/utils/debbie/setup

# Optional: Customize configuration
cp env.example .env
nano .env

# Run the setup script
sudo ./postinstall.sh
```

Key configuration variables:
- `SERVER_NAME`: Server hostname (debbie, trixie, etc.)
- `ETH_IP`, `WIFI_IP`: Static IP addresses
- `WIFI_SSID`, `WIFI_PSK`: WiFi credentials
- `REPO_PATH`: Repository location

The postinstall script can be run multiple times safely and will:
- Update system packages
- Install Docker, Node.js, Go, and build tools
- Configure firewall (UFW)
- Set up mDNS with Avahi
- Configure static IPs via NetworkManager
- Install and configure Zsh with Oh My Zsh
- Install systemd services
- Clone/update the repository

### Step 4: Enable Services

After postinstall completes, enable the services:

```bash
# Enable deployment service (one-shot: pulls latest code and runs docker)
sudo systemctl enable --now deployment-custom.service

# Enable Cloudflare tunnel (if configured)
sudo systemctl enable --now cloudflared-custom.service
```

## Usage

### Check System Status

```bash
# Run the status script
./status.sh
```

This displays:
- Server hostname and network information
- Status of all custom services
- Docker container status
- System resource usage

### View Service Logs

```bash
# Follow logs for a specific service
sudo journalctl -u deployment-custom.service -f

# View last 50 lines
sudo journalctl -u cloudflared-custom.service -n 50
```

### Manage Services

```bash
# Start/stop services
sudo systemctl start deployment-custom.service
sudo systemctl stop deployment-custom.service

# Restart a service
sudo systemctl restart cloudflared-custom.service

# Check service status
sudo systemctl status deployment-custom.service
```

## File Structure

```
utils/debbie/
├── docs/
│   ├── README.md         # This file
│   └── architecture.md   # System architecture documentation
├── services/
│   ├── deployment-custom.service    # One-shot deployment service
│   └── cloudflared-custom.service   # Cloudflare tunnel service
├── setup/
│   ├── env.example       # Configuration template
│   ├── build-usb.sh      # Creates bootable USB installer (runs on Mac)
│   └── postinstall.sh    # Main idempotent setup script (runs on server)
└── status.sh             # Status summary script
```

## Troubleshooting

### Network Issues

If networking isn't working after setup:

```bash
# Check NetworkManager connections
nmcli connection show

# Restart NetworkManager
sudo systemctl restart NetworkManager

# Check if static IPs are configured
ip addr show
```

### Service Won't Start

```bash
# Check why a service failed
sudo systemctl status deployment-custom.service
sudo journalctl -u deployment-custom.service -n 50

# Reload systemd if you modified a service file
sudo systemctl daemon-reload
```

### Idempotency Issues

The `postinstall.sh` script is designed to be idempotent. If you encounter issues:

```bash
# Run postinstall again
sudo ./postinstall.sh

# Check the log
cat ~/postinstall.log
```

## Advanced Usage

### Running on Different Servers

The system auto-detects server type by MAC address. To override:

```bash
# Force server name
export SERVER_NAME=trixie
sudo ./setup/postinstall.sh
```

Or modify `setup/.env` before running.

### Adding New Services

1. Create a `.service` file in `services/`
2. Run `sudo ./setup/postinstall.sh` to install it
3. Enable the service: `sudo systemctl enable --now your-service.service`

### Customizing Network Configuration

Edit `setup/.env` to customize network settings, then run:

```bash
cd ~/projects/seanorepo/utils/debbie/setup
sudo ./postinstall.sh
```

The script will reconfigure NetworkManager with your settings.

## References

- Original working scripts: `2025-10-08/` (read-only reference)
- Preseed configuration: `2025-10-08/preseed-1.cfg`
- Archive: `archive/` (historical scripts)
