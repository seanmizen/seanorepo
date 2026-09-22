# debbie — 2026-09-17

This generation installs Debian 13 on a target machine, configures it as a
debbie server, and checks the result. It works the same way on real hardware
and in a local VM, so you can test a change in the VM before it reaches a real
machine.

Production still runs the `2025-10-08b` generation. Nothing here changes it.

The rules a target machine must follow are in
[`../requirements/`](../requirements/). Each requirement states its reason and
names the check that proves it. CI validates them on every PR. This README
tells you how to use the generation. The reasons live in the requirements and
in the comments of each script.

## Layout

| Folder | Contents | Runs on |
|---|---|---|
| `scripts/` | What you run: `1-build-iso/`, `2-serve-preseed/`, `3-provision/`, `test-vm/`. Each step folder holds its `.env.example` and one `<machine>.env` per target machine. `lib.sh` holds the functions they share. | your computer |
| `payload/` | What the scripts send to a target machine: `preseed.cfg` (installer answers), `setup-developer-environment.sh` (toolchain and shell), `setup-server-environment.sh` (server configuration), `assert.sh` (checks). | the installer, then the target machine |
| `services/` | What runs on a target machine all the time: `release-poll.sh`, `deploy.sh` and `net-failover.sh`, with the systemd unit beside each. systemd starts them from the `release` checkout. | the target machine |
| `working/` | Output: ISOs, the SSH key, VM images. Gitignored. | — |

## Test a change in the VM

Install the tools once:

- **macOS:** `brew install qemu coreutils`
- **Linux or WSL2 on Windows 11:** `sudo apt install qemu-system-x86 qemu-system-arm qemu-utils ovmf qemu-efi-aarch64 curl python3`. On WSL2, also set `nestedVirtualization=true` in `.wslconfig` and add yourself to the `kvm` group.

Then run:

```bash
./scripts/test-vm/test-vm.sh --full      # install, configure, check (about 10 minutes)
./scripts/test-vm/test-vm.sh --assert    # reuse the cached install: configure and check
./scripts/test-vm/test-vm.sh --install   # install only
./scripts/test-vm/test-vm.sh --clean     # delete the cached images
```

The exit code is the result: `0` pass, `1` a check failed, `2` the install
failed, `3` no SSH or no proven reboot, `124` a time limit. Read the skipped
checks too. A skip names what the VM could not test.

The VM runs the architecture of your computer: arm64 on a Mac, amd64 on Linux.
debbie hardware is amd64, so a real machine tests amd64 installs. On Windows 10,
or across architectures, QEMU has no acceleration and an install takes one to
two hours.

The VM console password is `debbie`. Real target machines use your own hash.

### What a VM run cannot test

Test these on a real target machine:

- wifi: association, WPA2, and wifi after a reboot
- the real NIC and wifi drivers, and real UEFI firmware behaviour
- amd64-specific boot: BIOS/CSM, Secure Boot, `grub-efi-amd64`, CPU microcode
- disk layouts other than one virtio disk
- mDNS from another machine on the LAN, and a published port refused from another machine
- a Cloudflare tunnel or ngrok session that connects (no VM has credentials)
- an unattended security update that installs, which takes weeks and a real advisory
- the deploy scripts in the checkout, until `release` contains this generation

## Install and configure a target machine

Follow [`scripts/README.md`](./scripts/README.md). In short:

1. `1-build-iso/build-iso.sh <machine>` builds a USB installer.
2. `2-serve-preseed/serve-preseed.sh <machine>` serves the installer's answers
   while the target machine installs from the USB stick.
3. `3-provision/provision.sh <machine>` configures the target machine and
   checks it. Run it again whenever its configuration or roles change.

## Set up a Mac

`payload/setup-developer-environment.sh` installs the toolchain and shell that
every machine of Sean's gets. Target machines run it first, before the server
setup. A Mac runs it on its own:

```bash
git clone https://github.com/seanmizen/seanorepo ~/projects/seanorepo
bash ~/projects/seanorepo/utils/debbie/2026-09-17/payload/setup-developer-environment.sh
```

Do not use sudo: Homebrew refuses to run as root. It installs Homebrew,
zsh with oh-my-zsh and the shared prompt, Node 20, corepack and Yarn, Docker,
shist, the seanorepo clone, the git config from
`utils/config-anywhere`, and iTerm2 with its preferences.

It rewrites `~/.zshrc` on every run, so put your own shell settings in
`~/.zshrc.local`. It is safe to run again whenever the file changes.

## Roles

Roles set what a target machine does. Set them in
`scripts/3-provision/<machine>.env`. **An unset role is off.** Each run of
`provision.sh` makes the target machine match the file.

| Roles | The target machine | Sites published on | How many |
|---|---|---|---|
| none | tracks `release` and is reachable over ngrok | — | any |
| `ROLE_WEBSERVER=yes` | also runs the sites | the LAN | any |
| `ROLE_WEBSERVER=yes` and `ROLE_TUNNEL=yes` | also runs the Cloudflare tunnel | loopback only | exactly one |

The tunnel needs the webserver role on the same machine. A LAN webserver keeps
its own data, separate from the public machine's. To see a machine's roles:
`ssh srv@<name>.local ls /etc/seanorepo/roles`.

### Move the tunnel to another machine

Set the role and provision. Then stop the tunnel on the machine that had it.

```bash
# 1. the new machine serves the sites on the LAN. Check every site by IP.
#    ROLE_WEBSERVER=yes, ROLE_TUNNEL unset in 3-provision/<new>.env
scripts/3-provision/provision.sh <new>

# 2. give it the tunnel role. The reboot at the end of this run starts the
#    tunnel, so both machines serve it from here until step 3.
#    ROLE_TUNNEL=yes in 3-provision/<new>.env
scripts/3-provision/provision.sh <new>

# 3. stop the tunnel on the old machine.
ssh -t srv@<old>.local sudo systemctl disable --now cloudflared-custom.service
```

