//! The map as vector shapes, in squares (map units). view.zig draws them
//! each frame at the screen resolution, so they stay sharp at each zoom.
//!
//! `build` makes the parts that do not change, one time: the contours, the
//! water banks, the stipple of water and woods, and the buildings. They go
//! into chunks of `chunk` x `chunk` squares, so a frame draws only the
//! chunks on the screen. Two levels of detail:
//! - The contours: a fine set (8 samples for each square side, bicubic, all
//!   contours) for a close view, and a coarse set (2 samples, index
//!   contours only) for a far view.
//! - The dots: each dot has a rank (0..1). A far view draws only the dots
//!   with a low rank.
//!
//! The ways and the hedges change in the game. `Ways` makes their segments
//! again when the map changes.
const std = @import("std");
const map = @import("../core/map.zig");
const noise = @import("../core/noise.zig");

pub const Seg = struct { a: [2]f32, b: [2]f32 };
pub const Dot = struct { x: f32, y: f32, rank: f32, big: bool = false };

pub const chunk = 8;
pub const chunks = map.size / chunk;
pub const chunk_count = chunks * chunks;
pub const contour_interval = 5;
/// Each 5th contour is an index contour.
pub const index_every = 5;

/// A list of items, cut into chunks: the items of chunk k are
/// items[start[k]..start[k + 1]].
pub fn Chunked(comptime T: type) type {
    return struct {
        items: std.ArrayList(T) = .empty,
        start: [chunk_count + 1]u32 = @splat(0),

        const Self = @This();
        pub fn of(s: *const Self, k: usize) []const T {
            return s.items.items[s.start[k]..s.start[k + 1]];
        }
        pub fn deinit(s: *Self, alloc: std.mem.Allocator) void {
            s.items.deinit(alloc);
        }
    };
}

pub const Shapes = struct {
    contours: Chunked(Seg) = .{},
    index: Chunked(Seg) = .{},
    /// The index contours for a far view.
    index_far: Chunked(Seg) = .{},
    banks: Chunked(Seg) = .{},
    water: Chunked(Dot) = .{},
    wood: Chunked(Dot) = .{},
    /// x, y, w, h in squares.
    buildings: Chunked([4]f32) = .{},

    pub fn deinit(s: *Shapes, alloc: std.mem.Allocator) void {
        s.contours.deinit(alloc);
        s.index.deinit(alloc);
        s.index_far.deinit(alloc);
        s.banks.deinit(alloc);
        s.water.deinit(alloc);
        s.wood.deinit(alloc);
        s.buildings.deinit(alloc);
    }
};

/// A Catmull-Rom curve through four values, at t (0..1) between b and c.
fn cubic(a: f32, b: f32, c: f32, d: f32, t: f32) f32 {
    return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}

/// The height at (x, y), smooth: bicubic on the fine grid of the map.
fn smoothHeight(m: *const map.Map, x: f32, y: f32) f32 {
    const fp: f32 = map.fine_per;
    const max: i32 = map.fine_n - 1;
    const fx = x * fp;
    const fy = y * fp;
    const ix: i32 = @intFromFloat(@floor(fx));
    const iy: i32 = @intFromFloat(@floor(fy));
    const tx = fx - @floor(fx);
    const ty = fy - @floor(fy);
    var rows: [4]f32 = undefined;
    for (0..4) |j| {
        const yy: usize = @intCast(std.math.clamp(iy - 1 + @as(i32, @intCast(j)), 0, max));
        var v: [4]f32 = undefined;
        for (0..4) |i| {
            const xx: usize = @intCast(std.math.clamp(ix - 1 + @as(i32, @intCast(i)), 0, max));
            v[i] = m.height[yy * map.fine_n + xx];
        }
        rows[j] = cubic(v[0], v[1], v[2], v[3], tx);
    }
    return cubic(rows[0], rows[1], rows[2], rows[3], ty);
}

