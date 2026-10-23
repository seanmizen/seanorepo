// Where: apps/action/game/src/escape.zig (zig build floorplan -- <map> escape)
// When: before you merge a map change. The audit fails (exit code 1) when it
// finds an escape hole.
// Why: a player who gets through a hole in a wall leaves the map. This audit
// flood fills the space that a player can reach from the spawn points. It
// reports each place where that space touches the outside of the map or has
// no floor below it.
//
// The model:
// - The player is an upright box (player.zig). A feet position is free when
//   that box overlaps no solid box. The audit samples feet positions on a
//   grid of columns, `cell` apart. In each column it keeps the exact free
//   height intervals.
// - It tests each column at its centre with a player that is half a cell
//   thinner. Thus the free space that it sees is never smaller than the real
//   free space, and the audit errs toward an escape.
// - A standing player can rise to the top of a jump and move into the next
//   column at any height on the way. This one rule is the walk, the step up
//   and the jump onto a ledge.
// - From a drop edge (a floor next to it is more than `drop_min` lower), an
//   air search follows the jump envelope: at a horizontal distance d from the
//   take-off, the player can be at any free height below the top of a
//   full-speed jump at d.
// - The jump height, the run speed and the envelope come from player.zig. The
//   audit measures them on a flat test floor, so it follows changes to the
//   movement.
// - The ramps over the stairs and the escalators (map.zig Ramp) are solid.
//   On a ramp, the audit uses the highest feet height that a player in the
//   cell can stand at, so it does not make a jump from a ramp too low.
// - The audit ignores dynamic boxes: the landing doors count as open, and the
//   deep train is not there. Each lift cab gets its floor and its ceiling at
//   each level, and a player in the cab can go to the other level.
const std = @import("std");
const map = @import("map.zig");
const player = @import("player.zig");
const vec = @import("vec.zig");
const V3 = vec.V3;
const v3 = vec.v3;

/// The distance between two columns, in metres.
const cell: f32 = 0.1;
/// The radius of the test player: half a cell less than the real radius.
const r_test: f32 = player.radius - cell / 2;
/// A floor next to a standing point that is this much lower makes the point
/// a drop edge, where the air search starts.
const drop_min: f32 = 0.2;
/// The game tick (main.zig tick_hz).
const tick: f32 = 1.0 / 120.0;
/// The step of the jump envelope table, in metres.
const env_step: f32 = 0.05;
/// The size of a bucket of the box index, in metres.
const bucket: f32 = 2;

const no_floor: f32 = -1e30;
const sky: f32 = 1e30;
const none: u32 = std.math.maxInt(u32);
const not_built: u32 = std.math.maxInt(u32);

// Flags of a free interval.
const reached: u8 = 1;
const escaped: u8 = 2;

/// Free feet heights in a column. lo = no_floor: nothing below.
const Iv = struct { lo: f32, hi: f32 };
const Solid = struct { min: V3, max: V3 };
const Col = struct { start: u32, n: u32 };

/// The movement of player.zig, measured.
const Motion = struct {
    /// The highest rise of the feet in a jump from rest.
    jump: f32,
    /// The run speed, metres a second.
    speed: f32,
    /// env[k]: the highest feet height above the take-off at a horizontal
    /// distance of k * env_step or more, on a full-speed jump.
    env: []f32,

    fn at(m: *const Motion, d: f32) f32 {
        const k: usize = @intFromFloat(@floor(d / env_step));
        return if (k < m.env.len) m.env[k] else no_floor;
    }
};

/// One escape: the standing point that the player leaves from, and the
/// column with no floor (or outside the map) that they get to.
const Escape = struct {
    from: u32,
    x: f32,
    z: f32,
    outside: bool,
};

const Air = struct { d: f32, p: u32 };
fn airOrder(_: void, a: Air, b: Air) std.math.Order {
    return std.math.order(a.d, b.d);
}

var gpa: std.mem.Allocator = undefined;
var motion: Motion = undefined;

