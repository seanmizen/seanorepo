//! The map generator. One seed gives one map, the same each time. It also
//! picks the scenario on the map (`Setup`): the front line, the blue depot,
//! the objective, the red observation posts and batteries, and the start
//! squares of each side.
//!
//! The steps, in order:
//!  1. The height: fractal noise, and ridged noise for the ridge lines.
//!  2. The rivers: from high squares, down the steepest slope to the edge
//!     of the map or into a lake. Each river cuts a valley.
//!  3. The woods: a noise field, thin near the water.
//!  4. The towns: spaced out on dry, gentle ground.
//!  5. The roads: each town to its nearest towns, along the cheapest route
//!     (slope, woods and water cost more; an old road costs less). A road
//!     on water is a bridge.
//!  6. The scenario: the objective in the north half, the depot in the
//!     south, and the main road between them. A farm lane behind the blue
//!     start line.
//!  7. The hedges: thick in the bocage areas, thin elsewhere.
//!  8. The posts, the batteries and the start squares.
const std = @import("std");
const map = @import("map.zig");
const noise = @import("noise.zig");
const route = @import("route.zig");

const size = map.size;
const n = map.fine_n;
const per = map.fine_per;

pub const max_objective = 12;
pub const max_posts = 3;
pub const max_batteries = 3;
pub const max_squads = 16;

pub const Setup = struct {
    /// The y of the front line: red is north of it, blue south.
    front_y: i32 = size / 2,
    depot: u16 = 0,
    objective: [max_objective]u16 = @splat(0),
    objective_n: u8 = 0,
    /// The red observation posts: x, y, eye height (m).
    posts: [max_posts][3]f32 = @splat(.{ 0, 0, 0 }),
    batteries: [max_batteries][2]f32 = @splat(.{ 0, 0 }),
    blue: [max_squads]u16 = @splat(0),
    blue_n: u8 = 0,
    red: [max_squads]u16 = @splat(0),
    red_n: u8 = 0,

    pub fn isObjective(s: *const Setup, c: u16) bool {
        for (s.objective[0..s.objective_n]) |o| if (o == c) return true;
        return false;
    }
};

const Town = struct { c: u16, r: u8 };
const max_towns = 64;

fn fi(ix: usize, iy: usize) usize {
    return iy * n + ix;
}

fn bump(d: f32, r: f32) f32 {
    return @exp(-(d * d) / (r * r));
}

/// Make the map and the scenario from the seed. `scratch` is for the route
/// search.
pub fn generate(m: *map.Map, setup: *Setup, seed: u32, scratch: *route.Scratch) void {
    setup.* = .{};
    heights(m, seed);
    rivers(m, seed);
    woods(m, seed);
    groundFromFields(m);
    var towns: [max_towns]Town = undefined;
    const town_n = placeTowns(m, seed, &towns);
    m.way = @splat(.none);
    m.net = @splat(false);
    scenario(m, setup, towns[0..town_n], scratch);
    roads(m, towns[0..town_n], scratch);
    hedges(m, seed);
    observers(m, setup);
    squads(m, setup);
}

// ------------------------------------------------------------ 1. height

fn heights(m: *map.Map, seed: u32) void {
    for (0..n) |iy| for (0..n) |ix| {
        const x = @as(f32, @floatFromInt(ix)) / per;
        const y = @as(f32, @floatFromInt(iy)) / per;
        // A warp bends the ridges, so they do not run straight.
        const wx = x + 6 * (noise.value(x / 20, y / 20, seed +% 1) - 0.5);
        const wy = y + 6 * (noise.value(x / 20, y / 20, seed +% 2) - 0.5);
        var h: f32 = 30;
        h += 110 * noise.fbm(wx / 34, wy / 34, 5, seed +% 3);
        h += 45 * noise.ridged(wx / 26, wy / 26, 3, seed +% 4);
        // Small bumps: knolls and folds that give dead ground.
        h += 6 * noise.fbm(x / 3, y / 3, 2, seed +% 5);
        m.height[fi(ix, iy)] = h;
    };
}

