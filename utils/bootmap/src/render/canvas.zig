//! Draw the plan into a raw XRGB8888 pixel buffer.
//!
//! The UEFI GOP framebuffer (PixelBlueGreenRedReserved8BitPerColor) and a
//! DRM dumb buffer (DRM_FORMAT_XRGB8888) have this memory layout, so the
//! loader, the daemon and the replay use this same code.

const std = @import("std");
const plan_mod = @import("../model/plan.zig");
const palette = @import("palette.zig");

pub const Canvas = struct {
    pixels: []u32,
    width: i32,
    height: i32,
    /// Pixels from the start of one row to the start of the next.
    stride: i32,

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

/// The space between two boxes, in pixels. It is on the right and bottom
/// side of each box.
pub const gap = 2;

/// Draw every leaf of the plan at time `t_us`. The canvas must be cleared
/// to palette.surface first, for the first frame.
pub fn drawPlan(c: Canvas, plan: *const plan_mod.Plan, t_us: u64) void {
    for (plan.nodes, 0..) |nd, i| {
        if (nd.depth != 3) continue;
        drawLeaf(c, nd, plan.state(i, t_us), t_us);
    }
}

pub fn drawLeaf(c: Canvas, nd: plan_mod.Node, st: plan_mod.State, t_us: u64) void {
    const r = nd.rect;
    const w = if (r.w > gap) r.w - gap else r.w;
    const h = if (r.h > gap) r.h - gap else r.h;
    if (w <= 0 or h <= 0) return;
    const color = palette.leafColor(nd.stage, nd.name);
    switch (st) {
        .pending => c.fill(r.x, r.y, w, h, palette.surface),
        .active => {
            // Fill from the bottom, in proportion to the expected time.
            // Stop at 90 %: only "done" fills a box.
            const total = @max(nd.end_us -| nd.start_us, 1);
            const elapsed = t_us -| nd.start_us;
            const part: i32 = @intCast(@min((elapsed * 90) / total, 90));
            const fh = @divTrunc(h * part, 100);
            c.fill(r.x, r.y, w, h - fh, palette.surface);
            c.fill(r.x, r.y + h - fh, w, fh, palette.dim(color));
            c.outline(r.x, r.y, w, h, color);
        },
        .done => c.fill(r.x, r.y, w, h, color),
        .failed => {
            c.fill(r.x, r.y, w, h, palette.critical);
            c.cross(r.x, r.y, w, h, palette.surface);
        },
    }
}

test "fill clips to the canvas" {
    var px: [4 * 3]u32 = @splat(0);
    const c: Canvas = .{ .pixels = &px, .width = 4, .height = 3, .stride = 4 };
    c.fill(-2, 1, 4, 10, 7);
    try std.testing.expectEqualSlices(u32, &.{ 0, 0, 0, 0, 7, 7, 0, 0, 7, 7, 0, 0 }, &px);
}
