// The pigeons of the Earl's Court train shed.
//
// - They sit on the tie rods of the roof (maps/earls_court.zig tieRod), at
//   11.5 m. A perched pigeon bobs its head, looks round, pecks, turns
//   round, shuffles along the rod and coos.
// - A shot that passes near a pigeon, or a shot near it, startles it. The
//   pigeons next to it follow. A startled pigeon drops off the rod and
//   flies off in a random direction. The flight is not a straight line: the
//   turn rate wanders, the pigeon jinks at random, climbs and sinks, and it
//   flaps and glides in turn. Some flights are dumb: the pigeon does not
//   look ahead and flies into a wall or the roof, then flutters on.
// - After some seconds a startled pigeon leaves up through the roof. A
//   pigeon on a joyride (a short flight with no startle) lands on a free
//   place on a tie rod again. Some landings fail, and it goes round again.
// - A hit kills the pigeon. The body is a physics object: it falls, bounces,
//   tumbles and comes to rest on its side. A shot or a kick moves it. F
//   picks it up and F throws it (main.zig).
// - A pigeon that left or died comes back after 60 to 180 s (return_delay).
//   It flies down through the roof near the crown, then lands on a free
//   place on a tie rod (comeBack).
//
// Deathmatch (`net`): the server (server/pigeons.ts) owns the state of each
// pigeon: here, flown off or dead, its perch, and its generation (one more
// at each return). The flights are not sent. Each pigeon has its own random
// numbers (Bird.rng), and a flight uses no other random numbers. So a
// flight is a function of its start (the place, the velocity) and a seed,
// and each client flies the same path.
// - The client that startles or kills a pigeon decides. It acts at once and
//   puts the event in `outbox` (main.zig sends it): "up" (a takeoff or a
//   startle in flight, with its seed), "die" (the body: its place and
//   velocity). The server checks the state and sends the event to the
//   other clients (applyUp, applyDie). A shot of another player does not
//   startle the pigeons of this client: its shooter decides.
// - The server decides the joyrides (applyJoy) and the returns (applyBack),
//   with the seed and the perch. A client in net mode has no timers of its
//   own for these.
// - A body is (bird, gen). A shot, a blast or a kick sends "push": the place
//   and the velocity after the push. A body that comes to rest sends its
//   place once (the client that moved it last). F sends "grab": the client
//   holds the body at once, and the server grants it to the first player
//   only (applyGrab). The others draw a held body in the hand of its holder
//   (carryFor). A throw or a drop sends "drop".
// - Each 10 s the server sends the state of the flock (applyFlock). It
//   corrects a perched or away pigeon that is wrong. On join the same
//   message has the seed (the tints) and the bodies.
//
// The module has no sound, no input and no network. main.zig plays the
// events (events), sends the outbox and calls the startles (shot, noise,
// blast) and the apply functions.
const std = @import("std");
const vec = @import("vec.zig");
const map = @import("map.zig");
const mesh = @import("mesh.zig");
const ec = @import("maps/earls_court.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;

pub const max_birds = 12;
pub const max_corpses = 12;
const max_feathers = 96;
const max_rods = 16;

/// The hit sphere of a perched pigeon, and of a flying one (the wings).
pub const perched_radius: f32 = 0.16;
pub const flying_radius: f32 = 0.22;
/// The half size of the collision box of a flying pigeon.
const fly_half: f32 = 0.07;
/// The half size of the collision box of a body.
pub const corpse_half: f32 = 0.06;
/// The body centre of a perched pigeon above the top of its rod.
pub const perch_lift: f32 = 0.085;
/// No perch nearer than this to the end of a rod, or to another pigeon.
const rod_margin: f32 = 1.2;
const min_gap: f32 = 0.45;
/// A shot path nearer than this startles a pigeon. A shot startles the
/// pigeons within noise_radius of the muzzle.
pub const near_miss: f32 = 4;
pub const noise_radius: f32 = 14;
/// A takeoff startles the perched pigeons within this distance.
const flock_radius: f32 = 5;
pub const gravity: f32 = 9.81;
/// The free space of a flight: inside it the pigeon wanders; out of it, it
/// turns back. The top is under the roof arch (ceilingAt).
const zone_x: f32 = 38;
const zone_z = [2]f32{ -19, 10.5 };
const zone_y0: f32 = 5.6;

pub const State = enum { perched, flying, away };
/// enter: on the way back, down through the roof to `exit`, then land.
pub const Goal = enum { wander, leave, land, enter };
/// The time from a leave or a death to the return, in seconds.
pub const return_delay = [2]f32{ 60, 180 };
/// The perches of a shuffle stay this near (m, along the rod) to the perch.
const shuffle_max: f32 = 0.15;

/// A place on a tie rod: the body centre.
pub const Perch = struct { rod: usize, pos: V3 };

pub const Bird = struct {
    state: State = .away,
    goal: Goal = .wander,
    pos: V3 = v3(0, 0, 0),
    vel: V3 = v3(0, 0, 0),
    /// The facing of the body (vec.forward convention: yaw 0 looks to -Z).
    yaw: f32 = 0,
    pitch: f32 = 0,
    bank: f32 = 0,
    /// The wander heading, its turn rate (rad/s) and the goal of the rate.
    heading: f32 = 0,
    turn: f32 = 0,
    turn_goal: f32 = 0,
    turn_t: f32 = 0,
    /// The phase of a weave about the heading.
    weave: f32 = 0,
    /// The wander height and the time to the next one.
    alt: f32 = 8,
    alt_t: f32 = 0,
    speed: f32 = 6.5,
    /// The wing beat: the phase, and the flap or glide part of the cycle.
    flap: f32 = 0,
    glide: bool = false,
    cycle_t: f32 = 0,
    /// The time in this state, and the length of the flight.
    t: f32 = 0,
    flight_len: f32 = 0,
    /// Away: the time to the return. Perched: the time to the next idle act.
    timer: f32 = 0,
    /// The delay of a startle, or < 0 for none.
    startle: f32 = -1,
    /// After a hit on a wall: a spin and a frantic flap.
    dazed: f32 = 0,
    /// This flight does not look ahead.
    dumb: bool = false,
    /// A short flight with no startle: it lands again, it does not leave.
    joyride: bool = false,
    perch: Perch = .{ .rod = 0, .pos = v3(0, 0, 0) },
    /// Landing: first a point to the side of the perch, then the perch.
    approach: bool = false,
    decided: bool = false,
    misses: u8 = 0,
    /// The exit point over the roof.
    exit: V3 = v3(0, 0, 0),
    /// Perched: the head turn, a peck, a hop (the wings open), the coo.
    head_yaw: f32 = 0,
    head_goal: f32 = 0,
    peck: f32 = 0,
    hop: f32 = 0,
    coo_t: f32 = 0,
    tint: V3 = v3(0.44, 0.47, 0.53),
    /// The random numbers of the flights of this pigeon only. In deathmatch
    /// each flight starts from a seed of the event.
    rng: std.Random.DefaultPrng = .init(0),
    /// One more at each return. A body is (bird, gen).
    gen: u16 = 0,
};

pub const Corpse = struct {
    pos: V3,
    vel: V3,
    /// The yaw, pitch and roll, and their rates.
    rot: V3,
    spin: V3,
    rest: bool = false,
    grounded: bool = false,
    check_t: f32 = 0,
    kick_t: f32 = 0,
    tint: V3,
    /// The pigeon of this body, and its generation: the key in deathmatch.
    bird: u8 = 0,
    gen: u16 = 0,
    /// The id of another player who holds it (deathmatch), or 0.
    holder: u32 = 0,
    /// This client moved it last: it sends the place of rest.
    mine: bool = false,
};

const Feather = struct { p: V3, v: V3, life: f32, age: f32, spin: f32, phase: f32, floor: f32, col: V3 };

/// A sound for main.zig to play at p.
pub const Sound = enum { takeoff, coo, hit, bonk, thud, flutter };
pub const Event = struct { kind: Sound, p: V3 };

pub var birds: [max_birds]Bird = undefined;
pub var bird_n: usize = 0;
pub var corpses: [max_corpses]Corpse = undefined;
pub var corpse_n: usize = 0;
/// The body in the hands of the player (main.zig), or null.
pub var held: ?usize = null;
var feathers: [max_feathers]Feather = undefined;
var feather_n: usize = 0;
pub var events: [32]Event = undefined;
pub var event_n: usize = 0;
/// The tie rods: x, the top of the rod, and the z range for perches.
const Rod = struct { x: f32, y: f32, z0: f32, z1: f32 };
var rods: [max_rods]Rod = undefined;
var rod_n: usize = 0;
/// The time to the next joyride of a perched pigeon.
var joy_t: f32 = 0;
var prng: std.Random.DefaultPrng = .init(1);
/// The seed of the last reset.
pub var seed_now: u64 = 1;

/// Deathmatch: the server owns the state (see the top of the file).
pub var net = false;

/// An event for the server (deathmatch).
pub const NetKind = enum { up, die, push, grab, drop };
pub const NetEvent = struct {
    kind: NetKind,
    bird: usize,
    gen: u16 = 0,
    seed: u32 = 0,
    p: V3 = v3(0, 0, 0),
    v: V3 = v3(0, 0, 0),
};
pub var outbox: [48]NetEvent = undefined;
pub var out_n: usize = 0;

fn netOut(e: NetEvent) void {
    if (!net or out_n == outbox.len) return;
    outbox[out_n] = e;
    out_n += 1;
}

/// The cosmetic random numbers: the idle acts, the feathers, the spin of
/// a body, the startle delays. Never a flight.
fn rf() f32 {
    return prng.random().float(f32);
}

fn newSeed() u32 {
    return prng.random().int(u32);
}

/// The random numbers of a flight (Bird.rng).
fn brf(b: *Bird) f32 {
    return b.rng.random().float(f32);
}

fn brange(b: *Bird, lo: f32, hi: f32) f32 {
    return lo + (hi - lo) * brf(b);
}

fn bsign(b: *Bird) f32 {
    return if (brf(b) < 0.5) -1 else 1;
}

fn range(a: f32, b: f32) f32 {
    return a + (b - a) * rf();
}

fn sign() f32 {
    return if (rf() < 0.5) -1 else 1;
}

fn emit(kind: Sound, p: V3) void {
    if (event_n < events.len) {
        events[event_n] = .{ .kind = kind, .p = p };
        event_n += 1;
    }
}

/// The horizontal direction of a heading (vec.forward with no pitch).
fn dir(h: f32) V3 {
    return v3(-@sin(h), 0, -@cos(h));
}

/// The heading of a direction.
fn headingOf(v: V3) f32 {
    return std.math.atan2(-v[0], -v[2]);
}

fn wrap(a: f32) f32 {
    var x = a;
    while (x > std.math.pi) x -= std.math.tau;
    while (x < -std.math.pi) x += std.math.tau;
    return x;
}

/// Turn h toward `to` by at most `step` rad.
fn turnToward(h: f32, to: f32, max_step: f32) f32 {
    return h + std.math.clamp(wrap(to - h), -max_step, max_step);
}

/// The top of the free space over z: under the roof arch.
pub fn ceilingAt(z: f32) f32 {
    return ec.archY(z) - 0.9;
}

/// True inside the shed, under the roof.
fn underRoof(p: V3) bool {
    return @abs(p[0]) < ec.rib_x[1] + 1 and p[1] < ec.archY(p[2]);
}

/// Put the pigeons on the roof of Earl's Court. Other maps have none.
pub fn reset(seed: u64) void {
    prng = .init(seed);
    seed_now = seed;
    out_n = 0;
    bird_n = 0;
    corpse_n = 0;
    held = null;
    feather_n = 0;
    event_n = 0;
    rod_n = 0;
    if (map.id != .earls_court) return;
    // The end ribs are in the walls of the concourses.
    var x = ec.rib_x[0] + ec.rib_step;
    while (x < ec.rib_x[1] - 0.01 and rod_n < max_rods) : (x += ec.rib_step) {
        const r = ec.tieRod(x);
        rods[rod_n] = .{ .x = x, .y = r[0][1] + ec.tie_half, .z0 = r[0][2] + rod_margin, .z1 = r[1][2] - rod_margin };
        rod_n += 1;
    }
    for (0..max_birds) |i| {
        birds[i] = .{};
        bird_n = i + 1;
        const b = &birds[i];
        b.tint = pickTint();
        b.rng = .init(newSeed());
        b.perch = freePerch(i) orelse continue;
        settle(b);
        b.timer = range(0.5, 4);
        b.coo_t = range(3, 25);
    }
    joy_t = range(10, 30);
}

fn pickTint() V3 {
    const r = rf();
    if (r < 0.1) return v3(0.27, 0.28, 0.32); // dark
    if (r < 0.15) return v3(0.78, 0.76, 0.72); // white
    if (r < 0.2) return v3(0.48, 0.38, 0.31); // brown
    return v3(0.44, 0.47, 0.53) * vec.s(range(0.85, 1.1));
}

/// A free place on a random rod, away from the other pigeons (perched, or
/// landing there). Null when none is found.
fn freePerch(self: usize) ?Perch {
    if (rod_n == 0) return null;
    var tries: usize = 0;
    while (tries < 40) : (tries += 1) {
        const ri = @min(rod_n - 1, @as(usize, @intFromFloat(rf() * @as(f32, @floatFromInt(rod_n)))));
        const r = rods[ri];
        const p = v3(r.x, r.y + perch_lift, range(r.z0, r.z1));
        if (perchFree(self, p)) return .{ .rod = ri, .pos = p };
    }
    return null;
}

fn perchFree(self: usize, p: V3) bool {
    for (birds[0..bird_n], 0..) |o, j| {
        if (j == self) continue;
        const busy = o.state == .perched or (o.state == .flying and (o.goal == .land or o.goal == .enter)) or o.state == .away;
        if (busy and vec.len(o.perch.pos - p) < min_gap) return false;
    }
    return true;
}

/// The number of tie rods: server/pigeons.ts RODS must be the same.
pub fn rodCount() usize {
    return rod_n;
}

/// The perch at `u` (0 to 1) along the free part of rod `rod`: the form of
/// a perch in the messages of the server.
pub fn perchAt(rod: usize, u: f32) ?Perch {
    if (rod_n == 0) return null;
    const ri = @min(rod, rod_n - 1);
    const r = rods[ri];
    return .{ .rod = ri, .pos = v3(r.x, r.y + perch_lift, r.z0 + (r.z1 - r.z0) * std.math.clamp(u, 0, 1)) };
}

/// Sit on the perch, facing along the shed.
fn settle(b: *Bird) void {
    b.state = .perched;
    b.pos = b.perch.pos;
    b.vel = v3(0, 0, 0);
    b.pitch = 0;
    b.bank = 0;
    b.t = 0;
    b.startle = -1;
    b.dazed = 0;
    b.head_yaw = 0;
    b.head_goal = 0;
    b.yaw = if (rf() < 0.5) std.math.pi / 2.0 else -std.math.pi / 2.0;
}

// ---- The startles ---------------------------------------------------------

/// Startle one pigeon after `delay` s: a perched one takes off, a landing
/// one turns away. This client decides: in deathmatch it sends "up".
fn startleBird(b: *Bird, delay: f32) void {
    switch (b.state) {
        .perched => {
            if (b.startle < 0 or delay < b.startle) b.startle = delay;
        },
        .flying => if (b.goal == .land or b.goal == .enter) {
            const sd = newSeed();
            netOut(.{ .kind = .up, .bird = indexOf(b), .seed = sd, .p = b.pos, .v = b.vel });
            b.rng = .init(sd);
            scare(b);
        },
        .away => {},
    }
}

/// A startle in flight: a landing pigeon goes round and then leaves. A
/// pigeon on the way in goes back up through the roof.
fn scare(b: *Bird) void {
    switch (b.goal) {
        .land => {
            b.goal = .wander;
            b.joyride = false;
            b.flight_len = b.t + brange(b, 3, 7);
        },
        .enter => {
            b.goal = .leave;
            b.exit = v3(b.pos[0], ec.archY(b.pos[2]) + 1.5, b.pos[2]);
        },
        .wander, .leave => {},
    }
}

/// The distance from p to the segment a..b.
fn segDistance(p: V3, a: V3, b: V3) f32 {
    const d = b - a;
    const l2 = vec.dot(d, d);
    const k = if (l2 > 1e-6) std.math.clamp(vec.dot(p - a, d) / l2, 0, 1) else 0;
    return vec.len(p - (a + d * vec.s(k)));
}

/// A shot from o whose path ends at e: the pigeons near the path take off
/// at once, the pigeons near the muzzle soon after.
pub fn shot(o: V3, e: V3) void {
    for (birds[0..bird_n]) |*b| {
        if (b.state == .away) continue;
        if (segDistance(b.pos, o, e) < near_miss) {
            startleBird(b, range(0, 0.08));
        } else if (vec.len(b.pos - o) < noise_radius) {
            startleBird(b, range(0.05, 0.35));
        }
    }
}

/// A loud noise at p: the pigeons within `radius` take off.
pub fn noise(p: V3, radius: f32) void {
    for (birds[0..bird_n]) |*b| {
        if (b.state != .away and vec.len(b.pos - p) < radius) startleBird(b, range(0.03, 0.4));
    }
}

/// A grenade blast at p: it kills the pigeons within kill_r, throws the
/// bodies and startles the rest.
pub fn blast(p: V3, kill_r: f32) void {
    for (birds[0..bird_n]) |*b| {
        if (b.state == .away) continue;
        const d = vec.len(b.pos - p);
        if (d < kill_r) kill(b, vec.norm(b.pos - p) * vec.s(1.5));
    }
    for (corpses[0..corpse_n], 0..) |*c, i| {
        if (held == i or c.holder != 0) continue;
        const d = vec.len(c.pos - p);
        if (d < kill_r) {
            const k = 1 - d / kill_r;
            wake(c, vec.norm(c.pos - p) * vec.s(7 * k) + v3(0, 3 * k, 0));
        }
    }
    noise(p, 30);
}

/// Take off from the perch with the flight of `seed`. `follow`: the
/// pigeons near it follow (this client decides them).
fn takeOff(b: *Bird, joyride: bool, seed: u64, follow: bool) void {
    b.rng = .init(seed);
    b.state = .flying;
    b.goal = .wander;
    b.t = 0;
    b.joyride = joyride;
    b.heading = brf(b) * std.math.tau;
    b.turn = 0;
    b.turn_goal = brange(b, -1.2, 1.2);
    b.turn_t = brange(b, 0.3, 1);
    b.weave = brf(b) * std.math.tau;
    b.alt = b.pos[1] - brange(b, 0.5, 4);
    b.alt_t = brange(b, 1, 2.5);
    b.speed = brange(b, 5.8, 7.6);
    b.dumb = brf(b) < 0.25;
    b.flight_len = if (joyride) brange(b, 3, 6) else brange(b, 6, 13);
    // It drops off the rod, then flaps.
    b.vel = dir(b.heading) * vec.s(2.2) + v3(0, -0.6, 0);
    b.flap = 0;
    b.glide = false;
    b.cycle_t = brange(b, 0.9, 1.4);
    b.startle = -1;
    b.dazed = 0;
    b.misses = 0;
    b.decided = false;
    if (!joyride) {
        emit(.takeoff, b.pos);
        // The flock follows.
        if (follow) for (birds[0..bird_n]) |*o| {
            if (o.state == .perched and o.startle < 0 and vec.len(o.pos - b.pos) < flock_radius and rf() < 0.75) o.startle = range(0.12, 0.6);
        };
    } else emit(.flutter, b.pos);
}

/// The way back: from over the roof near its crown, down through the roof
/// to a point under it, then to the perch p. `seed` sets the flight.
fn comeBack(b: *Bird, p: Perch, seed: u64) void {
    b.rng = .init(seed);
    b.state = .flying;
    b.goal = .enter;
    b.t = 0;
    b.joyride = true;
    b.perch = p;
    // Between two ribs (the rods are on the ribs), near the crown.
    const x = std.math.clamp(p.pos[0] + bsign(b) * ec.rib_step / 2, -zone_x, zone_x);
    const z = std.math.clamp(-4.2 + brange(b, -5, 5), zone_z[0], zone_z[1]);
    b.exit = v3(x, ceilingAt(z) - 1.2, z);
    b.pos = v3(x, ec.archY(z) + 2.5, z);
    b.vel = v3(0, -2, 0);
    b.heading = headingOf(p.pos - b.pos);
    b.yaw = b.heading;
    b.pitch = 0;
    b.bank = 0;
    b.speed = brange(b, 5.8, 7.6);
    b.flap = 0;
    b.glide = false;
    b.cycle_t = brange(b, 0.9, 1.4);
    b.turn = 0;
    b.turn_goal = 0;
    b.turn_t = 1;
    b.weave = 0;
    b.alt = b.exit[1];
    b.alt_t = 2;
    b.startle = -1;
    b.dazed = 0;
    b.dumb = false;
    b.misses = 0;
    b.decided = false;
    b.approach = true;
    b.flight_len = 0;
    b.gen +%= 1;
}

/// Go to the perch from wherever the pigeon is.
fn goLand(b: *Bird, p: Perch) void {
    b.goal = .land;
    b.perch = p;
    b.approach = true;
    b.decided = false;
}

// ---- Hits -----------------------------------------------------------------

pub const Hit = struct {
    t: f32,
    /// A live pigeon, or a body.
    bird: ?usize = null,
    corpse: ?usize = null,
};

fn raySphere(o: V3, d: V3, c: V3, r: f32) ?f32 {
    const oc = c - o;
    const tca = vec.dot(oc, d);
    if (tca < 0) return null;
    const d2 = vec.dot(oc, oc) - tca * tca;
    if (d2 > r * r) return null;
    return tca - @sqrt(r * r - d2);
}

/// The first pigeon or body on a ray (d a unit vector), within max_t.
pub fn ray(o: V3, d: V3, max_t: f32) ?Hit {
    var best: ?Hit = null;
    for (birds[0..bird_n], 0..) |b, i| {
        if (b.state == .away) continue;
        const r = if (b.state == .perched) perched_radius else flying_radius;
        if (raySphere(o, d, b.pos, r)) |t| {
            if (t < max_t and (best == null or t < best.?.t)) best = .{ .t = t, .bird = i };
        }
    }
    for (corpses[0..corpse_n], 0..) |c, i| {
        if (held == i or c.holder != 0) continue;
        if (raySphere(o, d, c.pos, 0.14)) |t| {
            if (t < max_t and (best == null or t < best.?.t)) best = .{ .t = t, .bird = null, .corpse = i };
        }
    }
    return best;
}

/// A shot (direction d) hit a pigeon or a body: it kills the pigeon, or
/// it throws the body. Returns true when it killed.
pub fn shoot(h: Hit, d: V3) bool {
    if (h.bird) |i| {
        const b = &birds[i];
        if (b.state == .away) return false;
        kill(b, d * vec.s(2.5));
        return true;
    }
    if (h.corpse) |i| {
        const c = &corpses[i];
        wake(c, d * vec.s(3.5) + v3(0, 1.8, 0));
        addFeathers(c.pos, 4, c.vel * vec.s(0.2), c.tint);
        emit(.hit, c.pos);
    }
    return false;
}

fn kill(b: *Bird, push: V3) void {
    const vel = b.vel * vec.s(0.6) + push + v3(0, 0.8, 0);
    netOut(.{ .kind = .die, .bird = indexOf(b), .gen = b.gen, .p = b.pos, .v = vel });
    const c = addCorpse(b, b.pos, vel);
    if (c) |cc| cc.mine = true;
    addFeathers(b.pos, 14, b.vel * vec.s(0.3), b.tint);
    emit(.hit, b.pos);
    b.state = .away;
    b.timer = range(return_delay[0], return_delay[1]);
    b.startle = -1;
}

/// A new body of pigeon b at p with velocity v. Null when the body is
/// there already (deathmatch: the same bird and generation).
fn addCorpse(b: *const Bird, p: V3, v: V3) ?*Corpse {
    const bi: u8 = @intCast(indexOf(b));
    if (findCorpse(bi, b.gen) != null) return null;
    const c: Corpse = .{
        .pos = p,
        .vel = v,
        .rot = v3(b.yaw, b.pitch, b.bank),
        .spin = v3(range(-6, 6), range(-8, 8), range(-8, 8)),
        .tint = b.tint,
        .bird = bi,
        .gen = b.gen,
    };
    if (corpse_n == max_corpses) {
        // The oldest body goes, unless it is in the hands.
        var drop: usize = 0;
        if (held == 0) drop = 1;
        for (drop + 1..corpse_n) |k| corpses[k - 1] = corpses[k];
        corpse_n -= 1;
        if (held) |h| {
            if (h > drop) held = h - 1;
        }
    }
    corpses[corpse_n] = c;
    corpse_n += 1;
    return &corpses[corpse_n - 1];
}

/// The index of the body of (bird, gen), or null.
fn findCorpse(bird: u8, gen: u16) ?usize {
    for (corpses[0..corpse_n], 0..) |c, i| {
        if (c.bird == bird and c.gen == gen) return i;
    }
    return null;
}

/// A push from this client: in deathmatch it sends the new state.
fn wake(c: *Corpse, dv: V3) void {
    c.vel += dv;
    c.rest = false;
    c.grounded = false;
    c.mine = true;
    c.spin = v3(range(-6, 6), range(-9, 9), range(-9, 9));
    netOut(.{ .kind = .push, .bird = c.bird, .gen = c.gen, .p = c.pos, .v = c.vel });
}

fn addFeathers(p: V3, n: usize, v: V3, tint: V3) void {
    const floor = if (map.raycast(p, v3(0, -1, 0), 60)) |h| p[1] - h.t else -1000;
    for (0..n) |_| {
        const col = if (rf() < 0.3) v3(0.88, 0.88, 0.86) else tint * vec.s(range(0.8, 1.15));
        feathers[feather_n % max_feathers] = .{
            .p = p + v3(range(-0.08, 0.08), range(-0.05, 0.08), range(-0.08, 0.08)),
            .v = v + v3(range(-1.2, 1.2), range(-0.2, 1.4), range(-1.2, 1.2)),
            .life = range(4, 7),
            .age = 0,
            .spin = rf() * std.math.tau,
            .phase = rf() * std.math.tau,
            .floor = floor,
            .col = col,
        };
        feather_n += 1;
    }
}

// ---- Bodies in the hands --------------------------------------------------

/// The body under a ray within reach, for F.
pub fn pick(o: V3, d: V3, reach: f32) ?usize {
    var best: ?usize = null;
    var best_t = reach;
    for (corpses[0..corpse_n], 0..) |c, i| {
        if (held == i or c.holder != 0) continue;
        if (raySphere(o, d, c.pos, 0.25)) |t| {
            if (t < best_t) {
                best_t = t;
                best = i;
            }
        }
    }
    return best;
}

/// Pick up body i. In deathmatch the server grants it (applyGrab).
pub fn grab(i: usize) void {
    if (i >= corpse_n) return;
    held = i;
    corpses[i].rest = false;
    netOut(.{ .kind = .grab, .bird = corpses[i].bird, .gen = corpses[i].gen });
}

/// Carry the held body to `target` (in front of the eye), out of the
/// walls. It hangs by the feet and swings with the move.
pub fn holdAt(eye: V3, target: V3, yaw: f32, dt: f32) void {
    const i = held orelse return;
    carry(&corpses[i], eye, target, yaw, dt);
}

/// Carry the bodies that player `id` holds (deathmatch): the same as
/// holdAt, from the eye of that player.
pub fn carryFor(id: u32, eye: V3, target: V3, yaw: f32, dt: f32) void {
    for (corpses[0..corpse_n]) |*c| {
        if (c.holder == id) carry(c, eye, target, yaw, dt);
    }
}

fn carry(c: *Corpse, eye: V3, target: V3, yaw: f32, dt: f32) void {
    var p = target;
    const to = target - eye;
    const l = vec.len(to);
    if (l > 0.01) if (map.raycast(eye, to / vec.s(l), l + corpse_half)) |h| {
        p = eye + to / vec.s(l) * vec.s(@max(0, h.t - corpse_half - 0.02));
    };
    var v = (p - c.pos) / vec.s(dt);
    if (vec.len(v) > 12) v = vec.norm(v) * vec.s(12);
    c.vel += (v - c.vel) * vec.s(@min(1, dt * 20));
    c.pos = p;
    // Head down; the swing follows the move to the side.
    const side = vec.dot(c.vel, v3(@cos(yaw), 0, -@sin(yaw)));
    c.rot = v3(yaw, -std.math.pi / 2.0, std.math.clamp(-side * 0.08, -0.6, 0.6));
    c.spin = v3(0, 0, 0);
}

/// Let go of the held body with velocity v.
pub fn release(v: V3) void {
    const i = held orelse return;
    held = null;
    const c = &corpses[i];
    c.vel = v;
    c.rest = false;
    c.grounded = false;
    c.mine = true;
    c.spin = v3(range(-3, 3), range(-7, 7), range(-5, 5));
    netOut(.{ .kind = .drop, .bird = c.bird, .gen = c.gen, .p = c.pos, .v = v });
}

/// A player whose feet are at `feet` walks with velocity v: it kicks the
/// bodies at its feet.
pub fn kick(feet: V3, v: V3) void {
    const hs = @sqrt(v[0] * v[0] + v[2] * v[2]);
    if (hs < 1) return;
    for (corpses[0..corpse_n], 0..) |*c, i| {
        if (held == i or c.holder != 0 or c.kick_t > 0) continue;
        const dx = c.pos[0] - feet[0];
        const dz = c.pos[2] - feet[2];
        if (dx * dx + dz * dz > 0.45 * 0.45) continue;
        if (c.pos[1] < feet[1] - 0.2 or c.pos[1] > feet[1] + 0.5) continue;
        c.kick_t = 0.3;
        wake(c, v3(v[0] * 1.1, 1.6, v[2] * 1.1));
        emit(.thud, c.pos);
    }
}

// ---- Deathmatch: the events of the server ----------------------------------

/// Another client startled pigeon i: a takeoff from p, or a startle in
/// flight at p with velocity v. The flight of `seed`.
pub fn applyUp(i: usize, seed: u32, p: V3, v: V3) void {
    if (i >= bird_n) return;
    const b = &birds[i];
    switch (b.state) {
        .perched => {
            b.pos = p;
            b.vel = v;
            takeOff(b, false, seed, false);
        },
        .flying => {
            b.pos = p;
            b.vel = v;
            b.rng = .init(seed);
            scare(b);
        },
        .away => {},
    }
}

/// The server sends pigeon i on a joyride with the flight of `seed`. It
/// lands on perch p. A pigeon that is not on its perch here does not go.
pub fn applyJoy(i: usize, seed: u32, p: Perch) void {
    if (i >= bird_n) return;
    const b = &birds[i];
    if (b.state != .perched or b.startle >= 0) return;
    takeOff(b, true, seed, false);
    b.perch = p;
}

/// The server sends pigeon i back, generation `gen`, to perch p.
pub fn applyBack(i: usize, gen: u16, seed: u32, p: Perch) void {
    if (i >= bird_n) return;
    const b = &birds[i];
    comeBack(b, p, seed);
    b.gen = gen;
}

/// Another client killed pigeon i: its body (generation gen) at p with
/// velocity v.
pub fn applyDie(i: usize, gen: u16, p: V3, v: V3) void {
    if (i >= bird_n) return;
    const b = &birds[i];
    b.gen = gen;
    if (b.state != .away) {
        b.pos = p;
        addFeathers(p, 14, v3(0, 0, 0), b.tint);
        emit(.hit, p);
        b.state = .away;
        b.startle = -1;
    }
    _ = addCorpse(b, p, v);
}

/// Another client moved the body (bird, gen): its place and velocity now.
pub fn applyPush(bird: usize, gen: u16, p: V3, v: V3) void {
    if (bird >= bird_n) return;
    const k = findCorpse(@intCast(bird), gen) orelse blk: {
        // A body that this client does not have (a missed kill).
        const b = &birds[bird];
        const old = b.gen;
        b.gen = gen;
        _ = addCorpse(b, p, v);
        b.gen = old;
        break :blk findCorpse(@intCast(bird), gen) orelse return;
    };
    if (held == k or corpses[k].holder != 0) return;
    const c = &corpses[k];
    // A place of rest that this client has too: nothing to correct.
    if (vec.len(v) == 0 and vec.len(c.pos - p) < 0.02) {
        c.pos = p;
        c.mine = false;
        return;
    }
    c.pos = p;
    c.vel = v;
    c.rest = false;
    c.grounded = false;
    c.mine = false;
    if (vec.len(v) > 0.5) c.spin = v3(range(-6, 6), range(-9, 9), range(-9, 9));
}

/// The server gave the body (bird, gen) to player `id`. When that is not
/// this player (`me`), this client lets go of it.
pub fn applyGrab(bird: usize, gen: u16, id: u32, me: u32) void {
    if (bird >= bird_n or id == me) return;
    const k = findCorpse(@intCast(bird), gen) orelse return;
    if (held == k) held = null;
    corpses[k].holder = id;
    corpses[k].rest = false;
    corpses[k].mine = false;
}

/// The holder of the body (bird, gen) let go of it: at p with velocity v,
/// or where it is now (null: the holder left).
pub fn applyDrop(bird: usize, gen: u16, p: ?V3, v: V3) void {
    if (bird >= bird_n) return;
    const k = findCorpse(@intCast(bird), gen) orelse return;
    if (held == k) return;
    const c = &corpses[k];
    c.holder = 0;
    if (p) |pp| c.pos = pp;
    c.vel = v;
    c.rest = false;
    c.grounded = false;
    c.mine = false;
    c.spin = v3(range(-3, 3), range(-7, 7), range(-5, 5));
}

/// The state of one pigeon on the server: 0 here (on a perch, or on a
/// joyride or a return to it), 1 flown off, 2 dead. The perch: rod and u.
pub const Remote = struct { st: u8, gen: u16, rod: usize, u: f32 };

/// The state of the flock from the server. `join`: the first state after a
/// join. It puts each pigeon in place at once. Else it corrects only a
/// pigeon on a perch or away, and a pigeon here that is away flies back.
pub fn applyFlock(list: []const Remote, join: bool) void {
    for (list, 0..) |r, i| {
        if (i >= bird_n) break;
        const b = &birds[i];
        b.gen = r.gen;
        if (r.st == 0) {
            const p = perchAt(r.rod, r.u) orelse continue;
            switch (b.state) {
                .perched => if (vec.len(b.perch.pos - p.pos) > 0.05) {
                    b.perch = p;
                    settle(b);
                },
                .away => if (join) {
                    b.perch = p;
                    settle(b);
                } else {
                    comeBack(b, p, @as(u64, r.gen) *% 0x9E3779B97F4A7C15 +% i);
                    b.gen = r.gen;
                },
                .flying => if (join) {
                    b.perch = p;
                    settle(b);
                },
            }
        } else switch (b.state) {
            // Gone on the server: away at once on a join, else it flies off.
            .perched => if (join) {
                b.state = .away;
            } else takeOff(b, false, newSeed(), false),
            .flying => if (join) {
                b.state = .away;
            },
            .away => {},
        }
    }
}

/// The bodies from the server on a join: [bird, gen, x, y, z, holder].
pub fn applyBodies(list: []const [6]f32) void {
    corpse_n = 0;
    held = null;
    for (list) |row| {
        const bi: usize = @intFromFloat(@max(0, row[0]));
        if (bi >= bird_n) continue;
        const gen: u16 = @intFromFloat(std.math.clamp(row[1], 0, 65535));
        applyPush(bi, gen, v3(row[2], row[3], row[4]), v3(0, 0, 0));
        if (findCorpse(@intCast(bi), gen)) |k| corpses[k].holder = @intFromFloat(@max(0, row[5]));
    }
}

// ---- The step -------------------------------------------------------------

pub fn step(dt: f32) void {
    for (birds[0..bird_n], 0..) |*b, i| {
        switch (b.state) {
            .perched => perched(b, dt),
            .flying => fly(b, i, dt),
            // Gone. Offline it comes back after a time. In deathmatch the
            // server sends the return.
            .away => if (!net) {
                b.timer -= dt;
                if (b.timer <= 0) {
                    if (freePerch(i)) |p| comeBack(b, p, newSeed()) else b.timer = 5;
                }
            },
        }
    }
    // The joyrides. In deathmatch the server sends them.
    joy_t -= dt;
    if (!net and joy_t <= 0 and bird_n > 0) {
        joy_t = range(15, 45);
        const b = &birds[@min(bird_n - 1, @as(usize, @intFromFloat(rf() * @as(f32, @floatFromInt(bird_n)))))];
        if (b.state == .perched and b.startle < 0) takeOff(b, true, newSeed(), false);
    }
    for (corpses[0..corpse_n], 0..) |*c, i| {
        c.kick_t = @max(0, c.kick_t - dt);
        if (held != i and c.holder == 0) {
            const was = c.rest;
            corpseStep(c, dt);
            // The place of rest goes to the others once, from the client
            // that moved the body last.
            if (c.rest and !was and c.mine) {
                c.mine = false;
                netOut(.{ .kind = .push, .bird = c.bird, .gen = c.gen, .p = c.pos });
            }
        }
    }
    // A body that fell out of the map goes.
    var k: usize = 0;
    while (k < corpse_n) {
        if (corpses[k].pos[1] < map.kill_y and held != k and corpses[k].holder == 0) {
            for (k + 1..corpse_n) |j| corpses[j - 1] = corpses[j];
            corpse_n -= 1;
            if (held) |h| {
                if (h > k) held = h - 1;
            }
            continue;
        }
        k += 1;
    }
    for (feathers[0..@min(feather_n, max_feathers)]) |*f| {
        if (f.age >= f.life) continue;
        f.age += dt;
        if (f.p[1] > f.floor + 0.005) {
            // A slow fall to 0.5 m/s, a swing from side to side.
            f.v[1] += (-0.5 - f.v[1]) * @min(1, 2.5 * dt);
            f.v[0] *= 1 - @min(1, 1.8 * dt);
            f.v[2] *= 1 - @min(1, 1.8 * dt);
            f.p += f.v * vec.s(dt) + v3(@sin(f.age * 3.1 + f.phase) * 0.35 * dt, 0, @cos(f.age * 2.3 + f.phase) * 0.2 * dt);
            f.spin += dt * 2.5;
        } else f.p[1] = f.floor + 0.005;
    }
}

fn perched(b: *Bird, dt: f32) void {
    b.t += dt;
    b.hop = @max(0, b.hop - dt);
    b.peck = @max(0, b.peck - dt);
    if (b.startle >= 0) {
        b.startle -= dt;
        if (b.startle < 0) {
            // This client decides the takeoff: in deathmatch it sends it.
            const sd = newSeed();
            netOut(.{ .kind = .up, .bird = indexOf(b), .seed = sd, .p = b.pos, .v = b.vel });
            takeOff(b, false, sd, true);
            return;
        }
    }
    b.timer -= dt;
    if (b.timer <= 0) {
        b.timer = range(1, 4);
        const r = rf();
        if (r < 0.15) {
            // Turn round on the rod.
            b.yaw = wrap(b.yaw + std.math.pi);
            b.hop = 0.15;
        } else if (r < 0.35) {
            // A shuffle along the rod, near the perch. The perch stays: it
            // is the same on each client (deathmatch).
            const nz = std.math.clamp(b.pos[2] + sign() * range(0.08, 0.2), b.perch.pos[2] - shuffle_max, b.perch.pos[2] + shuffle_max);
            if (nz != b.pos[2]) {
                b.pos[2] = nz;
                b.hop = 0.1;
            }
        } else if (r < 0.55) {
            b.peck = 0.5;
        } else {
            b.head_goal = range(-0.8, 0.8);
        }
    }
    b.head_yaw += (b.head_goal - b.head_yaw) * @min(1, 12 * dt);
    b.coo_t -= dt;
    if (b.coo_t <= 0) {
        b.coo_t = range(6, 25);
        emit(.coo, b.pos);
    }
}

fn indexOf(b: *const Bird) usize {
    return (@intFromPtr(b) - @intFromPtr(&birds[0])) / @sizeOf(Bird);
}

/// The way back into the free space: zero inside it.
fn zonePull(p: V3) V3 {
    var out = v3(0, 0, 0);
    if (p[0] > zone_x) out[0] = zone_x - p[0];
    if (p[0] < -zone_x) out[0] = -zone_x - p[0];
    if (p[2] > zone_z[1]) out[2] = zone_z[1] - p[2];
    if (p[2] < zone_z[0]) out[2] = zone_z[0] - p[2];
    return out;
}

fn fly(b: *Bird, i: usize, dt: f32) void {
    b.t += dt;
    b.dazed = @max(0, b.dazed - dt);
    // The wing cycle: flap, glide, flap. No glide in the first second, on
    // the way out, or while dazed.
    b.cycle_t -= dt;
    if (b.cycle_t <= 0) {
        b.glide = !b.glide and b.t > 1.0 and b.goal != .leave and b.dazed <= 0;
        b.cycle_t = if (b.glide) brange(b, 0.35, 1.0) else brange(b, 0.5, 1.6);
    }
    const freq: f32 = if (b.t < 0.9 or b.dazed > 0) 11 else if (b.goal == .land) 9 else 7.5;
    if (!b.glide) b.flap = @mod(b.flap + dt * freq * std.math.tau, std.math.tau);

    var want = v3(0, 0, 0);
    switch (b.goal) {
        .wander => {
            b.turn_t -= dt;
            if (b.turn_t <= 0) {
                // Mostly the other way from the last turn: a weave.
                const way: f32 = if (b.turn_goal > 0) -1 else 1;
                b.turn_goal = (if (brf(b) < 0.7) way else -way) * brange(b, 0.3, 1.6);
                b.turn_t = brange(b, 0.4, 1.4);
            }
            // A dumb jink, now and then.
            if (brf(b) < 0.35 * dt) b.turn = bsign(b) * brange(b, 2.5, 4.5);
            b.turn += (b.turn_goal - b.turn) * @min(1, 2.5 * dt);
            if (b.dazed > 0) b.turn = 4.5;
            b.heading = wrap(b.heading + b.turn * dt);
            const pull = zonePull(b.pos);
            const pl = vec.len(pull);
            if (pl > 0.01) b.heading = turnToward(b.heading, headingOf(pull), (1.2 + pl) * dt);
            b.alt_t -= dt;
            if (b.alt_t <= 0) {
                b.alt = brange(b, zone_y0 + 0.8, ceilingAt(b.pos[2]) - 0.3);
                b.alt_t = brange(b, 1.5, 4);
            }
            const ceil = ceilingAt(b.pos[2]);
            const alt = std.math.clamp(b.alt, zone_y0, ceil);
            // A weave of 20 degrees each way, about once a second.
            want = dir(b.heading + 0.35 * @sin(b.t * 5.5 + b.weave)) * vec.s(b.speed);
            want[1] = std.math.clamp((alt - b.pos[1]) * 0.9, -1.8, 2.2) - @as(f32, if (b.glide) 0.7 else 0);
            if (b.t > b.flight_len) {
                if (b.joyride) {
                    // In deathmatch the server gave the perch.
                    if (net) goLand(b, b.perch) else if (freePerch(i)) |p| goLand(b, p) else b.flight_len += 2;
                } else {
                    // Out through the roof, near its crown.
                    b.goal = .leave;
                    const z = std.math.clamp(-4.2 + brange(b, -6, 6), zone_z[0], zone_z[1]);
                    b.exit = v3(std.math.clamp(b.pos[0] + brange(b, -8, 8), -zone_x, zone_x), ec.archY(z) + 1.5, z);
                }
            }
        },
        .leave => {
            const to = b.exit - b.pos;
            // A wobble to the side on the way out.
            const side = vec.norm(vec.cross(vec.norm(to), v3(0, 1, 0)));
            want = vec.norm(to) * vec.s(b.speed) + side * vec.s(@sin(b.t * 2.3 + b.flight_len) * 1.8);
            if (b.pos[1] > ec.archY(b.pos[2]) + 0.7) {
                b.state = .away;
                b.timer = range(return_delay[0], return_delay[1]);
                return;
            }
        },
        .enter => {
            // Down to the point under the roof, then to the perch. A
            // pigeon that a rib or a purlin holds up goes there after 8 s.
            const to = b.exit - b.pos;
            const dist = vec.len(to);
            want = vec.norm(to) * vec.s(@min(b.speed, 1 + dist * 2));
            if (dist < 0.6 or b.t > 8) {
                if (dist >= 0.6) b.pos = b.exit;
                goLand(b, b.perch);
            }
        },
        .land => {
            // First to a point 2.2 m to the side of the perch and 0.7 m
            // over it, then in to the perch.
            const side: f32 = if (b.pos[0] > b.perch.pos[0]) 1 else -1;
            const target = if (b.approach) b.perch.pos + v3(side * 2.2, 0.7, 0) else b.perch.pos;
            const to = target - b.pos;
            const dist = vec.len(to);
            if (b.approach and dist < 0.8) b.approach = false;
            const sp = if (b.approach) b.speed else @min(b.speed, 0.5 + dist * 1.8);
            const wob = if (b.approach) dir(b.heading + std.math.pi / 2.0) * vec.s(@sin(b.t * 2.7) * 1.2) else v3(0, 0, 0);
            want = vec.norm(to) * vec.s(sp) + wob;
            if (!b.approach and !b.decided and dist < 0.9) {
                b.decided = true;
                // A dumb miss: round again.
                if (b.misses < 2 and brf(b) < 0.25) {
                    b.misses += 1;
                    b.goal = .wander;
                    b.joyride = true;
                    b.heading = headingOf(b.vel);
                    b.flight_len = b.t + brange(b, 2, 4);
                }
            }
            if (b.goal == .land and !b.approach and dist < 0.1) {
                settle(b);
                b.yaw = if (b.vel[0] > 0 or to[0] > 0) -std.math.pi / 2.0 else std.math.pi / 2.0;
                b.hop = 0.35;
                b.timer = range(1, 3);
                emit(.flutter, b.pos);
                return;
            }
        },
    }

    // Look ahead, unless this flight is dumb.
    const in_shed = underRoof(b.pos);
    const hv = vec.len(b.vel);
    if (in_shed and !b.dumb and b.goal == .wander and hv > 0.5) {
        const f = b.vel / vec.s(hv);
        if (map.raycast(b.pos, f, 2.5 + hv * 0.3)) |h| {
            var away = f - h.normal * vec.s(2 * vec.dot(f, h.normal));
            away[1] = 0;
            if (vec.len(away) > 0.1) b.heading = turnToward(b.heading, headingOf(away), 5 * dt);
            if (h.normal[1] > 0.5) b.alt += 2 * dt;
            want = dir(b.heading) * vec.s(b.speed) + v3(0, want[1], 0);
        }
    }

    const k: f32 = if (b.goal == .land) 3.5 else 2.2;
    b.vel += (want - b.vel) * vec.s(@min(1, k * dt));
    // Each beat lifts the body a little.
    if (!b.glide) b.vel[1] += @sin(b.flap) * 1.6 * dt;
    if (b.dazed > 0) b.vel[1] -= 3 * dt;

    // Move, axis by axis: a wall turns the pigeon back. In the shed a
    // wandering pigeon stays under the roof: a dumb one hits it, a smart
    // one never gets there.
    const before = b.pos;
    const roofed = b.goal == .wander and in_shed;
    if (in_shed or b.goal != .land) {
        inline for (0..3) |a| {
            var n = b.pos;
            n[a] += b.vel[a] * dt;
            // Over the line (after a missed landing) it may go down, not up.
            const over = n[1] - (ec.archY(n[2]) - 0.35);
            const roof = roofed and over > 0 and over > b.pos[1] - (ec.archY(b.pos[2]) - 0.35);
            if (roof or map.overlaps(n - vec.s(fly_half), n + vec.s(fly_half))) {
                if (@abs(b.vel[a]) > 2 and b.dazed <= 0) {
                    emit(.bonk, b.pos);
                    b.dazed = 0.7;
                    addFeathers(b.pos, 2, v3(0, 0, 0), b.tint);
                }
                b.vel[a] = -b.vel[a] * 0.4;
                if (roof and a == 1) b.vel[1] = @min(b.vel[1], -0.3);
                b.heading = headingOf(b.vel);
            } else b.pos = n;
        }
    } else b.pos += b.vel * vec.s(dt);

    // The pose: face the move, bank into the turn, pitch with the climb.
    const mv = b.pos - before;
    const hs = @sqrt(mv[0] * mv[0] + mv[2] * mv[2]);
    if (hs > 0.2 * dt) {
        const ny = headingOf(mv);
        const rate = wrap(ny - b.yaw) / dt;
        b.yaw = ny;
        b.bank += (std.math.clamp(rate * 0.3, -0.9, 0.9) - b.bank) * @min(1, 6 * dt);
    }
    b.pitch += (std.math.clamp(std.math.atan2(mv[1], hs + 1e-4), -0.8, 0.8) * 0.6 - b.pitch) * @min(1, 6 * dt);
}

fn corpseStep(c: *Corpse, dt: f32) void {
    const h = vec.s(corpse_half);
    if (c.rest) {
        c.check_t -= dt;
        if (c.check_t <= 0) {
            c.check_t = 0.15;
            // The floor went (a lift cab): fall again.
            if (!map.overlaps(c.pos - v3(corpse_half, corpse_half + 0.03, corpse_half), c.pos + v3(corpse_half, -corpse_half + 0.01, corpse_half))) {
                c.rest = false;
            }
        }
        return;
    }
    // Pushed into a solid box (a lift floor): out to its top.
    if (map.overlaps(c.pos - h, c.pos + h)) {
        if (map.floorTop(c.pos - h, c.pos + v3(corpse_half, 0.8, corpse_half))) |top| c.pos[1] = top + corpse_half + 0.001;
    }
    c.vel[1] -= gravity * dt;
    // The feathers: much drag.
    c.vel *= vec.s(1 - @min(1, 0.35 * dt));
    c.grounded = false;
    inline for (0..3) |a| {
        var n = c.pos;
        n[a] += c.vel[a] * dt;
        if (map.overlaps(n - h, n + h)) {
            if (a == 1 and c.vel[1] < 0) {
                c.grounded = true;
                if (c.vel[1] < -2.5) emit(.thud, c.pos);
                c.vel[0] *= 0.6;
                c.vel[2] *= 0.6;
                c.spin *= vec.s(0.5);
            }
            c.vel[a] = -c.vel[a] * 0.25;
        } else c.pos = n;
    }
    c.rot += c.spin * vec.s(dt);
    if (c.grounded) {
        c.vel[0] *= 1 - @min(1, 4 * dt);
        c.vel[2] *= 1 - @min(1, 4 * dt);
        c.spin *= vec.s(1 - @min(1, 8 * dt));
        // Settle on its side.
        const side: f32 = if (wrap(c.rot[2]) >= 0) std.math.pi / 2.0 else -std.math.pi / 2.0;
        c.rot[1] += (0 - wrap(c.rot[1])) * @min(1, 8 * dt);
        c.rot[2] = wrap(c.rot[2]);
        c.rot[2] += (side - c.rot[2]) * @min(1, 8 * dt);
        const hs = @sqrt(c.vel[0] * c.vel[0] + c.vel[2] * c.vel[2]);
        if (hs < 0.08 and @abs(c.vel[1]) < 0.6) {
            c.rest = true;
            c.vel = v3(0, 0, 0);
            c.spin = v3(0, 0, 0);
            c.check_t = 0.15;
        }
    }
}

// ---- The model ------------------------------------------------------------

const cloth: f32 = 6;
const neck_c = v3(0.2, 0.38, 0.33);
const bar_c = v3(0.1, 0.1, 0.12);
const leg_c = v3(0.75, 0.33, 0.33);

const Pose = struct {
    /// The wing angle up from level (rad), and the extra angle of the
    /// outer half. Null: folded.
    wings: ?[2]f32,
    /// A dead pigeon: one wing out and limp, the head turned down.
    dead: bool = false,
    legs: bool = false,
    head_yaw: f32 = 0,
    peck: f32 = 0,
};

/// The model of a pigeon about its body centre. Forward is -Z.
fn addModel(dyn: *mesh.Mesh, m: Mat4, tint: V3, pose: Pose) void {
    const body = tint;
    dyn.orientedBox(m, v3(-0.055, -0.045, -0.07), v3(0.055, 0.05, 0.09), body, cloth);
    dyn.orientedBox(m, v3(-0.05, -0.05, -0.115), v3(0.05, 0.04, -0.05), body * vec.s(0.9) + v3(0.05, 0.02, 0.06), cloth);
    dyn.orientedBox(m, v3(-0.036, 0.0, -0.13), v3(0.036, 0.075, -0.07), if (tint[0] > 0.7) body else neck_c, cloth);
    dyn.orientedBox(m, v3(-0.04, -0.005, 0.08), v3(0.04, 0.02, 0.19), body * vec.s(0.9), cloth);
    dyn.orientedBox(m, v3(-0.041, -0.006, 0.165), v3(0.041, 0.021, 0.19), bar_c, cloth);
    // The head: it turns, and dips for a peck.
    const peck = @sin(@min(1, pose.peck / 0.5) * std.math.pi);
    var hm = m.mul(vec.translate(v3(0, 0.075, -0.1))).mul(Mat4.rotationY(pose.head_yaw)).mul(Mat4.rotationX(-peck * 0.9));
    if (pose.dead) hm = m.mul(vec.translate(v3(0.02, 0.03, -0.11))).mul(Mat4.rotationY(0.9)).mul(Mat4.rotationX(-1.1));
    const head_c = if (tint[0] > 0.7) tint else v3(0.33, 0.35, 0.42);
    dyn.orientedBox(hm, v3(-0.028, 0, -0.055), v3(0.028, 0.055, 0.005), head_c, cloth);
    dyn.orientedBox(hm, v3(-0.007, 0.018, -0.08), v3(0.007, 0.03, -0.055), v3(0.12, 0.1, 0.1), cloth);
    dyn.orientedBox(hm, v3(-0.009, 0.03, -0.066), v3(0.009, 0.039, -0.05), v3(0.85, 0.85, 0.82), cloth);
    if (!pose.dead) {
        dyn.orientedBox(hm, v3(0.026, 0.03, -0.04), v3(0.031, 0.04, -0.03), v3(0.9, 0.45, 0.1), cloth);
        dyn.orientedBox(hm, v3(-0.031, 0.03, -0.04), v3(-0.026, 0.04, -0.03), v3(0.9, 0.45, 0.1), cloth);
    }
    if (pose.legs) {
        for ([_]f32{ -0.025, 0.025 }) |x| {
            dyn.orientedBox(m, v3(x - 0.006, -perch_lift, -0.01), v3(x + 0.006, -0.045, 0.005), leg_c, cloth);
            dyn.orientedBox(m, v3(x - 0.012, -perch_lift, -0.035), v3(x + 0.012, -perch_lift + 0.008, 0.01), leg_c, cloth);
        }
    }
    for ([_]f32{ -1, 1 }) |sd| {
        const ang: ?[2]f32 = if (pose.dead) (if (sd > 0) [2]f32{ -0.25, -0.3 } else null) else pose.wings;
        if (ang) |a| {
            const wm = m.mul(vec.translate(v3(sd * 0.05, 0.03, -0.03))).mul(Mat4.rotationZ(sd * a[0]));
            dyn.orientedBox(wm, v3(@min(0, sd * 0.16), -0.007, -0.05), v3(@max(0, sd * 0.16), 0.007, 0.08), body * vec.s(0.95), cloth);
            for ([_]f32{ 0.0, 0.035 }) |z| {
                dyn.orientedBox(wm, v3(@min(sd * 0.04, sd * 0.14), 0.007, z), v3(@max(sd * 0.04, sd * 0.14), 0.009, z + 0.014), bar_c, cloth);
            }
            const om = wm.mul(vec.translate(v3(sd * 0.16, 0, 0))).mul(Mat4.rotationZ(sd * a[1]));
            dyn.orientedBox(om, v3(@min(0, sd * 0.17), -0.006, -0.035), v3(@max(0, sd * 0.17), 0.006, 0.07), body * vec.s(0.75), cloth);
        } else {
            dyn.orientedBox(m, v3(@min(sd * 0.05, sd * 0.062), -0.03, -0.06), v3(@max(sd * 0.05, sd * 0.062), 0.045, 0.16), body * vec.s(0.88), cloth);
            dyn.orientedBox(m, v3(@min(sd * 0.05, sd * 0.064), 0.0, 0.03), v3(@max(sd * 0.05, sd * 0.064), 0.03, 0.045), bar_c, cloth);
        }
    }
}

fn rotOf(r: V3) Mat4 {
    return Mat4.rotationY(r[0]).mul(Mat4.rotationX(r[1]).mul(Mat4.rotationZ(r[2])));
}

/// Add the pigeons, the bodies and the feathers to the dynamic mesh.
/// `time` drives the flutter of a landing.
pub fn build(dyn: *mesh.Mesh, time: f32) void {
    for (birds[0..bird_n]) |b| {
        if (b.state == .away) continue;
        const m = vec.translate(b.pos).mul(rotOf(v3(b.yaw, b.pitch, b.bank)));
        var pose: Pose = .{ .wings = null, .head_yaw = b.head_yaw, .peck = b.peck };
        switch (b.state) {
            .perched => {
                pose.legs = true;
                if (b.hop > 0) pose.wings = .{ 0.9 + 0.5 * @sin(time * 60), 0.2 };
                // The head bobs a little.
                const bob = @sin(time * 2.1 + b.tint[0] * 40) * 0.004;
                addModel(dyn, m.mul(vec.translate(v3(0, bob, 0))), b.tint, pose);
                continue;
            },
            .flying => pose.wings = if (b.glide) .{ 0.38, 0.12 } else .{ 0.2 + 0.85 * @sin(b.flap), 0.4 * @sin(b.flap - 0.6) },
            .away => {},
        }
        addModel(dyn, m, b.tint, pose);
    }
    for (corpses[0..corpse_n]) |c| {
        addModel(dyn, vec.translate(c.pos).mul(rotOf(c.rot)), c.tint, .{ .wings = null, .dead = true, .legs = true });
    }
    for (feathers[0..@min(feather_n, max_feathers)]) |f| {
        if (f.age >= f.life) continue;
        const m = vec.translate(f.p).mul(Mat4.rotationY(f.spin).mul(Mat4.rotationX(@sin(f.age * 3.1 + f.phase) * 0.5)));
        dyn.orientedBox(m, v3(-0.012, -0.002, -0.035), v3(0.012, 0.002, 0.035), f.col, cloth);
    }
}