fn fineAt(grid: *const [n * n]f32, x: f32, y: f32) f32 {
    const ix: usize = @intFromFloat(std.math.clamp(@round(x * per), 0, n - 1));
    const iy: usize = @intFromFloat(std.math.clamp(@round(y * per), 0, n - 1));
    return grid[fi(ix, iy)];
}

// ------------------------------------------------------------ 2. rivers

const max_river = 400;

fn rivers(m: *map.Map, seed: u32) void {
    // The distance to the nearest river line, in squares, and the width of
    // that river, on the fine grid. The water and wood grids hold them
    // until the end of this step: woods() fills the wood grid later.
    const near = &m.water;
    const width = &m.wood;
    near.* = @splat(std.math.inf(f32));
    width.* = @splat(0);

    // The river that owns each square (0: none), so a river never steps
    // back onto itself and stops when it joins another.
    var used: [map.cells]u8 = @splat(0);
    const sources = size / 16;
    var made: u8 = 0;
    var tries: u32 = 0;
    while (made < sources and tries < 400) : (tries += 1) {
        // A high square, picked by the hash.
        const sx: i32 = @intFromFloat(noise.hash(@intCast(tries), 0, seed +% 11) * (size - 16) + 8);
        const sy: i32 = @intFromFloat(noise.hash(@intCast(tries), 1, seed +% 11) * (size - 16) + 8);
        const h0 = fineAt(&m.height, @floatFromInt(sx), @floatFromInt(sy));
        if (h0 < 90 or used[map.idx(sx, sy)] != 0) continue;
        made += 1;
        const id = made;
        var pts: [max_river][2]f32 = undefined;
        var count: usize = 0;
        var x = sx;
        var y = sy;
        var pdx: i32 = 0;
        var pdy: i32 = 0;
        // The pull toward the nearest edge of the map: a river does not
        // wander in circles.
        const to_w = sx;
        const to_e = size - 1 - sx;
        const to_n = sy;
        const to_s = size - 1 - sy;
        const near_edge = @min(@min(to_w, to_e), @min(to_n, to_s));
        const ex: f32 = if (near_edge == to_w) -1 else if (near_edge == to_e) 1 else 0;
        const ey: f32 = if (ex != 0) 0 else if (near_edge == to_n) -1 else 1;
        var steps: u32 = 0;
        while (steps < max_river) : (steps += 1) {
            pts[count] = .{ @as(f32, @floatFromInt(x)) + 0.5, @as(f32, @floatFromInt(y)) + 0.5 };
            count += 1;
            const c = map.idx(x, y);
            if (used[c] != 0 and used[c] != id) break; // It joins another river.
            used[c] = id;
            if (x <= 0 or y <= 0 or x >= size - 1 or y >= size - 1) break; // The edge.
            // The lowest neighbour that this river has not used. A turn
            // costs a little, and a small hash keeps the line from running
            // straight. In a hollow it climbs out the lowest way: the
            // river fills the hollow (a lake there, in effect).
            var best: ?[2]i32 = null;
            var best_h = std.math.inf(f32);
            var dy: i32 = -1;
            while (dy <= 1) : (dy += 1) {
                var dx: i32 = -1;
                while (dx <= 1) : (dx += 1) {
                    if (dx == 0 and dy == 0) continue;
                    if (!map.inside(x + dx, y + dy)) continue;
                    if (used[map.idx(x + dx, y + dy)] == id) continue;
                    const turn: f32 = if (pdx == 0 and pdy == 0) 0 else @as(f32, @floatFromInt(@abs(dx - pdx) + @abs(dy - pdy)));
                    const hh = fineAt(&m.height, @as(f32, @floatFromInt(x + dx)) + 0.5, @as(f32, @floatFromInt(y + dy)) + 0.5) +
                        2 * noise.hash(x + dx, y + dy, seed +% 12) + 1.5 * turn -
                        4 * (@as(f32, @floatFromInt(dx)) * ex + @as(f32, @floatFromInt(dy)) * ey);
                    if (hh < best_h) {
                        best_h = hh;
                        best = .{ x + dx, y + dy };
                    }
                }
            }
            const b = best orelse break;
            pdx = b[0] - x;
            pdy = b[1] - y;
            x = b[0];
            y = b[1];
        }
        if (count < 6) continue;
        // Smooth the line: two passes of Chaikin cutting.
        var a = pts;
        var an = count;
        for (0..2) |_| {
            var b: [max_river * 4][2]f32 = undefined;
            var bn: usize = 0;
            b[0] = a[0];
            bn = 1;
            for (0..an - 1) |i| {
                const p = a[i];
                const q = a[i + 1];
                if (bn + 2 > max_river) break;
                b[bn] = .{ 0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1] };
                b[bn + 1] = .{ 0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1] };
                bn += 2;
            }
            b[bn] = a[an - 1];
            bn += 1;
            @memcpy(a[0..bn], b[0..bn]);
            an = bn;
        }
        // Stamp the line onto the fine grid. The river is wider downstream.
        for (0..an - 1) |i| {
            const w = 0.18 + 0.22 * @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(an));
            stamp(near, width, a[i], a[i + 1], w);
        }
    }
    // Two lakes in low ground.
    var lakes: u32 = 0;
    tries = 0;
    while (lakes < 2 and tries < 100) : (tries += 1) {
        const lx = noise.hash(@intCast(tries), 5, seed +% 13) * (size - 20) + 10;
        const ly = noise.hash(@intCast(tries), 6, seed +% 13) * (size - 20) + 10;
        if (fineAt(&m.height, lx, ly) > 70) continue;
        lakes += 1;
        const r = 1.2 + 1.5 * noise.hash(@intCast(tries), 7, seed +% 13);
        for (0..n) |iy| for (0..n) |ix| {
            const fx = @as(f32, @floatFromInt(ix)) / per;
            const fy = @as(f32, @floatFromInt(iy)) / per;
            const d = @sqrt((fx - lx) * (fx - lx) + (fy - ly) * (fy - ly) * 1.5) - r + 0.4 * noise.value(fx * 1.5, fy * 1.5, seed +% 14);
            if (d < near[fi(ix, iy)]) {
                near[fi(ix, iy)] = @max(d, 0) + 0.001;
                width[fi(ix, iy)] = if (d < 0) -d + 0.3 else 0.3;
            }
        };
    }
    // The water field and the valleys.
    for (0..n * n) |i| {
        const d = near[i];
        m.water[i] = if (std.math.isInf(d)) 10 else d - width[i];
        width[i] = 0;
        if (!std.math.isInf(d)) m.height[i] -= 9 * bump(d, 2.6) + 3 * bump(d, 0.8);
    }
}

