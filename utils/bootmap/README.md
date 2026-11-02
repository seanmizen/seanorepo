# bootmap

bootmap shows the boot of a Linux machine as a live treemap. The screen
starts black. Each box is one step of the boot: a kernel initcall, the
initramfs, or a systemd unit. A box fills when its step completes. When every
box is full, the login screen opens.

![A boot at 30 %](docs/boot-30.png)

## How it works

Three programs draw one picture on the same framebuffer, one after the other:

| Stage | Program | It fills |
|---|---|---|
| 1 | Zig UEFI loader (`src/loader/`) | the firmware and loader boxes. Then it loads the UKI. |
| 2 | Kernel patch (`kernel/`) | one box for each initcall, live, from the `initcall_start` and `initcall_finish` tracepoints |
| 3 | Zig daemon in the initramfs (`src/daemon/`) | the systemd boxes, live, from the systemd job list |

The squarify layout exists in Zig (`src/layout/treemap.zig`) and in C
(`kernel/bootmap_layout.c`). It uses integer math only, so the two give the
same rectangles (REQ-BOOTMAP-001). All three programs draw with
`src/render/canvas.zig` into an XRGB8888 buffer. The GOP framebuffer and a
DRM dumb buffer have that format.

The size of a box is `floor(sqrt(duration in µs)) + 16`, from a recorded
boot. Stages and groups stay in boot order. The leaves in a group are sorted
by size.

## Status

| Part | State |
|---|---|
| Record a boot (`vm/record-trace.sh`) | done |
| Layout, model, renderer, CLI, replay window | done |
| Zig and C layout parity (`test/layout-parity.sh`) | done |
| Kernel patch | not started |
| Initramfs daemon and the handoff from the kernel | not started |
| UEFI loader | not started |
| Greeter handoff | not started |

## Use it

Zig 0.17 is necessary. The replay window also needs SDL2 and wgpu-native in
`~/.local/lib`, as for [swindowzig](https://github.com/seanmizen/swindowzig).

```bash
zig build test                    # unit tests
test/layout-parity.sh             # Zig and C layouts agree
zig build replay -- traces/debian13-cloud-tcg.json
zig build cli -- snapshot traces/debian13-cloud-tcg.json out.png --at 30
zig build cli -- stats traces/debian13-cloud-tcg.json
```

In the replay window: Space pauses, R restarts, and Left and Right change
the speed.

## Record a boot

`vm/record-trace.sh` boots the Debian 13 cloud image in QEMU with OVMF and
writes a trace to `traces/`. The first boot adds `initcall_debug` to the
kernel command line and reboots. The second boot is the one that the trace
records. `vm/collect-trace.py` runs on the guest and prints the trace.

```bash
mkdir -p working && cd working
curl -fLO https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.qcow2
cd .. && vm/record-trace.sh
```

The script uses KVM if `/dev/kvm` is writable, and TCG if not. Under TCG, a
recording takes about 5 minutes and the boot takes about 70 s. The trace
name has the accelerator in it, because TCG makes every step slower.

## Folders

| Folder | Contents |
|---|---|
| `src/` | Zig: `layout/`, `model/`, `render/`, `cli/`, `replay/` |
| `kernel/` | C: the layout for the kernel. The kernel patch comes later. |
| `test/` | the layout parity test |
| `vm/` | the boot recorder |
| `traces/` | recorded boots |
| `requirements/` | REQ-BOOTMAP-* |
| `working/` | downloads, VM disks, kernel builds. Gitignored. |
