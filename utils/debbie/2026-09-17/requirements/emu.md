# REQ-EMU — The VM test harness

Constraints on `utils/debbie/2026-09-17/scripts/test-vm/test-vm.sh`. The
harness installs Debian into a VM, so a provisioning change can be proven
before it touches hardware.

Three earlier attempts at this loop were abandoned, and `utils/debbie/archive/`
keeps them. These requirements guard against the same failures, so each
Rationale names the failure that it prevents.

---

## REQ-EMU-001 — An accelerator is never assumed from the host alone

- **Status:** active
- **Source:** sean
- **Origin:** #259
- **Type:** constraint
- **Priority:** P0
- **Statement:** If a requested accelerator is unsupported by the QEMU binary or
  unusable for the chosen guest architecture, then the harness shall refuse to
  start and name the reason.
- **Rationale:** This is the defect that killed the December 2025 attempt.
  `archive/2025-12-27/preseed/test-preseed.sh` asked `sysctl kern.hv_support`,
  which is true on an Apple Silicon Mac, and then passed `-accel hvf` to
  `qemu-system-x86_64`. Hardware virtualisation works only within one
  architecture, so that combination cannot work. The script had two
  independent settings, a hardcoded `amd64` guest and a host-probed
  accelerator, and nothing tied them together.

  The harness asks the binary and does not ask the host.
  `qemu-system-* -accel help` answers exactly the right question. The harness
  derives guest architecture from host architecture through a single table, so
  it cannot represent the mismatched pair.

  The refusal matters as much as the detection. An automatic fall back to
  software emulation turns a five-minute mistake into a two-hour one that
  nobody watches. So an explicitly requested accelerator that the harness
  cannot honour is a hard failure.
- **Verification:**
  - Inspection — `utils/debbie/2026-09-17/scripts/test-vm/test-vm.sh`'s `resolve_accel` probes `-accel help` on the resolved binary and exits non-zero on an unsatisfiable explicit request, never downgrading it silently.
  - Demonstration — `DEBBIE_ACCEL=hvf DEBBIE_GUEST_ARCH=amd64 ./test-vm.sh` on an arm64 host exits non-zero naming the architecture mismatch.
- **Relations:** none

## REQ-EMU-002 — An install completes without being watched

- **Status:** active
- **Source:** sean
- **Origin:** #259
- **Type:** functional
- **Priority:** P0
- **Statement:** The harness shall complete an installation with no interactive
  prompt and no keystroke.
- **Rationale:** From outside, an install that stops on one unanswered
  debconf question looks the same as a slow install. So the loop saves time
  only if the install finishes unattended by construction.

  The installed system powers itself off and does not reboot. That turns "did
  it finish?" into a process exit code that the harness can read. Without it,
  phase one never terminates on its own.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/scripts/test-vm/test-vm.sh` › the `--install` phase, which wraps QEMU in a hard timeout and treats expiry as a failure.
  - Inspection — `utils/debbie/2026-09-17/payload/preseed.cfg` sets `debian-installer/exit/poweroff` so the installer halts the machine on success.
- **Relations:** none

## REQ-EMU-003 — The harness reports by exit code

- **Status:** active
- **Source:** sean
- **Origin:** #259
- **Type:** constraint
- **Priority:** P1
- **Statement:** The harness shall report the outcome of a run through its exit
  status.
- **Rationale:** The December 2025 attempt ended with a scratch file of
  hand-run QEMU commands and notes that read "more stable". At that point
  nobody trusted the harness, and a human read the console. People skip a loop
  whose result needs interpretation.

  Each stage has its own exit code, so a failure names the stage that broke,
  and nobody has to open the log. Install failure, boot or SSH timeout, and
  assertion failure are different problems with different fixes.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › the trailing `[ "$fail" -eq 0 ]`, which fails the run if any single check failed.
  - Inspection — `utils/debbie/2026-09-17/scripts/test-vm/test-vm.sh` documents and uses 0 pass, 1 assertion failure, 2 install failure, 3 boot/SSH timeout, 124 timeout.
- **Relations:** none

## REQ-EMU-004 — The guest boots the way the hardware does

- **Status:** active
- **Source:** sean
- **Origin:** #259
- **Type:** constraint
- **Priority:** P1
- **Statement:** The harness shall boot the guest through UEFI firmware with a
  writable variable store.
- **Rationale:** The target laptop is a UEFI machine. A VM that boots through
  legacy BIOS would leave the partitioning and bootloader half of the preseed
  untested, and that half is where installs fail.

  The variable store must be writable, and each VM must have its own. The
  installer writes its GRUB boot entry into UEFI NVRAM. Firmware supplied
  with `-bios` gives a read-only store. The installer's write is then lost,
  and the installed disk does not boot in phase two. A `pflash` pair is
  therefore what makes a two-phase harness possible.

  Homebrew ships an aarch64 firmware image with no matching variables
  template. A 64 MiB zero-filled file is the correct substitute: EDK2 detects
  an unformatted varstore and initialises it on first boot. Do not use the
  similarly named `edk2-arm-vars.fd`. It is 32-bit ARM, and it already
  contains data.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "booted via UEFI"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "removable-path loader"
- **Relations:** none

## REQ-EMU-005 — One preseed serves both architectures

- **Status:** active
- **Source:** sean
- **Origin:** #259
- **Type:** constraint
- **Priority:** P1
- **Statement:** The harness shall install from a preseed file that contains no
  architecture-conditional line.
- **Rationale:** The fast loop runs an arm64 guest on an Apple Silicon Mac while
  the real server is x86_64, so the two would drift apart the moment the
  configuration under test could tell them apart. A second preseed is a second
  thing to keep in step, and the copy that is not being iterated on is the one
  that rots.

  The harness puts anything that truly depends on the architecture into a
  generated overrides file, which `preseed/include` adds. So the tracked
  preseed is portable by design.

  The December 2025 file showed what the drift looks like. It hardcoded
  `partman-auto/disk` to `/dev/vda` *and* declared an `early_command` that
  auto-detects the disk. The two mechanisms conflicted: the hardcoded one
  passes under QEMU and is wrong on real hardware. Disk selection happens
  once, and it ignores removable devices, so the installer cannot target the
  USB stick that it booted from.
- **Verification:**
  - Inspection — `utils/debbie/2026-09-17/payload/preseed.cfg` names no architecture, no `grub-efi-*` package and no disk device. `grub-installer` selects the bootloader from the detected architecture.
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "architecture is $EXPECT_ARCH"
- **Relations:** none
