//! The tests of the rules: sight, determinism, routes and the supply loop.
const std = @import("std");
const map = @import("map.zig");
const sim = @import("sim.zig");
const scenario = @import("scenario.zig");

fn newSim() !*sim.Sim {
    const s = try std.testing.allocator.create(sim.Sim);
    s.init();
    return s;
}

fn build(s: *sim.Sim, cells: []const [2]i32) void {
    for (cells) |p| {
        const c = map.idx(p[0], p[1]);
        s.m.way[c] = .track;
        s.m.cutHedges(c);
    }
}

test "red sees the main road, and a hidden path goes to the pocket" {
    const s = try newSim();
    defer std.testing.allocator.destroy(s);
    try std.testing.expect(s.seen[map.idx(20, 15)]);
    try std.testing.expect(s.seen[map.idx(21, 24)]);
    var path: [scenario.max_track][2]i32 = undefined;
    try std.testing.expect(scenario.hiddenPath(s, scenario.hidden_from, scenario.hidden_to, &path) != null);
    // The blue squads start out of sight.
    for (s.units) |u| if (u.alive and u.side == .blue) try std.testing.expect(!s.seen[u.cell()]);
}

test "the same commands give the same game" {
    var digests: [3]u64 = undefined;
    for (&digests, [_]scenario.Plan{ .west, .west, .none }) |*d, plan| {
        const s = try newSim();
        defer std.testing.allocator.destroy(s);
        scenario.run(s, plan, 150);
        d.* = s.digest();
    }
    try std.testing.expectEqual(digests[0], digests[1]);
    try std.testing.expect(digests[0] != digests[2]);
}

test "a truck takes the dead ground when the open route is shorter" {
    const s = try newSim();
    defer std.testing.allocator.destroy(s);
    var path: [scenario.max_track][2]i32 = undefined;
    build(s, scenario.hiddenPath(s, scenario.hidden_from, scenario.hidden_to, &path).?);
    build(s, &scenario.road_track);
    s.route(.truck, map.idx(map.depot[0], map.depot[1]));
    // Two routes reach the pocket. The cheaper one must not cross a seen
    // square after the farm lane.
    var c = map.idx(scenario.hidden_to[0], scenario.hidden_to[1]);
    try std.testing.expect(!std.math.isInf(s.dist[c]));
    var seen_steps: u32 = 0;
    while (s.prev[c] != std.math.maxInt(u16)) : (c = s.prev[c]) {
        if (s.seen[c]) seen_steps += 1;
    }
    try std.testing.expectEqual(@as(u32, 0), seen_steps);
}

const Outcome = struct { lost: u32, delivered: f32, supplied_s: u32 };

/// A blue squad holds at (16, 20) in the pocket, with low supply. Only one
/// track goes there. Run 5 minutes with all sectors on hold.
fn supplyRun(track: []const [2]i32) !Outcome {
    const s = try newSim();
    defer std.testing.allocator.destroy(s);
    build(s, track);
    const q = &s.units[3];
    try std.testing.expect(q.alive and q.kind == .infantry);
    q.x = 16.5;
    q.y = 20.5;
    q.supply = 20;
    var supplied: u32 = 0;
    for (0..300 * sim.tick_hz) |_| {
        s.step();
        if (q.alive and q.supply > 0) supplied += 1;
    }
    return .{ .lost = s.stats.trucks_lost, .delivered = s.stats.supply_delivered, .supplied_s = supplied / sim.tick_hz };
}

test "a track in dead ground keeps the trucks alive and the squad supplied" {
    const open = try supplyRun(&scenario.road_track);
    const s = try newSim();
    defer std.testing.allocator.destroy(s);
    var path: [scenario.max_track][2]i32 = undefined;
    const hidden = try supplyRun(scenario.hiddenPath(s, scenario.hidden_from, scenario.hidden_to, &path).?);
    try std.testing.expect(hidden.lost < open.lost);
    try std.testing.expect(hidden.delivered > open.delivered);
    try std.testing.expect(hidden.supplied_s > open.supplied_s);
}
