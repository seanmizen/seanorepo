//! The terrain image, drawn on the CPU into an RGBA buffer. The game shows it
//! as one texture. The look: a black ground, and OS map symbols in dim
//! colours. The contours are teal. Water and woods are a stipple of dots, not
//! a fill. The hedges are dotted green lines. The roads and tracks glow amber.
//!
//! `base` holds the parts that do not change (contours, water, woods,
//! buildings). `compose` copies it and draws the parts that the game changes
//! (hedges, tracks, roads).
const std = @import("std");
const map = @import("map.zig");

/// The pixels for each square side.
pub const px = 24;
pub const width = map.size * px;
pub const height = map.size * px;
pub const bytes = width * height * 4;

pub const Rgb = [3]f32;

const ground: Rgb = .{ 3, 4, 6 };
const contour: Rgb = .{ 22, 58, 62 };
const contour_index: Rgb = .{ 38, 100, 104 };
const water_dot: Rgb = .{ 30, 70, 130 };
const water_bank: Rgb = .{ 40, 92, 160 };
const wood_dot: Rgb = .{ 30, 92, 46 };
const wood_dot_bright: Rgb = .{ 48, 130, 64 };
const building: Rgb = .{ 92, 80, 62 };
const hedge: Rgb = .{ 58, 138, 70 };
pub const road: Rgb = .{ 255, 158, 48 };
pub const track: Rgb = .{ 200, 132, 56 };

pub const contour_interval = 5;

/// Draw the base image into `out` (bytes long).
pub fn base(m: *const map.Map, out: []u8) void {
    var h_row: [width + 1]f32 = undefined;
    var h_prev: [width + 1]f32 = undefined;
    var w_row: [width + 1]f32 = undefined;
    var w_prev: [width + 1]f32 = undefined;
    for (0..height + 1) |py| {
        const fy = (@as(f32, @floatFromInt(py)) + 0.5) / px;
        for (0..width + 1) |pxi| {
            const fx = (@as(f32, @floatFromInt(pxi)) + 0.5) / px;
            h_row[pxi] = map.heightField(fx, fy) + map.heightDetail(fx, fy);
            w_row[pxi] = map.waterField(fx, fy);
        }
        if (py > 0) {
            const y = py - 1;
            for (0..width) |x| {
                const fx = (@as(f32, @floatFromInt(x)) + 0.5) / px;
                const fyy = (@as(f32, @floatFromInt(y)) + 0.5) / px;
                var c = ground;
                const wet = w_prev[x] < 0;
                const bank = wet != (w_prev[x + 1] < 0) or wet != (w_row[x] < 0);
                const xi: i32 = @intCast(x);
                const yi: i32 = @intCast(y);
                const r = map.hash(xi, yi, 7);
                if (bank) {
                    c = water_bank;
                } else if (wet) {
                    if (r < 0.11) c = water_dot;
                } else {
                    // A contour where the level changes to the right or below.
                    const l0 = @floor(h_prev[x] / contour_interval);
                    const l1 = @floor(h_prev[x + 1] / contour_interval);
                    const l2 = @floor(h_row[x] / contour_interval);
                    if (l0 != l1 or l0 != l2) {
                        const lv: i32 = @intFromFloat(@max(l0, @max(l1, l2)));
                        c = if (@mod(lv, 5) == 0) contour_index else contour;
                    }
                    if (map.woodField(fx, fyy) > 0) {
                        if (r < 0.055) c = wood_dot;
                        if (r > 0.985) c = wood_dot_bright;
                    }
                }
                put(out, x, y, c);
            }
        }
        @memcpy(&h_prev, &h_row);
        @memcpy(&w_prev, &w_row);
    }
    // Buildings: small blocks in each town square, clear of the road.
    for (0..map.cells) |ci| {
        const c: u16 = @intCast(ci);
        const cx = map.cellX(c);
        const cy = map.cellY(c);
        if (m.ground[c] != .town) continue;
        for (0..6) |k| {
            const ki: i32 = @intCast(k);
            const bx = cx * px + 2 + @as(i32, @intFromFloat(map.hash(cx * 8 + ki, cy, 51) * 15));
            const by = cy * px + 2 + @as(i32, @intFromFloat(map.hash(cx, cy * 8 + ki, 52) * 15));
            const bw = 3 + @as(i32, @intFromFloat(map.hash(cx + ki, cy, 53) * 4));
            const bh = 3 + @as(i32, @intFromFloat(map.hash(cx, cy + ki, 54) * 4));
            // Keep the middle band (the road) clear.
            const mid = cx * px + px / 2;
            if (bx < mid + 4 and bx + bw > mid - 4) continue;
            fill(out, bx, by, bw, bh, building, 0.9);
        }
    }
}