var solids: std.ArrayList(Solid) = .empty;
/// The static bounds of the map (x, z): outside them is outside the map.
var bmin: [2]f32 = .{ 0, 0 };
var bmax: [2]f32 = .{ 0, 0 };
// The grid of columns.
var gx0: f32 = 0;
var gz0: f32 = 0;
var nx: usize = 0;
var nz: usize = 0;
var cols: []Col = &.{};
// The box index: for each bucket, the solids that can touch its columns.
var nbx: usize = 0;
var nbz: usize = 0;
var bstart: []u32 = &.{};
var bitems: []u32 = &.{};
// The free intervals of the built columns, and per interval its column, its
// flags and the standing point that the player got there from.
var ivs: std.ArrayList(Iv) = .empty;
var ivcol: std.ArrayList(u32) = .empty;
var flags: std.ArrayList(u8) = .empty;
var parent: std.ArrayList(u32) = .empty;
// Per interval, for the air search: the take-off height and the path length
// of the last search that got to it. A later search that gets there from a
// take-off no higher, by a path no shorter, can do nothing new from there.
var air_a: std.ArrayList(f32) = .empty;
var air_d: std.ArrayList(f32) = .empty;

var queue: std.ArrayList(u32) = .empty;
var escapes: std.ArrayList(Escape) = .empty;
var spawn_node: [16]u32 = @splat(none);
var air_q: std.PriorityQueue(Air, void, airOrder) = .empty;
var drop_edges: usize = 0;

/// Run the audit on the loaded map. Returns the number of problems: the
/// escape holes (groups of escapes close together) and the bad spawn points.
pub fn run(alloc: std.mem.Allocator) !usize {
    gpa = alloc;
    motion = try measure();
    try buildSolids();
    try buildIndex();

    // The spawn points start the flood fill.
    var bad_spawns: usize = 0;
    for (map.spawns[0..map.spawn_count], 0..) |s, i| {
        const ix = colX(s.pos[0]);
        const iz = colZ(s.pos[2]);
        const c = try column(ix, iz) orelse {
            std.debug.print("spawn {d} ({d:.1} {d:.1} {d:.1}) is outside the map\n", .{ i + 1, s.pos[0], s.pos[1], s.pos[2] });
            bad_spawns += 1;
            continue;
        };
        var found = false;
        for (0..c.n) |k| {
            const q: u32 = c.start + @as(u32, @intCast(k));
            const iv = ivs.items[q];
            if (s.pos[1] < iv.lo - 0.05 or s.pos[1] > iv.hi + 0.05) continue;
            found = true;
            if (iv.lo == no_floor) {
                std.debug.print("spawn {d} ({d:.1} {d:.1} {d:.1}) has no floor below it\n", .{ i + 1, s.pos[0], s.pos[1], s.pos[2] });
                bad_spawns += 1;
            } else {
                spawn_node[i] = q;
                try visit(q, none);
            }
            break;
        }
        if (!found) {
            std.debug.print("spawn {d} ({d:.1} {d:.1} {d:.1}) is inside a solid box\n", .{ i + 1, s.pos[0], s.pos[1], s.pos[2] });
            bad_spawns += 1;
        }
    }

    var head: usize = 0;
    while (head < queue.items.len) : (head += 1) try expand(queue.items[head]);

    return try report() + bad_spawns;
}

// ---- The movement, measured with player.zig ------------------------------------

