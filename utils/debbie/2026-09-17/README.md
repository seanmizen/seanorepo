# debbie — 2026-09-17

A VM harness for provisioning debbie, so a change can be proven before it
touches the laptop.

What binds here is [`utils/debbie/requirements/`](../requirements/) — `REQ-EMU-*`
for the harness, `REQ-SERVER-*` for what a provisioned host must be. This file
explains; the requirements bind. CI validates them on every PR.

## Why this exists

Every previous generation was written blind and debugged on real hardware.
Three attempts at an in-silico loop are in the repository and all three died:

| Attempt | Why |
|---|---|
| `archive/pxe/` (Apr 2025) | dnsmasq DHCP only worked over a direct Ethernet link — home routers intercept it. Its own `rah-setup.sh --info` records this. |
| `pxe/pxe-vm.sh` (Apr 2025) | VirtualBox cannot run x86_64 guests on Apple Silicon. Deleted a day later. |
| `2025-12-27/preseed/test-preseed.sh` (Dec 2025) | Probed `kern.hv_support` (true on arm64), then handed `-accel hvf` to `qemu-system-x86_64`. Hardware virtualisation is same-architecture only. |

The third is the instructive one, and `REQ-EMU-001` exists to prevent it: the
harness asks the **QEMU binary** what it supports, never the host.

## Running it

For a real machine, see [`metal/README.md`](./metal/README.md) — an unmodified
netinst stick plus the preseed served from your laptop. Both paths generate
`overrides.cfg` with the same [`scripts/write-overrides.sh`](./scripts/write-overrides.sh),
so what installs on hardware is what the VM proved.

```bash
./vm/test-vm.sh --full        # install, boot, provision, assert
./vm/test-vm.sh --install     # install only
./vm/test-vm.sh --assert      # boot the cached image and assert
./vm/test-vm.sh --clean       # delete cached images and run state
```

Exit codes: `0` pass · `1` assertion failed · `2` install failed · `3` never
came up on SSH · `124` timed out. Nothing needs watching.

### Prerequisites

- **macOS**: `brew install qemu coreutils` — firmware ships with QEMU.
- **WSL2 Debian**: `sudo apt install qemu-system-x86 qemu-system-arm qemu-utils ovmf qemu-efi-aarch64 curl python3`, plus `nestedVirtualization=true` in `.wslconfig`, `wsl --shutdown`, and `sudo usermod -aG kvm $USER` for `/dev/kvm`. Windows 11 only — see the Windows 10 note below.
- **Windows-native (unproven)**: `winget install SoftwareFreedomConservancy.QEMU`, enable the *Windows Hypervisor Platform* feature, reboot, and put `qemu-system-x86_64` on `PATH`. Firmware ships with QEMU under its `share/` directory.

  Accelerator *selection* is correct here, but this is not a supported path. Two things are unresolved: `whpx` is reported broken with `-drive if=pflash`, which this harness requires (see the Windows 10 note below); and a POSIX shell on Windows ships neither `timeout` nor `python3`, both of which the harness needs — `timeout` to bound the install, `python3` to pick a free port and serve the preseed. On Windows, prefer WSL2 and accept TCG.

No Yarn, no `node_modules`. The harness is shell and QEMU only.

## Architecture: the deliberate tradeoff

The guest architecture follows the host, so the loop stays fast:

| Host | Guest | Accelerator |
|---|---|---|
| macOS arm64 | arm64 | `hvf` |
| Linux x86_64, incl. WSL2 with nested virtualisation | amd64 | `kvm` |
| Windows-native, via a POSIX shell (MSYS2, Cygwin) | amd64 | `whpx` — unproven, see below |
| anything cross-arch | as asked | `tcg`, with a loud warning |

**Windows 10 has no accelerated path for this harness.** Two separate limits
stack up, and it is worth knowing both before going looking for a setting.