/// Copy `base_img` to `out`, then draw the hedges and the ways of the map.
pub fn compose(m: *const map.Map, base_img: []const u8, out: []u8) void {
    @memcpy(out, base_img);
    for (0..map.cells) |ci| {
        const c: u16 = @intCast(ci);
        const x = map.cellX(c) * px;
        const y = map.cellY(c) * px;
        if (m.hedge_e[c]) hedgeLine(out, x + px, y, true);
        if (m.hedge_s[c]) hedgeLine(out, x, y + px, false);
    }
    for (0..map.cells) |ci| {
        const c: u16 = @intCast(ci);
        if (m.way[c] != .none) drawWay(m, out, c);
    }
}

fn hedgeLine(out: []u8, x0: i32, y0: i32, vertical: bool) void {
    var i: i32 = 1;
    while (i < px) : (i += 3) {
        const j: i32 = if (map.hash(x0 + i, y0 + i, 61) < 0.5) 0 else 1;
        if (vertical) add(out, x0 - j, y0 + i, hedge, 1) else add(out, x0 + i, y0 - j, hedge, 1);
    }
}

/// A way square: a line from the centre to the middle of each edge that it
/// shares with another way square. A square with one turn (two edges at a
/// right angle) gets a curve.
fn drawWay(m: *const map.Map, out: []u8, c: u16) void {
    const cx = map.cellX(c);
    const cy = map.cellY(c);
    const level = m.way[c];
    const dirs = [_][2]i32{ .{ 0, -1 }, .{ 1, 0 }, .{ 0, 1 }, .{ -1, 0 } };
    var linked: [4]bool = @splat(false);
    var n: u32 = 0;
    for (dirs, 0..) |d, i| {
        const nx = cx + d[0];
        const ny = cy + d[1];
        // A road on the edge of the map goes on off the map.
        if (!map.inside(nx, ny)) {
            linked[i] = level == .road;
        } else {
            const nc = map.idx(nx, ny);
            linked[i] = m.way[nc] != .none and !m.hedgeBetween(c, nc);
        }
        if (linked[i]) n += 1;
    }
    const mx = (@as(f32, @floatFromInt(cx)) + 0.5) * px;
    const my = (@as(f32, @floatFromInt(cy)) + 0.5) * px;
    const half: f32 = px / 2;
    const style: Style = if (level == .road) .road else .track;
    if (n == 2 and ((linked[0] or linked[2]) and (linked[1] or linked[3]))) {
        // A turn: a quadratic curve between the two edge middles.
        var ends: [2][2]f32 = undefined;
        var k: usize = 0;
        for (dirs, 0..) |d, i| if (linked[i]) {
            ends[k] = .{ mx + @as(f32, @floatFromInt(d[0])) * half, my + @as(f32, @floatFromInt(d[1])) * half };
            k += 1;
        };
        var prev = ends[0];
        for (1..9) |si| {
            const t = @as(f32, @floatFromInt(si)) / 8;
            const a = (1 - t) * (1 - t);
            const b = 2 * (1 - t) * t;
            const cc = t * t;
            const p = [2]f32{ a * ends[0][0] + b * mx + cc * ends[1][0], a * ends[0][1] + b * my + cc * ends[1][1] };
            segment(out, prev, p, style);
            prev = p;
        }
        return;
    }
    if (n == 0) {
        segment(out, .{ mx - 3, my }, .{ mx + 3, my }, style);
        return;
    }
    for (dirs, 0..) |d, i| if (linked[i]) {
        segment(out, .{ mx, my }, .{ mx + @as(f32, @floatFromInt(d[0])) * half, my + @as(f32, @floatFromInt(d[1])) * half }, style);
    };
}

