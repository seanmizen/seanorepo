//! The squads of both sides: fire, supply use, and one step at a time by
//! the posture of their sector. The red commander sets the red postures by
//! the same three postures that the player uses.
//!
//! Manoeuvre style: a blue sector with an objective square routes its
//! squads there through dead ground (a cost field from the objective), and
//! the squads move in bounds: half move while half cover.
//! Blitz style: red attacks in waves, with new squads from the north.
const std = @import("std");
const sim = @import("sim.zig");
const map = sim.map;
const Sim = sim.Sim;
const Unit = sim.Unit;
const towns = @import("towns.zig");

/// The home line of each side, in squares from the front line: a squad
/// that falls back stops there.
pub const home_depth = 6;

fn forward(side: sim.Side) i32 {
    return if (side == .blue) -1 else 1;
}

fn nearestEnemy(s: *const Sim, u: *const Unit, r: f32) ?u8 {
    var best: ?u8 = null;
    var best_d = r * r;
    for (s.units, 0..) |v, i| {
        if (!v.alive or v.side == u.side or v.kind != .infantry) continue;
        const dx = v.x - u.x;
        const dy = v.y - u.y;
        const d = dx * dx + dy * dy;
        if (d <= best_d) {
            best_d = d;
            best = @intCast(i);
        }
    }
    return best;
}

/// The red supply comes from off the map at a fixed rate. It reaches only
/// the squads near the red side of the line.
fn redSupply(s: *const Sim, u: *Unit) void {
    if (u.y < @as(f32, @floatFromInt(s.setup.front_y + 4))) u.supply = @min(100, u.supply + towns.redSquadSupply(s));
}

/// Each squad near an enemy squad fires at the nearest one. All damage
/// lands at the same time.
pub fn fight(s: *Sim) void {
    var damage: [sim.max_units]f32 = @splat(0);
    for (&s.units) |*u| {
        if (!u.alive or u.kind != .infantry) continue;
        const target = nearestEnemy(s, u, s.rules.fire_range);
        u.engaged = target != null;
        const t = target orelse {
            u.supply = @max(0, u.supply - 0.25);
            if (u.supply > 50 and u.strength < 100) {
                u.strength = @min(100, u.strength + 0.5);
                u.supply -= 0.3;
            }
            if (u.side == .red) redSupply(s, u);
            continue;
        };
        const fire: f32 = if (u.supply > 0) 1 else 0.25;
        const tu = &s.units[t];
        damage[t] += 2 * (u.strength / 100) * fire * s.coverFactor(tu.cell());
        // A burst of fire, for the renderer. Spread so the tracers do not
        // all hit the same point.
        const k: f32 = @floatFromInt((s.tick / sim.decide_ticks + t) % 5);
        s.addShot(.{ u.x, u.y }, .{ tu.x + (k - 2) * 0.08, tu.y + (2 - k) * 0.06 }, u.side, false);
        u.supply = @max(0, u.supply - 1.5);
        if (u.side == .red) redSupply(s, u);
    }
    for (&s.units, 0..) |*u, i| {
        if (damage[i] == 0) continue;
        u.strength -= damage[i];
        if (u.strength <= 0) s.kill(u);
    }
}

fn occupied(s: *const Sim, c: u16) bool {
    for (s.units) |u| {
        if (!u.alive or u.kind != .infantry) continue;
        if (u.cell() == c) return true;
        if (u.moving() and u.path[u.path_i] == c) return true;
    }
    return false;
}

