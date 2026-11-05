//! Scripted games for the tests and the preview tool. A plan is a list of
//! player commands at fixed times.
//!   none  push in sector 1, and build nothing.
//!   west  push in sector 1, and build a track through dead ground behind
//!         the push (hiddenPath).
const std = @import("std");
const map = @import("map.zig");
const sim = @import("sim.zig");

pub const Plan = enum { none, west };

/// The ends of the dead-ground track: from the farm lane in the west
/// valley to the pocket behind the spur of the ridge.
pub const hidden_from = [2]i32{ 10, 26 };
pub const hidden_to = [2]i32{ 16, 22 };
pub const max_track = 128;

/// The shortest path of squares from `from` to `to` that red does not see
/// (4 neighbours, no water). The search is on the map, so the path follows
/// any change to the terrain. Null when no such path exists.
pub fn hiddenPath(s: *const sim.Sim, from: [2]i32, to: [2]i32, out: *[max_track][2]i32) ?[]const [2]i32 {
    var prev: [map.cells]u16 = @splat(std.math.maxInt(u16));
    var queue: [map.cells]u16 = undefined;
    const start = map.idx(from[0], from[1]);
    const goal = map.idx(to[0], to[1]);
    if (s.seen[start] or s.seen[goal]) return null;
    var head: usize = 0;
    var tail: usize = 1;
    queue[0] = start;
    prev[start] = start;
    while (head < tail) : (head += 1) {
        const c = queue[head];
        if (c == goal) break;
        const x = map.cellX(c);
        const y = map.cellY(c);
        for ([_][2]i32{ .{ 0, -1 }, .{ 1, 0 }, .{ 0, 1 }, .{ -1, 0 } }) |d| {
            if (!map.inside(x + d[0], y + d[1])) continue;
            const n = map.idx(x + d[0], y + d[1]);
            if (prev[n] != std.math.maxInt(u16) or s.seen[n] or s.m.ground[n] == .water) continue;
            prev[n] = c;
            queue[tail] = n;
            tail += 1;
        }
    }
    if (prev[goal] == std.math.maxInt(u16)) return null;
    var n: usize = 0;
    var c = goal;
    while (true) : (c = prev[c]) {
        if (n == max_track) return null;
        out[n] = .{ map.cellX(c), map.cellY(c) };
        n += 1;
        if (c == start) break;
    }
    std.mem.reverse([2]i32, out[0..n]);
    return out[0..n];
}

/// The short track: west from the main road at row 21. Red sees most of it,
/// and the road to it.
pub const road_track = [_][2]i32{ .{ 19, 21 }, .{ 18, 21 } };

/// The commands of the plan at the tick.
pub fn commands(s: *const sim.Sim, plan: Plan, tick: u64, buf: []sim.Command) []const sim.Command {
    var n: usize = 0;
    if (tick == 1) {
        // Push in sector 1 (x 10..19), hold elsewhere.
        buf[n] = .{ .posture = .{ .sector = 1, .posture = .push } };
        n += 1;
        if (plan == .west) {
            var path: [max_track][2]i32 = undefined;
            if (hiddenPath(s, hidden_from, hidden_to, &path)) |cells| for (cells) |p| {
                if (n == buf.len) break;
                buf[n] = .{ .build = .{ .cell = map.idx(p[0], p[1]), .kind = .track } };
                n += 1;
            };
        }
    }
    return buf[0..n];
}

/// Run the plan for `seconds` from the start.
pub fn run(s: *sim.Sim, plan: Plan, seconds: u32) void {
    var buf: [160]sim.Command = undefined;
    var t: u64 = 0;
    while (t < @as(u64, seconds) * sim.tick_hz) : (t += 1) {
        for (commands(s, plan, s.tick + 1, &buf)) |c| s.apply(c);
        s.step();
    }
}