const Style = enum { road, track };

/// A line with a glow. The light adds to the image, so a crossing is
/// brighter.
fn segment(out: []u8, a: [2]f32, b: [2]f32, style: Style) void {
    const core: f32 = if (style == .road) 1.3 else 0.8;
    const glow: f32 = if (style == .road) 6 else 3;
    const col = if (style == .road) road else track;
    const glow_a: f32 = if (style == .road) 0.22 else 0.12;
    const x0: i32 = @intFromFloat(@floor(@min(a[0], b[0]) - glow));
    const x1: i32 = @intFromFloat(@ceil(@max(a[0], b[0]) + glow));
    const y0: i32 = @intFromFloat(@floor(@min(a[1], b[1]) - glow));
    const y1: i32 = @intFromFloat(@ceil(@max(a[1], b[1]) + glow));
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = @max(dx * dx + dy * dy, 0.0001);
    var y = y0;
    while (y <= y1) : (y += 1) {
        var x = x0;
        while (x <= x1) : (x += 1) {
            const fx = @as(f32, @floatFromInt(x)) + 0.5;
            const fy = @as(f32, @floatFromInt(y)) + 0.5;
            const t = std.math.clamp(((fx - a[0]) * dx + (fy - a[1]) * dy) / l2, 0, 1);
            const ex = a[0] + t * dx - fx;
            const ey = a[1] + t * dy - fy;
            const d = @sqrt(ex * ex + ey * ey);
            if (d > glow) continue;
            // A track is dashed: 4 pixels on, 3 off, along the map.
            if (style == .track) {
                const along = @abs(fx - a[0]) + @abs(fy - a[1]) + @abs(a[0]) + @abs(a[1]);
                if (@mod(along, 7) > 4 and d < core + 0.5) continue;
            }
            var alpha: f32 = 0;
            if (d < core) alpha = 1 else if (d < core + 1) alpha = core + 1 - d;
            const g = 1 - d / glow;
            alpha = @max(alpha, glow_a * g * g);
            maxAdd(out, x, y, col, alpha);
        }
    }
}

fn put(out: []u8, x: usize, y: usize, c: Rgb) void {
    const i = (y * width + x) * 4;
    out[i] = @intFromFloat(c[0]);
    out[i + 1] = @intFromFloat(c[1]);
    out[i + 2] = @intFromFloat(c[2]);
    out[i + 3] = 255;
}

/// Add light to a pixel.
fn add(out: []u8, x: i32, y: i32, c: Rgb, a: f32) void {
    if (x < 0 or y < 0 or x >= width or y >= height) return;
    const i: usize = (@as(usize, @intCast(y)) * width + @as(usize, @intCast(x))) * 4;
    for (0..3) |k| {
        const v = @as(f32, @floatFromInt(out[i + k])) + c[k] * a;
        out[i + k] = @intFromFloat(@min(255, v));
    }
}

/// Raise a pixel toward the colour: the result is the brighter of the old
/// pixel and the colour at that alpha over black. Two segments that meet do
/// not double the light where they overlap.
fn maxAdd(out: []u8, x: i32, y: i32, c: Rgb, a: f32) void {
    if (x < 0 or y < 0 or x >= width or y >= height) return;
    const i: usize = (@as(usize, @intCast(y)) * width + @as(usize, @intCast(x))) * 4;
    for (0..3) |k| {
        const old = @as(f32, @floatFromInt(out[i + k]));
        const v = old + (c[k] - old) * a;
        out[i + k] = @intFromFloat(std.math.clamp(@max(old, v), 0, 255));
    }
}

fn fill(out: []u8, x: i32, y: i32, w: i32, h: i32, c: Rgb, a: f32) void {
    var yy = y;
    while (yy < y + h) : (yy += 1) {
        var xx = x;
        while (xx < x + w) : (xx += 1) maxAdd(out, xx, yy, c, a);
    }
}
