// The ambient-occlusion grid: a uniform 3D grid over the AO boxes of a map.
// Each cell lists the boxes that can be `reach` or less from a point in the
// cell. scene.wgsl ambientOcclusion skips a box further than 1.3 m, so it
// tests only the boxes of its cell (and the boxes that move, render.zig
// uploadBoxes). The same boxes contribute as in a loop over all the boxes.
//
// render.zig loadMap builds the grid from the boxes of the loaded map. The
// grid has no constants for one map. A grid with more than `max_cells`
// cells or `max_entries` list entries gets bigger cells. It never drops a
// box.
const std = @import("std");
const vec = @import("vec.zig");
const V3 = vec.V3;

/// scene.wgsl ambientOcclusion: a box further than this from the point
/// cannot occlude. The margin keeps the float rounding of the cell lookup
/// on the safe side.
pub const reach: f32 = 1.3 + 0.05;
/// The first cell size, in metres.
pub const cell_start: f32 = 2.0;
/// The limits of the grid buffer. Above one of them, the cell size grows.
pub const max_cells: usize = 1 << 18;
pub const max_entries: usize = 1 << 22;

pub const Input = struct { min: V3, max: V3 };

/// `data`: the offset of each cell list (cells + 1 values, from the start
/// of `data`), then the box indices of the lists. Cell (x, y, z) is
/// x + n[0] * (y + n[1] * z). scene.wgsl reads the same layout.
pub const Grid = struct {
    origin: V3,
    cell: f32,
    n: [3]u32,
    data: []u32,

    pub fn cells(g: Grid) usize {
        return @as(usize, g.n[0]) * g.n[1] * g.n[2];
    }

    /// The box list of the cell at point p. Empty outside the grid.
    pub fn list(g: Grid, p: V3) []const u32 {
        const c = g.cellOf(p) orelse return &.{};
        return g.data[g.data[c]..g.data[c + 1]];
    }

    pub fn cellOf(g: Grid, p: V3) ?usize {
        const q = (p - g.origin) / @as(V3, @splat(g.cell));
        var i: [3]usize = undefined;
        inline for (0..3) |a| {
            const f = @floor(q[a]);
            if (!(f >= 0) or f >= @as(f32, @floatFromInt(g.n[a]))) return null;
            i[a] = @intFromFloat(f);
        }
        return i[0] + g.n[0] * (i[1] + g.n[1] * i[2]);
    }

    pub fn deinit(g: *Grid, gpa: std.mem.Allocator) void {
        gpa.free(g.data);
        g.data = &.{};
    }
};

/// The distance between two boxes (0 when they touch or overlap).
fn boxDist(a_min: V3, a_max: V3, b_min: V3, b_max: V3) f32 {
    const gap = @max(@max(a_min - b_max, b_min - a_max), @as(V3, @splat(0)));
    return @sqrt(vec.dot(gap, gap));
}

/// Build the grid. `boxes[i]` gets index `ids[i]` in the lists.
pub fn build(gpa: std.mem.Allocator, boxes: []const Input, ids: []const u32) !Grid {
    std.debug.assert(boxes.len == ids.len);
    if (boxes.len == 0) {
        const data = try gpa.alloc(u32, 2);
        data[0] = 2;
        data[1] = 2;
        return .{ .origin = .{ 0, 0, 0 }, .cell = cell_start, .n = .{ 1, 1, 1 }, .data = data };
    }
    var lo: V3 = boxes[0].min;
    var hi: V3 = boxes[0].max;
    for (boxes) |b| {
        lo = @min(lo, b.min);
        hi = @max(hi, b.max);
    }
    const r: V3 = @splat(reach);
    lo -= r;
    hi += r;

    var cell = cell_start;
    while (true) : (cell *= 1.5) {
        var n: [3]u32 = undefined;
        var count: usize = 1;
        inline for (0..3) |a| {
            n[a] = @max(1, @as(u32, @intFromFloat(@ceil((hi[a] - lo[a]) / cell))));
            count *= n[a];
        }
        if (count > max_cells) continue;
        const g: Grid = .{ .origin = lo, .cell = cell, .n = n, .data = &.{} };
        const entries = countEntries(g, boxes, null) orelse continue;
        var grid = g;
        grid.data = try gpa.alloc(u32, count + 1 + entries);
        fill(&grid, boxes, ids);
        if (cell != cell_start) std.log.info("ao grid: cell {d:.2} m (the grid was too large with smaller cells)", .{cell});
        return grid;
    }
}

