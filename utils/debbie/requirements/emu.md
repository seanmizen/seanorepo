# REQ-EMU — The VM test harness

Constraints on `utils/debbie/2026-09-17/vm/test-vm.sh`, which installs Debian
into a VM so a provisioning change can be proven before it touches hardware.

Three earlier attempts at this loop exist in the repository and all three were
abandoned. These requirements exist mostly to stop the fourth going the same
way, so each Rationale names the failure it is guarding against.

Introduced in #259.

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
  `2025-12-27/preseed/test-preseed.sh` asked `sysctl kern.hv_support`, which is
  true on an Apple Silicon Mac, and then passed `-accel hvf` to
  `qemu-system-x86_64`. Hardware virtualisation is same-architecture only, so
  that combination cannot work. The script had two independent settings — a
  hardcoded `amd64` guest and a host-probed accelerator — and nothing tying them
  together.

  The fix is to ask the binary rather than the host: `qemu-system-* -accel help`
  answers exactly the right question and is impossible to get wrong. Guest
  architecture is derived from host architecture through a single table, so the
  mismatched pair is unrepresentable rather than merely unlikely.

  Refusing matters as much as detecting. An automatic fall back to software
  emulation turns a five-minute mistake into a two-hour one that nobody is
  watching, so an explicitly requested accelerator that cannot be honoured is a
  hard failure.
- **Verification:**
  - Inspection — `utils/debbie/2026-09-17/vm/test-vm.sh`'s `resolve_accel` probes `-accel help` on the resolved binary and exits non-zero on an unsatisfiable explicit request, never downgrading it silently.
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
- **Rationale:** An install that stops on one unanswered debconf question is
  indistinguishable, from outside, from one that is merely slow — so the loop
  only saves time if finishing is unattended by construction.

  The installed system powers itself off rather than rebooting, which is what
  turns "did it finish?" into a process exit code the harness can read. Without
  that, phase one never terminates on its own.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/test-vm.sh` › the `--install` phase, which wraps QEMU in a hard timeout and treats expiry as a failure.
  - Inspection — `utils/debbie/2026-09-17/preseed/preseed.cfg` sets `debian-installer/exit/poweroff` so the installer halts the machine on success.
- **Relations:** none

## REQ-EMU-003 — The harness reports by exit code

- **Status:** active
- **Source:** sean
- **Origin:** #259
- **Type:** constraint
- **Priority:** P1
- **Statement:** The harness shall report the outcome of a run through its exit
  status.
- **Rationale:** The previous attempt ended with a scratch file of
  hand-run QEMU commands and notes reading "more stable" — the point at which
  the harness had stopped being trusted and a human was reading the console
  instead. A loop whose result needs interpreting is one that gets skipped.

  Distinct codes rather than a single non-zero, so a failure says which stage
  broke without anyone opening the log: install failure, boot or SSH timeout,
  and assertion failure are different problems with different fixes.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › the trailing `[ "$fail" -eq 0 ]`, which fails the run if any single check failed.
  - Inspection — `utils/debbie/2026-09-17/vm/test-vm.sh` documents and uses 0 pass, 1 assertion failure, 2 install failure, 3 boot/SSH timeout, 124 timeout.
- **Relations:** none

## REQ-EMU-004 — The guest boots the way the hardware does

- **Status:** active
- **Source:** sean
- **Origin:** #259
- **Type:** constraint
- **Priority:** P1
- **Statement:** The harness shall boot the guest through UEFI firmware with a
  writable variable store.
- **Rationale:** The target laptop is a UEFI machine, so a VM booting through
  legacy BIOS would leave the partitioning and bootloader half of the preseed —
  where installs actually fail — completely untested.

  The variable store has to be writable, and per-VM. The installer writes its
  GRUB boot entry into UEFI NVRAM; supplying firmware with `-bios` gives a
  read-only store, that write is discarded, and the installed disk then will not
  boot in phase two. Supplying it as a `pflash` pair is therefore not a stylistic
  preference, it is what makes a two-phase harness possible at all.

  Homebrew ships an aarch64 firmware image with no matching variables template.
  A 64 MiB zero-filled file is the correct substitute — EDK2 detects an
  unformatted varstore and initialises it on first boot. The similarly named
  `edk2-arm-vars.fd` is 32-bit ARM and already populated, and must not be used.
- **Verification:**
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "booted via UEFI"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "removable-path loader"
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

  Anything genuinely arch-dependent is injected by the harness into a generated
  overrides file, layered on through `preseed/include`. That leaves the tracked
  preseed honestly portable rather than portable by coincidence.

  The December 2025 file showed what the drift looks like: it hardcoded
  `partman-auto/disk` to `/dev/vda` *and* declared an `early_command` that
  auto-detects the disk, two mechanisms fighting, where the hardcoded one passes
  under QEMU and is wrong on real hardware. Disk selection now happens once, and
  filters out removable devices so the installer cannot target the USB stick it
  booted from.
- **Verification:**
  - Inspection — `utils/debbie/2026-09-17/preseed/preseed.cfg` names no architecture, no `grub-efi-*` package and no disk device; `grub-installer` selects the bootloader from the detected architecture.
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "architecture is $EXPECT_ARCH"
- **Relations:** none
