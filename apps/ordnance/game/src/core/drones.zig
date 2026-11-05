//! The red drones (the Drone War style). Every `launch_s` seconds a drone
//! takes off from the red line at the best blue vehicle in reach: a moving
//! truck, then a working engineer. Drones do not need red eyes: each one
//! finds its own target. It flies at the target. When it arrives:
//! - On a square with a drone net: the net catches it.
//! - Else it hits: a truck is lost, an engineer takes heavy damage.
//! A drone whose target dies before it arrives takes the next best target,
//! or falls when its battery runs out.
const std = @import("std");
const sim = @import("sim.zig");
const map = sim.map;
const Sim = sim.Sim;
const Unit = sim.Unit;

pub const launch_s = 12;
pub const speed = 1.6;
/// The reach of a drone south of the front line, in squares.
pub const reach = 34;
pub const life_s = 50;
pub const engineer_damage = 60;

fn score(s: *const Sim, u: *const Unit) f32 {
    if (!u.alive or u.side != .blue) return 0;
    if (u.y > @as(f32, @floatFromInt(s.setup.front_y + reach))) return 0;
    return switch (u.kind) {
        .truck => if (u.moving() and !u.busy()) 3 else 0,
        .engineer => if (u.task == .working) 2 else 0,
        .infantry => 0,
    };
}

fn bestTarget(s: *const Sim) ?u8 {
    var pick: ?u8 = null;
    var best: f32 = 0;
    for (&s.units, 0..) |*u, i| {
        // One drone for each target.
        var taken = false;
        for (s.drones) |d| if (d.active and d.target == i) {
            taken = true;
        };
        if (taken) continue;
        const sc = score(s, u);
        if (sc > best) {
            best = sc;
            pick = @intCast(i);
        }
    }
    return pick;
}

/// True when red drones can reach the square: the risk for a truck route.
pub fn inReach(s: *const Sim, c: u16) bool {
    return map.cellY(c) <= s.setup.front_y + reach;
}

pub fn step(s: *Sim) void {
    s.drone_timer -|= 1;
    if (s.drone_timer == 0) {
        s.drone_timer = launch_s * sim.tick_hz;
        if (bestTarget(s)) |t| for (&s.drones) |*d| {
            if (d.active) continue;
            const tu = s.units[t];
            d.* = .{ .active = true, .x = tu.x, .y = @as(f32, @floatFromInt(s.setup.front_y - 6)), .target = t };
            break;
        };
    }
    const dt: f32 = 1.0 / @as(f32, sim.tick_hz);
    for (&s.drones) |*d| {
        if (!d.active) continue;
        if (d.target == sim.none or !s.units[d.target].alive) {
            d.target = bestTarget(s) orelse {
                d.active = false;
                s.addMark(.wreck, d.x, d.y);
                continue;
            };
        }
        const t = &s.units[d.target];
        const dx = t.x - d.x;
        const dy = t.y - d.y;
        const dist = @sqrt(dx * dx + dy * dy);
        if (dist > speed * dt) {
            d.x += dx / dist * speed * dt;
            d.y += dy / dist * speed * dt;
            continue;
        }
        d.active = false;
        if (s.m.net[t.cell()]) {
            // Caught in the net.
            s.addMark(.wreck, d.x, d.y);
            continue;
        }
        s.addMark(.burst, t.x, t.y);
        if (t.kind == .truck) {
            s.stats.trucks_lost += 1;
            s.kill(t);
        } else {
            t.strength -= engineer_damage;
            if (t.strength <= 0) s.kill(t);
        }
    }
}
