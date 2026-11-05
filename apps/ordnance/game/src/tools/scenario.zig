//! Scripted games for the preview tool. A plan is a list of player
//! commands at fixed times.
//!   hold  the player gives no orders.
//!   push  push in each sector from the start.
const std = @import("std");
const sim = @import("../core/sim.zig");

pub const Plan = enum { hold, push };

/// Run the plan for `seconds` from now.
pub fn run(s: *sim.Sim, plan: Plan, seconds: u32) void {
    if (plan == .push and s.tick == 0) {
        for (0..sim.sectors) |k| s.apply(.{ .posture = .{ .sector = @intCast(k), .posture = .push } });
    }
    for (0..@as(u64, seconds) * sim.tick_hz) |_| s.step();
}