/// Make the shapes that do not change.
pub fn build(alloc: std.mem.Allocator, m: *const map.Map) !Shapes {
    var s: Shapes = .{};
    errdefer s.deinit(alloc);
    const fine = 8;
    const far = 2;
    // The grids of the samples in one chunk, with one more row and column.
    var h: [(chunk * fine + 1) * (chunk * fine + 1)]f32 = undefined;
    var w: [(chunk * fine + 1) * (chunk * fine + 1)]f32 = undefined;
    for (0..chunks) |cy| for (0..chunks) |cx| {
        const k = cy * chunks + cx;
        const x0: f32 = @floatFromInt(cx * chunk);
        const y0: f32 = @floatFromInt(cy * chunk);
        // The fine contours and the banks.
        try sampleChunk(m, x0, y0, fine, &h, &w, true);
        try marchChunk(alloc, &h, &w, x0, y0, fine, &s.contours, &s.index, &s.banks);
        // The far index contours.
        var hf: [(chunk * far + 1) * (chunk * far + 1)]f32 = undefined;
        var wf: [(chunk * far + 1) * (chunk * far + 1)]f32 = undefined;
        try sampleChunk(m, x0, y0, far, &hf, &wf, false);
        try marchChunk(alloc, &hf, &wf, x0, y0, far, null, &s.index_far, null);
        // The stipple.
        try stipple(alloc, m, x0, y0, &s.water, &s.wood);
        try townBlocks(alloc, m, cx, cy, &s.buildings);
        for ([_]*Chunked(Seg){ &s.contours, &s.index, &s.index_far, &s.banks }) |list| list.start[k + 1] = @intCast(list.items.items.len);
        for ([_]*Chunked(Dot){ &s.water, &s.wood }) |list| list.start[k + 1] = @intCast(list.items.items.len);
        s.buildings.start[k + 1] = @intCast(s.buildings.items.items.len);
    };
    return s;
}

fn sampleChunk(m: *const map.Map, x0: f32, y0: f32, comptime per: usize, h: []f32, w: []f32, detail: bool) !void {
    const n = chunk * per + 1;
    for (0..n) |iy| for (0..n) |ix| {
        const x = x0 + @as(f32, @floatFromInt(ix)) / per;
        const y = y0 + @as(f32, @floatFromInt(iy)) / per;
        var v = smoothHeight(m, x, y);
        // A little detail, so the contours are not smooth like a model.
        if (detail) v += 1.2 * (noise.value(x * 1.4, y * 1.4, 13) - 0.5);
        h[iy * n + ix] = v;
        w[iy * n + ix] = m.waterAt(x, y);
    };
}

fn marchChunk(
    alloc: std.mem.Allocator,
    h: []const f32,
    w: []const f32,
    x0: f32,
    y0: f32,
    comptime per: usize,
    contours: ?*Chunked(Seg),
    index: *Chunked(Seg),
    banks: ?*Chunked(Seg),
) !void {
    const n = chunk * per + 1;
    for (0..n - 1) |iy| for (0..n - 1) |ix| {
        const c = [4]f32{ h[iy * n + ix], h[iy * n + ix + 1], h[(iy + 1) * n + ix + 1], h[(iy + 1) * n + ix] };
        const wc = [4]f32{ w[iy * n + ix], w[iy * n + ix + 1], w[(iy + 1) * n + ix + 1], w[(iy + 1) * n + ix] };
        const px = x0 + @as(f32, @floatFromInt(ix)) / per;
        const py = y0 + @as(f32, @floatFromInt(iy)) / per;
        if (banks) |b| try march(alloc, &b.items, wc, 0, px, py, 1.0 / @as(f32, per));
        // No contours on the water.
        if (wc[0] < 0 and wc[1] < 0 and wc[2] < 0 and wc[3] < 0) continue;
        const lo = @min(@min(c[0], c[1]), @min(c[2], c[3]));
        const hi = @max(@max(c[0], c[1]), @max(c[2], c[3]));
        var level = @ceil(lo / contour_interval) * contour_interval;
        while (level <= hi) : (level += contour_interval) {
            const lv: i32 = @intFromFloat(level / contour_interval);
            if (@mod(lv, index_every) == 0) {
                try march(alloc, &index.items, c, level, px, py, 1.0 / @as(f32, per));
            } else if (contours) |list| {
                try march(alloc, &list.items, c, level, px, py, 1.0 / @as(f32, per));
            }
        }
    };
}

