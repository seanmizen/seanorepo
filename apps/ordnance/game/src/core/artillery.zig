//! The guns.
//! - The red artillery (when the style has it). Each battery fires at the
//!   blue unit that red sees with the highest priority: a moving truck,
//!   then a working engineer, then an engineer, then a standing truck, then
//!   a squad that is not in a fight. It aims where the target will be when
//!   the shell lands, along its path.
//! - The blue mortars (when the style has them): every 12 s, a round on the
//!   red squad that blue sees nearest to a blue squad. A squad in a fight
//!   first.
const std = @import("std");
const sim = @import("sim.zig");
const map = sim.map;
const Sim = sim.Sim;
const Unit = sim.Unit;

pub const flight_s = 4;
pub const reload_s = 9;
pub const radius = 0.75;
pub const truck_damage = 100;
pub const unit_damage = 12;

fn priority(u: *const Unit) f32 {
    return switch (u.kind) {
        .truck => if (u.moving() and !u.busy()) 3 else 1.5,
        .engineer => if (u.task == .working) 2.5 else 2,
        .infantry => 1,
    };
}

/// Where the unit will be after `seconds`, along its path.
fn lead(s: *const Sim, u: *const Unit, seconds: f32) [2]f32 {
    var x = u.x;
    var y = u.y;
    if (u.busy()) return .{ x, y };
    var left = seconds;
    var i = u.path_i;
    var from = u.cell();
    while (i < u.path_len and left > 0) : (i += 1) {
        const nxt = u.path[i];
        const t = map.centre(nxt);
        const v = @max(s.speed(u.kind, from, nxt), 0.05);
        const d = @sqrt((t[0] - x) * (t[0] - x) + (t[1] - y) * (t[1] - y));
        if (d / v > left) {
            x += (t[0] - x) / d * v * left;
            y += (t[1] - y) / d * v * left;
            break;
        }
        left -= d / v;
        x = t[0];
        y = t[1];
        from = nxt;
    }
    return .{ x, y };
}

pub const mortar_reload_s = 12;
pub const mortar_flight_s = 3;
pub const mortar_damage = 15;
pub const mortar_reach = 8;

fn fire(s: *Sim, at: [2]f32, flight: u32, mortar: bool) void {
    for (&s.shells) |*sh| {
        if (sh.active) continue;
        sh.* = .{ .active = true, .mortar = mortar, .x = at[0], .y = at[1], .timer = flight * sim.tick_hz };
        if (!mortar) s.stats.shells += 1;
        return;
    }
}

fn mortars(s: *Sim) void {
    s.mortar_timer -|= 1;
    if (s.mortar_timer > 0) return;
    s.mortar_timer = mortar_reload_s * sim.tick_hz;
    var pick: ?u8 = null;
    var pick_score: f32 = 0;
    for (s.units, 0..) |u, i| {
        if (!u.alive or u.side != .red or u.kind != .infantry or !s.blue_seen[u.cell()]) continue;
        // The distance to the nearest blue squad.
        var near = std.math.inf(f32);
        for (s.units) |b| {
            if (!b.alive or b.side != .blue or b.kind != .infantry) continue;
            near = @min(near, @sqrt((b.x - u.x) * (b.x - u.x) + (b.y - u.y) * (b.y - u.y)));
        }
        if (near > mortar_reach) continue;
        const score = (if (u.engaged) @as(f32, 100) else 0) - near;
        if (pick == null or score > pick_score) {
            pick = @intCast(i);
            pick_score = score;
        }
    }
    const t = &s.units[pick orelse return];
    fire(s, .{ t.x, t.y }, mortar_flight_s, true);
}

pub fn step(s: *Sim) void {
    if (s.rules.mortars) mortars(s);
    if (s.rules.artillery) guns(s);
    land(s);
}

fn guns(s: *Sim) void {
    for (&s.battery_timer) |*bt| {
        bt.* -|= 1;
        if (bt.* > 0) continue;
        bt.* = reload_s * sim.tick_hz;
        var pick: ?u8 = null;
        for (s.units, 0..) |u, i| {
            if (!u.alive or u.side != .blue or !s.seen[u.cell()]) continue;
            // Red does not shell a target near its own squads.
            if (u.kind == .infantry and u.engaged) continue;
            if (pick == null or priority(&u) > priority(&s.units[pick.?])) pick = @intCast(i);
        }
        const t = &s.units[pick orelse continue];
        fire(s, lead(s, t, flight_s), flight_s, false);
    }
}

fn land(s: *Sim) void {
    for (&s.shells) |*sh| {
        if (!sh.active) continue;
        sh.timer -|= 1;
        if (sh.timer > 0) continue;
        sh.active = false;
        s.addMark(.burst, sh.x, sh.y);
        for (&s.units) |*u| {
            if (!u.alive) continue;
            const dx = u.x - sh.x;
            const dy = u.y - sh.y;
            if (dx * dx + dy * dy > radius * radius) continue;
            if (u.kind == .truck and !sh.mortar) {
                s.stats.trucks_lost += 1;
                s.kill(u);
            } else {
                const dmg: f32 = if (sh.mortar) mortar_damage else unit_damage;
                u.strength -= dmg * s.coverFactor(u.cell());
                if (u.strength <= 0) s.kill(u);
            }
        }
    }
}