fn measure() !Motion {
    // The test runs on a floor of its own. Keep the map, and put it back.
    const saved = try gpa.dupe(map.Box, map.boxes[0..map.box_count]);
    const saved_boxes = map.box_count;
    const saved_esc = map.escalator_count;
    const saved_ramps = map.ramp_count;
    const saved_spawns = map.spawn_count;
    defer {
        @memcpy(map.boxes[0..saved_boxes], saved);
        map.box_count = saved_boxes;
        map.escalator_count = saved_esc;
        map.ramp_count = saved_ramps;
        map.spawn_count = saved_spawns;
    }
    map.escalator_count = 0;
    map.ramp_count = 0;
    map.spawn_count = 0;

    // The run speed: run for two seconds.
    map.box_count = 0;
    _ = map.add(v3(-100, -1, -10), v3(100, 0, 10), v3(0, 0, 0), .paint);
    var p = player.Player{ .pos = v3(-50, 0, 0), .grounded = true };
    for (0..240) |_| p.step(tick, v3(1, 0, 0), false, 1);
    const speed = @sqrt(p.vel[0] * p.vel[0] + p.vel[2] * p.vel[2]);

    // A jump from rest.
    p = .{ .pos = v3(0, 0, 0), .grounded = true };
    var jump: f32 = 0;
    for (0..240) |i| {
        p.step(tick, v3(0, 0, 0), i == 0, 1);
        jump = @max(jump, p.pos[1]);
    }

    // A full-speed jump off the end of a floor, and the fall after it.
    map.box_count = 0;
    _ = map.add(v3(-100, -1, -10), v3(-player.radius - 0.01, 0, 10), v3(0, 0, 0), .paint);
    p = .{ .pos = v3(0, 0, 0), .vel = v3(speed, 0, 0), .grounded = true };
    var xs: std.ArrayList(f32) = .empty;
    var ys: std.ArrayList(f32) = .empty;
    var i: usize = 0;
    while (p.pos[1] > -60 and i < 2400) : (i += 1) {
        p.step(tick, v3(1, 0, 0), i == 0, 1);
        try xs.append(gpa, p.pos[0]);
        try ys.append(gpa, p.pos[1]);
    }
    const last = xs.items[xs.items.len - 1];
    const env = try gpa.alloc(f32, @as(usize, @intFromFloat(@ceil(last / env_step))) + 1);
    var best: f32 = no_floor;
    var j = xs.items.len;
    var k = env.len;
    while (k > 0) {
        k -= 1;
        const d = @as(f32, @floatFromInt(k)) * env_step;
        while (j > 0 and xs.items[j - 1] >= d) {
            j -= 1;
            best = @max(best, ys.items[j]);
        }
        env[k] = best;
    }
    return .{ .jump = jump, .speed = speed, .env = env };
}

// ---- Solids, the box index, the columns ------------------------------------------

fn buildSolids() !void {
    solids.clearRetainingCapacity();
    for (map.boxes[0..map.box_count]) |b| {
        if (!b.solid or b.dynamic) continue;
        try solids.append(gpa, .{ .min = b.min, .max = b.max });
    }
    // Each lift cab: its floor and ceiling at each level.
    for (map.lifts[0..map.lift_count]) |l| {
        const fb = map.boxes[l.floor_box];
        const cb = map.boxes[l.ceil_box];
        const fh = fb.max[1] - fb.min[1];
        const ch = cb.max[1] - cb.min[1];
        for (l.levels) |y| {
            try solids.append(gpa, .{ .min = v3(fb.min[0], y - fh, fb.min[2]), .max = v3(fb.max[0], y, fb.max[2]) });
            const cy = y + map.cab_height;
            try solids.append(gpa, .{ .min = v3(cb.min[0], cy, cb.min[2]), .max = v3(cb.max[0], cy + ch, cb.max[2]) });
        }
    }
    bmin = .{ 1e9, 1e9 };
    bmax = .{ -1e9, -1e9 };
    for (solids.items) |s| {
        bmin = .{ @min(bmin[0], s.min[0]), @min(bmin[1], s.min[2]) };
        bmax = .{ @max(bmax[0], s.max[0]), @max(bmax[1], s.max[2]) };
    }
    // Two cells of margin round the bounds.
    gx0 = bmin[0] - 2 * cell;
    gz0 = bmin[1] - 2 * cell;
    nx = @intFromFloat(@ceil((bmax[0] - bmin[0]) / cell) + 4);
    nz = @intFromFloat(@ceil((bmax[1] - bmin[1]) / cell) + 4);
    cols = try gpa.alloc(Col, nx * nz);
    @memset(cols, .{ .start = 0, .n = not_built });
}

