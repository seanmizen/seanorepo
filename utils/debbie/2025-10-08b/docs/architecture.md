# Debbie Server Architecture

## Overview

The Debbie server setup provides a fully automated deployment system for Debian-based servers. The architecture is designed to be idempotent, configurable, and maintainable.

## System Components

### 1. USB Creation Layer
- **build-usb.sh**: Creates bootable Debian installer (runs on Mac/dev machine)
  - Downloads Debian ISO
  - Injects preseed configuration
  - Creates bootable USB with automated installation

### 2. Configuration Layer
- **setup/.env**: Central configuration file
  - Server identity (name, hostname)
  - Network settings (IPs, MACs, WiFi credentials)
  - Repository settings
  - Service credentials/tokens

### 3. Setup Layer
- **setup/postinstall.sh**: Main idempotent configuration script
  - Reads configuration from `.env`
  - Auto-detects server type if not configured
  - Installs all system packages and tools
  - Configures system services
  - Installs custom systemd services

### 4. Service Layer
- **services/*.service**: Systemd unit files
  - `deployment-custom.service`: One-shot deployment service
  - `cloudflared-custom.service`: Cloudflare tunnel service
  - All services read configuration from `.env` via `EnvironmentFile`

### 5. Monitoring Layer
- **status.sh**: Status summary script
  - Shows network configuration
  - Lists all custom services and their status
  - Displays Docker container status
  - Shows system resources

## Service Topology

```
┌─────────────────────────────────────────────────┐
│              Debian Server (debbie)             │
│                                                 │
│  ┌────────────────────────────────────────────┐ │
│  │         System Services                    │ │
│  │  • Docker                                  │ │
│  │  • NetworkManager (static IPs)             │ │
│  │  • Avahi (mDNS)                            │ │
│  │  • UFW (firewall)                          │ │
│  │  • fail2ban                                │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌────────────────────────────────────────────┐ │
│  │         Custom Services                    │ │
│  │                                            │ │
│  │  deployment-custom.service                 │ │
│  │    ├─> git fetch & reset                   │ │
│  │    └─> yarn prod:docker                    │ │
│  │         └─> Docker Compose Stack           │ │
│  │              ├─> seanmizen.com             │ │
│  │              ├─> carolinemizen.art         │ │
│  │              └─> other apps...             │ │
│  │                                            │ │
│  │  cloudflared-custom.service                │ │
│  │    └─> Cloudflare Tunnel                   │ │
│  │         └─> Exposes services externally    │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌────────────────────────────────────────────┐ │
│  │         Repository                         │ │
│  │  /home/srv/projects/seanorepo              │ │
│  │    ├─> apps/                               │ │
│  │    ├─> utils/debbie/                       │ │
│  │    └─> ...                                 │ │
│  └────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

## Data Flow

### Initial Setup Flow

```
1. Create USB (on Mac/dev machine)
   build-usb.sh
   ├─> Download Debian ISO
   ├─> Inject preseed configuration
   └─> Create bootable USB
       ↓
2. Boot from USB and install
   Preseed automation
   ├─> Install Debian Bookworm
   ├─> Create user 'srv'
   ├─> Configure basic networking
   └─> Install essential packages
       ↓
3. SSH into server and run postinstall.sh
   ├─> Clone seanorepo (if needed)
   └─> Run postinstall.sh
       ↓
4. postinstall.sh
   ├─> Read .env configuration
   ├─> Install packages (Docker, Node, Go, etc.)
   ├─> Configure network (NetworkManager, mDNS)
   ├─> Configure firewall (UFW)
   ├─> Clone/update repository
   ├─> Install systemd services
   └─> Configure shell (Zsh, Oh My Zsh)
       ↓
5. Enable services manually
   └─> systemctl enable --now <service>
       ↓
6. Services start automatically on boot
```

### Deployment Flow

```
1. deployment-custom.service (one-shot)
   ↓
2. git fetch --all
   ↓
3. git reset --hard origin/main
   ↓
4. yarn prod:docker
   ↓
5. Docker Compose up -d
   ├─> Pull images
   ├─> Build containers
   └─> Start services
       ↓
6. Applications running
   └─> Accessible via Cloudflare Tunnel
```

### Tunnel Flow

```
Internet
   ↓
Cloudflare Network
   ↓
cloudflared-custom.service
   ↓
Local Docker containers
   ├─> seanmizen.com:80
   ├─> carolinemizen.art:80
   └─> other services
```

## Network Configuration

### Debbie Server
- **Ethernet**: 192.168.1.6 (MAC: 9C:EB:E8:4A:A5:79)
- **WiFi**: 192.168.1.7 (MAC: 48:45:20:40:E4:E9, SSID: mojodojo)
- **mDNS**: debbie.local
- **Gateway**: 192.168.1.1
- **DNS**: 1.1.1.1, 8.8.8.8

### Trixie Server
- **Primary Interface**: 192.168.1.10 (auto-detected interface)
- **mDNS**: trixie.local
- **Gateway**: 192.168.1.1
- **DNS**: 1.1.1.1, 8.8.8.8

## Security

### Firewall (UFW)
- Default deny incoming
- Default allow outgoing
- Allow SSH (22)
- Allow HTTP (80)
- Allow HTTPS (443)
- Allow mDNS (5353/udp)

### fail2ban
- Automatically enabled
- Protects SSH and other services
- Bans IPs after repeated failed login attempts

### Automatic Updates
- unattended-upgrades enabled
- Security patches applied automatically

## Idempotency

The `postinstall.sh` script is designed to be idempotent:

- **Package installation**: Uses `apt-get install -y` which is idempotent
- **Service configuration**: Only modifies if not already configured
- **Network profiles**: Checks if profile exists before creating
- **Repository**: Updates if exists, clones if missing
- **Systemd services**: Copies and reloads, safe to repeat
- **Shell configuration**: Appends only if not present

Running `postinstall.sh` multiple times will not cause issues.

## Dependencies

### External Dependencies
- Debian package repositories (apt)
- NodeSource (Node.js 20)
- Docker repository
- Oh My Zsh installation script
- GitHub (seanorepo)

### Internal Dependencies
- `build-usb.sh` → preseed → Debian installation
- `postinstall.sh` → `.env` (optional)
- `postinstall.sh` → `services/*.service`
- Services → `.env` (via EnvironmentFile)

## Maintenance

### Adding a New Server

1. Update `setup/.env` with new server configuration
2. Run `postinstall.sh` with `SERVER_NAME` set
3. Enable required services

### Updating Configuration

1. Modify `setup/.env`
2. Run `sudo ./setup/postinstall.sh`
3. Restart affected services

### Adding a New Service

1. Create `services/your-service.service`
2. Run `sudo ./setup/postinstall.sh` to install
3. Enable: `sudo systemctl enable --now your-service.service`
4. Update `status.sh` to monitor the new service

## Future Enhancements

- Automated testing in VM
- Ansible playbook alternative
- Multiple environment support (dev, staging, prod)
- Backup/restore functionality
- Health check endpoint
- Prometheus metrics export
