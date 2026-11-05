//! Scripted games for the tests and the preview tool. A plan is a list of
//! player commands at fixed times.
//!   none  push in sector 1, and build nothing.
//!   west  push in sector 1, and build a track through dead ground behind
//!         the push (west_track).
const std = @import("std");
const map = @import("map.zig");
const sim = @import("sim.zig");

pub const Plan = enum { none, west };

/// The dead-ground track: north from the farm lane up the west valley,
/// then east behind the spur of the ridge to the pocket at x 14..18.
pub const west_track = [_][2]i32{
    .{ 10, 26 }, .{ 10, 25 }, .{ 10, 24 }, .{ 10, 23 }, .{ 10, 22 },
    .{ 11, 22 }, .{ 12, 22 }, .{ 13, 22 }, .{ 14, 22 }, .{ 15, 22 },
    .{ 16, 22 },
};

/// The short track: west from the main road at row 21. Red sees most of it,
/// and the road to it.
pub const road_track = [_][2]i32{ .{ 19, 21 }, .{ 18, 21 } };

/// The commands of the plan at the tick.
pub fn commands(plan: Plan, tick: u64, buf: []sim.Command) []const sim.Command {
    var n: usize = 0;
    if (tick == 1) {
        // Push in sector 1 (x 10..19), hold elsewhere.
        buf[n] = .{ .posture = .{ .sector = 1, .posture = .push } };
        n += 1;
        if (plan == .west) for (west_track) |p| {
            buf[n] = .{ .build = .{ .cell = map.idx(p[0], p[1]), .kind = .track } };
            n += 1;
        };
    }
    return buf[0..n];
}

/// Run the plan for `seconds` from the start.
pub fn run(s: *sim.Sim, plan: Plan, seconds: u32) void {
    var buf: [64]sim.Command = undefined;
    var t: u64 = 0;
    while (t < @as(u64, seconds) * sim.tick_hz) : (t += 1) {
        for (commands(plan, s.tick + 1, &buf)) |c| s.apply(c);
        s.step();
    }
}