1. **WSL2 on Windows 10 has no nested virtualisation.** Microsoft gates the
   processor-feature lookup behind a Windows 11 check, so `nestedVirtualization=true`
   in `.wslconfig` is silently ignored, `/dev/kvm` never appears, and `vmx` is
   absent from `/proc/cpuinfo` no matter what the CPU supports
   ([microsoft/WSL#40735](https://github.com/microsoft/WSL/issues/40735)). A run
   from a WSL2 shell therefore uses TCG.
2. **`whpx` is not an alternative there.** It is the Windows Hypervisor Platform
   API, so only a QEMU built for Windows can load `WinHvPlatform.dll`. A Linux
   build has no `whpx` accelerator compiled in at all, which is why asking for
   one inside WSL2 fails loudly rather than degrading silently.

A Windows-native QEMU *could* use `whpx`, and the harness selects it where
`uname -s` reports `MINGW*`/`MSYS*`/`CYGWIN*`. But it collides with this
harness's firmware requirement:
[QEMU #513](https://gitlab.com/qemu-project/qemu/-/issues/513) reports `whpx`
failing on `-drive if=pflash` with *"Failed to emulate MMIO access"*, unfixed
since 2020, and the documented workaround is `-bios` — exactly what
`REQ-EMU-004` forbids, because a read-only variable store discards the
installer's boot entry and the disk then will not boot in the assert phase.
**Treat the Windows-native path as unproven.**

So on Windows 10, expect TCG. That is not the worst case it sounds like: an
amd64 guest on an amd64 host gets *multi-threaded* TCG, unlike the x86-on-ARM
combination. Windows 11 WSL2 supports nested virtualisation and gets `kvm`
normally.

debbie itself is **x86_64**. Running an arm64 guest on the Mac is a knowing
trade of fidelity for iteration speed — minutes instead of hours. One preseed
serves both, with anything arch-specific injected by the harness into a
generated `overrides.cfg` (`REQ-EMU-005`).

### What the arm64 loop proves

Preseed syntax and debconf key validity, that no prompt goes unanswered,
network and mirror configuration, partitioning and ESP creation on GPT under
UEFI, the UEFI → GRUB → systemd boot chain, user and SSH setup, and every
`REQ-SERVER-*` property.

### Two assertion phases, and why

`vm/assert.sh` runs **twice**, and the split is the whole of `#285`:

| `PHASE` | When | What a pass means |
|---|---|---|
| `firstboot` | the installed system has booted once; nothing run by hand | the **installer** produced a correct box |
| `provisioned` | after `postinstall.sh` and a reboot | the **box** is correct |

Before this, only the second run existed. `postinstall.sh` repairs the hostname
and installs mDNS, so a box the installer named `192` was already named
correctly by the time anything looked at it — the end state was right, the
install was wrong, and no run could tell the two apart. A check that fails in
`firstboot` and passes in `provisioned` now reads, in exactly those words, as
*postinstall repaired it*, and both harnesses exit non-zero on it.

### What it does not

Read this before trusting a green run on hardware:

- **BIOS/CSM and `grub-pc`.** arm64 has no legacy BIOS path at all.
- **Secure Boot.** The x86 shim → signed-GRUB → MOK chain is never exercised.
- **`grub-efi-amd64` specifically** — only the generic grub-installer logic.
- **Intel/AMD microcode** packages.
- **Real UEFI NVRAM behaviour.** Vendor firmware that drops or reorders
  `efibootmgr` entries is exactly why the preseed sets
  `force-efi-extra-removable`, and exactly what a VM cannot reproduce.
- **The laptop's NIC and wifi drivers.** The VM sees `virtio-net-pci`, which
  needs no firmware. This is the highest-risk gap: a preseed install with no
  working NIC hangs at `netcfg` forever.
- **Wifi, at all.** QEMU has no 802.11 device the installer would drive, so
  nothing about association, WPA2 or wifi persistence is exercised here —
  `REQ-SERVER-005` is skipped, not passed, on every VM run. The first proof is
  the box itself. This is why the wifi credentials go on the kernel command
  line rather than into the preseed: the preseed is fetched *over* the network,
  so the network must already be up to read it.
- **Real disk topology** — NVMe naming, multiple disks, an existing ESP.
- **The hostname fault of `#285`, in its original form.** The box installed
  itself as `192` because netcfg fell through to a reverse-DNS lookup of
  `192.168.1.182` and split it at the first dot. QEMU's user-mode DHCP supplies
  no hostname and no reverse-DNS answer, so that branch of netcfg is never
  taken here and the specific symptom cannot appear.

  What the VM **does** now cover is the class rather than the instance: with
  `PHASE=firstboot` asserting the hostname before `postinstall.sh` runs, any
  install that fails to impose the intended name — for whatever reason netcfg
  chose something else — goes red. Whether the *fix* works against a router
  that does answer reverse DNS is unproven until the on-metal run.
- **A tunnel that actually connects.** There are no Cloudflare credentials in
  any VM and there never will be, so no green run proves that `cloudflared`
  authenticates, that the ingress rules route, or that a request from the
  internet reaches a container. What the tunnel checks prove is that the box is
  *provisioned* to run one: the package is installed and dpkg-owned, the unit
  exists with the right config path and working directory, nothing else is
  driving the same tunnel, and the absence of credentials produces a refusal.
  The first proof of a working tunnel is the box itself.
- **mDNS on the LAN.** `$SERVER_NAME.local resolves` asks the box's own
  `nss-mdns`, which asks the local `avahi-daemon`, which answers for the name
  it publishes. That proves the daemon is up, publishing the right name, and
  wired into `nsswitch.conf`. It does **not** prove a multicast packet leaves
  the machine or that another host on the LAN can resolve it — QEMU's slirp
  networking does not carry multicast to the host. Only the real box proves
  reachability. `metal/provision.sh` dials the name first for `#284` — the DHCP
  lease moves on every boot and the name does not — and falls back to a supplied
  `HOST` address precisely because this is the one thing no green run proves.
- **A published port refused from *another machine*.** The firewall section
  publishes a port deliberately and then proves two things about it: that the
  socket is bound to `127.0.0.1` and nothing else, and that a connection to the
  box's own routable address is refused. Both of those leave from the box and
  arrive at the box. What they establish is the **binding** — a socket bound to
  loopback does not accept a connection addressed to `10.0.2.15`, whoever sends
  it — and that is the property `REQ-SERVER-002` actually turns on.

  What no VM run establishes is that a packet from a *different* host on the
  LAN is refused at the wire. QEMU's slirp networking gives the guest no LAN
  peer to be refused from; the guest cannot be dialled from the host at all
  without an explicit forward. The first proof of that half is the metal run:
  with `yarn prod:docker` up on debbie, `nc -vz debbie.local 4000` from a laptop
  on the same wifi must be refused, and `curl -sf localhost:4000` on the box
  itself must answer.

  The off-host half **was** proven off the box, just not in this harness: the
  same daemon setting, tested from a second container on a separate network
  namespace, refused a loopback-bound published port and answered a
  `0.0.0.0`-bound one. See `#300`.
- **That an unattended upgrade ever actually installs anything.**
  `REQ-SERVER-006`'s checks prove the box is *configured and scheduled* to patch
  itself: `unattended-upgrades` is installed, both apt timers are enabled and
  running, apt's effective configuration allows exactly one origin — the
  security suite for the running codename — and `Automatic-Reboot` is
  explicitly `false`. The origin check reads `unattended-upgrade --dry-run
  --debug`, killed at its first line of output on purpose so the assertion does
  not download the packages it is describing.

  What no VM run proves is that a security fix published next month is fetched
  and installed on a timer nobody watched. That takes calendar time and a real
  advisory, and the only thing that will show it is the box itself — `journalctl
  -u unattended-upgrades` and `/var/log/unattended-upgrades/` on debbie, some
  weeks after this shipped.

  The reboot half is asserted rather than exercised for the same reason, and
  that is the safe direction: the failure being guarded against is the box
  rebooting on its own and not coming back on wifi, so a green run means it did
  not, not that it survived one.
- **That the box can actually deploy, when the deploy-poller checks skip.**
  `deploy.sh` lives in the checkout and the checkout is on `release`, so a box
  provisioned before this generation shipped genuinely cannot have it. Four
  checks then skip rather than fail — `#311` — and the reason printed beside
  each names the commit on disk and the path it does not track.

  **A green run with those skips present does not prove the deploy path.** It
  proves the timer, the unit ownership, the polling interval and the sudoers
  boundary are right; it proves nothing about `deploy.sh` itself, because there
  is no `deploy.sh` to prove anything about. Read the skips, not just the exit
  code. The first run that proves the deploy path is the one after `yarn
  release` has put this generation on `release` — in that run the same four
  checks **run**, and a missing or non-executable `deploy.sh` is then a
  failure, loudly, because the commit on disk says the file should be there.

## Notes on the design

**UEFI via pflash, never `-bios`** (`REQ-EMU-004`). The installer writes its
GRUB boot entry into UEFI NVRAM. `-bios` gives a read-only variable store, so
that write is discarded and the installed disk will not boot in the assert
phase. Homebrew ships `edk2-aarch64-code.fd` with no matching vars template; a
64 MiB zero-filled file is correct, because EDK2 formats an unformatted
varstore on first boot. The similarly named `edk2-arm-vars.fd` is 32-bit ARM
and must not be substituted.

Verified on this host — EDK2 honours `-kernel`/`-initrd` via fw_cfg and
delivers the initrd over LoadFile2:

```
EFI stub: Booting Linux Kernel...
EFI stub: Loaded initrd from LINUX_EFI_INITRD_MEDIA_GUID device path
Linux version 6.12.107+deb13-arm64
efi: EFI v2.7 by EDK II
```

**A `netcfg/*` answer only counts if it is on the boot line** (`REQ-SERVER-004`,
`#285`). The preseed is fetched *over the network*, so netcfg has already run
and already decided everything it decides by the time the file is read. The
Debian guide states it plainly: *"preseeding the network configuration won't
work if you're loading your preconfiguration file from the network"* (B.4.3).

That is not a corner case here, it is the norm — it is why the wifi credentials
were already on the kernel command line, and `netcfg/hostname` now joins them,
in `metal/lib.sh` `installer_params()` and in `vm/test-vm.sh`'s `append`. The
keys in `preseed.cfg` and `overrides.cfg` are kept, but nothing depends on
them: on the first real install both `netcfg/hostname` and
`netcfg/get_hostname` were set correctly and the box still came up as `192`,
because netcfg had already resolved `192.168.1.182` by reverse DNS and split it
at the first dot.

Belt *and* braces: `overrides.cfg`'s `late_command` also writes
`/etc/hostname` and the `127.0.1.1` line directly into the target. It runs at
`finish-install.d/07`, after the target's identity files exist and before the
only later netcfg script (`55netcfg-copy-config`), which writes interface
configuration and does not touch either file. That layer cannot lose a race
with netcfg whatever the boot line does.

**The box ignores its own power button** (`REQ-SERVER-001`, `#283`). The logind
drop-in covered the lid, masked `sleep`/`suspend`/`hibernate` and set
`IdleAction=ignore`, and then left `HandlePowerKey` at systemd's default of
`poweroff`. On a laptop on a shelf that is a graceful shutdown of every hosted
site for the price of a knock, and it happened twice in the first evening of
real use — the second time while `provision.sh` was waiting for the box, which
is why that run reported "did not come up on SSH". `HandlePowerKey`,
`HandleSuspendKey` and `HandleHibernateKey` are now `ignore` in the same
drop-in, asserted after the reboot against the running logind manager.

To shut debbie down on purpose:

```bash
ssh srv@debbie.local sudo systemctl poweroff   # deliberate
ssh srv@debbie.local sudo systemctl reboot     # deliberate
```

If it is wedged badly enough that SSH will not answer, **hold the power button**
for about four seconds. That force-off is done by the firmware, not by the
operating system, and no logind setting can disable it — it is a hard cut, so it
is the last resort rather than the normal way. `HandlePowerKeyLongPress` is
logind's *software* long press, an unrelated knob, and it is explicitly
`ignore`: setting it to `poweroff` would hand the hole straight back to anyone
who held the button a moment too long.

**The box patches itself, from the security suite, and never reboots to do it**
(`REQ-SERVER-006`, `#286`). Three things about this are easy to get wrong and
all three are deliberate.

*Debian's stock configuration is not security-only.* `50unattended-upgrades`
enables three origin patterns and the first,
`origin=Debian,codename=${distro_codename},label=Debian`, is the whole stable
suite. A `--dry-run` against it proposed `base-files`, `bash`, `libc6`,
`perl-base` and `tzdata` from `archive:stable`. So `postinstall.sh` writes
`/etc/apt/apt.conf.d/52debbie-unattended-upgrades`, which `#clear`s the list
before setting one pattern — apt.conf list syntax **appends**, so a drop-in that
only names the pattern it wants leaves all three of Debian's in place and adds
a fourth duplicate.

*The configuration is half of it.* `apt-daily.timer` and
`apt-daily-upgrade.timer` are the other half, and a perfect configuration on a
box whose timers are masked has patched nothing since the day it was installed
and says so nowhere. That is `#136` again. Both are enabled by `postinstall.sh`
and both are asserted against systemd rather than against a file.

*Reboots are not automatic, explicitly.* `Unattended-Upgrade::Automatic-Reboot`
is written as `"false"` although the package default is already `false`, because
the default cannot be told apart from nobody having considered the question. The
cost is real and accepted: a kernel or libc fix sits unpacked and inactive until
somebody reboots by hand.

```bash
ssh srv@debbie.local cat /var/run/reboot-required   # is one pending?
ssh srv@debbie.local sudo systemctl reboot          # apply it, deliberately
ssh srv@debbie.local 'journalctl -u unattended-upgrades --no-pager | tail -40'
```

`powermgmt-base` is deliberately not installed: with it present,
`unattended-upgrades` skips every run while the machine is on battery, and
debbie is a laptop, so its battery is always there to be found.

**The preseed is served over HTTP**, not embedded in the initrd. Embedding is
what drove the December attempt to hand-write a cpio archive in PowerShell; over
HTTP, editing the preseed costs nothing and there is no build step.

**Disk selection filters removable devices.** The previous preseed both
hardcoded `/dev/vda` and declared an auto-detecting `early_command` — two
mechanisms fighting, where the hardcoded one passes under QEMU and is wrong on
metal. There is now one mechanism, and it skips removable media so an install
cannot target the USB stick it booted from.

**The installed image is cached once and overlaid, not copied.** A successful
install moves its disk to `work/cache/base-<arch>.qcow2`, and the run disk
becomes a thin qcow2 overlay backed by it. Copying instead cost a real 2G per
run — APFS does not clone a file written that way — so the pair occupied 4G
where 2G plus a few hundred kilobytes does. The practical effect is that
`--assert` can be re-run as often as you like for free, which is what makes
iterating on `postinstall.sh` and the assertions cheap: only `--install`
re-pays the two minutes and the 2G.

## Scope

In: install, provision, assert — in a VM and on metal, plus the repository
checkout itself (`REQ-DEPLOY-001`): `postinstall.sh` clones seanorepo as the
deploy user and puts it on `release`. Since #279 the deploy poller is in too,
and since #280 the Cloudflare tunnel (`REQ-NETWORK-001`, `REQ-NETWORK-002`).
Out: the network failover watchdog (`REQ-NETWORK-003`) and the wifi migration
to NetworkManager (`REQ-NETWORK-004`).

### Published ports never reach the LAN

`REQ-SERVER-002` says four ports and no more. Until #300 that was a claim about
`ufw` rather than about the host, and the two are not the same thing: Docker
writes its own chains into `nat` and `filter`, and a container published with
`-p 4000:4000` gets a DNAT rule consulted *before* ufw's. Every app port in the
4xxx range was reachable from the LAN the moment `yarn prod:docker` ran, and the
assertion that would have caught it read `ufw status` — which is not where those
rules live, so it went green over the hole.

`postinstall.sh` writes `/etc/docker/daemon.json`:

```json
{
  "ip": "127.0.0.1"
}
```

That is dockerd's `--ip`, *"Host IP for port publishing"*. A published port then
binds `127.0.0.1` and nothing else. The tunnel is unaffected because every
ingress rule in `apps/cloudflared/config.yml` already reaches its origin as
`http://localhost:4xxx` and `cloudflared` runs as a host process.

Chosen over a LAN-deny rule in `DOCKER-USER` on purpose: binding removes the
class, filtering only catches it. There is no rule to persist across a reboot
and no chain ordering to get right.

It is a **default**, though, and a compose file that writes
`"0.0.0.0:4001:4001"` still publishes to the LAN — measured, same daemon,
reachable from another host. #309 is the ticket for making the compose files say
what they mean. Until then the assertions are the guard, and they deliberately
do not trust this file: they read the listening sockets, the `nat` chain, and a
port they publish themselves on the spot. Changing the daemon setting back does
not make them pass.

A note for anyone debugging this on the box: the setting takes effect on a
daemon **restart**, not on `SIGHUP`. dockerd's live reload covers a named subset
of settings and `ip` is not in it — writing the file and reloading leaves a
later `-p 4000:4000` still on `0.0.0.0`, which looks exactly like it worked.

### The deploy poller

`postinstall.sh` installs `custom-deploy-poll.timer`, which runs
`scripts/deploy.sh` every two minutes. The host pulls, because nothing can
reach in — `REQ-SERVER-002` forwards no port and `REQ-DEPLOY-002` is the
consequence. Follow a deploy with:

```bash
ssh srv@debbie.local journalctl -u custom-deploy-poll.service -f
# decisions only, without the ~720 "up to date" lines a day
ssh srv@debbie.local journalctl -u custom-deploy-poll.service -p info
```

Four things about it are deliberate and easy to undo by accident:

- **The units are written by `postinstall.sh` itself, not copied out of the
  checkout.** That script is delivered on its own — `scp`'d to `/tmp` by
  `vm/test-vm.sh`, streamed over stdin by `metal/provision.sh` — so it can read
  nothing beside it in the repository. The only checkout it could read from is
  the one it just made, which is on `release`, which by definition holds the
  last thing *shipped*. On the first box this generation provisions, `release`
  still points at the previous generation. Sourcing the units from there would
  install the poller only on a box that already had one.
- **`deploy.sh` is run from the checkout**, so a deploy updates the deployer. It
  is too long to inline and two copies would be worse than the problem. The
  consequence is the chicken-and-egg above, one level down: on a box whose
  `release` predates #279 the timer fails until the checkout advances.
  `postinstall.sh` says so, with the remedy, rather than leaving a unit that
  fails every two minutes with *No such file or directory*.

  `vm/assert.sh` takes the same view, and takes it **once** for all four checks
  that read the file — `#311`. The question it asks is not "is `deploy.sh`
  there" but "does the commit this working tree came from track it", answered
  with `git cat-file -e HEAD:utils/debbie/2026-09-17/scripts/deploy.sh`:

  | the commit on disk | `deploy.sh` on disk | result |
  |---|---|---|
  | does not track it | absent | **skip**, naming the commit and the path |
  | tracks it | present and executable | **pass** |
  | tracks it | absent, or not executable | **fail** |

  The middle column cannot contradict the first by accident, which is the
  point: a flat skip would have made a green run unable to tell a box that
  legitimately predates the poller from one that has lost a file it should
  have, and the second is a real fault. The exact path is asked for rather than
  the generation directory, because the directory landed before `deploy.sh`
  did — a `release` in between has the directory and no script, and on such a
  box the file still cannot exist. `HEAD` is asked rather than `origin/release`
  because `HEAD` is what produced the working tree, and needs no network.
- **There is no boot-time deploy unit.** The previous generation needed one
  because no app compose file sets a restart policy, so after a power cut the
  containers are down while `release` has not moved. `deploy.sh` records the
  boot id alongside the deployed SHA, so a reboot is itself a reason to deploy.
  One line in the marker replaces a whole unit.
- **There is no `git clean`** — `REQ-DEPLOY-006`, and `vm/assert.sh` asserts
  both its absence and the comment explaining it. `apps/cloudflared/credentials/`
  is gitignored and exists only on the host.

The sudoers drop-in grants exactly one command, which is the whole reason the
deploy does not need general root. Note what it is and is not today:
`scripts/write-overrides.sh` has the installer write
`srv ALL=(ALL) NOPASSWD:ALL` to `/etc/sudoers.d/90-srv`, so the account already
has general passwordless root and this file narrows nothing *yet*. What it does
is make the deploy need only one command, so that tightening the blanket grant
under `REQ-SERVER-008` later does not break deploys.

The clone is anonymous HTTPS. seanmizen/seanorepo is public, so provisioning
holds no deploy key and there is nothing on the box to rotate; if the
repository is ever made private, `postinstall.sh`'s clone is what breaks, and
`vm/assert.sh` › "srv can reach origin with no credential" is what says so.

`release` exists only once someone has run `yarn release`, so on a newly
provisioned box it may legitimately be absent. That is reported and skipped,
never failed, and `postinstall.sh` deliberately does not create it — doing so
would ship whatever `main` happened to be.

### The Cloudflare tunnel

Everything public arrives this way. `REQ-SERVER-002` forwards no inbound port
and the firewall allows four, none of them an app port, so until the tunnel is
running the box serves nothing to the internet — that is the design, not a
gap. `postinstall.sh` installs `custom-cloudflared.service`, which reads its
ingress rules from `apps/cloudflared/config.yml` in the deployed checkout
(`REQ-NETWORK-002`), and `deploy.sh` restarts it when that file changes.

**Not the SSH tunnel.** `utils/debbie/README.md` has a *Cloudflare SSH tunnel*
section with its own `cloudflared tunnel create` recipe and an
`ssh-config.yml`. That is a different tunnel for a different job. This one is
the ingress tunnel that serves the sites.

**From apt, not a binary drop** (#135). `postinstall.sh` adds Cloudflare's
repository and installs the `cloudflared` package, so the binary is
dpkg-owned and `REQ-SERVER-006`'s unattended upgrades keep it current. The
unit passes `--no-autoupdate` for the same reason (#136): cloudflared's own
self-update failed silently for about sixteen months on the old box, and with
the package in charge of the version a second updater could only ever conflict.

The apt suite is `any`, not the host's codename, and that is deliberate:
Cloudflare publishes no `trixie` suite — `dists/trixie/Release` is a 404 — so
the codename substitution used for Docker's repository would break apt on
every update. `any` serves a byte-identical `Packages` index to the codename
suites, and `cloudflared` is a static Go binary, so one build covers all of
them.

#### Creating the tunnel and placing its credentials

The credentials are host-specific, gitignored (`REQ-DEPLOY-006`) and in no
repository. **Provisioning defines the path and creates the directory; it never
writes the credentials and never overwrites an existing set**, so re-running
`postinstall.sh` cannot break a working tunnel.

On a machine with a Cloudflare login:

```bash
cloudflared tunnel login                 # browser, once per machine
cloudflared tunnel create debbie         # writes ~/.cloudflared/<uuid>.json
cloudflared tunnel route dns debbie seanmizen.com   # per hostname served
```

Then put the credentials on the box and point the config at them:

```bash
# on debbie, as srv
install -m 600 <uuid>.json \
  ~/projects/seanorepo/apps/cloudflared/credentials/<uuid>.json
```

`apps/cloudflared/config.yml` must name the same tunnel:

```yaml
tunnel: <uuid>
credentials-file: ./credentials/<uuid>.json
```

That `credentials-file` path is **relative**, and cloudflared resolves it
against the process's working directory rather than against the config file.
The unit therefore sets `WorkingDirectory` to `apps/cloudflared`; deleting that
line makes the daemon start and then fail to find its credentials, which reads
like an auth problem and is not one. `vm/assert.sh` asserts the line is there.

Finally, re-run `postinstall.sh`. It enables the unit once — and only once —
the credentials are in place.

#### What happens on a box with no credentials

A newly provisioned box has none, and that is a normal state rather than a
failure: `postinstall.sh` exits 0, prints the recipe above, and **does not
enable the unit**. Enabling it would be the worse outcome — a tunnel restarting
every ten seconds against credentials that are not there fills a journal that
is uncapped until #287 and buries the one fact that matters.

Two mechanisms, because the refusal has to survive a box that loses its
credentials later as well as one that never had them:

- `postinstall.sh` enables the unit only when `config.yml` and a non-empty
  credentials directory both exist. It never *disables* an already-enabled
  unit, so a re-provisioning run cannot take a working tunnel down.
- The unit carries `ConditionPathExists` and `ConditionDirectoryNotEmpty`. A
  unit whose conditions are unmet is **skipped** by systemd — one log line,
  left inactive, never marked failed, so `Restart=` is never reached. For
  failures the conditions cannot see (credentials present but rejected, a
  config that will not parse) `StartLimitBurst=5` over ten minutes stops the
  retries and leaves the unit in `failed`, where `systemctl status` shows it.

Check with:

```bash
ssh srv@debbie.local systemctl status custom-cloudflared.service
ssh srv@debbie.local journalctl -u custom-cloudflared.service -b
```

#### One tunnel, one daemon

Two `cloudflared` processes serving one tunnel is a real failure mode:
Cloudflare accepts both connections, requests are dealt to whichever, and
restarting "the tunnel" fixes half of them. The `cloudflared` package itself
ships **no** systemd unit — verified by unpacking the `.deb`, which contains
only `/usr/bin/cloudflared`, a man page and a changelog — so there is nothing
packaged to race and nothing to mask. A `cloudflared.service` can still appear,
because `cloudflared service install` writes one and that is the documented way
to set this up; `cloudflared-custom.service` is the previous generation's unit
and is live on the box this replaces. `postinstall.sh` disables either on
sight, and `vm/assert.sh` › "no other cloudflared unit is enabled" is what
keeps it true.

Our unit is `custom-cloudflared.service` and deliberately **not**
`cloudflared.service`: a file of that name in `/usr/local/lib/systemd/system`
would shadow any packaged unit of the same name, which `REQ-SERVER-012`
forbids. The name appears in three places — the unit on disk, `CLOUDFLARED_UNIT`
in `deploy.sh`, and the sudoers drop-in — and `vm/assert.sh` asserts all three
agree, because a rename that moves only two of them fails at the exact moment
it matters, an ingress change, and passes every other day of the year.

Deferred, not rejected: **systemd targets and slices.** Units go in
`/usr/local/lib/systemd/system` with a `custom-` prefix (`REQ-SERVER-011`,
`REQ-SERVER-013`), and that is as far as grouping goes for now. Two further
mechanisms exist if they ever earn their place:

- A **target** is a named list of units, so `systemctl list-dependencies
  custom.target` shows the whole stack with live status and
  `systemctl restart custom.target` operates on it as one thing.
- A **slice** is a cgroup resource bucket: services given `Slice=custom.slice`
  can be capped together with `MemoryMax=` and inspected with
  `systemd-cgls /custom.slice`.

Neither changes how anything runs, and both can be added later without
rework — a target is a new file plus nothing else, a slice is one line per
unit. The reason to wait is that most of what this host serves is already
agglomerated under Docker, so the number of top-level systemd units is
expected to stay small, and `systemctl list-units 'custom-*'` may well be the
whole answer. Revisit once there is a clean install and an actual list of
services to look at.

Also out, and deliberately: **migrating wifi to NetworkManager.** `netcfg`
persists wifi as an ifupdown stanza, which works and satisfies
`REQ-SERVER-005`, but production's `net-failover.sh` drives `nmcli` and will
not see it. Adding `network-manager` to the package list does not fix that —
its ifupdown plugin marks an interface listed in `/etc/network/interfaces` as
unmanaged, so neither half ends up in charge. The migration has to remove the
stanza and write an NM profile in one step, and getting it wrong leaves a
headless box with no network. It is not worth coupling that to installing the
machine, so it lands with `REQ-NETWORK-*`.

`2025-10-08b` remains what production runs. Nothing here changes it.