/// The cell range of box b, and a test for one cell of it.
const Range = struct {
    lo: [3]u32,
    hi: [3]u32,

    fn of(g: Grid, b: Input) Range {
        var rg: Range = undefined;
        inline for (0..3) |a| {
            const s = g.cell;
            const l = @floor((b.min[a] - reach - g.origin[a]) / s);
            const h = @floor((b.max[a] + reach - g.origin[a]) / s);
            const top: f32 = @floatFromInt(g.n[a] - 1);
            rg.lo[a] = @intFromFloat(std.math.clamp(l, 0, top));
            rg.hi[a] = @intFromFloat(std.math.clamp(h, 0, top));
        }
        return rg;
    }
};

fn cellNear(g: Grid, b: Input, x: u32, y: u32, z: u32) bool {
    const c_min = g.origin + V3{ @floatFromInt(x), @floatFromInt(y), @floatFromInt(z) } * @as(V3, @splat(g.cell));
    const c_max = c_min + @as(V3, @splat(g.cell));
    return boxDist(c_min, c_max, b.min, b.max) <= reach;
}

/// The list entries of all the cells. Null when more than max_entries.
/// With `counts`, also the entry count of each cell.
fn countEntries(g: Grid, boxes: []const Input, counts: ?[]u32) ?usize {
    var total: usize = 0;
    for (boxes) |b| {
        const rg = Range.of(g, b);
        var z = rg.lo[2];
        while (z <= rg.hi[2]) : (z += 1) {
            var y = rg.lo[1];
            while (y <= rg.hi[1]) : (y += 1) {
                var x = rg.lo[0];
                while (x <= rg.hi[0]) : (x += 1) {
                    if (!cellNear(g, b, x, y, z)) continue;
                    total += 1;
                    if (counts) |cs| cs[x + g.n[0] * (y + g.n[1] * z)] += 1;
                }
            }
        }
        if (total > max_entries) return null;
    }
    return total;
}

fn fill(g: *Grid, boxes: []const Input, ids: []const u32) void {
    const cells = g.cells();
    const off = g.data[0 .. cells + 1];
    @memset(off, 0);
    _ = countEntries(g.*, boxes, off[1..]);
    // off[c + 1] gets the start of cell c, and is the write cursor of cell
    // c. After the fill it is the end of cell c, which is the start of
    // cell c + 1.
    var start: u32 = @intCast(cells + 1);
    off[0] = start;
    for (off[1..]) |*o| {
        const count = o.*;
        o.* = start;
        start += count;
    }
    const cursor = off[1..];
    for (boxes, ids) |b, id| {
        const rg = Range.of(g.*, b);
        var z = rg.lo[2];
        while (z <= rg.hi[2]) : (z += 1) {
            var y = rg.lo[1];
            while (y <= rg.hi[1]) : (y += 1) {
                var x = rg.lo[0];
                while (x <= rg.hi[0]) : (x += 1) {
                    if (!cellNear(g.*, b, x, y, z)) continue;
                    const c = x + g.n[0] * (y + g.n[1] * z);
                    g.data[cursor[c]] = id;
                    cursor[c] += 1;
                }
            }
        }
    }
}

const testing = std.testing;

fn sdBox(p: V3, mn: V3, mx: V3) f32 {
    const c = (mn + mx) * @as(V3, @splat(0.5));
    const h = (mx - mn) * @as(V3, @splat(0.5));
    const q = @abs(p - c) - h;
    const out = @max(q, @as(V3, @splat(0)));
    return @sqrt(vec.dot(out, out)) + @min(@max(q[0], @max(q[1], q[2])), 0);
}

/// Each box that the shader does not skip at point p (sdBox 1.3 or less)
/// is in the list of the cell of p.
fn expectComplete(g: Grid, boxes: []const Input, ids: []const u32, rand: std.Random, points: usize) !void {
    var lo = boxes[0].min;
    var hi = boxes[0].max;
    for (boxes) |b| {
        lo = @min(lo, b.min);
        hi = @max(hi, b.max);
    }
    lo -= @splat(3);
    hi += @splat(3);
    for (0..points) |_| {
        const p = lo + V3{ rand.float(f32), rand.float(f32), rand.float(f32) } * (hi - lo);
        const l = g.list(p);
        for (boxes, ids) |b, id| {
            if (sdBox(p, b.min, b.max) > 1.3) continue;
            if (std.mem.indexOfScalar(u32, l, id) == null) {
                std.debug.print("box {d} is {d:.3} m from {any}, not in its cell\n", .{ id, sdBox(p, b.min, b.max), p });
                return error.BoxMissing;
            }
        }
    }
}

