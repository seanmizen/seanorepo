# debbie — 2026-09-17

This generation installs Debian 13 on a target machine, configures it as a
debbie server, and checks the result. It works the same way on real hardware
and in a local VM, so you can test a change in the VM before it reaches a real
machine.

Both target machines run this generation. asus is production, with the
webserver and tunnel roles. surface has no roles. Older generations are in
[`../archive/`](../archive/).

The rules a target machine must follow are in
[`requirements/`](./requirements/). Each requirement states its reason and
names the check that proves it. CI checks them on every PR. This README
tells you how to use the generation. The reasons live in the requirements and
in the comments of each script.

## Layout

| Folder | Contents | Runs on |
|---|---|---|
| `scripts/` | What you run: `1-build-iso/`, `2-serve-preseed/`, `3-provision/`, `test-vm/`. `1-build-iso/` holds one `.env` for every machine. The other steps hold one `<machine>.env` each. `lib.sh` holds the functions they share. | your computer |
| `payload/` | What the scripts send to a target machine: `preseed.cfg` (installer answers), `setup-developer-environment.sh` (toolchain and shell), `setup-server-environment.sh` (server configuration), `assert.sh` (checks). | the installer, then the target machine |
| `services/` | What runs on a target machine all the time: `release-poll.sh`, `deploy.sh`, `host-tools.sh` and `net-failover.sh`, with the systemd unit beside each. It also holds the units for cloudflared, ngrok and tcp-getter. systemd starts the first three scripts from the `release` checkout. `setup-server-environment.sh` installs `net-failover.sh` in `/usr/local/lib/seanorepo`. | the target machine |
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
- the deploy units with the scripts under test: the units in the VM run the
  scripts from the guest's `release` checkout, and `assert.sh` runs the scripts
  under test only against a scratch repo

## Install and configure a target machine

Follow [`scripts/README.md`](./scripts/README.md). In short:

1. `1-build-iso/build-iso.sh` builds a USB installer. **One stick installs any
   machine**, so this step runs once and never again.
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
zsh with oh-my-zsh and the shared prompt, Node and Yarn, Docker,
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

### Move the tunnel from machine A to machine B

A runs the sites and the tunnel. B has whatever roles you gave it. This moves
the public traffic to B with no gap, and keeps A one command from taking it back.

Ordering matters more than anything else here. **The tunnel must not start
before the sites are up.** `provision.sh` enables the tunnel and reboots, but
the sites arrive when the release poller fires at `OnBootSec=3min`. Give B the
tunnel role and walk away, and for three minutes it holds the tunnel with
nothing behind it, while Cloudflare balances half your traffic into it.

#### 1. Make B serve everything, on the LAN

`ROLE_WEBSERVER=yes` and **no** `ROLE_TUNNEL` in `3-provision/<B>.env`.

```bash
scripts/3-provision/provision.sh <B>
```

Without the tunnel role B publishes on the LAN, so you can see it.

#### 2. Copy what does not travel in git

The tunnel credential is host-specific and in no repository:

```bash
scp apps/cloudflared/credentials/<uuid>.json srv@<B>.local:/tmp/
ssh srv@<B>.local 'install -d -m 0700 ~/projects/seanorepo/apps/cloudflared/credentials \
  && install -m 0600 /tmp/<uuid>.json ~/projects/seanorepo/apps/cloudflared/credentials/ && rm /tmp/<uuid>.json'
```

Then every `.env` each app needs, and any site data. Check the `uuid` matches
`tunnel:` in `apps/cloudflared/config.yml`, or B serves a different tunnel and
every hostname moves with it.

#### 3. Deploy, and prove B on the LAN

```bash
ssh srv@<B>.local '~/projects/seanorepo/utils/debbie/2026-09-17/services/deploy.sh --force'
for p in 4000 4020 4021 4030 4042 4060; do printf "%s " "$(curl -s -m5 -o /dev/null -w %{http_code} http://<B-ip>:$p/)"; done
```

Click the sites. Check the data. This is the last moment anything is cheap.

#### 4. Give B the tunnel role

