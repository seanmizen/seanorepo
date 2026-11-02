# bootmap

bootmap shows the boot of a Linux machine as a live treemap. The screen
starts black. Each box is one step of the boot: a kernel initcall, the
initramfs, or a systemd unit. A box fills when its step completes. When every
box is full, the login screen opens.

![A boot at 30 %](docs/boot-30.png)

## How it works

Three programs show the boot on the same framebuffer, one after the other:

| Stage | Program | It fills |
|---|---|---|
| 1 | GRUB, with the bootmap theme (`grub/`) | nothing yet: the menu is in the treemap's style. A Zig UEFI loader that fills the firmware and loader boxes is not started. |
| 2 | Kernel patch (`kernel/`) | one box for each initcall, live, from the `initcall_start` and `initcall_finish` tracepoints |
| 3 | Zig daemon `bootmapd` (`src/daemon/`) | the initrd box, then the systemd boxes, live, from the systemd unit states |

The squarify layout exists in Zig (`src/layout/treemap.zig`) and in C
(`kernel/bootmap_layout.c`). It uses integer math only, so the two give the
same rectangles (REQ-BOOTMAP-001). The daemon, the CLI and the replay draw
with `src/render/canvas.zig` into an XRGB8888 buffer. The kernel patch draws
with the same rules in C (`kernel/bootmap.c`). The EFI framebuffer and a DRM
dumb buffer have that format.

The size of a box is `floor(sqrt(duration in µs)) + 16`, from a recorded
boot. Stages and groups stay in boot order. The leaves in a group are sorted
by size.

## Options

The same options work as kernel command-line parameters
(`bootmap.fill=spiral`) and as CLI and replay arguments (`fill=spiral`).
`src/render/style.zig` and `kernel/bootmap.c` implement them.

| Option | Default | Values |
|---|---|---|
| `fill` | `rows-up` | `rows-up`: whole lines from the bottom. `raster`: left to right, top to bottom, pixel by pixel. `spiral`: pixel by pixel, from the edge to the centre. |
| `fill_ms` | `250` | The shortest fill of a box, in ms. A box that completes sooner still fills over this time, so you see it fill. |
| `outline` | `0` | The outline width, in the stage colour, when a box spawns. `0`: no outline. |
| `empty` | `dim` | The colour of the part of a box that is not full: `dim` (the box colour at 25 %), `black`, `white` or `#rrggbb`. |
| `spawn` | `plan` | `plan`: all boxes appear, dim, in the first frame. `start`: a box appears when its step starts, so the screen starts black. |
| `gap` | `1` | The space between two boxes, in pixels. |
| `pad` | `1,1,1` | The inset of the screen, a stage and a group, in pixels. |
| `warn_ms` | `500` | After this time in flight (or 2× its expected time, if known), a step is late. The pixels that it paints from then on are yellow. |
| `labels` | `all` | `all`: names in the boxes and titles above areas. `areas`: titles only. `none`. A group with one member has no title. |
| `font` | `6x8` | `6x8` or `4x6`: the kernel's bitmap fonts. |
| `overflow` | `wrap` | `wrap`: a name breaks after a non-word character (`xyz.` / `service`). A word longer than a line breaks inside the word. `cut`: one line. |
| `fit` | `whole` | When a box shows its name. `whole`: the whole name fits. `words`: the whole name fits, and no word is split. `word`: the first word is not split. Also `chars:N`, `percent:N` or `any`. |
| `order` | `boot` | How groups and boxes are placed. `boot`: in boot order. `size`: largest first. `best`: `boot` or `size`, whichever gives the squarer worst box. The stages always keep boot order. |
| `other` | `10` | In thousandths of a stage. When two or more groups are smaller than this, their boxes go into one `other` group, the last one (bottom right). `0`: never. Every box is still drawn. |
| `ink` | `inverse` | The text pixels: `inverse` (black on filled pixels, the stage colour on empty pixels), `white` or `black`. |
| `late` | `clear` | `clear`: when a late step completes, its yellow pixels get the stage colour. `keep`: they stay yellow, as a record. |

One pixel is one unit (REQ-BOOTMAP-006). Nothing is drawn wider than 1 px
for emphasis. A state shows in the colour of single pixels.

A box fills to 90 % over its expected time. After that, it moves on towards
100 % more and more slowly, and gets there only when its step completes. So a
late step still paints pixels, and the yellow pixels show how late it is. The
expected time is the time of the last boot. With no earlier time, a box uses
`fill_ms`. A box that fails is red, with a 1 px cross.