/// Write the distance to the segment a..b into `near` where it is lower.
fn stamp(near: *[n * n]f32, width: *[n * n]f32, a: [2]f32, b: [2]f32, w: f32) void {
    const reach: f32 = 4;
    const x0: usize = @intFromFloat(std.math.clamp((@min(a[0], b[0]) - reach) * per, 0, n - 1));
    const x1: usize = @intFromFloat(std.math.clamp((@max(a[0], b[0]) + reach) * per, 0, n - 1));
    const y0: usize = @intFromFloat(std.math.clamp((@min(a[1], b[1]) - reach) * per, 0, n - 1));
    const y1: usize = @intFromFloat(std.math.clamp((@max(a[1], b[1]) + reach) * per, 0, n - 1));
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = @max(dx * dx + dy * dy, 0.0001);
    for (y0..y1 + 1) |iy| for (x0..x1 + 1) |ix| {
        const px = @as(f32, @floatFromInt(ix)) / per;
        const py = @as(f32, @floatFromInt(iy)) / per;
        const t = std.math.clamp(((px - a[0]) * dx + (py - a[1]) * dy) / l2, 0, 1);
        const ex = a[0] + t * dx - px;
        const ey = a[1] + t * dy - py;
        const d = @sqrt(ex * ex + ey * ey);
        if (d < near[fi(ix, iy)]) {
            near[fi(ix, iy)] = d;
            width[fi(ix, iy)] = w;
        }
    };
}

