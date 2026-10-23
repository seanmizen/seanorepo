// The practice range: human dummies behind the waist-high walls south of
// the arena (maps/arena.zig range_dummies).
//
// - A dummy is a player: the player model (body.zig), the player
//   hit boxes and the player lean (player.zig). Thus a hit on a dummy does
//   the same damage as the same hit on a player in deathmatch.
// - A dead dummy falls over, and after 1 s it stands up again at its place
//   with full health. A dummy that gets no hit for 4 s heals to full.
// - One dummy walks side to side. One dummy stands behind a pillar and
//   leans out past its edge and back, at random times.
//
// Also the HUD parts: the damage numbers near the crosshair, and the health
// bar that shows over each dummy (and over each deathmatch player on the
// debug screen).
const std = @import("std");
const gfx = @import("sw_gfx2d");
const sw_text = @import("sw_text");
const vec = @import("vec.zig");
const player = @import("player.zig");
const arena = @import("maps/arena.zig");
const V3 = vec.V3;
const v3 = vec.v3;

pub const max_hp: f32 = 100;
/// The time from a death to the respawn.
const respawn_time: f32 = 1.0;
/// A dummy that gets no hit for this long heals to full.
const heal_time: f32 = 4.0;
/// The walk: radians a second of the side-to-side cycle. The top speed is
/// `walk * walk_rate` (3 m/s for a walk of 2.75 m).
const walk_rate: f32 = 1.1;

pub const Dummy = struct {
    place: arena.Dummy,
    home: V3,
    /// The position, the facing, the lean and the walked distance.
    body: player.Player,
    hp: f32 = max_hp,
    /// The health bar shows the health that a hit took in white for a
    /// moment. Then the white part shrinks to hp.
    trail: f32 = max_hp,
    alive: bool = true,
    /// 0 upright. It rises to 1 while a dead dummy falls over.
    fall: f32 = 0,
    /// The time since the last hit or the death.
    since: f32 = 0,
    /// The walk cycle, in radians.
    phase: f32 = 0,
    /// The peek: the lean that the dummy wants (0 or place.peek), and the
    /// time to the next change.
    peek_want: f32 = 0,
    peek_t: f32 = 0,

    pub fn hitBoxes(self: *const Dummy) [3]player.HitBox {
        return player.hitBoxes(self.body.pos, self.body.yaw, self.body.lean);
    }

    pub fn blastPoints(self: *const Dummy) [3]V3 {
        return player.blastPoints(self.body.pos, self.body.yaw, self.body.lean);
    }
};

pub var dummies: [arena.range_dummies.len]Dummy = undefined;

/// The yaw that faces the practice spawn from p. Yaw 0 looks to -Z.
fn facing(p: V3) f32 {
    const s = arena.range_spawn.pos;
    return std.math.atan2(p[0] - s[0], p[2] - s[2]);
}

fn place(d: *Dummy, pl: arena.Dummy) void {
    const home = arena.dummyHome(pl);
    d.* = .{ .place = pl, .home = home, .body = .{ .pos = home, .yaw = facing(home), .grounded = true }, .peek_t = 1.5 };
}

/// Put every dummy at its place with full health, and clear the damage
/// numbers.
pub fn reset() void {
    for (&dummies, arena.range_dummies) |*d, pl| place(d, pl);
    pop_n = 0;
    streak = .{};
}

pub fn step(dt: f32, rnd: std.Random) void {
    for (&dummies) |*d| {
        d.since += dt;
        if (!d.alive) {
            d.fall = @min(1, d.fall + dt * 3);
            if (d.since >= respawn_time) place(d, d.place);
            continue;
        }
        if (d.since > heal_time) d.hp = max_hp;
        // The white part of the bar waits a moment, then shrinks.
        if (d.since > 0.35) d.trail = @max(d.hp, d.trail - dt * 150);
        if (d.trail < d.hp) d.trail = d.hp;
        if (d.place.walk > 0) {
            d.phase += dt * walk_rate;
            const before = d.body.pos;
            d.body.pos[0] = d.home[0] + d.place.walk * @sin(d.phase);
            d.body.stride += @abs(d.body.pos[0] - before[0]);
            // The legs walk at this speed (body.zig).
            d.body.vel = v3((d.body.pos[0] - before[0]) / dt, 0, 0);
            d.body.yaw = facing(d.body.pos);
        }
        if (d.place.peek != 0) {
            d.peek_t -= dt;
            if (d.peek_t <= 0) {
                // Out for 0.7 to 2 s, then back for 1.2 to 3.5 s.
                const out = d.peek_want == 0;
                d.peek_want = if (out) d.place.peek else 0;
                d.peek_t = if (out) 0.7 + rnd.float(f32) * 1.3 else 1.2 + rnd.float(f32) * 2.3;
            }
            // The player lean: the same speed, and a wall stops the head.
            d.body.updateLean(dt, d.peek_want);
        }
    }
    stepNumbers(dt);
}

