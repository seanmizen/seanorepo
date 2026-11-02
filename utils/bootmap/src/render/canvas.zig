//! Draw the plan into a raw XRGB8888 pixel buffer.
//!
//! The UEFI GOP framebuffer (PixelBlueGreenRedReserved8BitPerColor) and a
//! DRM dumb buffer (DRM_FORMAT_XRGB8888) have this memory layout, so the
//! loader, the daemon and the replay use this same code.

const std = @import("std");
const plan_mod = @import("../model/plan.zig");
const palette = @import("palette.zig");
const style_mod = @import("style.zig");
const text = @import("text.zig");
const color_mod = @import("color.zig");

/// A fill with a pixel pattern (style.pattern). `lo` and `hi` are the two
/// shades of the pattern, `by` and `bh` the top and height of the box.
pub const Paint = struct { pattern: color_mod.Pattern, lo: u32, hi: u32, by: i32, bh: i32 };

pub const Canvas = struct {
    pixels: []u32,
    width: i32,
    height: i32,
    /// Pixels from the start of one row to the start of the next.
    stride: i32,
    /// When set, fill() paints each pixel with the pattern.
    paint: ?Paint = null,

    pub fn clear(c: Canvas, color: u32) void {
        var y: i32 = 0;
        while (y < c.height) : (y += 1) {
            const row = c.pixels[@intCast(y * c.stride)..][0..@intCast(c.width)];
            @memset(row, color);
        }
    }

    pub fn fill(c: Canvas, x0: i32, y0: i32, w: i32, h: i32, color: u32) void {
        const xa = @max(x0, 0);
        const ya = @max(y0, 0);
        const xb = @min(x0 + w, c.width);
        const yb = @min(y0 + h, c.height);
        if (xa >= xb or ya >= yb) return;
        var y = ya;
        if (c.paint) |p| {
            while (y < yb) : (y += 1) {
                var x = xa;
                while (x < xb) : (x += 1)
                    c.pixels[@intCast(y * c.stride + x)] = color_mod.patternPixel(p.pattern, color, p.lo, p.hi, x, y, p.by, p.bh);
            }
            return;
        }
        while (y < yb) : (y += 1) {
            const row = c.pixels[@intCast(y * c.stride + xa)..][0..@intCast(xb - xa)];
            @memset(row, color);
        }
    }

    pub fn outline(c: Canvas, x: i32, y: i32, w: i32, h: i32, color: u32) void {
        c.fill(x, y, w, 1, color);
        c.fill(x, y + h - 1, w, 1, color);
        c.fill(x, y, 1, h, color);
        c.fill(x + w - 1, y, 1, h, color);
    }

    pub fn put(c: Canvas, x: i32, y: i32, color: u32) void {
        if (x < 0 or y < 0 or x >= c.width or y >= c.height) return;
        c.pixels[@intCast(y * c.stride + x)] = color;
    }

    /// Two diagonals: the second channel for "failed", so that the state
    /// is not shown by colour alone.
    pub fn cross(c: Canvas, x: i32, y: i32, w: i32, h: i32, color: u32) void {
        const n = @max(w, h);
        var i: i32 = 0;
        while (i < n) : (i += 1) {
            const dx = @divTrunc(i * (w - 1), @max(n - 1, 1));
            const dy = @divTrunc(i * (h - 1), @max(n - 1, 1));
            c.put(x + dx, y + dy, color);
            c.put(x + w - 1 - dx, y + dy, color);
        }
    }
};

/// fillRange with the style's pixel pattern on the filled pixels.
fn paintedRange(c: Canvas, st: style_mod.Style, x: i32, y: i32, w: i32, h: i32, k0: u32, k1: u32, col: u32) void {
    if (st.pattern == .solid) return fillRange(c, x, y, w, h, st.fill, k0, k1, col);
    var pc = c;
    pc.paint = .{ .pattern = st.pattern, .lo = color_mod.shade(col, -0.08), .hi = color_mod.shade(col, 0.08), .by = y, .bh = h };
    fillRange(pc, x, y, w, h, st.fill, k0, k1, col);
}