// ------------------------------------------------------------ 3. woods

fn woods(m: *map.Map, seed: u32) void {
    for (0..n) |iy| for (0..n) |ix| {
        const x = @as(f32, @floatFromInt(ix)) / per;
        const y = @as(f32, @floatFromInt(iy)) / per;
        const wx = x + 1.5 * (noise.value(x / 1.8, y / 1.8, seed +% 21) - 0.5);
        const wy = y + 1.5 * (noise.value(x / 1.8, y / 1.8, seed +% 22) - 0.5);
        var w = noise.fbm(wx / 7, wy / 7, 4, seed +% 23) - 0.58;
        // Fewer woods on the low, wet ground, more on the steep hills.
        const wet = m.water[fi(ix, iy)];
        if (wet < 0.6) w -= 0.25;
        m.wood[fi(ix, iy)] = w;
    };
}

fn groundFromFields(m: *map.Map) void {
    for (0..map.cells) |ci| {
        const c: u16 = @intCast(ci);
        const p = map.centre(c);
        m.ground[c] = if (m.waterAt(p[0], p[1]) < 0.3) .water else if (m.woodAt(p[0], p[1]) > 0) .wood else .grass;
    }
}

// ------------------------------------------------------------ 4. towns

fn slopeAt(m: *const map.Map, c: u16) f32 {
    const p = map.centre(c);
    const dx = m.heightAt(p[0] + 0.5, p[1]) - m.heightAt(p[0] - 0.5, p[1]);
    const dy = m.heightAt(p[0], p[1] + 0.5) - m.heightAt(p[0], p[1] - 0.5);
    return @sqrt(dx * dx + dy * dy);
}

fn placeTowns(m: *map.Map, seed: u32, out: *[max_towns]Town) usize {
    var count: usize = 0;
    const spacing: f32 = 11;
    var k: u32 = 0;
    while (k < 4000 and count < max_towns) : (k += 1) {
        const x: i32 = @intFromFloat(noise.hash(@intCast(k), 31, seed) * (size - 6) + 3);
        const y: i32 = @intFromFloat(noise.hash(@intCast(k), 32, seed) * (size - 6) + 3);
        const c = map.idx(x, y);
        if (m.ground[c] == .water or slopeAt(m, c) > 12) continue;
        const p = map.centre(c);
        if (m.waterAt(p[0], p[1]) < 0.8) continue;
        var ok = true;
        for (out[0..count]) |t| {
            const q = map.centre(t.c);
            if ((q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1]) < spacing * spacing) ok = false;
        }
        if (!ok) continue;
        const r: u8 = if (noise.hash(x, y, seed +% 33) < 0.3) 2 else if (noise.hash(x, y, seed +% 34) < 0.5) 1 else 0;
        out[count] = .{ .c = c, .r = r };
        count += 1;
        buildTown(m, c, r, seed);
    }
    return count;
}

fn buildTown(m: *map.Map, c: u16, r: u8, seed: u32) void {
    const x = map.cellX(c);
    const y = map.cellY(c);
    const ri: i32 = r;
    var dy: i32 = -ri;
    while (dy <= ri) : (dy += 1) {
        var dx: i32 = -ri;
        while (dx <= ri) : (dx += 1) {
            if (!map.inside(x + dx, y + dy)) continue;
            // A round town, with ragged edges.
            if (dx * dx + dy * dy > ri * ri + 1) continue;
            if (dx != 0 and dy != 0 and noise.hash(x + dx, y + dy, seed +% 35) < 0.35) continue;
            const t = map.idx(x + dx, y + dy);
            if (m.ground[t] != .water) m.ground[t] = .town;
        }
    }
}

