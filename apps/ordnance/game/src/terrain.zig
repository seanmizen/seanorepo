//! The map as vector shapes, in squares (map units). `build` makes the parts
//! that do not change, one time: the contours, the water banks, the stipple
//! of water and woods, and the buildings. view.zig draws them each frame at
//! the screen resolution, so they stay sharp at each zoom. The ways and the
//! hedges change in the game: `waySegments` and `hedgeDots` make them from
//! the map when view.zig draws.
const std = @import("std");
const map = @import("map.zig");

pub const Seg = struct { a: [2]f32, b: [2]f32 };
pub const Dot = struct { x: f32, y: f32, big: bool = false };

/// The samples of the fine grid for each square side.
const per = 8;
const n = map.size * per + 1;
pub const contour_interval = 5;
/// Each 5th contour is an index contour.
pub const index_every = 5;

pub const Shapes = struct {
    contours: std.ArrayList(Seg) = .empty,
    index: std.ArrayList(Seg) = .empty,
    banks: std.ArrayList(Seg) = .empty,
    water: std.ArrayList(Dot) = .empty,
    wood: std.ArrayList(Dot) = .empty,
    /// x, y, w, h in squares.
    buildings: std.ArrayList([4]f32) = .empty,

    pub fn deinit(s: *Shapes, alloc: std.mem.Allocator) void {
        s.contours.deinit(alloc);
        s.index.deinit(alloc);
        s.banks.deinit(alloc);
        s.water.deinit(alloc);
        s.wood.deinit(alloc);
        s.buildings.deinit(alloc);
    }
};

/// Make the shapes that do not change.
pub fn build(alloc: std.mem.Allocator, m: *const map.Map) !Shapes {
    var s: Shapes = .{};
    const h = try alloc.alloc(f32, n * n);
    defer alloc.free(h);
    const w = try alloc.alloc(f32, n * n);
    defer alloc.free(w);
    for (0..n) |iy| for (0..n) |ix| {
        const x = @as(f32, @floatFromInt(ix)) / per;
        const y = @as(f32, @floatFromInt(iy)) / per;
        h[iy * n + ix] = map.heightField(x, y) + map.heightDetail(x, y);
        w[iy * n + ix] = map.waterField(x, y);
    };

    // Contours: marching squares at each level.
    for (0..n - 1) |iy| for (0..n - 1) |ix| {
        const c = corners(h, ix, iy);
        const lo = @min(@min(c[0], c[1]), @min(c[2], c[3]));
        const hi = @max(@max(c[0], c[1]), @max(c[2], c[3]));
        var level = @ceil(lo / contour_interval) * contour_interval;
        while (level <= hi) : (level += contour_interval) {
            // No contours on the water.
            if (corners(w, ix, iy)[0] < 0) break;
            const lv: i32 = @intFromFloat(level / contour_interval);
            const list = if (@mod(lv, index_every) == 0) &s.index else &s.contours;
            try march(alloc, list, c, level, ix, iy);
        }
    };
    // The water banks.
    for (0..n - 1) |iy| for (0..n - 1) |ix| {
        try march(alloc, &s.banks, corners(w, ix, iy), 0, ix, iy);
    };

    // The stipple: one point near each sample of the fine grid, moved by a
    // hash so it does not look like a grid.
    for (0..n - 1) |iy| for (0..n - 1) |ix| {
        const xi: i32 = @intCast(ix);
        const yi: i32 = @intCast(iy);
        const x = (@as(f32, @floatFromInt(ix)) + map.hash(xi, yi, 71)) / per;
        const y = (@as(f32, @floatFromInt(iy)) + map.hash(xi, yi, 72)) / per;
        const r = map.hash(xi, yi, 73);
        if (map.waterField(x, y) < -0.02) {
            if (r < 0.55) try s.water.append(alloc, .{ .x = x, .y = y });
        } else {
            const wf = map.woodField(x, y);
            // Thinner at the edge of a wood.
            if (wf > 0 and r < 0.42 * std.math.clamp(wf * 8, 0.25, 1)) {
                try s.wood.append(alloc, .{ .x = x, .y = y, .big = map.hash(xi, yi, 74) < 0.06 });
            }
        }
    };

    // Buildings: small blocks in each town square, clear of the road.
    for (0..map.cells) |ci| {
        const c: u16 = @intCast(ci);
        if (m.ground[c] != .town) continue;
        const cx = map.cellX(c);
        const cy = map.cellY(c);
        const fx: f32 = @floatFromInt(cx);
        const fy: f32 = @floatFromInt(cy);
        for (0..7) |k| {
            const ki: i32 = @intCast(k);
            var bx = fx + 0.08 + map.hash(cx * 8 + ki, cy, 51) * 0.7;
            const by = fy + 0.08 + map.hash(cx, cy * 8 + ki, 52) * 0.7;
            const bw = 0.1 + map.hash(cx + ki, cy, 53) * 0.14;
            const bh = 0.1 + map.hash(cx, cy + ki, 54) * 0.14;
            // Keep the middle band (the road) clear.
            if (bx < fx + 0.68 and bx + bw > fx + 0.32) bx = if (bx < fx + 0.5) fx + 0.32 - bw else fx + 0.68;
            try s.buildings.append(alloc, .{ bx, by, bw, bh });
        }
    }
    return s;
}