fn buildIndex() !void {
    nbx = @intFromFloat(@ceil(@as(f32, @floatFromInt(nx)) * cell / bucket));
    nbz = @intFromFloat(@ceil(@as(f32, @floatFromInt(nz)) * cell / bucket));
    const counts = try gpa.alloc(u32, nbx * nbz + 1);
    @memset(counts, 0);
    // Two passes: count, then fill.
    for (0..2) |pass| {
        if (pass == 1) {
            var sum: u32 = 0;
            for (counts) |*c| {
                const n = c.*;
                c.* = sum;
                sum += n;
            }
            bstart = try gpa.dupe(u32, counts);
            bitems = try gpa.alloc(u32, sum);
        }
        for (solids.items, 0..) |s, si| {
            const r = bucketRange(s);
            var bz = r[1];
            while (bz <= r[3]) : (bz += 1) {
                var bx = r[0];
                while (bx <= r[2]) : (bx += 1) {
                    const b = bz * nbx + bx;
                    if (pass == 0) {
                        counts[b] += 1;
                    } else {
                        bitems[counts[b]] = @intCast(si);
                        counts[b] += 1;
                    }
                }
            }
        }
    }
}

/// The buckets that a solid can touch (its footprint grown by the test
/// radius): x0, z0, x1, z1.
fn bucketRange(s: Solid) [4]usize {
    const f = struct {
        fn idx(v: f32, o: f32, n: usize) usize {
            const i = @floor((v - o) / bucket);
            return @intFromFloat(std.math.clamp(i, 0, @as(f32, @floatFromInt(n - 1))));
        }
    }.idx;
    return .{
        f(s.min[0] - r_test, gx0, nbx), f(s.min[2] - r_test, gz0, nbz),
        f(s.max[0] + r_test, gx0, nbx), f(s.max[2] + r_test, gz0, nbz),
    };
}

fn colX(x: f32) i32 {
    return @intFromFloat(@floor((x - gx0) / cell));
}
fn colZ(z: f32) i32 {
    return @intFromFloat(@floor((z - gz0) / cell));
}
fn centreX(ix: i32) f32 {
    return gx0 + (@as(f32, @floatFromInt(ix)) + 0.5) * cell;
}
fn centreZ(iz: i32) f32 {
    return gz0 + (@as(f32, @floatFromInt(iz)) + 0.5) * cell;
}

/// The free intervals of a column. The first call builds them. Null outside
/// the grid. The interval list can move when the audit builds another
/// column: keep indices, not slices.
fn column(ix: i32, iz: i32) !?Col {
    if (ix < 0 or iz < 0 or ix >= nx or iz >= nz) return null;
    const ci = @as(usize, @intCast(iz)) * nx + @as(usize, @intCast(ix));
    if (cols[ci].n != not_built) return cols[ci];

    const x = centreX(ix);
    const z = centreZ(iz);
    const bx: usize = @intFromFloat(@floor((x - gx0) / bucket));
    const bz: usize = @intFromFloat(@floor((z - gz0) / bucket));
    const b = @min(bz, nbz - 1) * nbx + @min(bx, nbx - 1);
    // The feet heights that each solid blocks here: (min - height, max).
    var blk: [512][2]f32 = undefined;
    var n: usize = 0;
    for (bitems[bstart[b]..bstart[b + 1]]) |si| {
        const s = solids.items[si];
        if (x <= s.min[0] - r_test or x >= s.max[0] + r_test or z <= s.min[2] - r_test or z >= s.max[2] + r_test) continue;
        if (n == blk.len) return error.TooManyBoxesInAColumn;
        blk[n] = .{ s.min[1] - player.height, s.max[1] };
        n += 1;
    }
    // A ramp blocks the feet from its bottom up to its surface. The surface
    // top is the highest that a player anywhere in this cell stands at: the
    // real radius plus half a cell each way.
    for (map.ramps[0..map.ramp_count]) |r| {
        if (x - r_test >= r.x1 or x + r_test <= r.x0 or z - r_test >= r.z1 or z + r_test <= r.z0) continue;
        if (n == blk.len) return error.TooManyBoxesInAColumn;
        const reach = player.radius + cell / 2;
        blk[n] = .{ r.bottom - player.height, map.rampTop(r, x - reach, x + reach) };
        n += 1;
    }
    const S = struct {
        fn less(_: void, a: [2]f32, c: [2]f32) bool {
            return a[0] < c[0];
        }
    };
    std.mem.sort([2]f32, blk[0..n], {}, S.less);

    const start: u32 = @intCast(ivs.items.len);
    var lo: f32 = no_floor;
    var i: usize = 0;
    while (i < n) {
        // Join blocked ranges with less than 1 mm between them.
        var hi_b = blk[i][1];
        const lo_b = blk[i][0];
        i += 1;
        while (i < n and blk[i][0] < hi_b + 1e-3) : (i += 1) hi_b = @max(hi_b, blk[i][1]);
        if (lo_b > lo + 1e-3 or lo == no_floor) try addIv(.{ .lo = lo, .hi = lo_b }, ci);
        lo = @max(lo, hi_b);
    }
    try addIv(.{ .lo = lo, .hi = sky }, ci);
    cols[ci] = .{ .start = start, .n = @as(u32, @intCast(ivs.items.len)) - start };
    return cols[ci];
}