/// The square one step from the squad in the direction dy (forward or
/// back). Straight first, then a side step toward the sector centre, then
/// the other side step.
fn stepTarget(s: *const Sim, u: *const Unit, dy: i32) ?u16 {
    const c = u.cell();
    const x = map.cellX(c);
    const y = map.cellY(c);
    const centre = @as(i32, Sim.sectorOf(u.x)) * sim.sector_w + sim.sector_w / 2;
    const side: i32 = if (x < centre) 1 else -1;
    const options = [_][2]i32{ .{ x, y + dy }, .{ x + side, y }, .{ x - side, y } };
    for (options, 0..) |o, i| {
        if (!map.inside(o[0], o[1])) continue;
        const n = map.idx(o[0], o[1]);
        if (s.speed(.infantry, c, n) == 0) continue;
        if (occupied(s, n)) continue;
        // A side step only when the straight step is not possible, and
        // only when the square past it is open.
        if (i > 0) {
            const fy = o[1] + dy;
            if (!map.inside(o[0], fy)) continue;
            const f = map.idx(o[0], fy);
            if (s.m.ground[f] == .water and s.m.way[f] == .none) continue;
        }
        return n;
    }
    return null;
}

/// Each squad that stands still picks its next step.
pub fn decide(s: *Sim) void {
    const front = s.setup.front_y;
    for (&s.units) |*u| {
        if (!u.alive or u.kind != .infantry or u.moving()) continue;
        const fwd = forward(u.side);
        const y = map.cellY(u.cell());
        const home_ok = if (u.side == .blue) y >= front + home_depth else y <= front - home_depth;
        const posture = s.posture[@backingInt(u.side)][Sim.sectorOf(u.x)];
        var dir: i32 = 0;
        if (u.strength < 25 or u.supply < 5) {
            if (!home_ok) dir = -fwd;
        } else if (u.engaged) {
            dir = 0;
        } else switch (posture) {
            .push => if (u.supply >= 40 and u.strength >= 50) {
                dir = fwd;
            },
            .hold => {},
            .back => if (!home_ok) {
                dir = -fwd;
            },
        }
        if (dir == fwd and u.side == .blue and s.rules.manoeuvre) {
            const sec = Sim.sectorOf(u.x);
            if (s.goal[sec] != null) {
                manoeuvreStep(s, u, sec);
                continue;
            }
        }
        if (dir == 0) continue;
        const target = stepTarget(s, u, dir) orelse continue;
        u.path[0] = target;
        u.path_len = 1;
        u.path_i = 0;
    }
}

/// The cost for a squad to step into square b, in seconds. A square that
/// red sees costs much more: the route keeps to dead ground.
const CoverCost = struct {
    s: *const Sim,
    pub fn cost(c: CoverCost, a: u16, b: u16) f32 {
        const v = c.s.speed(.infantry, a, b);
        if (v == 0) return std.math.inf(f32);
        return 1 / v + (if (c.s.seen[b]) @as(f32, 40) else 0);
    }
};

/// The cost field to the objective of a sector (Sim.goal_field). It is
/// made again when the objective changes, and every 5 s (the sight
/// changes).
fn field(s: *Sim, sec: usize) *const [map.cells]f32 {
    const g = s.goal[sec].?;
    if (s.goal_field_goal[sec] != g or s.tick >= s.goal_field_tick[sec] + 5 * sim.tick_hz) {
        sim.routing.search(&s.scratch, &.{g}, CoverCost{ .s = s }, null);
        s.goal_field[sec] = s.scratch.dist;
        s.goal_field_goal[sec] = g;
        s.goal_field_tick[sec] = s.tick;
    }
    return &s.goal_field[sec];
}

/// One step down the cost field to the objective, in bounds: the squads
/// with an even id move for 20 s, then the odd ones.
fn manoeuvreStep(s: *Sim, u: *Unit, sec: usize) void {
    const id = (@intFromPtr(u) - @intFromPtr(&s.units[0])) / @sizeOf(Unit);
    const phase = (s.tick / (20 * sim.tick_hz)) % 2;
    if (id % 2 != phase) return;
    const f = field(s, sec);
    const c = u.cell();
    if (f[c] < 3) return; // At the objective.
    const x = map.cellX(c);
    const y = map.cellY(c);
    var best: ?u16 = null;
    var best_v = f[c];
    for ([_][2]i32{ .{ 0, -1 }, .{ 1, 0 }, .{ 0, 1 }, .{ -1, 0 } }) |d| {
        if (!map.inside(x + d[0], y + d[1])) continue;
        const nb = map.idx(x + d[0], y + d[1]);
        if (f[nb] < best_v and !occupied(s, nb)) {
            best_v = f[nb];
            best = nb;
        }
    }
    const nb = best orelse return;
    u.path[0] = nb;
    u.path_len = 1;
    u.path_i = 0;
}