pub const Hit = struct { idx: usize, t: f32, head: bool };

/// The nearest live dummy on a ray: its hit boxes, as for a player
/// (main.zig rayRemotes).
pub fn ray(o: V3, d: V3) ?Hit {
    var best: ?Hit = null;
    for (&dummies, 0..) |*dm, i| {
        if (!dm.alive) continue;
        for (dm.hitBoxes(), 0..) |b, k| {
            const h = @import("map.zig").rayBox(o, d, b.min, b.max) orelse continue;
            if (best == null or h.t < best.?.t) best = .{ .idx = i, .t = h.t, .head = k == 2 };
        }
    }
    return best;
}

/// Damage a dummy: `body` and `head` are the damage of one shot (all its
/// pellets) to the body and to the head. The damage numbers show each part.
/// Returns true when the shot kills the dummy.
pub fn hit(i: usize, body: f32, head: f32) bool {
    const d = &dummies[i];
    if (!d.alive) return false;
    d.trail = @max(d.trail, d.hp);
    d.hp -= body + head;
    d.since = 0;
    const killed = d.hp <= 0;
    if (killed) {
        d.hp = 0;
        d.alive = false;
    }
    if (head > 0) addNumber(head, true, killed and body == 0);
    if (body > 0) addNumber(body, false, killed);
    if (streak.quiet > streak_gap) streak = .{};
    streak.total += body + head;
    streak.hits += 1;
    streak.quiet = 0;
    return killed;
}

// ---- The damage numbers ------------------------------------------------------
// Near the crosshair, to the right. The newest number is at the bottom and
// the older ones move up, so a fast series of hits stays readable. Under
// the crosshair, the total of the series shows.

const Number = struct { dmg: f32, head: bool, kill: bool, age: f32 = 0, y: f32 = 0 };
const number_life: f32 = 1.3;
const max_numbers = 6;
/// The newest first.
var pops: [max_numbers]Number = undefined;
var pop_n: usize = 0;
/// A series of hits with gaps shorter than streak_gap.
const streak_gap: f32 = 1.0;
var streak: struct { total: f32 = 0, hits: u32 = 0, quiet: f32 = 100 } = .{};

fn addNumber(dmg: f32, head: bool, kill: bool) void {
    var k = @min(pop_n, max_numbers - 1);
    while (k > 0) : (k -= 1) pops[k] = pops[k - 1];
    pops[0] = .{ .dmg = dmg, .head = head, .kill = kill };
    pop_n = @min(pop_n + 1, max_numbers);
}

fn stepNumbers(dt: f32) void {
    streak.quiet += dt;
    var n: usize = 0;
    for (pops[0..pop_n], 0..) |*p, slot| {
        p.age += dt;
        // Each number eases to the place of its slot.
        const target = @as(f32, @floatFromInt(slot)) * 24;
        p.y += (target - p.y) * @min(1, dt * 18);
        if (p.age < number_life) n = slot + 1;
    }
    pop_n = n;
}

/// "50", or "27.5" for a damage that is not whole.
fn damageText(buf: []u8, dmg: f32) []const u8 {
    const whole = @abs(dmg - @round(dmg)) < 0.05;
    return (if (whole) std.fmt.bufPrint(buf, "{d:.0}", .{dmg}) else std.fmt.bufPrint(buf, "{d:.1}", .{dmg})) catch "";
}