/// The line where the field crosses `level` in one cell of a grid. The
/// corners: top left, top right, bottom right, bottom left.
fn march(alloc: std.mem.Allocator, out: *std.ArrayList(Seg), c: [4]f32, level: f32, x0: f32, y0: f32, d: f32) !void {
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

/// One dot near each point of a 6 x 6 grid in each square, moved by a hash
/// so it does not look like a grid.
fn stipple(alloc: std.mem.Allocator, m: *const map.Map, x0: f32, y0: f32, water: *Chunked(Dot), wood: *Chunked(Dot)) !void {
    const per = 6;
    for (0..chunk * per) |iy| for (0..chunk * per) |ix| {
        const gx: i32 = @intFromFloat(x0 * per + @as(f32, @floatFromInt(ix)));
        const gy: i32 = @intFromFloat(y0 * per + @as(f32, @floatFromInt(iy)));
        const x = (@as(f32, @floatFromInt(gx)) + noise.hash(gx, gy, 71)) / per;
        const y = (@as(f32, @floatFromInt(gy)) + noise.hash(gx, gy, 72)) / per;
        const r = noise.hash(gx, gy, 73);
        const rank = noise.hash(gx, gy, 75);
        if (m.waterAt(x, y) < -0.02) {
            if (r < 0.55) try water.items.append(alloc, .{ .x = x, .y = y, .rank = rank });
        } else {
            const wf = m.woodAt(x, y);
            // Thinner at the edge of a wood.
            if (wf > 0 and r < 0.42 * std.math.clamp(wf * 10, 0.25, 1)) {
                try wood.items.append(alloc, .{ .x = x, .y = y, .rank = rank, .big = noise.hash(gx, gy, 74) < 0.06 });
            }
        }
    };
}

/// Small blocks in each town square of the chunk, clear of the road.
fn townBlocks(alloc: std.mem.Allocator, m: *const map.Map, cx: usize, cy: usize, out: *Chunked([4]f32)) !void {
    for (0..chunk) |dy| for (0..chunk) |dx| {
        const x: i32 = @intCast(cx * chunk + dx);
        const y: i32 = @intCast(cy * chunk + dy);
        const c = map.idx(x, y);
        if (m.ground[c] != .town) continue;
        const fx: f32 = @floatFromInt(x);
        const fy: f32 = @floatFromInt(y);
        const road = m.way[c] != .none;
        for (0..7) |k| {
            const ki: i32 = @intCast(k);
            var bx = fx + 0.08 + noise.hash(x * 8 + ki, y, 51) * 0.7;
            var by = fy + 0.08 + noise.hash(x, y * 8 + ki, 52) * 0.7;
            const bw = 0.1 + noise.hash(x + ki, y, 53) * 0.14;
            const bh = 0.1 + noise.hash(x, y + ki, 54) * 0.14;
            // Keep the middle (the road) clear.
            if (road and bx < fx + 0.66 and bx + bw > fx + 0.34 and by < fy + 0.66 and by + bh > fy + 0.34) {
                if (noise.hash(x, y, @intCast(k)) < 0.5) bx = if (bx < fx + 0.5) fx + 0.34 - bw else fx + 0.66 else by = if (by < fy + 0.5) fy + 0.34 - bh else fy + 0.66;
            }
            try out.items.append(alloc, .{ bx, by, bw, bh });
        }
    };
}

// ------------------------------------------------------------ ways

/// The segments of the roads and tracks, made again when the map changes.
pub const Ways = struct {
    road: std.ArrayList(Seg) = .empty,
    track: std.ArrayList(Seg) = .empty,
    /// A hash of the ways and hedges that the segments show.
    shown: u64 = 0,

    pub fn deinit(w: *Ways, alloc: std.mem.Allocator) void {
        w.road.deinit(alloc);
        w.track.deinit(alloc);
    }

    /// Make the segments again when the ways or the hedges changed.
    pub fn update(w: *Ways, alloc: std.mem.Allocator, m: *const map.Map) !void {
        var hs = std.hash.Wyhash.init(0);
        hs.update(std.mem.sliceAsBytes(&m.way));
        hs.update(std.mem.sliceAsBytes(&m.hedge_e));
        hs.update(std.mem.sliceAsBytes(&m.hedge_s));
        const now = hs.final();
        if (now == w.shown and w.road.items.len + w.track.items.len > 0) return;
        w.shown = now;
        w.road.clearRetainingCapacity();
        w.track.clearRetainingCapacity();
        try waySegments(alloc, m, &w.road, &w.track);
    }
};

/// A line from the centre of a way square to the middle of each edge that
/// it shares with another way square. A square with one turn gets a curve.
fn waySegments(alloc: std.mem.Allocator, m: *const map.Map, road: *std.ArrayList(Seg), track: *std.ArrayList(Seg)) !void {
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
                try out.append(alloc, .{ .a = prev, .b = p });
                prev = p;
            }
            continue;
        }
        if (count == 0) {
            try out.append(alloc, .{ .a = .{ mx - 0.15, my }, .b = .{ mx + 0.15, my } });
            continue;
        }
        for (dirs, 0..) |d, i| if (linked[i]) {
            try out.append(alloc, .{ .a = .{ mx, my }, .b = .{ mx + @as(f32, @floatFromInt(d[0])) * 0.5, my + @as(f32, @floatFromInt(d[1])) * 0.5 } });
        };
    }
}