fn addIv(iv: Iv, ci: usize) !void {
    try ivs.append(gpa, iv);
    try ivcol.append(gpa, @intCast(ci));
    try flags.append(gpa, 0);
    try parent.append(gpa, none);
    try air_a.append(gpa, no_floor);
    try air_d.append(gpa, sky);
}

// ---- The flood fill --------------------------------------------------------------

/// A standing point that the player can get to: queue it once.
fn visit(q: u32, from: u32) !void {
    if (flags.items[q] & reached != 0) return;
    flags.items[q] |= reached;
    parent.items[q] = from;
    try queue.append(gpa, q);
}

fn addEscape(from: u32, ix: i32, iz: i32) !void {
    if (flags.items[from] & escaped != 0) return;
    flags.items[from] |= escaped;
    const x = centreX(ix);
    const z = centreZ(iz);
    const outside = x < bmin[0] or x > bmax[0] or z < bmin[1] or z > bmax[1];
    try escapes.append(gpa, .{ .from = from, .x = x, .z = z, .outside = outside });
}

const sides = [4][2]i32{ .{ 1, 0 }, .{ -1, 0 }, .{ 0, 1 }, .{ 0, -1 } };

/// Every move from a standing point: into each next column at any height
/// from the floor to the top of a jump, the lift, and the air search from a
/// drop edge.
fn expand(p: u32) !void {
    const iv = ivs.items[p];
    const a = iv.lo;
    const top = @min(iv.hi, a + motion.jump);
    const ci = ivcol.items[p];
    const ix: i32 = @intCast(ci % nx);
    const iz: i32 = @intCast(ci / nx);
    var drop = false;
    for (sides) |o| {
        const jx = ix + o[0];
        const jz = iz + o[1];
        const c = try column(jx, jz) orelse {
            try addEscape(p, jx, jz);
            continue;
        };
        for (0..c.n) |k| {
            const q: u32 = c.start + @as(u32, @intCast(k));
            const j = ivs.items[q];
            if (j.hi < a or j.lo > top) continue;
            if (j.lo == no_floor) {
                try addEscape(p, jx, jz);
                continue;
            }
            if (j.lo < a - drop_min) drop = true;
            try visit(q, p);
        }
    }
    try liftMove(p, ix, iz, a);
    if (drop) {
        drop_edges += 1;
        try airSearch(p);
    }
}

/// A player in a lift cab at one level can get to the other level.
fn liftMove(p: u32, ix: i32, iz: i32, a: f32) !void {
    const x = centreX(ix);
    const z = centreZ(iz);
    for (map.lifts[0..map.lift_count]) |l| {
        const fb = map.boxes[l.floor_box];
        if (x <= fb.min[0] - r_test or x >= fb.max[0] + r_test or z <= fb.min[2] - r_test or z >= fb.max[2] + r_test) continue;
        for (0..2) |lv| {
            if (@abs(a - l.levels[lv]) > 1e-3) continue;
            const c = (try column(ix, iz)).?;
            for (0..c.n) |k| {
                const q: u32 = c.start + @as(u32, @intCast(k));
                if (@abs(ivs.items[q].lo - l.levels[1 - lv]) < 1e-3) try visit(q, p);
            }
        }
    }
}