fn corners(g: []const f32, ix: usize, iy: usize) [4]f32 {
    // Top left, top right, bottom right, bottom left.
    return .{ g[iy * n + ix], g[iy * n + ix + 1], g[(iy + 1) * n + ix + 1], g[(iy + 1) * n + ix] };
}

/// The line where the field crosses `level` in one cell of the fine grid.
fn march(alloc: std.mem.Allocator, out: *std.ArrayList(Seg), c: [4]f32, level: f32, ix: usize, iy: usize) !void {
    const x0 = @as(f32, @floatFromInt(ix)) / per;
    const y0 = @as(f32, @floatFromInt(iy)) / per;
    const d: f32 = 1.0 / @as(f32, per);
    const pos = [4][2]f32{ .{ x0, y0 }, .{ x0 + d, y0 }, .{ x0 + d, y0 + d }, .{ x0, y0 + d } };
    var pts: [4][2]f32 = undefined;
    var k: usize = 0;
    for (0..4) |e| {
        const a = c[e] - level;
        const b = c[(e + 1) % 4] - level;
        if ((a < 0) == (b < 0)) continue;
        const t = a / (a - b);
        const pa = pos[e];
        const pb = pos[(e + 1) % 4];
        pts[k] = .{ pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t };
        k += 1;
    }
    if (k == 2) {
        try out.append(alloc, .{ .a = pts[0], .b = pts[1] });
    } else if (k == 4) {
        // A saddle: the centre value picks the pairs.
        const centre = (c[0] + c[1] + c[2] + c[3]) / 4 - level;
        if ((centre < 0) == (c[0] - level < 0)) {
            try out.append(alloc, .{ .a = pts[0], .b = pts[3] });
            try out.append(alloc, .{ .a = pts[1], .b = pts[2] });
        } else {
            try out.append(alloc, .{ .a = pts[0], .b = pts[1] });
            try out.append(alloc, .{ .a = pts[2], .b = pts[3] });
        }
    }
}

// ------------------------------------------------------------ ways

pub const max_way_segs = map.cells * 12;

