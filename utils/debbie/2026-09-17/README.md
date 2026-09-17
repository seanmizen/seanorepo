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
- **WSL2 Debian**: `sudo apt install qemu-system-x86 qemu-system-arm qemu-utils ovmf qemu-efi-aarch64 curl python3`, plus `nestedVirtualization=true` in `.wslconfig`, `wsl --shutdown`, and `sudo usermod -aG kvm $USER` for `/dev/kvm`.

No Yarn, no `node_modules`. The harness is shell and QEMU only.

## Architecture: the deliberate tradeoff

The guest architecture follows the host, so the loop stays fast:

| Host | Guest | Accelerator |
|---|---|---|
| macOS arm64 | arm64 | `hvf` |
| WSL2 / Linux x86_64 | amd64 | `kvm` |
| anything cross-arch | as asked | `tcg`, with a loud warning |

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

In: install, provision, assert. Out: the deploy poller, the Cloudflare tunnel
and the network failover watchdog — those are rebuilt in a later generation
under `REQ-DEPLOY-*` and `REQ-NETWORK-*`.

`2025-10-08b` remains what production runs. Nothing here changes it.