// ------------------------------------------------------------ hedges

/// The dots of one hedge, in squares. The hedge runs along a square edge
/// from (x0, y0), `vertical` or not, and wanders off the straight line. Its
/// ends stay on the corners, so hedges meet. Some dots are hedge trees.
pub fn hedgeDots(x0: f32, y0: f32, vertical: bool, out: []Dot) usize {
    const steps = out.len;
    const xi: i32 = @intFromFloat(x0 * 7);
    const yi: i32 = @intFromFloat(y0 * 7 + (if (vertical) @as(f32, 3) else 0));
    // Two waves give the line its bends.
    const a1 = (noise.hash(xi, yi, 81) - 0.5) * 0.16;
    const a2 = (noise.hash(xi, yi, 82) - 0.5) * 0.08;
    var k: usize = 0;
    for (0..steps) |i| {
        const t = (@as(f32, @floatFromInt(i)) + 0.5) / @as(f32, @floatFromInt(steps));
        // A gap: a gate or a dead bush.
        if (noise.hash(xi + @as(i32, @intCast(i)), yi, 83) < 0.07) continue;
        const off = a1 * @sin(std.math.pi * t) + a2 * @sin(2 * std.math.pi * t);
        const big = noise.hash(xi, yi + @as(i32, @intCast(i)), 84) < 0.06;
        out[k] = if (vertical) .{ .x = x0 + off, .y = y0 + t, .rank = 0, .big = big } else .{ .x = x0 + t, .y = y0 + off, .rank = 0, .big = big };
        k += 1;
    }
    return k;
}

test "the shapes of a generated map" {
    const alloc = std.testing.allocator;
    const mapgen = @import("../core/mapgen.zig");
    const route = @import("../core/route.zig");
    const m = try alloc.create(map.Map);
    defer alloc.destroy(m);
    const scratch = try alloc.create(route.Scratch);
    defer alloc.destroy(scratch);
    var setup: mapgen.Setup = .{};
    mapgen.generate(m, &setup, 1, scratch);
    var s = try build(alloc, m);
    defer s.deinit(alloc);
    try std.testing.expect(s.contours.items.items.len > 10000);
    try std.testing.expect(s.index_far.items.items.len > 500);
    try std.testing.expect(s.index_far.items.items.len < s.index.items.items.len);
    try std.testing.expect(s.wood.items.items.len > 1000);
    try std.testing.expectEqual(@as(u32, @intCast(s.contours.items.items.len)), s.contours.start[chunk_count]);
}