/// Both sides: every 60 s, a new squad for a side with fewer than its
/// start squads. A blue squad comes in on the farm lane, a red squad
/// behind the red line, in the sector with the fewest squads of that side.
pub fn reinforce(s: *Sim) void {
    if (s.tick % (60 * sim.tick_hz) != 0) return;
    for ([_]sim.Side{ .blue, .red }) |side| {
        var count: [sim.sectors]u32 = @splat(0);
        var total: u32 = 0;
        for (s.units) |u| if (u.alive and u.kind == .infantry and u.side == side) {
            count[Sim.sectorOf(u.x)] += 1;
            total += 1;
        };
        const start = if (side == .blue) s.setup.blue_n else s.setup.red_n;
        if (total >= start) continue;
        var sec: usize = 0;
        for (count, 0..) |c, i| if (c < count[sec]) {
            sec = i;
        };
        const x: i32 = @intCast(sec * sim.sector_w + sim.sector_w / 2);
        const y: i32 = if (side == .blue) s.setup.front_y + 8 else s.setup.front_y - 8;
        var dx: i32 = 0;
        while (dx < sim.sector_w / 2) : (dx += 1) {
            const c = map.idx(x + dx, y);
            if (s.m.ground[c] == .water) continue;
            _ = s.spawnAt(side, .infantry, c);
            break;
        }
    }
}

/// Blitz: every 90 s a wave. New red squads come in from the north, and
/// red pushes in every sector for 40 s.
pub fn waves(s: *Sim) void {
    s.wave_timer -|= 1;
    if (s.wave_timer > 0) return;
    s.wave += 1;
    s.wave_timer = 90 * sim.tick_hz;
    const count = @min(4 + s.wave * 2, 12);
    const y = s.setup.front_y - 16;
    for (0..count) |k| {
        const x: i32 = @intCast((k * 37 + s.wave * 11) % (map.size - 8) + 4);
        var c = map.idx(x, y);
        var tries: i32 = 0;
        while (s.m.ground[c] == .water and tries < 8) : (tries += 1) c = map.idx(x + tries, y);
        _ = s.spawnAt(.red, .infantry, c);
    }
    for (&s.posture[@backingInt(sim.Side.red)]) |*p| p.* = .push;
}

/// The red commander. For each sector: fall back when the supply is low,
/// push when red is stronger, else hold. In a Blitz wave, red pushes.
pub fn redCommander(s: *Sim) void {
    if (s.rules.waves and s.wave > 0 and s.wave_timer > 50 * sim.tick_hz) return;
    for (0..sim.sectors) |sec| {
        var red_str: f32 = 0;
        var red_sup: f32 = 0;
        var red_n: f32 = 0;
        var blue_str: f32 = 0;
        for (s.units) |u| {
            if (!u.alive or u.kind != .infantry or Sim.sectorOf(u.x) != sec) continue;
            if (u.side == .red) {
                red_str += u.strength;
                red_sup += u.supply;
                red_n += 1;
            } else blue_str += u.strength;
        }
        const p = &s.posture[@backingInt(sim.Side.red)][sec];
        if (red_n == 0) {
            p.* = .hold;
        } else if (red_sup / red_n < 20) {
            p.* = .back;
        } else if (red_str > 1.1 * blue_str + 30 and red_sup / red_n > 40) {
            p.* = .push;
        } else p.* = .hold;
    }
}
