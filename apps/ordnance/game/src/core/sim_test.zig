//! The tests of the rules. Most build a small world by hand on a flat map,
//! so they do not change when the map generator changes.
const std = @import("std");
const sim = @import("sim.zig");
const map = sim.map;
const Sim = sim.Sim;

fn newSim() !*Sim {
    return std.testing.allocator.create(Sim);
}

/// A flat map with the depot at (60, 120) and a blue squad at (60, 90) with
/// low supply. Red sees the squares of the straight route (x = 60, y 96 to
/// 112), and a battery stands far north. No posts and no red squads.
fn flatWorld(s: *Sim) u8 {
    s.m.flat(50);
    s.setup = .{ .front_y = 64, .depot = map.idx(60, 120) };
    s.setup.objective[0] = map.idx(60, 10);
    s.setup.objective_n = 1;
    for (&s.setup.batteries) |*b| b.* = .{ 60, 30 };
    s.reset();
    s.fixed_sight = true;
    s.m.way[s.setup.depot] = .road;
    var y: i32 = 96;
    while (y <= 112) : (y += 1) s.seen[map.idx(60, y)] = true;
    const q = s.spawnAt(.blue, .infantry, map.idx(60, 90)).?;
    s.units[q].supply = 20;
    for (0..3) |_| _ = s.spawnAt(.blue, .truck, s.setup.depot);
    return q;
}

fn track(s: *Sim, x0: i32, y0: i32, x1: i32, y1: i32) void {
    var x = x0;
    var y = y0;
    while (true) {
        const c = map.idx(x, y);
        if (s.m.way[c] == .none) s.m.way[c] = .track;
        if (x == x1 and y == y1) break;
        if (x != x1) x += if (x1 > x) 1 else -1 else y += if (y1 > y) 1 else -1;
    }
}

/// The straight route: north from the depot, through the seen squares.
fn openRoute(s: *Sim) void {
    track(s, 60, 119, 60, 91);
}

/// The long route: west, north and east again, out of sight.
fn hiddenRoute(s: *Sim) void {
    track(s, 59, 120, 50, 120);
    track(s, 50, 119, 50, 90);
    track(s, 51, 90, 58, 90);
}

test "the same seed and commands give the same game" {
    var digests: [3]u64 = undefined;
    for (&digests, [_]u32{ 3, 3, 4 }) |*d, seed| {
        const s = try newSim();
        defer std.testing.allocator.destroy(s);
        s.init(seed, .supply_line);
        s.apply(.{ .posture = .{ .sector = 3, .posture = .push } });
        for (0..60 * sim.tick_hz) |_| s.step();
        d.* = s.digest();
    }
    try std.testing.expectEqual(digests[0], digests[1]);
    try std.testing.expect(digests[0] != digests[2]);
}

test "a truck takes the long route out of sight" {
    const s = try newSim();
    defer std.testing.allocator.destroy(s);
    _ = flatWorld(s);
    openRoute(s);
    hiddenRoute(s);
    s.route(.truck, s.setup.depot);
    var c = map.idx(58, 90);
    try std.testing.expect(!std.math.isInf(s.scratch.dist[c]));
    var seen_steps: u32 = 0;
    while (s.scratch.prev[c] != sim.routing.none) : (c = s.scratch.prev[c]) {
        if (s.seen[c]) seen_steps += 1;
    }
    try std.testing.expectEqual(@as(u32, 0), seen_steps);
}

const Outcome = struct { lost: u32, delivered: f32, supplied_s: u32 };

fn supplyRun(hidden: bool) !Outcome {
    const s = try newSim();
    defer std.testing.allocator.destroy(s);
    const q = flatWorld(s);
    if (hidden) hiddenRoute(s) else openRoute(s);
    var supplied: u32 = 0;
    for (0..300 * sim.tick_hz) |_| {
        s.step();
        if (s.units[q].alive and s.units[q].supply > 0) supplied += 1;
    }
    return .{ .lost = s.stats.trucks_lost, .delivered = s.stats.supply_delivered, .supplied_s = supplied / sim.tick_hz };
}

test "a route out of sight keeps the trucks alive and the squad supplied" {
    const open = try supplyRun(false);
    const hidden = try supplyRun(true);
    try std.testing.expect(open.lost > 0);
    try std.testing.expectEqual(@as(u32, 0), hidden.lost);
    try std.testing.expect(hidden.delivered > open.delivered);
    try std.testing.expect(hidden.supplied_s >= open.supplied_s);
}

test "an engineer builds a track and cuts the hedge" {
    const s = try newSim();
    defer std.testing.allocator.destroy(s);
    _ = flatWorld(s);
    const e = s.spawnAt(.blue, .engineer, s.setup.depot).?;
    _ = e;
    const c = map.idx(60, 119);
    s.m.hedge_s[c] = true;
    s.apply(.{ .build = .{ .cell = c, .kind = .track } });
    for (0..30 * sim.tick_hz) |_| s.step();
    try std.testing.expectEqual(map.Way.track, s.m.way[c]);
    try std.testing.expect(!s.m.hedge_s[c]);
}

test "the generated game starts with the blue squads in reach of a way" {
    const s = try newSim();
    defer std.testing.allocator.destroy(s);
    s.init(1, .supply_line);
    var cut: u32 = 0;
    for (s.units, 0..) |u, i| {
        if (!u.alive or u.side != .blue or u.kind != .infantry) continue;
        if (@import("logistics.zig").cutOff(s, @intCast(i))) cut += 1;
    }
    try std.testing.expect(cut <= 2);
}