// ------------------------------------------------------------ 5. roads

/// The cost to lay a road from square a to square b.
const RoadCost = struct {
    m: *const map.Map,
    lane: bool = false,
    pub fn cost(ctx: RoadCost, a: u16, b: u16) f32 {
        const m = ctx.m;
        if (m.way[b] == .road) return 0.35;
        if (m.way[b] == .track) return if (ctx.lane) 0.5 else 0.8;
        var c: f32 = 1;
        c += @abs(m.cellHeight(b) - m.cellHeight(a)) * 0.25;
        switch (m.ground[b]) {
            .water => c += 30,
            .wood => c += 2,
            .town => c -= 0.3,
            .grass => {},
        }
        return c;
    }
};

fn layRoad(m: *map.Map, scratch: *route.Scratch, from: u16, to: u16, way: map.Way, lane: bool) void {
    route.search(scratch, &.{from}, RoadCost{ .m = m, .lane = lane }, to);
    var buf: [route.max_path]u16 = undefined;
    const p = route.path(scratch, to, &buf) orelse return;
    if (@backingInt(m.way[from]) < @backingInt(way)) m.way[from] = way;
    for (p) |c| if (@backingInt(m.way[c]) < @backingInt(way)) {
        m.way[c] = way;
    };
}

fn roads(m: *map.Map, towns: []const Town, scratch: *route.Scratch) void {
    // Each town to its two nearest towns.
    for (towns, 0..) |t, i| {
        var best = [2]?usize{ null, null };
        var best_d = [2]f32{ std.math.inf(f32), std.math.inf(f32) };
        const p = map.centre(t.c);
        for (towns, 0..) |u, j| {
            if (i == j) continue;
            const q = map.centre(u.c);
            const d = (q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1]);
            if (d < best_d[0]) {
                best_d[1] = best_d[0];
                best[1] = best[0];
                best_d[0] = d;
                best[0] = j;
            } else if (d < best_d[1]) {
                best_d[1] = d;
                best[1] = j;
            }
        }
        for (best) |b| if (b) |j| if (j > i or best_d[0] > 0) {
            layRoad(m, scratch, t.c, towns[j].c, .road, false);
        };
    }
}

// ------------------------------------------------------------ 6. scenario

fn nearestTown(towns: []const Town, x: f32, y0: f32, y1: f32) ?Town {
    var best: ?Town = null;
    var best_d = std.math.inf(f32);
    for (towns) |t| {
        const p = map.centre(t.c);
        if (p[1] < y0 or p[1] > y1) continue;
        // A bigger town is a better objective.
        const d = @abs(p[0] - x) - @as(f32, @floatFromInt(t.r)) * 6;
        if (d < best_d) {
            best_d = d;
            best = t;
        }
    }
    return best;
}