The unit is `cloudflared-custom.service` on a 2025-10-08b machine and
`custom-cloudflared.service` here. `systemctl list-units 'c*cloudflared*'` names
it.

**Set the role in the env file. Do not enable the unit by hand.** `provision.sh`
stops a tunnel with `systemctl disable --now` and starts one with plain
`systemctl enable` — off is immediate, on waits for the reboot the step
triggers. A unit enabled by hand runs while the env file says it should not, and
the next `provision.sh` run stops it, immediately. Each run of `provision.sh` makes the
machine match the env file.

Between step 2 and step 3 both machines serve the tunnel. Cloudflare balances
across the two connections, so there is no gap, and both answer the same sites
from their own copy of the data. Keep that window short and do not take writes
in it. A machine holding the tunnel role it should not hold is the state
`REQ-NETWORK-002` exists to prevent, so step 3 is not optional.

Two things provisioning does not move:

- **ngrok.** One agent session, and it is an admin path rather than user
  traffic. Add the authtoken on the new machine and start `custom-ngrok.service`
  there. The address and the SSH host key both change, so the command
  tcp-getter emails will not match the one you have.
- **Site data.** Copy it before step 2 and check it renders over the LAN. You
  lose any write that reaches the old machine after you copy its database.
  carolinemizen.art takes admin writes only, so the window is small and the
  cost is one re-upload, but nothing here protects you from it.

## Network failover

Every machine runs `custom-net-failover.timer`, once a minute, with no role and
no configuration. It probes the gateway **through** the interface that holds the
default route. A success changes nothing and logs nothing. A failure promotes an
interface that does reach its own gateway, and demotes the rest.

It needs no interface names. `/sys/class/net/<iface>/wireless` says which links
are wireless, so the rule is "prefer wired, then whichever reaches upstream",
and the same build protects a machine with one link, two links, or a pair this
repository has never seen. The previous generation named debbie's two interfaces
in an env file, which left every other machine unprotected.

It does not fail back. Promotion happens only when the **active** path is dead,
so after a failover the machine stays where it is until that path dies too.
Flapping between two marginal links is worse than sitting on the second one.

Read its decisions with `journalctl -t net-failover`. An empty log is the
healthy state.

Two failures, and the second is the one that caused an outage:

| Failure | What the machine sees | Who catches it |
|---|---|---|
| cable unplugged | carrier goes to 0 | NetworkManager, then this watchdog |
| switch port dead, access point stopped forwarding | carrier stays 1, packets vanish | this watchdog only |

On 2026-08-14 the second one returned Cloudflare Error 1033 for seanmizen.com
while `cloudflared` ran normally, shouting into a disconnected wire. There is no
event for "still has carrier, stopped forwarding", which is why this is a timer.

## Operate a target machine

All commands run from your computer. Replace `<name>` with the target machine's
`SERVER_NAME`.

| To | Run |
|---|---|
| follow the release poller and deploys | `ssh srv@<name>.local journalctl -u custom-release-poll.service -u custom-deploy.service -f` |
| see deploy decisions only | `ssh srv@<name>.local journalctl -u custom-deploy.service -p info` |
| deploy now, whatever changed | `ssh srv@<name>.local ~/projects/seanorepo/utils/debbie/2026-09-17/services/deploy.sh --force` |
| check whether an update needs a reboot | `ssh srv@<name>.local cat /var/run/reboot-required` |
| see recent security updates | `ssh srv@<name>.local 'journalctl -u unattended-upgrades --no-pager \| tail -40'` |
| reboot or power off | `ssh srv@<name>.local sudo systemctl reboot` (or `poweroff`) |
| check the tunnel | `ssh srv@<name>.local systemctl status custom-cloudflared.service` |

The power button does nothing (REQ-SERVER-001). If SSH does not answer, hold
the power button for four seconds. The firmware then cuts the power.

Security updates install automatically. The target machine never reboots on
its own, so a kernel fix waits until you reboot it.

### Set up the Cloudflare tunnel

Only the machine with `ROLE_TUNNEL=yes` needs this. The credentials are in no
repository.

1. On a computer with a Cloudflare login:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create debbie                    # writes ~/.cloudflared/<uuid>.json
   cloudflared tunnel route dns debbie seanmizen.com   # once per hostname
   ```
2. Copy the credentials to the target machine, as `srv`:
   ```bash
   install -m 600 <uuid>.json ~/projects/seanorepo/apps/cloudflared/credentials/<uuid>.json
   ```
3. Make `apps/cloudflared/config.yml` name the same tunnel:
   ```yaml
   tunnel: <uuid>
   credentials-file: ./credentials/<uuid>.json
   ```
4. Run `provision.sh <machine>` again. It enables the tunnel when the machine
   has the tunnel role and the credentials are present.

### Remote SSH (ngrok)

ngrok is the only way to reach a target machine over SSH from outside the LAN
(REQ-NETWORK-005). Every target machine runs it once it has a token.

1. On the target machine, as `srv`: `ngrok config add-authtoken <token>`
   (the token is on dashboard.ngrok.com).
2. Run `provision.sh <machine>` again. It enables `custom-ngrok.service`.

The address changes each time ngrok restarts. To find it:

```bash
ssh srv@<name>.local 'journalctl -u custom-ngrok.service -b | grep -o "url=tcp://[^ ]*" | tail -1'
```

If you cannot reach the machine at all, the ngrok dashboard shows the address.
Then connect with `ssh -p <port> srv@<host>` and your usual key.