/// The air search from a drop edge: a shortest-path search over the
/// columns. At a path length d from the take-off, the feet can be at any
/// free height up to the jump envelope at d. Each interval that the search
/// gets to is a place to land.
fn airSearch(p0: u32) !void {
    air_q.clearRetainingCapacity();
    const a0 = ivs.items[p0].lo;
    try air_q.push(gpa, .{ .d = 0, .p = p0 });
    air_a.items[p0] = a0;
    air_d.items[p0] = 0;
    while (air_q.pop()) |s| {
        if (s.d > air_d.items[s.p]) continue;
        const iv = ivs.items[s.p];
        const top = @min(iv.hi, a0 + motion.at(s.d));
        // On the floor here: no air left.
        if (top <= iv.lo + 1e-3) continue;
        // A floor as high as the take-off: a jump from here gets at least as
        // far, so the flood fill takes it from here.
        if (s.p != p0 and iv.lo >= a0) continue;
        const ci = ivcol.items[s.p];
        const ix: i32 = @intCast(ci % nx);
        const iz: i32 = @intCast(ci / nx);
        var dz: i32 = -1;
        while (dz <= 1) : (dz += 1) {
            var dx: i32 = -1;
            while (dx <= 1) : (dx += 1) {
                if (dx == 0 and dz == 0) continue;
                const diag = dx != 0 and dz != 0;
                // A diagonal move goes through one of the two side columns.
                if (diag and !(try passes(ix + dx, iz, iv.lo, top) or try passes(ix, iz + dz, iv.lo, top))) continue;
                const d2 = s.d + if (diag) cell * std.math.sqrt2 else cell;
                const jx = ix + dx;
                const jz = iz + dz;
                const c = try column(jx, jz) orelse {
                    try addEscape(p0, jx, jz);
                    continue;
                };
                for (0..c.n) |k| {
                    const q: u32 = c.start + @as(u32, @intCast(k));
                    const j = ivs.items[q];
                    if (@max(iv.lo, j.lo) > @min(top, j.hi)) continue;
                    if (j.lo == no_floor) {
                        try addEscape(p0, jx, jz);
                        continue;
                    }
                    try visit(q, p0);
                    if (air_a.items[q] >= a0 and air_d.items[q] <= d2) continue;
                    air_a.items[q] = a0;
                    air_d.items[q] = d2;
                    try air_q.push(gpa, .{ .d = d2, .p = q });
                }
            }
        }
    }
}

/// True when a column has free space that overlaps the feet heights lo..hi.
fn passes(ix: i32, iz: i32, lo: f32, hi: f32) !bool {
    const c = try column(ix, iz) orelse return false;
    for (0..c.n) |k| {
        const j = ivs.items[c.start + k];
        if (@max(lo, j.lo) <= @min(hi, j.hi)) return true;
    }
    return false;
}

// ---- The report ----------------------------------------------------------------