/// Paint pixels [k0, k1) of the area (x, y, w, h), in the order of `fill`.
/// The orders only add pixels, so a box can grow by painting the new range.
pub fn fillRange(c: Canvas, x: i32, y: i32, w: i32, h: i32, fill: style_mod.Fill, k0: u32, k1: u32, color: u32) void {
    if (w <= 0 or h <= 0 or k1 <= k0) return;
    const uw: u32 = @intCast(w);
    switch (fill) {
        .raster => {
            var k = k0;
            while (k < k1) {
                const row: i32 = @intCast(k / uw);
                const col: u32 = k % uw;
                const run = @min(uw - col, k1 - k);
                c.fill(x + @as(i32, @intCast(col)), y + row, @intCast(run), 1, color);
                k += run;
            }
        },
        .rows_up => {
            // Whole lines only: a part of a line waits for the rest.
            const r0: i32 = @intCast(k0 / uw);
            const r1: i32 = @intCast(k1 / uw);
            if (r1 > r0) c.fill(x, y + h - r1, w, r1 - r0, color);
        },
        .spiral => spiralRange(c, x, y, w, h, k0, k1, color),
    }
}

/// Clockwise from the top-left corner, ring by ring to the centre.
fn spiralRange(c: Canvas, x0: i32, y0: i32, w0: i32, h0: i32, k0: u32, k1: u32, color: u32) void {
    var x = x0;
    var y = y0;
    var w = w0;
    var h = h0;
    var off: u32 = 0;
    while (w > 0 and h > 0 and off < k1) {
        // The four sides of this ring: start point, direction, length.
        const Side = struct { sx: i32, sy: i32, dx: i32, dy: i32, len: i32 };
        const sides = [4]Side{
            .{ .sx = x, .sy = y, .dx = 1, .dy = 0, .len = w },
            .{ .sx = x + w - 1, .sy = y + 1, .dx = 0, .dy = 1, .len = h - 1 },
            .{ .sx = x + w - 2, .sy = y + h - 1, .dx = -1, .dy = 0, .len = if (h > 1) w - 1 else 0 },
            .{ .sx = x, .sy = y + h - 2, .dx = 0, .dy = -1, .len = if (w > 1) h - 2 else 0 },
        };
        for (sides) |sd| {
            if (sd.len <= 0) continue;
            const len: u32 = @intCast(sd.len);
            const a = @max(k0, off);
            const b = @min(k1, off + len);
            if (b > a) {
                const s0: i32 = @intCast(a - off);
                const n: i32 = @intCast(b - a);
                // The run from s0 to s0 + n - 1, as a rectangle.
                const px = sd.sx + sd.dx * s0;
                const py = sd.sy + sd.dy * s0;
                const qx = px + sd.dx * (n - 1);
                const qy = py + sd.dy * (n - 1);
                c.fill(@min(px, qx), @min(py, qy), @max(px, qx) - @min(px, qx) + 1, @max(py, qy) - @min(py, qy) + 1, color);
            }
            off += len;
        }
        x += 1;
        y += 1;
        w -= 2;
        h -= 2;
    }
}

/// Set the colour of each leaf from style.color_by. Call it before each
/// frame (time and duration change while a step runs).
pub fn assignColors(plan: *plan_mod.Plan, st: style_mod.Style, t_us: u64) void {
    const pal = color_mod.palettes[@min(st.palette, color_mod.palettes.len - 1)];
    // The place of each group in its stage.
    for (plan.nodes) |nd| {
        if (nd.depth != 1) continue;
        for (nd.children, 0..) |c, i| plan.nodes[c].index = @intCast(i);
    }
    var end: u64 = 1;
    var longest: u64 = 1;
    for (plan.nodes) |nd| {
        if (nd.depth != 3) continue;
        const e = @min(nd.end_us, t_us);
        if (nd.start_us < t_us) end = @max(end, e);
        if (nd.start_us < t_us) longest = @max(longest, e -| nd.start_us);
    }
    for (plan.nodes) |*nd| {
        if (nd.depth != 3) continue;
        nd.color = leafColor(nd.*, plan.nodes[nd.parent].index, pal, st, t_us, end, longest);
    }
}

