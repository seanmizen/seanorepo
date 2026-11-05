//! Who holds each town square. At the start, a town south of the front
//! line is blue and one north of it is red. After that, a town square goes
//! to the side whose squads are within `reach` of it, when only one side
//! is. A square with both sides near it stays with its holder.
//!
//! The Frontier style reads `towns_held`: the towns make the supply.
const std = @import("std");
const sim = @import("sim.zig");
const map = sim.map;
const Sim = sim.Sim;

pub const reach = 3;
/// Frontier: the supply of each town square that blue holds, a second.
pub const blue_rate = 0.012;
/// Frontier: the supply rate of a red squad, for each red town square.
pub const red_rate = 0.003;

pub fn update(s: *Sim) void {
    s.towns_held = .{ 0, 0 };
    for (0..map.cells) |ci| {
        const c: u16 = @intCast(ci);
        if (s.m.ground[c] != .town) continue;
        if (s.owner[c] == null) s.owner[c] = if (map.cellY(c) > s.setup.front_y) .blue else .red;
        const p = map.centre(c);
        var near = [2]bool{ false, false };
        for (s.units) |u| {
            if (!u.alive or u.kind != .infantry) continue;
            if (@abs(u.x - p[0]) <= reach and @abs(u.y - p[1]) <= reach) near[@backingInt(u.side)] = true;
        }
        if (near[0] and !near[1]) s.owner[c] = .blue;
        if (near[1] and !near[0]) s.owner[c] = .red;
        s.towns_held[@backingInt(s.owner[c].?)] += 1;
    }
}

/// The blue supply rate, a second.
pub fn blueSupplyRate(s: *const Sim) f32 {
    if (!s.rules.town_supply) return s.rules.supply_rate;
    return s.rules.supply_rate + blue_rate * @as(f32, @floatFromInt(s.towns_held[0]));
}

/// The supply that a red squad near the red line gets each half second.
pub fn redSquadSupply(s: *const Sim) f32 {
    if (!s.rules.town_supply) return 0.45;
    return std.math.clamp(red_rate * @as(f32, @floatFromInt(s.towns_held[1])), 0.05, 0.6);
}