/// The segments of each way, in squares: a line from the centre of a way
/// square to the middle of each edge that it shares with another way
/// square. A square with one turn gets a curve. The road and track segments
/// go to separate lists.
pub fn waySegments(m: *const map.Map, road: []Seg, track: []Seg) [2]usize {
    var nr: usize = 0;
    var nt: usize = 0;
    const dirs = [_][2]i32{ .{ 0, -1 }, .{ 1, 0 }, .{ 0, 1 }, .{ -1, 0 } };
    for (0..map.cells) |ci| {
        const c: u16 = @intCast(ci);
        const level = m.way[c];
        if (level == .none) continue;
        const cx = map.cellX(c);
        const cy = map.cellY(c);
        var linked: [4]bool = @splat(false);
        var count: u32 = 0;
        for (dirs, 0..) |d, i| {
            const nx = cx + d[0];
            const ny = cy + d[1];
            linked[i] = if (!map.inside(nx, ny)) level == .road else m.way[map.idx(nx, ny)] != .none and !m.hedgeBetween(c, map.idx(nx, ny));
            if (linked[i]) count += 1;
        }
        const out = if (level == .road) road else track;
        const len = if (level == .road) &nr else &nt;
        const mx = @as(f32, @floatFromInt(cx)) + 0.5;
        const my = @as(f32, @floatFromInt(cy)) + 0.5;
        if (count == 2 and (linked[0] or linked[2]) and (linked[1] or linked[3])) {
            var ends: [2][2]f32 = undefined;
            var k: usize = 0;
            for (dirs, 0..) |d, i| if (linked[i]) {
                ends[k] = .{ mx + @as(f32, @floatFromInt(d[0])) * 0.5, my + @as(f32, @floatFromInt(d[1])) * 0.5 };
                k += 1;
            };
            var prev = ends[0];
            for (1..9) |si| {
                const t = @as(f32, @floatFromInt(si)) / 8;
                const a = (1 - t) * (1 - t);
                const b = 2 * (1 - t) * t;
                const cc = t * t;
                const p = [2]f32{ a * ends[0][0] + b * mx + cc * ends[1][0], a * ends[0][1] + b * my + cc * ends[1][1] };
                if (len.* < out.len) out[len.*] = .{ .a = prev, .b = p };
                len.* += 1;
                prev = p;
            }
            continue;
        }
        if (count == 0) {
            if (len.* < out.len) out[len.*] = .{ .a = .{ mx - 0.15, my }, .b = .{ mx + 0.15, my } };
            len.* += 1;
            continue;
        }
        for (dirs, 0..) |d, i| if (linked[i]) {
            if (len.* < out.len) out[len.*] = .{ .a = .{ mx, my }, .b = .{ mx + @as(f32, @floatFromInt(d[0])) * 0.5, my + @as(f32, @floatFromInt(d[1])) * 0.5 } };
            len.* += 1;
        };
    }
    return .{ @min(nr, road.len), @min(nt, track.len) };
}

// ------------------------------------------------------------ hedges

/// The dots of one hedge, in squares. The hedge runs along a square edge
/// from (x0, y0), `vertical` or not, and wanders off the straight line. Its
/// ends stay on the corners, so hedges meet. Some dots are hedge trees.
pub fn hedgeDots(x0: f32, y0: f32, vertical: bool, out: []Dot) usize {
    const steps = out.len;
    const xi: i32 = @intFromFloat(x0 * 7);
    const yi: i32 = @intFromFloat(y0 * 7 + (if (vertical) @as(f32, 3) else 0));
    // Two random waves give the line its bends.
    const a1 = (map.hash(xi, yi, 81) - 0.5) * 0.16;
    const a2 = (map.hash(xi, yi, 82) - 0.5) * 0.08;
    var k: usize = 0;
    for (0..steps) |i| {
        const t = (@as(f32, @floatFromInt(i)) + 0.5) / @as(f32, @floatFromInt(steps));
        // A gap: a gate or a dead bush.
        if (map.hash(xi + @as(i32, @intCast(i)), yi, 83) < 0.07) continue;
        const off = a1 * @sin(std.math.pi * t) + a2 * @sin(2 * std.math.pi * t);
        const big = map.hash(xi, yi + @as(i32, @intCast(i)), 84) < 0.06;
        out[k] = if (vertical) .{ .x = x0 + off, .y = y0 + t, .big = big } else .{ .x = x0 + t, .y = y0 + off, .big = big };
        k += 1;
    }
    return k;
}

test "the contours close and are many" {
    const alloc = std.testing.allocator;
    const m = try alloc.create(map.Map);
    defer alloc.destroy(m);
    m.generate();
    var s = try build(alloc, m);
    defer s.deinit(alloc);
    try std.testing.expect(s.contours.items.len > 1000);
    try std.testing.expect(s.index.items.len > 100);
    try std.testing.expect(s.water.items.len > 100);
    try std.testing.expect(s.wood.items.len > 100);
}
