# REQ-BOOTMAP — The boot treemap

Constraints on `utils/bootmap`. Three programs draw one picture, one after
the other: the UEFI loader, the kernel patch and the userspace daemon. These
requirements keep the three parts of the picture in agreement.

---

## REQ-BOOTMAP-001 — The Zig layout and the C layout give the same rectangles

- **Status:** active
- **Source:** agent:SEAN-1016
- **Origin:** #1016
- **Type:** constraint
- **Priority:** P0
- **Statement:** For the same plan and the same area, `kernel/bootmap_layout.c`
  shall give byte-identical rectangles to `src/layout/treemap.zig`.
- **Rationale:** The kernel draws the first part of the picture. The daemon
  then continues the same picture. If the two layouts differ by one pixel, the
  boxes move at the handoff and the picture jumps. The layout uses integer math
  only, so that the two implementations can agree exactly.
- **Verification:** Test — `utils/bootmap/test/layout-parity.sh`
- **Relations:** none

## REQ-BOOTMAP-002 — A box is black until its step starts

- **Status:** active
- **Source:** sean
- **Origin:** #1016
- **Type:** functional
- **Priority:** P1
- **Statement:** While a step has not started, the renderer shall draw its box
  in the surface colour (black).
- **Rationale:** The screen starts black, and boxes appear as the machine
  loads. A box that shows before its step starts tells the viewer nothing.
- **Verification:** Inspection — `utils/bootmap/src/render/canvas.zig`
- **Relations:** none

## REQ-BOOTMAP-003 — A full box never becomes empty again

- **Status:** active
- **Source:** agent:SEAN-1016
- **Origin:** #1016
- **Type:** constraint
- **Priority:** P1
- **Statement:** When time increases, the state of a box shall only move
  forward: pending, then active, then done or failed.
- **Rationale:** The picture is a record of progress. A box that empties again
  looks like a step that was undone.
- **Verification:** Test — `utils/bootmap/src/model/plan.zig` › "states only move forward"
- **Relations:** none

## REQ-BOOTMAP-004 — A failed box is not shown by colour alone

- **Status:** active
- **Source:** agent:SEAN-1016
- **Origin:** #1016
- **Type:** quality
- **Priority:** P2
- **Statement:** The renderer shall draw a 1 px cross on each failed box, in
  addition to the red fill.
- **Rationale:** Some viewers cannot tell red from the stage colours. The
  cross carries the same information without colour.
- **Verification:** Inspection — `utils/bootmap/src/render/canvas.zig`
- **Relations:** none

## REQ-BOOTMAP-005 — The login screen opens when every box is full

- **Status:** proposed
- **Source:** sean
- **Origin:** #1016
- **Type:** functional
- **Priority:** P1
- **Statement:** When every box is done or failed, the system shall show the
  login screen, with no blank frame between the treemap and the login screen.
- **Rationale:** The treemap is the whole boot. The login screen is the end of
  the boot, so it comes after the last box and not before.
- **Verification:** Demonstration — a boot of `vm/run.sh --full` goes from the full treemap to the greeter with no blank frame.
- **Relations:** none

## REQ-BOOTMAP-006 — One pixel is one unit

- **Status:** active
- **Source:** sean
- **Origin:** #1016
- **Type:** constraint
- **Priority:** P1
- **Statement:** The renderers shall draw every line, outline, gap and marker
  1 px wide, and shall show each state in the colour of single pixels.
- **Rationale:** The picture is pixel-wise information. A wider stroke for
  emphasis hides pixels that carry data. For example, a late step shows as
  yellow pixels in its fill, and not as a thick yellow outline.
- **Verification:** Inspection — `utils/bootmap/src/render/canvas.zig`
- **Relations:** none