fn randomBoxes(gpa: std.mem.Allocator, rand: std.Random, n: usize, span: f32) !struct { []Input, []u32 } {
    const boxes = try gpa.alloc(Input, n);
    const ids = try gpa.alloc(u32, n);
    for (boxes, ids, 0..) |*b, *id, i| {
        const c = V3{ rand.float(f32), rand.float(f32) * 0.3, rand.float(f32) } * @as(V3, @splat(span)) - @as(V3, @splat(span / 2));
        // Mostly small parts, some long walls and floors.
        const big = rand.float(f32) < 0.1;
        const h = V3{ rand.float(f32), rand.float(f32), rand.float(f32) } * @as(V3, @splat(if (big) 20 else 1.5)) + @as(V3, @splat(0.02));
        b.* = .{ .min = c - h, .max = c + h };
        id.* = @intCast(i * 3 + 1);
    }
    return .{ boxes, ids };
}

test "ao grid: each box in range of a point is in the list of its cell" {
    var prng = std.Random.DefaultPrng.init(880);
    const rand = prng.random();
    const boxes, const ids = try randomBoxes(testing.allocator, rand, 400, 120);
    defer testing.allocator.free(boxes);
    defer testing.allocator.free(ids);
    var g = try build(testing.allocator, boxes, ids);
    defer g.deinit(testing.allocator);
    try testing.expectEqual(cell_start, g.cell);
    try expectComplete(g, boxes, ids, rand, 20_000);
    // Points on the cell faces and corners: the rounding of the lookup.
    for (0..2000) |i| {
        const c = V3{ @floatFromInt(i % 17), @floatFromInt(i % 5), @floatFromInt(i % 23) };
        const p = g.origin + c * @as(V3, @splat(g.cell));
        const l = g.list(p);
        for (boxes, ids) |b, id| {
            if (sdBox(p, b.min, b.max) <= 1.3) try testing.expect(std.mem.indexOfScalar(u32, l, id) != null);
        }
    }
}

test "ao grid: a box is in no cell that it cannot reach" {
    const boxes = [_]Input{
        .{ .min = .{ 0, 0, 0 }, .max = .{ 1, 1, 1 } },
        .{ .min = .{ 20, 0, 0 }, .max = .{ 21, 1, 1 } },
    };
    var g = try build(testing.allocator, &boxes, &.{ 7, 9 });
    defer g.deinit(testing.allocator);
    try testing.expectEqualSlices(u32, &.{7}, g.list(.{ 0.5, 0.5, 0.5 }));
    try testing.expectEqualSlices(u32, &.{9}, g.list(.{ 20.5, 0.5, 0.5 }));
    try testing.expectEqualSlices(u32, &.{}, g.list(.{ 10.5, 0.5, 0.5 }));
    // Outside the grid: no list.
    try testing.expectEqual(null, g.cellOf(.{ -50, 0, 0 }));
}

test "ao grid: a large map gets bigger cells and keeps all the boxes" {
    var prng = std.Random.DefaultPrng.init(7);
    const rand = prng.random();
    // 2 km wide: at 2 m cells, more than max_cells.
    const boxes, const ids = try randomBoxes(testing.allocator, rand, 300, 2000);
    defer testing.allocator.free(boxes);
    defer testing.allocator.free(ids);
    var g = try build(testing.allocator, boxes, ids);
    defer g.deinit(testing.allocator);
    try testing.expect(g.cell > cell_start);
    try testing.expect(g.cells() <= max_cells);
    try expectComplete(g, boxes, ids, rand, 5_000);
}

test "ao grid: no boxes" {
    var g = try build(testing.allocator, &.{}, &.{});
    defer g.deinit(testing.allocator);
    try testing.expectEqualSlices(u32, &.{}, g.list(.{ 0.5, 0.5, 0.5 }));
}
