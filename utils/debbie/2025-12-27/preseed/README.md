# Debian Preseed Testing Guide

## Issues Found in Your Original Preseed

### 1. **Wrong Debian Version**
```diff
- d-i mirror/suite string bookworm
+ d-i mirror/suite string trixie
```
You're targeting Debian 13 (trixie) but specifying bookworm (Debian 12).

### 2. **Deprecated/Redundant Settings**
```properties
# These are deprecated - use keyboard-configuration instead:
d-i console-setup/ask_detect boolean false    # REMOVE
d-i console-setup/layoutcode string gb        # REMOVE

# Duplicated setting:
d-i netcfg/disable_autoconfig boolean false   # Appears twice
```

### 3. **Conflicting Network Settings**
```properties
# You set both:
d-i netcfg/hostname string debbie2
d-i netcfg/get_hostname string debbie2  # These do different things
```
Use `netcfg/hostname` to *force* hostname, or `netcfg/get_hostname` to *suggest* (DHCP overrides).

### 4. **Missing Version Header**
```properties
# Add at the very top:
#_preseed_V1
```
This helps the installer identify the file format.

### 5. **Plain-text Password**
```properties
d-i passwd/user-password password debbie  # INSECURE!
```
Use `mkpasswd -m sha-512` to generate a hash:
```properties
d-i passwd/user-password-crypted password $6$rounds=4096$...
```

### 6. **Incomplete GPT/UEFI Setup**
Your GPT settings use the wrong syntax:
```diff
- d-i partman-partitioning/choose_label string gpt
+ d-i partman-partitioning/choose_label select gpt
```

### 7. **Missing apt-setup/cdrom/set-first**
This is needed for netinst ISOs:
```properties
d-i apt-setup/cdrom/set-first boolean false
```

---

## Quick Start: Testing Your Preseed

### On macOS

```bash
# Install dependencies
brew install qemu wget python3

# Download files to this directory
cd /path/to/preseed-files

# Make the test script executable
chmod +x test-preseed.sh

# Run a test installation (serial console)
./test-preseed.sh

# Or with graphical VNC display
./test-preseed.sh --vnc
# Then connect: open vnc://localhost:5901
```

### On Linux (including WSL2)

```bash
# Install dependencies
sudo apt update
sudo apt install qemu-system-x86 qemu-utils wget python3 ovmf

# Enable KVM acceleration (much faster!)
sudo usermod -aG kvm $USER
newgrp kvm

# Run test
chmod +x test-preseed.sh
./test-preseed.sh
```

### On Windows (WSL2)

```bash
# In WSL2 Ubuntu:
sudo apt install qemu-system-x86 qemu-utils wget python3

# For VNC display, install VcXsrv on Windows or use WSLg
./test-preseed.sh --vnc
# Connect with any VNC client to localhost:5901
```

---

## Adding Desktop Environments

The new preseed.cfg has modular desktop selection. Edit the "DESKTOP ENVIRONMENT CONFIGURATION" section:

### Headless Server (default)
```properties
tasksel tasksel/first multiselect standard, ssh-server
```

### KDE Plasma Desktop
```properties
tasksel tasksel/first multiselect standard, desktop, kde-desktop, ssh-server
```

### GNOME Desktop
```properties
tasksel tasksel/first multiselect standard, desktop, gnome-desktop, ssh-server
```

### XFCE (Lightweight)
```properties
tasksel tasksel/first multiselect standard, desktop, xfce-desktop, ssh-server
```

### Important Notes on Desktop Installation:

1. **`desktop` task is required** - It installs X.org and basic desktop infrastructure
2. **Order matters** - `desktop` must come before the specific DE
3. **RAM requirements**:
   - Server: 512MB minimum
   - XFCE/LXQT: 1GB minimum
   - KDE/GNOME: 2GB minimum (4GB recommended)
4. **Disk requirements**:
   - Server: 5GB minimum
   - Desktop: 15-20GB minimum

---

## Testing Workflow

### Rapid Iteration Cycle

```bash
# 1. Edit your preseed.cfg
vim preseed.cfg

# 2. Run test (old disk is reused - delete for fresh install)
./test-preseed.sh

# 3. If you need a completely fresh install:
./test-preseed.sh --clean

# 4. Watch for errors in the serial console
#    Common issues:
#    - "Preconfiguration file could not be loaded" = bad preseed syntax
#    - "No network interfaces" = netcfg issue
#    - "Partitioning failed" = disk/partition settings
```

### Debugging Tips

1. **Check preseed syntax**:
   ```bash
   # Look for obvious issues
   grep -n "string$" preseed.cfg  # Lines missing values
   ```

2. **Enable installer shell access** (add to preseed):
   ```properties
   # Uncomment to enable SSH into installer:
   d-i anna/choose_modules string network-console
   d-i network-console/password password install
   d-i network-console/password-again password install
   ```

3. **Check installer logs**:
   - In VNC: Alt+F4 for logs
   - Serial: Ctrl-A C, then `sendkey alt-f4`

4. **After installation**:
   ```bash
   ssh -p 2222 admin@localhost  # SSH into the installed system
   cat /var/log/installer/syslog  # Installer log
   ```

---

## File Structure

```
.
├── preseed.cfg              # Improved preseed configuration
├── test-preseed.sh          # QEMU testing script
├── setup-developer-environment.sh  # Post-install dev tools
├── set-server-settings.sh   # Post-install server config
└── README.md                # This file
```

---

## Recommended Testing Order

1. **Start simple**: Test headless server install first
2. **Add complexity**: Enable desktop environment
3. **Add customization**: Add late_command scripts
4. **Test post-install**: Run your setup scripts on the VM

---

## Creating a Custom ISO (Advanced)

If you want to bake the preseed directly into an ISO:

```bash
# Extract ISO
mkdir iso-work
bsdtar -xf debian-testing-amd64-netinst.iso -C iso-work

# Add preseed to initrd
gunzip iso-work/install.amd/initrd.gz
echo preseed.cfg | cpio -H newc -o -A -F iso-work/install.amd/initrd
gzip iso-work/install.amd/initrd

# Modify boot menu to auto-start (iso-work/isolinux/txt.cfg):
# Change "append" line to include: auto=true priority=critical file=/preseed.cfg

# Rebuild ISO
genisoimage -r -J -b isolinux/isolinux.bin -c isolinux/boot.cat \
    -no-emul-boot -boot-load-size 4 -boot-info-table \
    -o debian-preseed.iso iso-work/
```

---

## References

- [Official Debian Preseed Documentation (trixie)](https://www.debian.org/releases/trixie/amd64/apb.en.html)
- [Example preseed.txt](https://www.debian.org/releases/trixie/example-preseed.txt)
- [All Preseed Options](https://preseed.debian.net/)
- [Debian Wiki: QEMU Testing](https://wiki.debian.org/DebianInstaller/Qemu)