/// Text with a dark shadow, so it reads on the sky and on a bright wall.
fn shadowed(r: *gfx.Renderer, t: *sw_text.TextRenderer, s: []const u8, x: f32, y: f32, size: f32, col: gfx.Color) void {
    _ = t.draw(r, s, x + 1.5, y + 1.5, .{ .size = size, .color = .{ .r = 0, .g = 0, .b = 0, .a = 0.6 * col.a } }) catch {};
    _ = t.draw(r, s, x, y, .{ .size = size, .color = col }) catch {};
}

/// The damage numbers, at the crosshair (cx, cy). A body hit is red, a head
/// hit is gold, larger, and says HEAD. The hit that kills says KILL.
pub fn drawNumbers(r: *gfx.Renderer, t: *sw_text.TextRenderer, cx: f32, cy: f32) void {
    var buf: [32]u8 = undefined;
    var num: [16]u8 = undefined;
    for (pops[0..pop_n]) |p| {
        const a = vec.clamp01((number_life - p.age) / 0.4);
        const size: f32 = if (p.head) 24 else 20;
        const col = if (p.head) gfx.Color{ .r = 1, .g = 0.82, .b = 0.25, .a = a } else gfx.Color{ .r = 0.95, .g = 0.25, .b = 0.2, .a = a };
        const s = std.fmt.bufPrint(&buf, "-{s}{s}{s}", .{
            damageText(&num, p.dmg), if (p.head) " HEAD" else "", if (p.kill) " KILL" else "",
        }) catch "";
        // A new number floats up a little as it fades.
        shadowed(r, t, s, cx + 26, cy - 40 - p.y - p.age * 12, size, col);
    }
    if (streak.hits >= 2 and streak.quiet < streak_gap + 0.6) {
        const a = vec.clamp01((streak_gap + 0.6 - streak.quiet) / 0.4);
        const s = std.fmt.bufPrint(&buf, "TOTAL -{s}  ({d} hits)", .{ damageText(&num, streak.total), streak.hits }) catch "";
        shadowed(r, t, s, cx + 26, cy + 14, 14, .{ .r = 1, .g = 1, .b = 1, .a = 0.9 * a });
    }
}

// ---- The health bar ----------------------------------------------------------

/// The size on the screen of a health bar with its text.
pub const bar_w: f32 = 52;
pub const bar_h: f32 = 25;

/// A health bar with its bottom centre at (x, y): a fixed size on the
/// screen, so it reads at any range. Above it, the health and the distance
/// in metres. The part from hp to trail shows in white (the last hit).
pub fn drawBar(r: *gfx.Renderer, t: *sw_text.TextRenderer, x: f32, y: f32, hp: f32, trail: f32, dist: f32) !void {
    const bw = bar_w;
    const bh: f32 = 6;
    const x0 = @round(x - bw / 2);
    const y0 = @round(y - bh);
    const k = vec.clamp01(hp / max_hp);
    const kt = vec.clamp01(trail / max_hp);
    try r.fillRect(.{ .x = x0 - 1, .y = y0 - 1, .w = bw + 2, .h = bh + 2 }, gfx.Color.rgba8(0, 0, 0, 170));
    if (kt > k) try r.fillRect(.{ .x = x0 + bw * k, .y = y0, .w = bw * (kt - k), .h = bh }, gfx.Color.rgba8(255, 255, 255, 220));
    const col = if (k > 0.5) gfx.Color.rgba8(90, 220, 110, 255) else if (k > 0.25) gfx.Color.rgba8(240, 200, 60, 255) else gfx.Color.rgba8(235, 70, 55, 255);
    try r.fillRect(.{ .x = x0, .y = y0, .w = bw * k, .h = bh }, col);
    var buf: [16]u8 = undefined;
    const white = gfx.Color.rgba8(245, 240, 232, 255);
    shadowed(r, t, std.fmt.bufPrint(&buf, "{d:.0}", .{@ceil(@max(0, hp))}) catch "", x0, y0 - 17, 12, white);
    const ds = std.fmt.bufPrint(&buf, "{d:.0} m", .{dist}) catch "";
    shadowed(r, t, ds, x0 + bw - t.measure(ds, 12).w, y0 - 17, 12, gfx.Color.rgba8(245, 240, 232, 170));
}