/// The colour of one leaf. `group` is the place of its group in the stage.
/// `end` is the end of the boot so far, `longest` the longest step so far.
pub fn leafColor(nd: plan_mod.Node, group: u16, pal: color_mod.Palette, st: style_mod.Style, t_us: u64, end: u64, longest: u64) u32 {
    const n = pal.stops.len;
    const base: u32 = switch (st.color_by) {
        .stage => pal.stops[nd.stage % n],
        .group => pal.stops[group % n],
        .kind => pal.stops[kindOf(nd) % n],
        .hash => color_mod.ramp(pal, @as(f32, @floatFromInt(std.hash.Fnv1a_32.hash(nd.name) % 1000)) / 999, st.space),
        .mono => pal.stops[n / 2],
        .time => color_mod.ramp(pal, if (nd.start_us > t_us) 0 else @as(f32, @floatFromInt(nd.start_us)) / @as(f32, @floatFromInt(@max(end, 1))), st.space),
        .duration => blk: {
            // A log scale: 1 ms to the longest step so far.
            const d = @max(@min(nd.end_us, t_us) -| nd.start_us, 1);
            const lo = @log(@as(f32, 1000));
            const hi = @log(@as(f32, @floatFromInt(@max(longest, 1001))));
            const x = (@log(@as(f32, @floatFromInt(@max(d, 1000)))) - lo) / (hi - lo);
            break :blk color_mod.ramp(pal, x, st.space);
        },
    };
    if (st.jitter == 0) return base;
    // A lightness change from the name, from -jitter/2 % to +jitter/2 %.
    const j: i32 = st.jitter;
    const v: i32 = @as(i32, @intCast(std.hash.Fnv1a_32.hash(nd.name) % @as(u32, @intCast(j + 1)))) - @divTrunc(j, 2);
    return color_mod.shade(base, @as(f32, @floatFromInt(v)) / 200);
}

/// 0 kernel initcall, 1 service, 2 mount, 3 socket, 4 timer, 5 path,
/// 6 any other unit.
fn kindOf(nd: plan_mod.Node) usize {
    if (nd.stage == plan_mod.kernel_stage) return 0;
    const kinds = [_][]const u8{ ".service", ".mount", ".socket", ".timer", ".path" };
    for (kinds, 1..) |k, i| if (std.mem.endsWith(u8, nd.name, k)) return i;
    return 6;
}

/// Draw every leaf of the plan at time `t_us`, then the area titles.
pub fn drawPlan(c: Canvas, plan: *plan_mod.Plan, st: style_mod.Style, t_us: u64) void {
    assignColors(plan, st, t_us);
    for (plan.nodes, 0..) |nd, i| {
        if (nd.depth != 3) continue;
        drawLeaf(c, nd, plan.state(i, t_us), st, t_us);
    }
    if (st.labels == .none) return;
    for (plan.nodes) |nd| drawHeader(c, nd, st, t_us);
}

/// The title of a stage or a group, in the stage colour on black, in the
/// strip above its boxes. It appears with the first box of the area
/// (spawn=start), or in the first frame (spawn=plan).
pub fn drawHeader(c: Canvas, nd: plan_mod.Node, st: style_mod.Style, t_us: u64) void {
    const h = nd.header;
    if (h.w <= 0 or h.h <= 0) return;
    c.fill(h.x, h.y, h.w, h.h, palette.surface);
    if (st.spawn == .start and t_us < nd.first_us) return;
    const pal = color_mod.palettes[@min(st.palette, color_mod.palettes.len - 1)];
    _ = text.draw(c, st.fontOf(), h.x, h.y, h.w, h.h - 1, nd.name, .cut, .any, .{ .solid = pal.stops[nd.stage % pal.stops.len] });
}

/// The name of a leaf, inside its box, 1 px from the outline.
fn drawLeafLabel(c: Canvas, nd: plan_mod.Node, st: style_mod.Style, ix: i32, iy: i32, iw: i32, ih: i32, base: u32) void {
    if (st.labels != .all) return;
    const empty = st.emptyColor(base);
    const ink: text.Ink = switch (st.ink) {
        .inverse => .{ .inverse = .{ .empty = empty, .on_empty = base } },
        .white => .{ .solid = 0xffffff },
        .black => .{ .solid = 0x000000 },
    };
    _ = text.draw(c, st.fontOf(), ix + 1, iy + 1, iw - 2, ih - 2, nd.name, st.overflow, st.fit, ink);
}

/// The interior of a box: its rectangle less the gap (right and bottom).
pub fn boxArea(r: plan_mod.Rect, gap: i32) plan_mod.Rect {
    return .{ .x = r.x, .y = r.y, .w = if (r.w > gap) r.w - gap else r.w, .h = if (r.h > gap) r.h - gap else r.h };
}