/// Group the escapes: take-off points less than 2 m apart are one hole.
/// Print each hole and the route to it. A hole that the player can only get
/// to through an earlier hole says so: fix the earlier hole first. Returns
/// the number of holes.
fn report() !usize {
    var standing: usize = 0;
    for (flags.items, ivs.items) |f, iv| {
        if (f & reached != 0 and iv.lo != no_floor) standing += 1;
    }
    std.debug.print("{d} columns built, {d} standing points, {d} drop edges; jump {d:.3} m, run {d:.2} m/s, a running jump clears {d:.2} m\n", .{
        countBuilt(), standing, drop_edges, motion.jump, motion.speed, flatReach(),
    });

    const Hole = struct { first: usize, n: usize, min: V3, max: V3 };
    var holes: std.ArrayList(Hole) = .empty;
    // The hole of each take-off point.
    var hole_of: std.AutoHashMapUnmanaged(u32, usize) = .empty;
    for (escapes.items, 0..) |e, ei| {
        const pt = point(e.from);
        var joined: ?usize = null;
        for (holes.items, 0..) |*h, hi| {
            if (pt[0] < h.min[0] - 2 or pt[0] > h.max[0] + 2 or pt[2] < h.min[2] - 2 or pt[2] > h.max[2] + 2) continue;
            if (pt[1] < h.min[1] - 2 or pt[1] > h.max[1] + 2) continue;
            h.n += 1;
            h.min = @min(h.min, pt);
            h.max = @max(h.max, pt);
            joined = hi;
            break;
        }
        if (joined == null) {
            joined = holes.items.len;
            try holes.append(gpa, .{ .first = ei, .n = 1, .min = pt, .max = pt });
        }
        try hole_of.put(gpa, e.from, joined.?);
    }
    var after_count: usize = 0;
    for (holes.items, 0..) |h, hi| {
        const e = escapes.items[h.first];
        const pt = point(e.from);
        // The first hole on the route from the spawn, if it is another one.
        var after: ?usize = null;
        var q = parent.items[e.from];
        while (q != none) : (q = parent.items[q]) {
            if (hole_of.get(q)) |k| if (k != hi) {
                after = k;
            };
        }
        var after_buf: [32]u8 = undefined;
        const after_txt = if (after) |k| try std.fmt.bufPrint(&after_buf, " (after hole {d})", .{k + 1}) else "";
        if (after != null) after_count += 1;
        std.debug.print("escape hole {d}{s}: {s} at ({d:.2} {d:.2}), from the floor at ({d:.2} {d:.2} {d:.2})\n", .{
            hi + 1, after_txt, if (e.outside) "outside the map" else "no floor below", e.x, e.z, pt[0], pt[1], pt[2],
        });
        std.debug.print("  {d} take-off points in ({d:.1} {d:.1} {d:.1}) .. ({d:.1} {d:.1} {d:.1})\n", .{
            h.n, h.min[0], h.min[1], h.min[2], h.max[0], h.max[1], h.max[2],
        });
        try printRoute(e.from);
    }
    if (after_count > 0) {
        std.debug.print("{d} escape holes, {d} of them after another hole\n", .{ holes.items.len, after_count });
    } else std.debug.print("{d} escape holes\n", .{holes.items.len});
    return holes.items.len;
}

/// The feet position of a standing point.
fn point(p: u32) V3 {
    const ci = ivcol.items[p];
    const ix: i32 = @intCast(ci % nx);
    const iz: i32 = @intCast(ci / nx);
    return v3(centreX(ix), ivs.items[p].lo, centreZ(iz));
}

/// The route from a spawn point to a standing point: the spawn, the take-off
/// and each move that changes the floor height by more than 0.5 m (the
/// points before and after it). A stair step is less. The last 10 points.
fn printRoute(p: u32) !void {
    var chain: std.ArrayList(u32) = .empty;
    var q = p;
    while (q != none) : (q = parent.items[q]) try chain.append(gpa, q);
    std.mem.reverse(u32, chain.items);
    var keep: std.ArrayList(u32) = .empty;
    for (chain.items, 0..) |c, i| {
        const step = i + 1 < chain.items.len and @abs(ivs.items[chain.items[i + 1]].lo - ivs.items[c].lo) > 0.5;
        const after = i > 0 and @abs(ivs.items[chain.items[i - 1]].lo - ivs.items[c].lo) > 0.5;
        if (i == 0 or i == chain.items.len - 1 or step or after) try keep.append(gpa, c);
    }
    const root = chain.items[0];
    var spawn: usize = 0;
    for (spawn_node, 1..) |s, i| if (s == root) {
        spawn = i;
        break;
    };
    std.debug.print("  route from spawn {d}:", .{spawn});
    const from = if (keep.items.len > 10) keep.items.len - 10 else 0;
    if (from > 0) std.debug.print(" ...", .{});
    for (keep.items[from..], from..) |c, i| {
        const pt = point(c);
        std.debug.print("{s}({d:.1} {d:.1} {d:.1})", .{ if (i == from) " " else " > ", pt[0], pt[1], pt[2] });
    }
    std.debug.print("\n", .{});
}

fn countBuilt() usize {
    var n: usize = 0;
    for (cols) |c| {
        if (c.n != not_built) n += 1;
    }
    return n;
}

/// The horizontal distance of a full-speed jump that lands at the take-off
/// height.
fn flatReach() f32 {
    var k = motion.env.len;
    while (k > 0) {
        k -= 1;
        if (motion.env[k] >= 0) return @as(f32, @floatFromInt(k)) * env_step;
    }
    return 0;
}
