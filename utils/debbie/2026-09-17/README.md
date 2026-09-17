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

In: install, provision, assert — in a VM and on metal. Out: the deploy poller,
the Cloudflare tunnel and the network failover watchdog — those are rebuilt in
a later generation under `REQ-DEPLOY-*` and `REQ-NETWORK-*`.

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