pub fn drawLeaf(c: Canvas, nd: plan_mod.Node, state: plan_mod.State, st: style_mod.Style, t_us: u64) void {
    const a = boxArea(nd.rect, st.gap);
    if (a.w <= 0 or a.h <= 0) return;
    const base = if (nd.color != 0) nd.color else palette.leafColor(nd.stage, nd.name);
    const color = if (nd.failed) palette.critical else base;

    if (state == .pending and st.spawn == .start) {
        c.fill(a.x, a.y, a.w, a.h, palette.surface);
        return;
    }
    const expected = nd.expected_us;
    const end: ?u64 = if (state == .done or state == .failed) nd.end_us else null;
    const p = if (state == .pending) 0 else style_mod.permille(nd.start_us, end, expected, st.fill_ms, t_us);

    const o: i32 = if (a.w > 2 * @as(i32, st.outline) and a.h > 2 * @as(i32, st.outline)) st.outline else 0;
    const ix = a.x + o;
    const iy = a.y + o;
    const iw = a.w - 2 * o;
    const ih = a.h - 2 * o;
    const area: u64 = @intCast(iw * ih);
    const k: u32 = @intCast((area * p) / 1000);

    // The late pixels: the ones painted after lateAt and before the end.
    // They are yellow while the step is in flight. After the end they get
    // the stage colour (late=clear) or stay yellow (late=keep).
    var kl0: u32 = 0;
    var kl1: u32 = 0;
    const late_t = style_mod.lateAt(st, nd.start_us, expected);
    if (state != .pending and t_us > late_t and (end == null or nd.end_us > late_t)) {
        const until = if (end) |e| @min(e, t_us) else t_us;
        kl0 = @intCast((area * style_mod.permille(nd.start_us, null, expected, st.fill_ms, late_t)) / 1000);
        kl1 = @intCast((area * style_mod.permille(nd.start_us, null, expected, st.fill_ms, until)) / 1000);
    }
    const show_late = kl1 > kl0 and (end == null or st.late == .keep);

    if (p >= 1000) {
        paintedRange(c, st, a.x, a.y, a.w, a.h, 0, @intCast(a.w * a.h), color);
        if (show_late) fillRange(c, ix, iy, iw, ih, st.fill, kl0, kl1, palette.warning);
        drawLeafLabel(c, nd, st, ix, iy, iw, ih, base);
        if (nd.failed) c.cross(a.x, a.y, a.w, a.h, palette.surface);
        return;
    }
    if (o > 0) c.fill(a.x, a.y, a.w, a.h, base);
    c.fill(ix, iy, iw, ih, st.emptyColor(base));
    paintedRange(c, st, ix, iy, iw, ih, 0, k, color);
    if (show_late) fillRange(c, ix, iy, iw, ih, st.fill, kl0, @min(kl1, k), palette.warning);
    drawLeafLabel(c, nd, st, ix, iy, iw, ih, base);
}

test "fill clips to the canvas" {
    var px: [4 * 3]u32 = @splat(0);
    const c: Canvas = .{ .pixels = &px, .width = 4, .height = 3, .stride = 4 };
    c.fill(-2, 1, 4, 10, 7);
    try std.testing.expectEqualSlices(u32, &.{ 0, 0, 0, 0, 7, 7, 0, 0, 7, 7, 0, 0 }, &px);
}

test "each fill order paints each pixel one time" {
    inline for (.{ style_mod.Fill.raster, style_mod.Fill.spiral }) |f| {
        var px: [7 * 5]u32 = @splat(0);
        const c: Canvas = .{ .pixels = &px, .width = 7, .height = 5, .stride = 7 };
        var k: u32 = 0;
        // Paint one pixel at a time with a new colour: each pixel must get
        // exactly one colour, and the last pixel must be the last one painted.
        while (k < 35) : (k += 1) fillRange(c, 0, 0, 7, 5, f, k, k + 1, k + 1);
        var seen: [36]bool = @splat(false);
        for (px) |v| {
            try std.testing.expect(v >= 1 and v <= 35 and !seen[v]);
            seen[v] = true;
        }
    }
    // Spiral: the top row first, then down the right side.
    var px: [4 * 3]u32 = @splat(0);
    const c: Canvas = .{ .pixels = &px, .width = 4, .height = 3, .stride = 4 };
    var k: u32 = 0;
    while (k < 12) : (k += 1) fillRange(c, 0, 0, 4, 3, .spiral, k, k + 1, k + 1);
    try std.testing.expectEqualSlices(u32, &.{ 1, 2, 3, 4, 10, 11, 12, 5, 9, 8, 7, 6 }, &px);
}

test "rows-up paints whole lines from the bottom" {
    var px: [3 * 3]u32 = @splat(0);
    const c: Canvas = .{ .pixels = &px, .width = 3, .height = 3, .stride = 3 };
    fillRange(c, 0, 0, 3, 3, .rows_up, 0, 5, 7);
    try std.testing.expectEqualSlices(u32, &.{ 0, 0, 0, 0, 0, 0, 7, 7, 7 }, &px);
}