## Status

| Part | State |
|---|---|
| Record a boot (`vm/record-trace.sh`), layout, model, renderer, CLI, replay window, video | done |
| Zig and C layout parity (`test/layout-parity.sh`) | done |
| Kernel patch: live initcall boxes, labels, titles, palettes, options, the initrd box | done |
| `bootmapd` on real hardware: starts in the initramfs (`hw/initramfs/`) and holds the screen from there. Without it, the systemd unit starts it. | done |
| `bootmapd` reads the unit states from systemd over D-Bus each 250 ms. A Ping after each call makes systemd answer. `systemctl` is the fallback. | done |
| Unit times (`/var/lib/bootmap/durations`) and initcall times (EFI variable `BootmapTimes`) saved for the box sizes of the next boot | done |
| GRUB theme (`grub/`) | done |
| Real hardware (`hw/`): Secure Boot with a MOK key. i915 waits until after the picture. `BOOTMAP_DEFAULT=1` makes bootmap the GRUB default. | done, on a Surface Pro 3 |
| The login screen after the last box (REQ-BOOTMAP-005) | on real hardware: `bootmapd` gives the screen to the text console. Then the GPU driver loads and sets its mode. |
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
vm/prepare-guest.sh               # one time: the Debian guest for --full
vm/fetch-initrd.sh                # one time: Debian's initrd, for the initrd stage
vm/run.sh --full --show           # the whole boot, live: kernel, initrd, systemd
tools/record-video.sh traces/debian13-cloud-tcg.json out.mp4 1920x1080
```

In the replay window:

| Key | Action |
|---|---|
| Space | Pause |
| B | Play backwards (rewind), or forwards again |
| Left, Right | Jump 1 s back or forward. With Shift: 10 s. |
| Home, End | Go to the start or the end. R also goes to the start. |
| Up, Down | Change the speed (0.1× to 16×) |
| F, E, O, S | Change the fill, the empty colour, the outline, the spawn mode |

## GRUB theme

`grub/make-theme.py` makes a GRUB theme in the treemap's style. GRUB is the
loader stage, so it uses the loader colour. An entry is a box: dim when not
selected, full when selected. The timeout is a box that fills. The text is the
treemap's 6x8 font. `grub/preview.sh [--show]` boots it in QEMU in seconds.

## Real hardware

Nothing is reinstalled. The machine keeps its Debian, and gets one more kernel.

```bash
scp srv@<host>:/boot/config-$(uname -r) working/surface/config   # see hw/install.sh
kernel/build-deb.sh surface        # the machine's config, cut to its modules, + bootmap
hw/install.sh <host> surface       # kernel, daemon, GRUB theme. The stock kernel stays the default.
hw/boot-once.sh <host> surface     # boot the bootmap kernel one time
hw/uninstall.sh <host> surface     # remove all of it
```

- **Secure Boot.** With `working/<machine>/mok/MOK.pem`, `build-deb.sh`
  signs the kernel and every module. `hw/install.sh` queues the key with
  `mokutil --import`. MokManager asks for it one time, at the next boot.
- **The GPU driver waits.** A GPU driver takes the screen from `simpledrm`.
  So `hw/install.sh` writes a `modprobe.d` rule: on the bootmap kernel, i915
  loads only after `bootmapd` creates `/run/bootmap-gpu`. When every box is
  full, `bootmapd` gives the screen to the text console, creates that file
  and loads the modules of `bootmap.gpu=` (`BOOTMAP_GPU`, default `i915`).
- **The default boot.** `BOOTMAP_DEFAULT=1 hw/install.sh ...` makes the
  bootmap kernel the GRUB default. The GRUB menu has no recovery entries.

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
| `src/` | Zig: `layout/`, `model/`, `render/`, `cli/`, `replay/`, `daemon/` |
| `kernel/` | C: the kernel patch (`bootmap.c`), its layout, the configs, the build scripts |
| `grub/` | the GRUB theme and its QEMU preview |
| `hw/` | install on a real machine over SSH, and the initramfs scripts |
| `test/` | the layout parity test |
| `tools/` | font and palette generators, video recording |
| `vm/` | the boot recorder and the QEMU harness |
| `traces/` | recorded boots |
| `requirements/` | REQ-BOOTMAP-* |
| `working/` | downloads, VM disks, kernel builds. Gitignored. |
