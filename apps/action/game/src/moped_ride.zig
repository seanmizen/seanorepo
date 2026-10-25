// Where: apps/action/game/src/moped_ride.zig
// When: on Earl's Court, main.zig drives the moped of the player of this
// client from the keys in each tick, steps the other mopeds, draws them,
// sends the outbox in deathmatch and plays the events.
// Why: a crashed moped of the moped thieves (moped.zig) is a moped that a
// player can ride, on Warwick Road and into the station (REQ-MOPED-001).
//
// - A moped: the crash of a thief moped leaves one (moped.zig event
//   `rest`, `add`). It lies on its side where it stopped, to the end of the
//   match. Each player has at most one moped to ride: a newer moped from
//   a visit of the same player makes the old one a wreck (`Bike.wreck`).
// - Get on: F on a moped with no rider (`aim`). It stands up, and the
//   player sits on it.
// - Ride (`ride`): W throttle, S brake and reverse, A and D steer. The
//   moped leans in each turn. It drives on each floor that a player walks
//   on, the ramps over the stairs and the escalators too (map.Ramp). It
//   goes up a step of `step_up` and follows a floor down `step_down` in a
//   tick. Past that it is in the air (REQ-MOPED-002).
// - The body of the moped and the rider are three boxes along the moped,
//   from `step_up` (on the ground) or `air_bottom` (in the air) to
//   `body_top`. A wall stops them. A lift cab is a wall to a moped.
// - Get off: Space (`leave`). A wall at `crash_speed` or more, or a landing
//   at `bad_landing` or more, throws the rider. The moped with no rider
//   falls on its side and slides to a stop.
// - A moped that hits a player at `hit_speed` or more does damage, more at
//   a higher speed (`hitDamage`).
// - A rider who dies is a ragdoll (ragdoll.zig) from the seat (`Corpse`).
//
// Deathmatch (main.zig, server/bikes.ts), as the moped thieves:
// - The server gives the id of each moped in the "die" of the driver.
// - F asks the server ("mount"). The server checks it and sends "mount"
//   to all the players, with the place of the moped.
// - The client of the rider drives its moped. Its `st` messages carry the
//   state of the moped (`bk`), and the other clients draw the moped and
//   its rider from the snapshots (`follow`).
// - "off": the rider got off or was thrown, at a place. The server sends
//   it to the other players. The death of a rider: the server sends "off"
//   with the last place of the rider, to all the players. Each client
//   slides the moped from that place with the map only, so each client
//   sees it stop at the same place.
// - "hit": the moped of this client hit another player. The server checks
//   it and applies the damage. The kill feed says "moped".
//
// The module has no sound, no input and no network.
const std = @import("std");
const vec = @import("vec.zig");
const map = @import("map.zig");
const mesh = @import("mesh.zig");
const npc = @import("npc.zig");
const ragdoll = @import("ragdoll.zig");
const moped = @import("moped.zig");
const player = @import("player.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;

pub const max_bikes = 16;
/// The engine voice of bike i is slot `sound_slot0 + i` (moped_sound.zig).
pub const sound_slot0: u32 = moped.max_rides;

/// The speeds, m/s, and the rates, m/s^2.
pub const top_speed: f32 = 16;
const reverse_top: f32 = 3;
const accel: f32 = 6;
const brake: f32 = 11;
const reverse_accel: f32 = 3;
const coast: f32 = 1.2;
/// The gravity of a moped in the air, m/s^2.
pub const gravity: f32 = 13;
/// The highest step up, and the deepest step down, that keep the moped on
/// the ground (in one tick).
const step_up: f32 = 0.45;
const step_down: f32 = 0.35;
/// The body of the moped with its rider: three boxes `half_w` from the
/// middle line, at `sample_at` along it, up to `body_top`.
const half_w: f32 = 0.25;
const sample_at = [3]f32{ -0.65, 0, 0.65 };
const body_top: f32 = 1.75;
/// The highest floor under an end of the moped, over the floor under its
/// middle, that is a slope and not a wall: a stair is 0.52 m at 0.65 m.
const slope_rise: f32 = 0.6;
const air_bottom: f32 = 0.1;
/// A wall at this speed or more (the part of the speed into the wall)
/// throws the rider. A landing at this vertical speed or more too.
pub const crash_speed: f32 = 8;
pub const bad_landing: f32 = 9;
/// F reaches a moped this far from the eye.
pub const mount_reach: f32 = 2.6;
/// A moped hits a player at this speed or more.
pub const hit_speed: f32 = 3;
/// The time between two hits of one moped on one player, s.
const hit_gap: f32 = 0.6;
/// The seat of the rider in the frame of the moped.
const seat = v3(0, 0.8, -0.05);

/// The damage of a moped hit at `speed` m/s. server/bikes.ts has the same
/// formula.
pub fn hitDamage(speed: f32) f32 {
    return std.math.clamp((@abs(speed) - hit_speed) * 7, 0, 100);
}

/// The state of a moped in the messages: x, y, z, yaw, speed, roll, and
/// the vertical speed.
pub const State = [7]f32;

pub const Bike = struct {
    on: bool = false,
    id: u32 = 0,
    /// The player of the visit whose crash left the moped.
    owner: u32 = 0,
    /// The ground under the middle of the moped.
    pos: V3 = v3(0, 0, 0),
    /// 0 looks to -Z, as the player.
    yaw: f32 = 0,
    /// Along the yaw, m/s. Negative: reverse.
    speed: f32 = 0,
    /// The vertical speed, m/s.
    vy: f32 = 0,
    /// The lean (positive leans right) and the pitch (positive: the nose
    /// up), radians.
    roll: f32 = 0,
    pitch: f32 = 0,
    yaw_rate: f32 = 0,
    grounded: bool = true,
    /// 0 upright to 1 on its side, the side of the fall (1 right, -1 left),
    /// and the turn of the slide.
    fall: f32 = 1,
    fall_v: f32 = 0,
    fall_side: f32 = 1,
    spin: f32 = 0,
    /// The direction of a slide with no rider.
    slide: V3 = v3(0, 0, -1),
    /// The rider: a player id (0 offline), or null.
    rider: ?u32 = null,
    /// The rider is the player of this client.
    mine: bool = false,
    /// A newer moped of the same owner: nobody can get on this one.
    wreck: bool = false,
    /// The throttle, 0 to 1: the engine sound.
    throttle: f32 = 0,
    spark_t: f32 = 0,
    /// The time to the next hit on each player slot (`hits`).
    hit_t: [24]f32 = @splat(0),
};

pub var bikes: [max_bikes]Bike = @splat(.{});
/// True in deathmatch: the server answers a mount.
pub var net = false;
/// A mount that waits for the server: the bike index, and the time left.
pub var asking: ?usize = null;
var ask_t: f32 = 0;

pub const OutKind = enum { mount, off, hit };
pub const Out = struct {
    kind: OutKind,
    bike: u32,
    q: State = @splat(0),
    /// off: the rider was thrown.
    crash: bool = false,
    /// hit: the player that the moped hit, and the speed.
    victim: u32 = 0,
    speed: f32 = 0,
};
pub var outbox: [8]Out = undefined;
pub var out_n: usize = 0;

pub const EventKind = enum {
    /// The moped stood up for its rider.
    mount,
    /// A rider was thrown: a crash.
    crash,
    /// The moped fell on its side.
    fall,
    scrape,
    spark,
    /// A hard landing.
    land,
};
pub const Event = struct { kind: EventKind, p: V3 = v3(0, 0, 0), n: V3 = v3(0, 1, 0) };
pub var events: [24]Event = undefined;
pub var event_n: usize = 0;

/// A rider who died: a ragdoll from the seat. `owner` is the player.
pub const Corpse = struct { on: bool = false, owner: u32 = 0, body: ragdoll.Body = .{} };
pub var corpses: [8]Corpse = @splat(.{});

fn emit(o: Out) void {
    if (out_n < outbox.len) {
        outbox[out_n] = o;
        out_n += 1;
    }
}

fn event(e: Event) void {
    if (event_n < events.len) {
        events[event_n] = e;
        event_n += 1;
    }
}

/// Remove all the mopeds, the bodies and the queues: a new map, mode or
/// match.
pub fn reset() void {
    bikes = @splat(.{});
    corpses = @splat(.{});
    out_n = 0;
    event_n = 0;
    asking = null;
}

pub fn fwdOf(yaw: f32) V3 {
    return v3(-@sin(yaw), 0, -@cos(yaw));
}

fn rightOf(yaw: f32) V3 {
    return v3(@cos(yaw), 0, -@sin(yaw));
}

/// The bike with this id, or null.
pub fn find(id: u32) ?*Bike {
    for (&bikes) |*b| {
        if (b.on and b.id == id) return b;
    }
    return null;
}

pub fn indexOf(b: *const Bike) usize {
    return (@intFromPtr(b) - @intFromPtr(&bikes[0])) / @sizeOf(Bike);
}

/// The bike of the player of this client, or null.
pub fn mineBike() ?*Bike {
    for (&bikes) |*b| {
        if (b.on and b.mine) return b;
    }
    return null;
}

/// The bike that player `id` rides, or null.
pub fn ridden(id: u32) ?*Bike {
    for (&bikes) |*b| {
        if (b.on and !b.mine and b.rider != null and b.rider.? == id) return b;
    }
    return null;
}

/// The number of mopeds: the debug screen.
pub fn count() usize {
    var c: usize = 0;
    for (&bikes) |*b| c += @intFromBool(b.on);
    return c;
}

// ---- New mopeds --------------------------------------------------------------------

/// A new moped `id` of the visit of player `owner`, on its side at `pos`.
/// An old moped of the same owner is a wreck from now on. A full list
/// reuses the first wreck, else the first moped with no rider.
pub fn add(id: u32, owner: u32, pos: V3, yaw: f32, side: f32) *Bike {
    if (find(id)) |b| return b;
    for (&bikes) |*b| {
        if (b.on and b.owner == owner) b.wreck = true;
    }
    var slot: ?*Bike = null;
    for (&bikes) |*b| {
        if (!b.on) {
            slot = b;
            break;
        }
    }
    if (slot == null) for (&bikes) |*b| {
        if (b.wreck and b.rider == null) {
            slot = b;
            break;
        }
    };
    if (slot == null) for (&bikes) |*b| {
        if (b.rider == null) {
            slot = b;
            break;
        }
    };
    const s = slot orelse &bikes[0];
    s.* = .{ .on = true, .id = id, .owner = owner, .pos = pos, .yaw = yaw, .fall = 1, .fall_side = if (side < 0) -1 else 1, .speed = 0 };
    s.roll = s.fall_side * 1.3;
    return s;
}

// ---- The frame, the body and the aim ------------------------------------------------

/// The frame of a moped: the pitch, the lean, and the fall on its side.
pub fn frameOf(b: *const Bike) Mat4 {
    return vec.translate(b.pos + v3(0, 0.17 * b.fall, 0)).mul(Mat4.rotationY(b.yaw).mul(Mat4.rotationX(b.pitch).mul(Mat4.rotationZ(-b.roll))));
}

/// The eye of a rider at `pos`: player.zig puts it `player.eye` over the
/// feet, and the feet of a rider are the moped position.
pub fn seatOf(b: *const Bike) V3 {
    return vec.xform(frameOf(b), seat);
}

/// The pose of the rider of a moped.
pub fn riderPose(b: *const Bike) npc.Pose {
    return .{ .pos = seatOf(b), .yaw = b.yaw, .action = .ride_driver, .roll = b.roll };
}

/// True when the body of the moped at p with this yaw goes into a wall
/// or a lift cab. `bottom`: the low edge of the body over p.
fn blockedAt(p: V3, yaw: f32, bottom: f32) bool {
    const f = fwdOf(yaw);
    for (sample_at) |k| {
        const c = p + f * vec.s(k);
        // On the ground, each box starts step_up over the floor under it,
        // so the ends of the moped clear a slope: a stair or an escalator.
        // A floor more than `slope_rise` over the middle is a wall.
        var base = p[1];
        if (bottom == step_up and k != 0) {
            if (map.floorTop(v3(c[0] - 0.15, p[1] - 1, c[2] - 0.15), v3(c[0] + 0.15, p[1] + slope_rise, c[2] + 0.15))) |y| base = @max(base, y);
        }
        const lo = v3(c[0] - half_w, base + bottom, c[2] - half_w);
        const hi = c + v3(half_w, body_top, half_w);
        if (map.overlaps(lo, hi)) return true;
        if (inLift(lo, hi)) return true;
    }
    return false;
}

/// True when a moped on the ground at p with this yaw has room: no wall
/// and no lift cab.
pub fn fits(p: V3, yaw: f32) bool {
    return !blockedAt(p, yaw, step_up);
}

/// True when the box lo..hi goes into the shaft of a lift: over its cab
/// floor in plan, between its lowest floor and its highest cab top.
fn inLift(lo: V3, hi: V3) bool {
    for (map.lifts[0..map.lift_count]) |l| {
        const fb = map.boxes[l.floor_box];
        if (lo[0] < fb.max[0] and hi[0] > fb.min[0] and lo[2] < fb.max[2] and hi[2] > fb.min[2] and
            hi[1] > @min(l.levels[0], l.levels[1]) - 1 and lo[1] < @max(l.levels[0], l.levels[1]) + map.cab_height) return true;
    }
    return false;
}

/// The highest floor under p, from `down` below it to `up` above it.
fn floorNear(p: V3, down: f32, up: f32) ?f32 {
    return map.floorTop(p - v3(0.15, down, 0.15), p + v3(0.15, up, 0.15));
}

/// The highest floor under the point p itself, from `down` below it to
/// `up` above it: a moped leaves the lip of a ramp at the lip.
fn floorAt(p: V3, down: f32, up: f32) ?f32 {
    return map.floorTop(p - v3(0.02, down, 0.02), p + v3(0.02, up, 0.02));
}

/// The body of a moped in its own frame: one box for the aim and the
/// shots.
const body_box = [2]V3{ v3(-0.24, 0.12, -0.82), v3(0.24, 1.12, 0.98) };

fn toLocal(m: Mat4, p: V3) V3 {
    return toLocalDir(m, p - v3(m.data[12], m.data[13], m.data[14]));
}

fn toLocalDir(m: Mat4, d: V3) V3 {
    const x = v3(m.data[0], m.data[1], m.data[2]);
    const y = v3(m.data[4], m.data[5], m.data[6]);
    const z = v3(m.data[8], m.data[9], m.data[10]);
    return v3(vec.dot(d, x), vec.dot(d, y), vec.dot(d, z));
}

pub const Hit = struct { bike: usize, t: f32, normal: V3 };

/// The first moped on a ray within max_t, or null. `skip`: the moped of
/// the rider who shoots.
pub fn ray(o: V3, d: V3, max_t: f32, skip: ?usize) ?Hit {
    var best: ?Hit = null;
    for (&bikes, 0..) |*b, i| {
        if (!b.on or (skip != null and skip.? == i)) continue;
        if (vec.len(b.pos - o) > max_t + 3) continue;
        const f = frameOf(b);
        if (map.rayBox(toLocal(f, o), toLocalDir(f, d), body_box[0], body_box[1])) |h| {
            if (h.t <= max_t and (best == null or h.t < best.?.t)) best = .{ .bike = i, .t = h.t, .normal = vec.xdir(f, h.n) };
        }
    }
    return best;
}

/// The moped with no rider under the crosshair, within reach, or null. A
/// wreck does not count.
pub fn aim(o: V3, d: V3) ?usize {
    const h = ray(o, d, mount_reach, null) orelse return null;
    const b = &bikes[h.bike];
    if (b.rider != null or b.wreck) return null;
    return h.bike;
}

// ---- Get on and get off -------------------------------------------------------------

/// F on moped i. Offline the player of this client gets on at once. In
/// deathmatch the server decides (a "mount").
pub fn tryMount(i: usize) void {
    const b = &bikes[i];
    if (!b.on or b.rider != null or b.wreck) return;
    if (net) {
        if (asking != null) return;
        asking = i;
        ask_t = 1.5;
        emit(.{ .kind = .mount, .bike = b.id, .q = stateOf(b) });
        return;
    }
    mount(b, 0, true);
}

/// Player `rider` gets on moped b: it stands up.
pub fn mount(b: *Bike, rider: u32, mine: bool) void {
    b.rider = rider;
    b.mine = mine;
    b.fall = 0;
    b.fall_v = 0;
    b.roll = 0;
    b.speed = 0;
    b.vy = 0;
    b.yaw_rate = 0;
    b.spin = 0;
    b.grounded = true;
    b.throttle = 0;
    if (floorNear(b.pos, 0.5, 0.5)) |y| b.pos[1] = y;
    if (mine) asking = null;
    event(.{ .kind = .mount, .p = b.pos });
}

/// The server put player `rider` on moped `id` at q (a "mount").
pub fn applyMount(id: u32, rider: u32, mine: bool, q: State) ?*Bike {
    const b = find(id) orelse return null;
    // Another moped of the same rider: it lost its rider (a lost message).
    for (&bikes) |*o| {
        if (o.on and o != b and o.rider != null and o.rider.? == rider) release(o, stateOf(o), false);
    }
    b.pos = v3(q[0], q[1], q[2]);
    b.yaw = q[3];
    mount(b, rider, mine);
    return b;
}

/// The rider leaves moped b at state q: it goes on with no rider, falls on
/// its side and slides to a stop. `crash`: the rider was thrown.
pub fn release(b: *Bike, q: State, crash: bool) void {
    setState(b, q);
    b.rider = null;
    b.mine = false;
    b.fall_v = 0;
    b.slide = fwdOf(b.yaw) * vec.s(if (b.speed < 0) @as(f32, -1) else 1);
    b.speed = @abs(b.speed);
    b.fall_side = if (b.roll < -0.02) -1 else 1;
    b.spin = if (crash) -b.fall_side * 0.9 else 0;
    b.throttle = 0;
    if (crash) event(.{ .kind = .crash, .p = b.pos });
}

/// The rider of moped `id` left it at q (an "off"). `died`: the rider died,
/// and `owner` is that player: a ragdoll falls from the seat.
pub fn applyOff(id: u32, q: State, crash: bool, died: bool, rider: u32) void {
    const b = find(id) orelse return;
    if (died) {
        setState(b, q);
        killRider(b, rider);
    }
    release(b, q, crash);
}

/// How the player of this client gets off.
pub const Leave = enum { jump, crash, died };

/// The player of this client gets off its moped (Space, a crash, a death).
/// Returns the moped, or null. In deathmatch a jump or a crash goes to the
/// server ("off"). The server sends a death itself.
pub fn leave(how: Leave) ?*Bike {
    const b = mineBike() orelse return null;
    const q = stateOf(b);
    if (net and how != .died) emit(.{ .kind = .off, .bike = b.id, .q = q, .crash = how == .crash });
    if (how == .died) killRider(b, b.rider orelse 0);
    release(b, q, how == .crash);
    return b;
}

/// A place for the feet of a player who gets off moped b: beside it, with
/// room for the body. Else over the moped.
pub fn dismountSpot(b: *const Bike) V3 {
    const f = fwdOf(b.yaw);
    const r = rightOf(b.yaw);
    for ([_]V3{ -r * vec.s(0.75), r * vec.s(0.75), -f * vec.s(1.4), f * vec.s(1.4), -r * vec.s(1.2), r * vec.s(1.2) }) |off| {
        const p0 = b.pos + off;
        const y = floorNear(p0, 0.6, 0.45) orelse continue;
        const p = v3(p0[0], y, p0[2]);
        const pr = player.radius;
        if (!map.overlaps(p + v3(-pr, 0.02, -pr), p + v3(pr, player.height, pr))) return p;
    }
    return b.pos + v3(0, 0.3, 0);
}

/// A rider who died: a ragdoll from the seat of moped b. The last body of
/// the same player goes.
pub fn killRider(b: *const Bike, owner: u32) void {
    clearCorpse(owner);
    var slot: *Corpse = &corpses[0];
    for (&corpses) |*c| {
        if (!c.on) {
            slot = c;
            break;
        }
    }
    const vel = fwdOf(b.yaw) * vec.s(b.speed) + v3(0, b.vy, 0);
    slot.* = .{ .on = true, .owner = owner, .body = ragdoll.Body.start(npc.skeleton(riderPose(b)), vel, v3(0, 1.5, 0) - fwdOf(b.yaw) * vec.s(1)) };
}

/// The body of player `owner` goes (a new life).
pub fn clearCorpse(owner: u32) void {
    for (&corpses) |*c| {
        if (c.on and c.owner == owner) c.on = false;
    }
}

/// The body of player `owner`, or null.
pub fn corpseOf(owner: u32) ?*Corpse {
    for (&corpses) |*c| {
        if (c.on and c.owner == owner) return c;
    }
    return null;
}

// ---- The state ------------------------------------------------------------------------

pub fn stateOf(b: *const Bike) State {
    return .{ b.pos[0], b.pos[1], b.pos[2], b.yaw, b.speed, b.roll, b.vy };
}

fn setState(b: *Bike, q: State) void {
    b.pos = v3(q[0], q[1], q[2]);
    b.yaw = q[3];
    b.speed = q[4];
    b.roll = q[5];
    b.vy = q[6];
    b.grounded = floorNear(b.pos, 0.05, 0.05) != null;
}

/// Another player rides moped b: its place and its pose from the
/// snapshots (main.zig smooths them), each tick.
pub fn follow(b: *Bike, rider: u32, pos: V3, yaw: f32, roll: f32, pitch: f32, speed: f32, dt: f32) void {
    if (b.rider == null or b.rider.? != rider) {
        b.rider = rider;
        b.mine = false;
    }
    b.fall = 0;
    const old = b.speed;
    b.pos = pos;
    b.yaw = yaw;
    b.roll = roll;
    b.pitch = pitch;
    b.speed = speed;
    b.throttle += (vec.clamp01((speed - old) / dt / 3) - b.throttle) * @min(1, 8 * dt);
}

// ---- The ride ---------------------------------------------------------------------------

/// The keys of the rider: throttle 1 (W), -1 (S), steer -1 (A) to 1 (D).
pub const Input = struct { throttle: f32 = 0, steer: f32 = 0 };

/// What happened to the rider in a tick.
pub const Outcome = enum { none, crash };

/// One tick of the moped of the player of this client.
pub fn ride(b: *Bike, in: Input, dt: f32) Outcome {
    if (b.grounded) {
        // The engine and the brake.
        if (in.throttle > 0) {
            b.speed += if (b.speed < 0) brake * dt else accel * dt * (1 - 0.4 * vec.clamp01(b.speed / top_speed));
        } else if (in.throttle < 0) {
            b.speed -= if (b.speed > 0.2) brake * dt else reverse_accel * dt;
        } else {
            b.speed -= std.math.clamp(b.speed, -coast * dt, coast * dt);
        }
        b.speed = std.math.clamp(b.speed, -reverse_top, top_speed);
        // The turn: tighter at a walk, wider at speed. Right (D) makes the
        // yaw smaller.
        const v = @abs(b.speed);
        const rate = @min(2.4, 9.0 / @max(v, 0.5)) * vec.clamp01(v / 1.5);
        const want = -in.steer * rate * (if (b.speed < 0) @as(f32, -1) else 1);
        b.yaw_rate += (want - b.yaw_rate) * @min(1, 8 * dt);
    } else b.yaw_rate *= @max(0, 1 - 4 * dt);
    b.throttle += (vec.clamp01(in.throttle) - b.throttle) * @min(1, 10 * dt);
    // A turn that puts the body into a wall does not happen.
    const bottom: f32 = if (b.grounded) step_up else air_bottom;
    const yaw0 = b.yaw;
    b.yaw += b.yaw_rate * dt;
    if (blockedAt(b.pos, b.yaw, bottom) and !blockedAt(b.pos, yaw0, bottom)) {
        b.yaw = yaw0;
        b.yaw_rate = 0;
    }
    // The lean of a turn: tan(roll) = v * w / g.
    const lean = std.math.clamp(std.math.atan(b.speed * b.yaw_rate / 9.81), -0.6, 0.6);
    b.roll += (-lean - b.roll) * @min(1, 6 * dt);
    if (moveFlat(b, bottom, dt, true)) return .crash;
    if (settle(b, dt, true)) return .crash;
    return .none;
}

/// The move along the ground in one tick. A wall stops the part of the
/// move into it. Returns true when a rider hits it at crash_speed or more.
fn moveFlat(b: *Bike, bottom: f32, dt: f32, rider: bool) bool {
    const dir = if (rider) fwdOf(b.yaw) * vec.s(if (b.speed < 0) @as(f32, -1) else 1) else b.slide;
    const v = @abs(b.speed);
    const d = dir * vec.s(v * dt);
    if (v < 1e-4) return false;
    if (!blockedAt(b.pos + d, b.yaw, bottom)) {
        b.pos += d;
        return false;
    }
    const bx = blockedAt(b.pos + v3(d[0], 0, 0), b.yaw, bottom);
    const bz = blockedAt(b.pos + v3(0, 0, d[2]), b.yaw, bottom);
    // The speed into the wall.
    var into: f32 = 0;
    if (bx) into += @abs(dir[0]) * v;
    if (bz) into += @abs(dir[2]) * v;
    if (!bx and !bz) into = v;
    if (rider and into >= crash_speed) return true;
    if (!bx) b.pos[0] += d[0];
    if (!bz) b.pos[2] += d[2];
    if (bx and bz or (!bx and !bz)) {
        b.speed = 0;
    } else {
        // A scrape along the wall.
        const keep = 1 - into / @max(v, 1e-3);
        b.speed *= std.math.clamp(keep, 0, 1);
        if (into > 2) event(.{ .kind = .scrape, .p = b.pos + dir * vec.s(0.8) + v3(0, 0.4, 0) });
    }
    return false;
}

/// The height in one tick: on the ground the moped follows the floor, in
/// the air it falls. Returns true for a bad landing of a rider.
fn settle(b: *Bike, dt: f32, rider: bool) bool {
    const f = fwdOf(b.yaw);
    if (b.grounded) {
        if (floorAt(b.pos, step_down, step_up)) |y| {
            // The vertical speed from the slope under the moped: the speed
            // of a jump off a ramp.
            const dir = f * vec.s(if (b.speed < 0) @as(f32, -1) else 1);
            const yb = floorAt(b.pos - dir * vec.s(0.25), 0.6, 0.6) orelse y;
            b.vy = std.math.clamp(@abs(b.speed) * (y - yb) / 0.25, -top_speed, top_speed);
            b.pos[1] = y;
        } else b.grounded = false;
        // The pitch: the floor under each wheel.
        const front = floorNear(b.pos + f * vec.s(0.6), 0.6, 0.6) orelse b.pos[1];
        const rear = floorNear(b.pos - f * vec.s(0.6), 0.6, 0.6) orelse b.pos[1];
        b.pitch += (std.math.atan((front - rear) / 1.2) - b.pitch) * @min(1, 20 * dt);
        if (b.grounded) return false;
    }
    b.vy -= gravity * dt;
    const ny = b.pos[1] + b.vy * dt;
    b.pitch *= @max(0, 1 - 1.5 * dt);
    if (b.vy > 0) {
        // A ceiling stops the climb.
        if (blockedAt(v3(b.pos[0], ny, b.pos[2]), b.yaw, air_bottom)) {
            b.vy = 0;
            return false;
        }
        b.pos[1] = ny;
        return false;
    }
    if (map.floorTop(v3(b.pos[0] - 0.15, ny, b.pos[2] - 0.15), v3(b.pos[0] + 0.15, b.pos[1] + 0.02, b.pos[2] + 0.15))) |y| {
        const impact = -b.vy;
        b.pos[1] = y;
        b.vy = 0;
        b.grounded = true;
        if (impact > 3) event(.{ .kind = .land, .p = b.pos });
        return rider and impact >= bad_landing;
    }
    b.pos[1] = ny;
    if (b.pos[1] < map.kill_y) {
        // Out of the map: it stays where it is.
        b.pos[1] = map.kill_y;
        b.vy = 0;
        b.grounded = true;
    }
    return false;
}

/// True when moped b (with a rider, at hit speed) touches a player with
/// its feet at `feet`.
pub fn touches(b: *const Bike, feet: V3) bool {
    if (@abs(b.speed) < hit_speed) return false;
    if (feet[1] + player.height < b.pos[1] or feet[1] > b.pos[1] + body_top) return false;
    const f = fwdOf(b.yaw) * vec.s(if (b.speed < 0) @as(f32, -1) else 1);
    for ([_]f32{ 0, 0.65, 1.0 }) |k| {
        const c = b.pos + f * vec.s(k);
        const dx = c[0] - feet[0];
        const dz = c[2] - feet[2];
        if (dx * dx + dz * dz < (half_w + player.radius) * (half_w + player.radius)) return true;
    }
    return false;
}

/// The hits of the moped of this client on the other players: `feet` and
/// `ids` of each live player. Deathmatch: a "hit" for each, at most one
/// each hit_gap. Returns the number of hits. The moped slows.
pub fn hits(b: *Bike, feet: []const V3, ids: []const u32, dt: f32) usize {
    var n: usize = 0;
    for (&b.hit_t) |*t| t.* = @max(0, t.* - dt);
    for (feet, ids, 0..) |p, id, i| {
        if (i >= b.hit_t.len or b.hit_t[i] > 0 or !touches(b, p)) continue;
        b.hit_t[i] = hit_gap;
        emit(.{ .kind = .hit, .bike = b.id, .victim = id, .speed = @abs(b.speed) });
        b.speed *= 0.6;
        n += 1;
    }
    return n;
}

// ---- The step -------------------------------------------------------------------------

/// Step the mopeds with no rider, and the bodies. The moped of this client
/// moves in `ride`, and the moped of another rider in `follow`.
pub fn step(dt: f32) void {
    if (asking != null) {
        ask_t -= dt;
        if (ask_t <= 0) asking = null;
    }
    for (&bikes) |*b| {
        if (!b.on or b.rider != null) continue;
        fallStep(b, dt);
    }
    for (&corpses) |*c| {
        if (c.on) c.body.step(dt);
    }
}

/// A moped with no rider: it falls on its side and slides to a stop.
fn fallStep(b: *Bike, dt: f32) void {
    if (b.fall < 1) {
        b.fall_v += 7 * dt;
        b.fall = @min(1, b.fall + b.fall_v * dt);
        b.roll += (b.fall_side * (0.35 + 0.95 * b.fall) - b.roll) * @min(1, 12 * dt);
        if (b.fall >= 1) event(.{ .kind = .fall, .p = b.pos });
    } else b.roll = b.fall_side * 1.3;
    b.pitch *= @max(0, 1 - 4 * dt);
    if (b.speed > 0) {
        b.speed = @max(0, b.speed - (if (b.fall < 1) @as(f32, 3) else 6) * dt);
        b.yaw += b.spin * dt;
        b.spin *= @max(0, 1 - 1.5 * dt);
        _ = moveFlat(b, if (b.grounded) step_up else air_bottom, dt, false);
        b.spark_t -= dt;
        if (b.fall >= 1 and b.speed > 1.2 and b.spark_t <= 0 and b.grounded) {
            b.spark_t = 0.05;
            const at = b.pos + rightOf(b.yaw) * vec.s(b.fall_side * 0.25) + v3(0, 0.04, 0);
            event(.{ .kind = .spark, .p = at, .n = vec.norm(-b.slide + v3(0, 0.6, 0)) });
        }
    }
    _ = settle(b, dt, false);
}

// ---- The model ----------------------------------------------------------------------

/// The mopeds into the dynamic mesh. main.zig draws the riders and the
/// bodies in the colours of their players (`riderPose`, `corpses`).
pub fn build(out: *mesh.Mesh) void {
    for (&bikes) |*b| {
        if (b.on) moped.buildMoped(out, frameOf(b), b.rider != null);
    }
}