`ROLE_TUNNEL=yes` in `3-provision/<B>.env`, then:

```bash
scripts/3-provision/provision.sh <B>
```

The reboot starts the tunnel, and the changed boot id makes B deploy again -
this time publishing on **loopback only**, because a tunnel machine must not
answer on the LAN (REQ-SERVER-002). The LAN addresses stop working. That is
the intended result.

**Watch for the three-minute window.** If B holds the tunnel before its
containers are up, take it out until they are:

```bash
ssh -t srv@<B>.local sudo systemctl stop custom-cloudflared.service
# ...wait for the deploy, then:
ssh -t srv@<B>.local sudo systemctl start custom-cloudflared.service
```

#### 5. Both machines serve. Check, then stop A

Cloudflare balances across both connections, so there is no gap. Probe each
hostname more than once - a single 200 does not prove both machines answer:

```bash
for u in seanmizen.com carolinemizen.art pp.seanmizen.com inside.seanmizen.com
do printf "%-26s " "$u"; for i in 1 2 3; do printf "%s " "$(curl -s -m12 -o /dev/null -w %{http_code} https://$u)"; done; echo; done
```

Take no admin writes in this window: a write can land on either machine.

```bash
ssh -t srv@<A>.local sudo systemctl disable --now custom-cloudflared.service
```

The unit is `custom-cloudflared.service` on a machine that runs this
generation, and `cloudflared-custom.service` on a machine that runs the archived
2025-10-08b generation. `systemctl list-units "*cloudflared*"` names it.

#### 6. ngrok, separately

It does not move with the role. On B:

```bash
ssh srv@<B>.local 'ngrok config add-authtoken <token>'
ssh -t srv@<B>.local 'sudo systemctl enable --now custom-ngrok.service'
```

The address **and** the SSH host key both change, so the command tcp-getter
emails you will not match the one you have. Expect that rather than debug it.

#### Rollback

One command on each machine, while A runs:

```bash
ssh -t srv@<A>.local sudo systemctl enable --now custom-cloudflared.service
ssh -t srv@<B>.local sudo systemctl stop custom-cloudflared.service
```

Leave A powered for a week. That is also what keeps any data you did not copy.

#### Things that bite

- **A `.env` edited for a LAN test survives every deploy.** `deploy.sh` never
  touches `.env`. A `CORS_ORIGIN` pointed at a LAN address gives a public site
  that refuses its own frontend. Put it back before step 4.
- **A frontend rebuilt with a LAN `API_URL` does not survive** - `deploy.sh
  --force` rebuilds it with `/api`. Run it anyway, to be sure.
- **`working/id_ed25519` is not the admin key.** A machine installed by this
  generation trusts `payload/seanorepo-admin.pub`. On a machine that trusts a
  different key, add the new key beside the old one. Prove that it works
  **before** you remove anything. sshd refuses passwords, so a wrong
  `authorized_keys` leaves only the console.

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

### Upgrade or roll back cloudflared and ngrok

apt owns both binaries, from their vendors' repositories, so an upgrade and a
rollback are each one apt command. Unattended upgrades take the Debian
security suite only (REQ-SERVER-006), so they do not update these two. Run
these commands from the LAN: a restart of `custom-ngrok.service` ends an SSH
session that came through ngrok.

```bash
# see the installed version and the versions apt can install
ssh srv@<name>.local apt-cache policy cloudflared ngrok

# upgrade both, then restart the units that run them
ssh -t srv@<name>.local 'sudo apt-get update && sudo apt-get install --only-upgrade cloudflared ngrok \
  && sudo systemctl restart custom-cloudflared.service custom-ngrok.service'

# roll back one package to a version from the list above
ssh -t srv@<name>.local 'sudo apt-get install --allow-downgrades cloudflared=<version> \
  && sudo systemctl restart custom-cloudflared.service'
```

The units run `/usr/bin/cloudflared` and `/usr/local/bin/ngrok`, the paths
that the packages install. dpkg replaces a binary in one step, so there is no
moment when a unit points at a missing file.

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
