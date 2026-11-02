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

## Options

The same options work as kernel command-line parameters
(`bootmap.fill=spiral`) and as CLI and replay arguments (`fill=spiral`).
`src/render/style.zig` and `kernel/bootmap.c` implement them.

| Option | Default | Values |
|---|---|---|
| `fill` | `raster` | `raster` (left to right, top to bottom, pixel by pixel), `rows-up` (whole lines from the bottom), `spiral` (pixel by pixel, from the edge to the centre) |
| `fill_ms` | `250` | The shortest fill of a box, in ms. A box that completes sooner still fills over this time, so you see it fill. |
| `outline` | `1` | The outline width, in the stage colour, when a box spawns. `0`: no outline. |
| `empty` | `white` | The colour of the part of a box that is not full: `white`, `black`, `dim` (the stage colour at 25 %) or `#rrggbb`. |
| `spawn` | `start` | `start`: a box appears when its step starts. `plan`: all boxes appear in the first frame. |
| `gap` | `2` | The space between two boxes, in pixels. |
| `pad` | `6,3,2` | The inset of the screen, a stage and a group, in pixels. |
| `warn_ms` | `500` | A box in flight for longer gets a yellow outline (2× its expected time, if known). |
| `stuck_ms` | `3000` | A box in flight for longer gets a red outline (4× its expected time, if known). |

A box fills over its expected time, and stops at 90 % until its step
completes. The kernel does not know an initcall's time, so its boxes fill over
`fill_ms`. A box that fails is red with a cross. The yellow and red outlines are
only for boxes in flight. A box goes back to its normal colour when it completes.

In the replay, F changes the fill, E the empty colour, O the outline, and S the
spawn mode.

## Status

| Part | State |
|---|---|
| Record a boot (`vm/record-trace.sh`) | done |
| Layout, model, renderer, CLI, replay window | done |
| Zig and C layout parity (`test/layout-parity.sh`) | done |
| Kernel patch: live initcall boxes, fill animation, options | done |
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
kernel/fetch-and-build.sh         # build the kernel with bootmap
vm/run.sh --kernel-only --show    # boot it in a QEMU window
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
| `kernel/` | C: the kernel patch (`bootmap.c`), its layout, the config, the build script |
| `test/` | the layout parity test |
| `vm/` | the boot recorder |
| `traces/` | recorded boots |
| `requirements/` | REQ-BOOTMAP-* |
| `working/` | downloads, VM disks, kernel builds. Gitignored. |