fn scenario(m: *map.Map, setup: *Setup, towns: []const Town, scratch: *route.Scratch) void {
    const mid: f32 = size / 2;
    const fy: f32 = @floatFromInt(setup.front_y);
    const obj = nearestTown(towns, mid, fy - 22, fy - 8) orelse Town{ .c = map.idx(size / 2, setup.front_y - 14), .r = 1 };
    const dep = nearestTown(towns, mid, size - 16, size - 4) orelse Town{ .c = map.idx(size / 2, size - 8), .r = 1 };
    // Make sure they are towns of some size.
    buildTown(m, obj.c, @max(obj.r, 1), 77);
    buildTown(m, dep.c, @max(dep.r, 1), 78);
    setup.depot = dep.c;
    // The objective: the town squares near its centre.
    const ox = map.cellX(obj.c);
    const oy = map.cellY(obj.c);
    var dy: i32 = -2;
    while (dy <= 2) : (dy += 1) {
        var dx: i32 = -2;
        while (dx <= 2) : (dx += 1) {
            if (!map.inside(ox + dx, oy + dy) or setup.objective_n == max_objective) continue;
            const c = map.idx(ox + dx, oy + dy);
            if (m.ground[c] == .town) {
                setup.objective[setup.objective_n] = c;
                setup.objective_n += 1;
            }
        }
    }
    // The main road: from the south edge (the railhead) to the depot, then
    // to the objective, then to the north edge.
    const dx_: i32 = map.cellX(dep.c);
    layRoad(m, scratch, map.idx(dx_, size - 1), dep.c, .road, false);
    layRoad(m, scratch, dep.c, obj.c, .road, false);
    layRoad(m, scratch, obj.c, map.idx(ox, 0), .road, false);
    // The farm lane: east to west behind the blue start line.
    const lane_y = setup.front_y + 8;
    var x: i32 = 0;
    var prev = map.idx(0, lane_y);
    while (x < size - 1) {
        x = @min(x + 12, size - 1);
        const c = map.idx(x, lane_y);
        layRoad(m, scratch, prev, c, .track, true);
        prev = c;
    }
}

// ------------------------------------------------------------ 7. hedges

fn hedges(m: *map.Map, seed: u32) void {
    for (0..size) |uy| for (0..size) |ux| {
        const x: i32 = @intCast(ux);
        const y: i32 = @intCast(uy);
        const c = map.idx(x, y);
        m.hedge_e[c] = false;
        m.hedge_s[c] = false;
        if (m.ground[c] != .grass) continue;
        // Bocage: the small fields with many hedges.
        const bocage = noise.fbm(@as(f32, @floatFromInt(x)) / 14, @as(f32, @floatFromInt(y)) / 14, 3, seed +% 41) > 0.52;
        const p: f32 = if (bocage) 0.5 else 0.12;
        if (x < size - 1 and m.ground[c + 1] == .grass and noise.hash(x, y, seed +% 42) < p) m.hedge_e[c] = true;
        if (y < size - 1 and m.ground[c + size] == .grass and noise.hash(x, y, seed +% 43) < p) m.hedge_s[c] = true;
    };
    for (0..map.cells) |c| if (m.way[c] != .none) m.cutHedges(@intCast(c));
}

// ------------------------------------------------------------ 8. units

fn observers(m: *const map.Map, setup: *Setup) void {
    // The posts: the highest squares in the red ground near the line, each
    // at least 24 squares from the others.
    const y0 = setup.front_y - 24;
    const y1 = setup.front_y - 7;
    var count: usize = 0;
    while (count < max_posts) : (count += 1) {
        var best: ?u16 = null;
        var best_h: f32 = -std.math.inf(f32);
        var y = y0;
        while (y <= y1) : (y += 1) {
            var x: i32 = 4;
            while (x < size - 4) : (x += 1) {
                const c = map.idx(x, y);
                if (m.ground[c] == .water) continue;
                var ok = true;
                for (setup.posts[0..count]) |p| {
                    if (@abs(p[0] - @as(f32, @floatFromInt(x))) < 24) ok = false;
                }
                if (!ok) continue;
                const h = m.cellHeight(c);
                if (h > best_h) {
                    best_h = h;
                    best = c;
                }
            }
        }
        const b = best orelse break;
        const p = map.centre(b);
        setup.posts[count] = .{ p[0], p[1], if (count == 0) 10 else 6 };
    }
    for (0..max_batteries) |i| {
        const x = @as(f32, @floatFromInt(size)) * (@as(f32, @floatFromInt(i)) + 0.5) / max_batteries;
        setup.batteries[i] = .{ x, @as(f32, @floatFromInt(setup.front_y)) - 30 };
    }
}

fn squads(m: *const map.Map, setup: *Setup) void {
    const step = size / max_squads;
    // Red: on the line, one in the objective.
    setup.red[0] = setup.objective[0];
    setup.red_n = 1;
    for (0..max_squads - 1) |i| {
        const x: i32 = @intCast(i * step + step / 2);
        if (pick(m, x, setup.front_y - 4, 3, null)) |c| {
            setup.red[setup.red_n] = c;
            setup.red_n += 1;
        }
    }
    // Blue: behind the line, near the farm lane, so the trucks reach them.
    var lane: [map.cells]bool = undefined;
    for (0..map.cells) |c| lane[c] = m.way[c] != .none;
    for (0..max_squads) |i| {
        if (setup.blue_n == max_squads) break;
        const x: i32 = @intCast(i * step + step / 2);
        if (pick(m, x, setup.front_y + 6, 3, &lane)) |c| {
            setup.blue[setup.blue_n] = c;
            setup.blue_n += 1;
        }
    }
}

/// A dry square near (x, y). With `near_way`, one within 2 squares of a way
/// if there is one.
fn pick(m: *const map.Map, x: i32, y: i32, reach: i32, near_way: ?*const [map.cells]bool) ?u16 {
    var r: i32 = 0;
    while (r <= reach) : (r += 1) {
        var dy: i32 = -r;
        while (dy <= r) : (dy += 1) {
            var dx: i32 = -r;
            while (dx <= r) : (dx += 1) {
                if (!map.inside(x + dx, y + dy)) continue;
                const c = map.idx(x + dx, y + dy);
                if (m.ground[c] == .water) continue;
                if (near_way) |w| if (!wayWithin(w, c, 2)) continue;
                return c;
            }
        }
    }
    return if (near_way != null) pick(m, x, y, reach, null) else null;
}

fn wayWithin(w: *const [map.cells]bool, c: u16, r: i32) bool {
    const x = map.cellX(c);
    const y = map.cellY(c);
    var dy: i32 = -r;
    while (dy <= r) : (dy += 1) {
        var dx: i32 = -r;
        while (dx <= r) : (dx += 1) {
            if (map.inside(x + dx, y + dy) and w[map.idx(x + dx, y + dy)]) return true;
        }
    }
    return false;
}

test "the map has rivers, towns, roads and a scenario" {
    const alloc = std.testing.allocator;
    const m = try alloc.create(map.Map);
    defer alloc.destroy(m);
    const scratch = try alloc.create(route.Scratch);
    defer alloc.destroy(scratch);
    var setup: Setup = .{};
    generate(m, &setup, 1, scratch);
    var water: u32 = 0;
    var town: u32 = 0;
    var road: u32 = 0;
    var wood: u32 = 0;
    for (0..map.cells) |c| {
        switch (m.ground[c]) {
            .water => water += 1,
            .town => town += 1,
            .wood => wood += 1,
            else => {},
        }
        if (m.way[c] == .road) road += 1;
    }
    try std.testing.expect(water > 100);
    try std.testing.expect(town > 40);
    try std.testing.expect(road > 400);
    try std.testing.expect(wood > 500);
    try std.testing.expect(setup.objective_n > 0);
    try std.testing.expectEqual(@as(u8, max_squads), setup.blue_n);
    try std.testing.expect(setup.red_n > 8);
    // The main road joins the depot to the objective.
    try std.testing.expect(m.way[setup.depot] == .road);
    try std.testing.expect(m.way[setup.objective[0]] == .road or m.ground[setup.objective[0]] == .town);
}

test "one seed gives one map" {
    const alloc = std.testing.allocator;
    const a = try alloc.create(map.Map);
    defer alloc.destroy(a);
    const b = try alloc.create(map.Map);
    defer alloc.destroy(b);
    const scratch = try alloc.create(route.Scratch);
    defer alloc.destroy(scratch);
    var sa: Setup = .{};
    var sb: Setup = .{};
    generate(a, &sa, 7, scratch);
    generate(b, &sb, 7, scratch);
    try std.testing.expectEqualSlices(map.Way, &a.way, &b.way);
    try std.testing.expectEqualSlices(f32, &a.height, &b.height);
}
