// Where: apps/action/game/src/moped.zig
// When: on Earl's Court, main.zig steps the mopeds in each tick, draws
// them, sends the outbox in deathmatch and plays the events.
// Why: Warwick Road has moped thieves. A player who walks onto the street
// with a primary weapon gets a visit: two men on a moped come along the
// road, the man at the back snatches the gun, and they leave at speed.
//
// - The trigger: the player steps onto the pavement or the road of
//   Warwick Road (`onStreet`) with a primary weapon. One visit for each
//   life (`newLife`).
// - The approach: the moped comes from `start_back` m behind the player,
//   out of view, in the left lane. It moves to the side of the player
//   and slows to the pace of the player. The thief puts his arm out.
// - The snatch: the gun goes from the player to the hand of the thief.
//   The primary slot of the player stays empty for the rest of the life.
// - The getaway: the moped accelerates along the road in its lane, and
//   it goes at the fence (`gone_at`).
// - The riders have the health of a player (`hp_full`). The roadmen do
//   not touch them.
//   - The driver dies: the moped skids, falls on its side and slides with
//     sparks. The driver is a ragdoll (ragdoll.zig). The thief jumps from
//     the moped and runs along the road, away from the crash.
//   - The thief dies: he is a ragdoll. On the moped he falls from it, and
//     the driver continues the getaway. The gun drops beside the body. F
//     takes it (`pickGun`, `takeGun`).
// - The moped leans in turns, and it buzzes as it passes
//   (moped_sound.zig).
//
// Deathmatch (main.zig, server/moped.ts), as the pigeons:
// - The client of the player decides the approach. It starts the moped at
//   once and puts "go" in `outbox`, with the place of the moped. "away"
//   stops the approach with no gun. "snatch" asks the server for the gun: the
//   moped waits beside the player for the answer.
// - The server owns the stolen gun and the health of the riders. It sends
//   "snatch" to all the players, and a "die" for each rider at 0 health,
//   with the place where the rider died. The thief death puts the gun on
//   the ground. The first "pick" from a player with an empty primary slot
//   gets it.
// - After "go", each client runs the moped toward the player from the
//   snapshots. Each event has the place, and each client starts it there:
//   the getaway, the crash, the run of the thief and each ragdoll use
//   only that place and the map. So each client sees each event at the
//   same place.
// - Offline (the tests), the module decides the snatch at once, and
//   main.zig applies the damage to the riders on the client.
//
// The module has no sound, no input and no network.
const std = @import("std");
const vec = @import("vec.zig");
const map = @import("map.zig");
const mesh = @import("mesh.zig");
const player = @import("player.zig");
const npc = @import("npc.zig");
const ragdoll = @import("ragdoll.zig");
const weapon = @import("weapon.zig");
const roadmen = @import("roadmen.zig");
const ec = @import("maps/earls_court.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;

/// The health of each rider: the same as a player.
pub const hp_full: f32 = 100;
/// The kill feed names of the riders, in the order of `Rider`.
pub const names = [2][]const u8{ "moped driver", "moped thief" };
/// The moped starts this far along the road behind the player.
pub const start_back: f32 = 70;
/// The speed of the approach, and the top speed of the getaway, m/s.
const cruise: f32 = 13;
const top_speed: f32 = 17;
const accel: f32 = 4.5;
const brake: f32 = 8;
/// The thief takes the gun from the player at this distance to the side
/// of the moped (the middle of the moped to the feet of the player).
const keep_side: f32 = 0.95;
/// The shoulder of the thief is this far behind the middle of the moped.
const thief_back: f32 = 0.3;
/// The snatch: the shoulder of the thief at most this far along the road
/// from the player, the player 0.35 to 1.8 m to the side.
const snatch_along: f32 = 0.75;
const snatch_side = [2]f32{ 0.35, 1.8 };
/// The approach stops after this long.
const give_up: f32 = 25;
/// A snatch with no answer from the server for this long stops.
const wait_answer: f32 = 1.5;
/// The moped and a running thief go at this distance along the road from
/// the exit: before the fence.
pub const gone_at: f32 = ec.warwick_fence - 6;
/// The run of the thief, m/s.
const run_speed: f32 = 7.5;
/// The lanes: this far from the middle of the road. The traffic keeps to
/// the left.
const lane_off: f32 = 2.2;
/// The skid before the fall, s.
const skid_time: f32 = 0.35;

pub const max_rides = 16;

/// The street of Warwick Road between the terraces: the road and the
/// pavements, north and south of the exit, short of the fences.
pub fn onStreet(p: V3) bool {
    return map.id == .earls_court and p[0] > west_front and p[0] < east_front and
        p[1] > ec.street_y - 0.5 and p[1] < ec.street_y + 2 and roadmen.along(p) < ec.warwick_fence;
}
const west_front = ec.warwick_lanes[0] - 1.5;
const east_front = ec.warwick_lanes[2] + 1.5;
const road_mid = ec.warwick_lanes[1];
/// The kerbs. The moped keeps to the road and the edge of the pavements:
/// the street lamps stand 0.55 m from each kerb.
const west_kerb = west_front + 3;
const east_kerb = east_front - 3;
const kerb_in: f32 = 0.15;

pub const Rider = enum(u1) { driver, thief };
pub const Stage = enum { approach, away, crash };
pub const Thief = enum { riding, running, dead, gone };

pub const Moped = struct {
    /// The ground under the middle of the moped.
    pos: V3 = v3(0, 0, 0),
    /// 0 looks to -Z, as the player.
    yaw: f32 = 0,
    /// Along the yaw, m/s. In the crash: along `slide`.
    speed: f32 = 0,
    /// The lean, radians. Positive leans right.
    roll: f32 = 0,
    yaw_rate: f32 = 0,
    /// The crash: 0 upright to 1 on its side, the side of the fall (1
    /// right, -1 left), the direction of the slide and the spin.
    fall: f32 = 0,
    fall_v: f32 = 0,
    fall_side: f32 = 1,
    slide: V3 = v3(0, 0, -1),
    spin: f32 = 0,
    /// The time to the next spark and to the next skid mark.
    spark_t: f32 = 0,
    mark_t: f32 = 0,
    /// Past the fence: not drawn, no sound.
    gone: bool = false,
};

pub const Ride = struct {
    on: bool = false,
    /// The player of the visit: its id in deathmatch, 0 offline.
    owner: u32 = 0,
    /// The player of this client: it decides the approach.
    mine: bool = false,
    stage: Stage = .approach,
    /// The time in the stage.
    t: f32 = 0,
    moped: Moped = .{},
    /// The way of the moped along the road: -1 north, 1 south.
    dir: f32 = -1,
    /// The side of the player: 1 on the right of the moped, -1 on the left.
    side: f32 = 1,
    target: V3 = v3(0, 0, 0),
    target_vel: V3 = v3(0, 0, 0),
    target_alive: bool = true,
    dead: [2]bool = .{ false, false },
    /// The health of each rider. Offline only: in deathmatch the server
    /// has it.
    hp: [2]f32 = .{ hp_full, hp_full },
    bodies: [2]ragdoll.Body = .{ .{}, .{} },
    thief: Thief = .riding,
    /// The thief on foot.
    runner: player.Player = .{},
    runner_yaw: f32 = 0,
    /// The arm of the thief: 0 in, 1 out to the side.
    reach: f32 = 0,
    /// The stolen gun. The thief holds it while `held`, else it lies at
    /// `drop`.
    gun: ?weapon.Item = null,
    held: bool = false,
    drop: ?V3 = null,
    drop_yaw: f32 = 0,
    /// A snatch that waits for the server: the time left, or < 0.
    waiting: f32 = -1,
    flinch: [2]f32 = .{ 0, 0 },
    flinch_dir: [2]V3 = .{ v3(0, 0, -1), v3(0, 0, -1) },
    /// The visit is over (a new life): the ride goes when this client
    /// cannot see it.
    ending: bool = false,
    hidden: f32 = 0,
};

pub var rides: [max_rides]Ride = @splat(.{});
/// True in deathmatch: the server answers a snatch, and the deaths come
/// from the server.
pub var net = false;
/// The player of this client had a visit in this life.
pub var used = false;

/// The events of this client for the server. `q` is the state of the
/// moped (`State`). A "pick" names the ride by its owner.
pub const OutKind = enum { go, snatch, away, pick };
pub const Out = struct { kind: OutKind, q: State = @splat(0), owner: u32 = 0 };
pub var outbox: [8]Out = undefined;
pub var out_n: usize = 0;

/// The events for main.zig: the sounds, the sparks and the gun.
pub const EventKind = enum {
    /// The thief took the gun of the player of this client.
    snatched,
    /// The gun of a picked ride goes to the player of this client.
    picked,
    skid,
    crash,
    scrape,
    spark,
    /// A body hits the ground.
    thud,
    /// A rider died: `rider`, and `who` the killer.
    died,
};
pub const Event = struct { kind: EventKind, p: V3 = v3(0, 0, 0), n: V3 = v3(0, 1, 0), ride: usize = 0, rider: Rider = .driver, who: u32 = 0 };
pub var events: [24]Event = undefined;
pub var event_n: usize = 0;

/// The state of a moped or a running thief in the messages:
/// x, y, z, yaw, speed, roll, then a direction (a shot, for a death)
/// dx, dy, dz, and 1 for the thief on foot (else 0).
pub const State = [10]f32;

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

/// Remove all the rides and the queues: a new map or a new mode.
pub fn reset() void {
    rides = @splat(.{});
    out_n = 0;
    event_n = 0;
    used = false;
    mark_n = 0;
}

/// A new life of the player of this client: a new visit can come. The
/// ride of the last life goes out of sight.
pub fn newLife() void {
    used = false;
    for (&rides) |*r| {
        if (r.on and r.mine) r.ending = true;
    }
}

fn find(owner: u32, mine: bool) ?*Ride {
    for (&rides) |*r| {
        if (r.on and !r.ending and r.mine == mine and (mine or r.owner == owner)) return r;
    }
    return null;
}

/// The ride of a player, or null.
pub fn rideOf(owner: u32, mine: bool) ?*Ride {
    return find(owner, mine);
}

fn indexOf(r: *const Ride) usize {
    return (@intFromPtr(r) - @intFromPtr(&rides[0])) / @sizeOf(Ride);
}

/// The yaw that faces the direction d (0 looks to -Z).
fn yawTo(d: V3) f32 {
    return std.math.atan2(-d[0], -d[2]);
}

fn fwdOf(yaw: f32) V3 {
    return v3(-@sin(yaw), 0, -@cos(yaw));
}

fn rightOf(yaw: f32) V3 {
    return v3(@cos(yaw), 0, -@sin(yaw));
}

fn angleDiff(a: f32, b: f32) f32 {
    return @mod(a - b + std.math.pi, std.math.tau) - std.math.pi;
}

/// A new ride with the moped at state q.
fn start(owner: u32, mine: bool, q: State) *Ride {
    var slot: ?*Ride = null;
    for (&rides) |*r| {
        if (!r.on) {
            slot = r;
            break;
        }
    }
    // All in use: the oldest ending one, else the first.
    if (slot == null) {
        for (&rides) |*r| {
            if (r.ending) {
                slot = r;
                break;
            }
        }
    }
    const s = slot orelse &rides[0];
    s.* = .{ .on = true, .owner = owner, .mine = mine };
    setMoped(s, q);
    s.dir = if (fwdOf(q[3])[2] > 0) 1 else -1;
    s.target = s.moped.pos + fwdOf(q[3]) * vec.s(start_back);
    return s;
}

/// Put the moped at state q.
fn setMoped(r: *Ride, q: State) void {
    r.moped.pos = v3(q[0], q[1], q[2]);
    r.moped.yaw = q[3];
    r.moped.speed = q[4];
    r.moped.roll = q[5];
    r.moped.yaw_rate = 0;
}

/// The state of the moped, or of the thief on foot (`rider` thief and
/// running), with the direction d.
pub fn stateOf(r: *const Ride, rider: Rider, d: V3) State {
    if (rider == .thief and r.thief == .running) {
        const p = r.runner.pos;
        return .{ p[0], p[1], p[2], r.runner_yaw, vec.len(v3(r.runner.vel[0], 0, r.runner.vel[2])), 0, d[0], d[1], d[2], 1 };
    }
    const m = r.moped;
    return .{ m.pos[0], m.pos[1], m.pos[2], m.yaw, m.speed, m.roll, d[0], d[1], d[2], 0 };
}

// ---- The player of this client ------------------------------------------------------

/// Each tick, for the player of this client: on the street with a primary
/// weapon, a moped comes. `owner` is the id of the player (0 offline).
/// `primary` is the gun in the primary slot, or null. `look` is the
/// camera: the moped comes from behind.
pub fn local(owner: u32, pos: V3, vel: V3, alive: bool, primary: ?weapon.Item, look: V3) void {
    var r = find(owner, true);
    if (r == null and !used and alive and primary != null and onStreet(pos)) {
        used = true;
        const q = startState(pos, look);
        r = start(owner, true, q);
        r.?.target = pos;
        r.?.side = sideOf(r.?, pos);
        emit(.{ .kind = .go, .q = q });
    }
    if (r) |rr| {
        rr.target = pos;
        rr.target_vel = vel;
        rr.target_alive = alive;
        if (rr.stage != .approach or rr.ending) return;
        // The gun went (a death, or a pick in the weapon menu): no snatch.
        if (rr.waiting < 0 and (primary == null or !alive or !onStreet(pos) or rr.t > give_up)) return giveUp(rr);
        if (rr.waiting >= 0) return;
        if (canSnatch(rr)) {
            if (net) {
                rr.waiting = wait_answer;
                emit(.{ .kind = .snatch, .q = stateOf(rr, .driver, v3(0, 0, 0)) });
            } else snatch(rr, stateOf(rr, .driver, v3(0, 0, 0)), primary.?);
        }
    }
}

/// The start of a moped for a player at `pos` who looks along `look`: on
/// the road start_back m behind the player, in the left lane, toward the
/// player. Short of the fences.
pub fn startState(pos: V3, look: V3) State {
    // From behind the player: the moped rides the way the player looks.
    var dir: f32 = if (look[2] < 0) -1 else 1;
    var z = pos[2] - dir * start_back;
    if (@abs(z - ec.warwick_exit_z) > gone_at - 2) {
        dir = -dir;
        z = pos[2] - dir * start_back;
    }
    z = std.math.clamp(z, ec.warwick_exit_z - gone_at + 2, ec.warwick_exit_z + gone_at - 2);
    const yaw: f32 = if (dir < 0) 0 else std.math.pi;
    return .{ road_mid + dir * lane_off, ec.street_y, z, yaw, cruise, 0, 0, 0, 0, 0 };
}

/// The side of the moped where the player is: 1 right, -1 left.
fn sideOf(r: *const Ride, p: V3) f32 {
    const right = rightOf(r.moped.yaw);
    return if (vec.dot(p - v3(road_mid, p[1], p[2]), right) >= 0) 1 else -1;
}

/// The player along the road from the shoulder of the thief (positive:
/// the player is ahead), and to the side of the moped.
fn offsets(r: *const Ride) struct { along: f32, side: f32 } {
    const m = r.moped;
    const along = (r.target[2] - m.pos[2]) * r.dir + thief_back;
    return .{ .along = along, .side = @abs(r.target[0] - m.pos[0]) };
}

fn canSnatch(r: *const Ride) bool {
    if (r.dead[0] or r.dead[1] or r.thief != .riding) return false;
    const o = offsets(r);
    const vp = r.target_vel[2] * r.dir;
    return @abs(o.along) < snatch_along and o.side > snatch_side[0] and o.side < snatch_side[1] and
        @abs(r.moped.speed - vp) < 4 and @abs(r.target[1] - r.moped.pos[1]) < 1 and r.reach > 0.8;
}

/// The approach ends with no gun: the getaway starts.
fn giveUp(r: *Ride) void {
    const q = stateOf(r, .driver, v3(0, 0, 0));
    toAway(r, q);
    emit(.{ .kind = .away, .q = q });
}

fn toAway(r: *Ride, q: State) void {
    setMoped(r, q);
    r.stage = .away;
    r.t = 0;
    r.waiting = -1;
}

/// The snatch at moped state q: the thief has the gun, and the getaway
/// starts.
fn snatch(r: *Ride, q: State, gun: weapon.Item) void {
    toAway(r, q);
    r.gun = gun;
    r.held = true;
    if (r.mine) event(.{ .kind = .snatched, .p = v3(q[0], q[1], q[2]), .ride = indexOf(r) });
}

// ---- The events of the server (deathmatch) ------------------------------------

/// Another player got a moped at state q (a "go" from the server).
pub fn applyGo(owner: u32, q: State, target: V3) void {
    if (find(owner, false) != null) return;
    const r = start(owner, false, q);
    r.target = target;
    r.side = sideOf(r, target);
}

/// The ride of a message: an existing one, else a new one at q (a player
/// who joined after the go).
fn rideFor(owner: u32, mine: bool, q: State) *Ride {
    if (find(owner, mine)) |r| return r;
    const r = start(owner, mine, q);
    r.target = r.moped.pos;
    return r;
}

/// The server gave the gun to the thief: the getaway starts at q. `gun`
/// is the stolen gun: on the client of its player the item with its
/// rounds, else a full gun of that model.
pub fn applySnatch(owner: u32, mine: bool, q: State, gun: weapon.Item) void {
    const r = rideFor(owner, mine, q);
    snatch(r, q, gun);
}

/// The moped of a player stopped the approach at q (an "away").
pub fn applyAway(owner: u32, q: State) void {
    const r = rideFor(owner, false, q);
    if (r.stage == .approach) toAway(r, q);
}

/// A rider died at state q (a "die" from the server, or a local death
/// offline). `who` is the killer: a player id.
pub fn applyDie(owner: u32, mine: bool, rider: Rider, q: State, who: u32) void {
    const r = rideFor(owner, mine, q);
    kill(r, rider, q);
    event(.{ .kind = .died, .p = v3(q[0], q[1], q[2]), .ride = indexOf(r), .rider = rider, .who = who });
}

/// A player took the gun of a ride from the ground. `who` is that player, `me` the
/// player of this client.
pub fn applyPick(owner: u32, mine: bool, who: u32, me: u32) void {
    const r = find(owner, mine) orelse return;
    if (r.drop == null) return;
    r.drop = null;
    if (who == me) event(.{ .kind = .picked, .ride = indexOf(r) });
}

/// The visit of a player is over (its new life, or it left): its ride goes
/// out of sight, and its gun on the ground goes.
pub fn applyEnd(owner: u32, mine: bool) void {
    const r = find(owner, mine) orelse return;
    r.ending = true;
    r.drop = null;
}

/// The place of another player from the snapshots, each tick.
pub fn remote(owner: u32, pos: V3, vel: V3, alive: bool) void {
    const r = find(owner, false) orelse return;
    r.target = pos;
    r.target_vel = vel;
    r.target_alive = alive;
}

// ---- Deaths ---------------------------------------------------------------------------

/// The seat of a rider on a moped, in the world.
fn seatOf(m: *const Moped, rider: Rider) V3 {
    return vec.xform(frameOf(m), if (rider == .driver) v3(0, 0.8, -0.05) else v3(0, 0.86, 0.36));
}

/// The frame of the moped: the lean, and the fall in a crash.
pub fn frameOf(m: *const Moped) Mat4 {
    return vec.translate(m.pos + v3(0, 0.17 * m.fall, 0)).mul(Mat4.rotationY(m.yaw).mul(Mat4.rotationZ(-m.roll)));
}

/// The floor under p at the street, or the street height.
fn floorAt(p: V3) f32 {
    const top = map.floorTop(p - v3(0.15, 1.5, 0.15), p + v3(0.15, 1.0, 0.15)) orelse return ec.street_y;
    return top;
}

fn kill(r: *Ride, rider: Rider, q: State) void {
    const i = @backingInt(rider);
    if (r.dead[i]) return;
    r.dead[i] = true;
    const push = v3(q[6], q[7], q[8]) * vec.s(2.5);
    switch (rider) {
        .driver => {
            setMoped(r, q);
            const vel = fwdOf(r.moped.yaw) * vec.s(r.moped.speed);
            r.bodies[0] = ragdoll.Body.start(npc.skeleton(riderPose(r, .driver)), vel, push + v3(0, 1, 0));
            r.moped.gone = false;
            r.stage = .crash;
            r.t = 0;
            r.waiting = -1;
            r.moped.slide = fwdOf(r.moped.yaw);
            // The fall: to the side of the lean, else to the right.
            r.moped.fall_side = if (r.moped.roll < -0.02) -1 else 1;
            r.moped.spin = -r.moped.fall_side * 0.9;
            event(.{ .kind = .skid, .p = r.moped.pos });
        },
        .thief => {
            var sk: npc.Skeleton = undefined;
            var vel: V3 = undefined;
            var at: V3 = undefined;
            if (q[9] > 0.5 or r.thief == .running) {
                // On foot.
                r.runner.pos = v3(q[0], q[1], q[2]);
                r.runner_yaw = q[3];
                vel = fwdOf(q[3]) * vec.s(q[4]);
                sk = npc.skeleton(.{ .pos = r.runner.pos, .yaw = q[3], .action = .run, .stride = r.runner.stride });
                at = r.runner.pos + fwdOf(q[3]) * vec.s(0.6);
            } else {
                // On the moped: he falls, and the moped continues.
                setMoped(r, q);
                vel = fwdOf(r.moped.yaw) * vec.s(r.moped.speed);
                sk = npc.skeleton(riderPose(r, .thief));
                const s = seatOf(&r.moped, .thief);
                const pf = vec.norm(v3(push[0], 0, push[2]));
                at = s + pf * vec.s(0.7);
                if (r.stage == .approach) toAway(r, q);
            }
            r.bodies[1] = ragdoll.Body.start(sk, vel, push + v3(0, 0.5, 0));
            r.thief = .dead;
            r.reach = 0;
            if (r.gun != null and r.held) {
                r.held = false;
                r.drop = v3(at[0], floorAt(at), at[2]);
                r.drop_yaw = q[3] + 1.2;
            }
        },
    }
}

/// A shot, a cut or a blast on a rider, offline: the damage. A rider at 0
/// health dies at the place where this client sees him. `who` is the
/// shooter.
pub fn hurt(ride: usize, rider: Rider, dmg: f32, d: V3, who: u32) void {
    const r = &rides[ride];
    const i = @backingInt(rider);
    if (r.dead[i]) return;
    r.hp[i] -= dmg;
    if (r.hp[i] <= 0) applyDie(r.owner, r.mine, rider, stateOf(r, rider, d), who);
}

// ---- The step -------------------------------------------------------------------------

/// Step all the rides. `eye` and `look` are the camera of this client: an
/// ending ride goes when this client cannot see it.
pub fn step(dt: f32, eye: V3, look: V3) void {
    for (&rides) |*r| {
        if (!r.on) continue;
        r.t += dt;
        if (r.waiting >= 0) {
            r.waiting -= dt;
            if (r.waiting < 0 and r.stage == .approach) giveUp(r);
        }
        for (&r.flinch) |*f| f.* = @max(0, f.* - dt * 2.5);
        switch (r.stage) {
            .approach => approach(r, dt),
            .away => away(r, dt),
            .crash => crash(r, dt),
        }
        if (r.thief == .running) run(r, dt);
        for (&r.bodies) |*b| {
            const was = b.asleep;
            b.step(dt);
            if (b.on and !was and b.still > 0 and b.still <= dt) event(.{ .kind = .thud, .p = b.centre() });
        }
        if (r.ending) {
            r.hidden = if (seen(r, eye, look)) 0 else r.hidden + dt;
            if (r.hidden > 0.5 or r.t > 60) r.on = false;
        }
    }
    fadeMarks(dt);
}

/// True when the eye can see a part of the ride.
fn seen(r: *const Ride, eye: V3, look: V3) bool {
    if (!r.moped.gone and roadmen.visible(eye, look, r.moped.pos)) return true;
    if (r.thief == .running and roadmen.visible(eye, look, r.runner.pos)) return true;
    for (r.bodies) |b| {
        if (b.on and roadmen.visible(eye, look, b.centre() - v3(0, 0.3, 0))) return true;
    }
    return false;
}

/// Turn toward a point on the road at a limited rate, lean in the turn,
/// and move.
fn drive(m: *Moped, aim: V3, want_speed: f32, dt: f32) void {
    const dv = want_speed - m.speed;
    m.speed += std.math.clamp(dv, -brake * dt, accel * dt);
    const want = yawTo(aim - m.pos);
    // The smallest turn radius is 2.5 m.
    const max_rate = std.math.clamp(m.speed / 2.5, 0.2, 2.2);
    m.yaw_rate = std.math.clamp(angleDiff(want, m.yaw) / 0.3, -max_rate, max_rate);
    m.yaw += m.yaw_rate * dt;
    // The lean of a turn: tan(roll) = v * w / g. A turn to the left (yaw
    // up) leans left.
    const lean = std.math.clamp(std.math.atan(m.speed * m.yaw_rate / 9.81), -0.6, 0.6);
    m.roll += (-lean - m.roll) * @min(1, 6 * dt);
    m.pos += fwdOf(m.yaw) * vec.s(m.speed * dt);
    // Up a kerb and down again.
    const y = floorAt(m.pos + v3(0, 0.3, 0));
    m.pos[1] += (y - m.pos[1]) * @min(1, 12 * dt);
}

fn approach(r: *Ride, dt: f32) void {
    const m = &r.moped;
    const o = offsets(r);
    // The point beside the player, on the street.
    const want_x = std.math.clamp(r.target[0] + r.dir * r.side * keep_side, west_kerb - kerb_in, east_kerb + kerb_in);
    const vp = r.target_vel[2] * r.dir;
    var want_speed = std.math.clamp(vp + 1.1 * o.along, 0, cruise);
    if (o.along < -4) want_speed = 2;
    const look = @max(3, m.speed * 0.7);
    drive(m, v3(want_x, m.pos[1], m.pos[2] + r.dir * look), want_speed, dt);
    // The arm goes out near the player.
    const near = o.side < 2.4 and @abs(o.along) < 4 and !r.dead[1] and r.thief == .riding;
    const want_reach: f32 = if (near) vec.clamp01(1.4 - @abs(o.along) / 2.5) else 0;
    r.reach += std.math.clamp(want_reach - r.reach, -3 * dt, 4 * dt);
}

fn away(r: *Ride, dt: f32) void {
    const m = &r.moped;
    if (m.gone) return;
    const lane = road_mid + r.dir * lane_off;
    drive(m, v3(lane, m.pos[1], m.pos[2] + r.dir * @max(6, m.speed)), top_speed, dt);
    r.reach = @max(0, r.reach - dt * 2.5);
    if (roadmen.along(m.pos) > gone_at) {
        m.gone = true;
        if (r.thief == .riding) {
            r.thief = .gone;
            r.held = false;
        }
    }
}

fn crash(r: *Ride, dt: f32) void {
    const m = &r.moped;
    const right = rightOf(m.yaw);
    if (r.t < skid_time) {
        // The rear wheel locks and slides out.
        m.speed = @max(0, m.speed - 8 * dt);
        m.roll += (m.fall_side * 0.35 - m.roll) * @min(1, 8 * dt);
        m.yaw += m.spin * dt;
    } else {
        if (m.fall < 1) {
            m.fall_v += 7 * dt;
            m.fall = @min(1, m.fall + m.fall_v * dt);
            if (m.fall >= 1) {
                event(.{ .kind = .crash, .p = m.pos });
                // The thief jumps from the moped on the high side, and runs.
                if (r.thief == .riding and !r.dead[1]) {
                    const at = m.pos - right * vec.s(m.fall_side * 0.8) + m.slide * vec.s(0.5);
                    r.runner = .{ .pos = v3(at[0], floorAt(at + v3(0, 0.5, 0)), at[2]), .grounded = true };
                    r.runner_yaw = if (r.dir < 0) 0 else std.math.pi;
                    r.thief = .running;
                    r.reach = 0;
                }
            }
        }
        m.roll = m.fall_side * (0.35 + (1.3 - 0.35) * m.fall);
        m.speed = @max(0, m.speed - (if (m.fall < 1) @as(f32, 6) else 4.5) * dt);
        m.yaw += m.spin * dt;
        m.spin *= @max(0, 1 - 1.5 * dt);
    }
    // The slide. A wall stops it.
    const next = m.pos + m.slide * vec.s(m.speed * dt);
    if (map.overlaps(next + v3(-0.25, 0.15, -0.25), next + v3(0.25, 0.6, 0.25))) {
        m.speed = 0;
    } else m.pos = next;
    const y = floorAt(m.pos + v3(0, 0.3, 0));
    m.pos[1] += (y - m.pos[1]) * @min(1, 12 * dt);
    // The marks on the road, and the sparks of the slide.
    m.mark_t -= dt;
    m.spark_t -= dt;
    if (m.speed > 0.5 and m.mark_t <= 0) {
        m.mark_t = 0.04;
        const rear = m.pos - fwdOf(m.yaw) * vec.s(0.55);
        const at = if (m.fall < 1) rear else m.pos + right * vec.s(m.fall_side * 0.25);
        addMark(at, m.slide, if (m.fall < 1) 0.1 else 0.22);
    }
    if (m.fall >= 1 and m.speed > 1.2 and m.spark_t <= 0) {
        m.spark_t = 0.05;
        const at = m.pos + right * vec.s(m.fall_side * 0.25) + v3(0, 0.04, 0);
        event(.{ .kind = .spark, .p = at, .n = vec.norm(-m.slide + v3(0, 0.6, 0)) });
        if (@mod(r.t, 0.1) < 0.05) event(.{ .kind = .scrape, .p = at });
    }
}

/// The thief on foot: along the road, away from the crash.
fn run(r: *Ride, dt: f32) void {
    const b = &r.runner;
    const wish = vec.norm(v3((road_mid + r.dir * 1.0 - b.pos[0]) * 0.15, 0, r.dir));
    r.runner_yaw = yawTo(wish);
    b.step(dt, wish, false, run_speed / player.walk_speed);
    if (roadmen.along(b.pos) > gone_at) {
        r.thief = .gone;
        r.held = false;
    }
}

// ---- The marks on the road ------------------------------------------------------------

const Mark = struct { p: V3, d: V3, w: f32, life: f32 };
var marks: [96]Mark = undefined;
var mark_n: usize = 0;
const mark_life: f32 = 40;

fn addMark(p: V3, d: V3, w: f32) void {
    marks[mark_n % marks.len] = .{ .p = v3(p[0], floorAt(p + v3(0, 0.3, 0)), p[2]), .d = d, .w = w, .life = mark_life };
    mark_n += 1;
}

fn fadeMarks(dt: f32) void {
    for (marks[0..@min(mark_n, marks.len)]) |*k| k.life -= dt;
}

// ---- Poses and hits -----------------------------------------------------------------

/// The pose of a rider on the moped.
pub fn riderPose(r: *const Ride, rider: Rider) npc.Pose {
    const m = &r.moped;
    const i = @backingInt(rider);
    return .{
        .pos = seatOf(m, rider),
        .yaw = m.yaw,
        .action = if (rider == .driver) .ride_driver else .ride_passenger,
        .roll = m.roll,
        .reach = if (rider == .thief) r.reach * r.side else 0,
        .flinch = r.flinch[i],
        .flinch_dir = r.flinch_dir[i],
    };
}

/// The skeleton of a live rider, or null (dead, gone or not on the
/// street).
pub fn riderSkeleton(r: *const Ride, rider: Rider) ?npc.Skeleton {
    if (r.dead[@backingInt(rider)]) return null;
    if (rider == .thief) {
        switch (r.thief) {
            .running => return npc.skeleton(.{
                .pos = r.runner.pos,
                .yaw = r.runner_yaw,
                .action = .run,
                .stride = r.runner.stride,
                .flinch = r.flinch[1],
                .flinch_dir = r.flinch_dir[1],
            }),
            .riding => {},
            .dead, .gone => return null,
        }
    }
    if (r.moped.gone or (rider == .driver and r.stage == .crash)) return null;
    return npc.skeleton(riderPose(r, rider));
}

pub const Hit = struct {
    ride: usize,
    /// The rider, or null for the moped itself.
    rider: ?Rider,
    t: f32,
    head: bool,
    normal: V3 = v3(0, 1, 0),
};

/// The body of the moped in its own frame: one box for the hits.
const body_box = [2]V3{ v3(-0.24, 0.12, -0.82), v3(0.24, 1.12, 0.98) };

/// The first rider or moped on a ray within max_t, or null.
pub fn ray(o: V3, d: V3, max_t: f32) ?Hit {
    var best: ?Hit = null;
    for (&rides, 0..) |*r, ri| {
        if (!r.on) continue;
        for ([_]Rider{ .driver, .thief }) |rider| {
            const sk = riderSkeleton(r, rider) orelse continue;
            const c = vec.xform(sk[@backingInt(npc.Part.hips)], v3(0, 0, 0));
            const along = vec.dot(c - o, d);
            if (along < -1.5 or along > max_t + 1.5) continue;
            if (vec.len(o + d * vec.s(along) - c) > 1.6) continue;
            for (npc.hitBoxes(sk), 0..) |b, k| {
                if (map.rayBox(o, d, b.min, b.max)) |h| {
                    if (h.t <= max_t and (best == null or h.t < best.?.t)) best = .{ .ride = ri, .rider = rider, .t = h.t, .head = k == 2, .normal = h.n };
                }
            }
        }
        if (r.moped.gone) continue;
        // The moped: the ray in its frame.
        const f = frameOf(&r.moped);
        const lo = toLocal(f, o);
        const ld = toLocalDir(f, d);
        if (map.rayBox(lo, ld, body_box[0], body_box[1])) |h| {
            if (h.t <= max_t and (best == null or h.t < best.?.t)) best = .{ .ride = ri, .rider = null, .t = h.t, .head = false, .normal = vec.xdir(f, h.n) };
        }
    }
    return best;
}

fn toLocal(m: Mat4, p: V3) V3 {
    const d = p - v3(m.data[12], m.data[13], m.data[14]);
    return toLocalDir(m, d);
}

fn toLocalDir(m: Mat4, d: V3) V3 {
    const x = v3(m.data[0], m.data[1], m.data[2]);
    const y = v3(m.data[4], m.data[5], m.data[6]);
    const z = v3(m.data[8], m.data[9], m.data[10]);
    return v3(vec.dot(d, x), vec.dot(d, y), vec.dot(d, z));
}

/// A shot or a cut hit a rider: he flinches. The damage comes from the
/// server (deathmatch) or from `hurt` (offline).
pub fn shoot(h: Hit, d: V3) void {
    const rider = h.rider orelse return;
    const r = &rides[h.ride];
    const i = @backingInt(rider);
    r.flinch[i] = 1;
    r.flinch_dir[i] = d;
}

/// The riders in a grenade blast: the ride, the rider and the three
/// points that the blast checks (grenade.damageTo).
pub const BlastTarget = struct { ride: usize, rider: Rider, points: [3]V3 };

pub fn blastTargets(buf: []BlastTarget) []BlastTarget {
    var n: usize = 0;
    for (&rides, 0..) |*r, ri| {
        if (!r.on) continue;
        for ([_]Rider{ .driver, .thief }) |rider| {
            if (n == buf.len) return buf[0..n];
            const sk = riderSkeleton(r, rider) orelse continue;
            const pts = npc.joints(sk);
            buf[n] = .{ .ride = ri, .rider = rider, .points = .{
                pts[@backingInt(npc.Joint.knee_l)],
                pts[@backingInt(npc.Joint.neck)] * vec.s(0.5) + pts[@backingInt(npc.Joint.pelvis)] * vec.s(0.5),
                pts[@backingInt(npc.Joint.head_top)] - v3(0, 0.12, 0),
            } };
            n += 1;
        }
    }
    return buf[0..n];
}

// ---- The stolen gun -----------------------------------------------------------------

/// The ride whose gun on the ground is under the crosshair, within reach,
/// or null.
pub fn pickGun(o: V3, d: V3, reach: f32) ?usize {
    var best: ?usize = null;
    var best_t: f32 = reach;
    for (&rides, 0..) |*r, i| {
        if (!r.on) continue;
        const p = (r.drop orelse continue) + v3(0, 0.05, 0);
        const t = vec.dot(p - o, d);
        if (t < 0 or t > best_t) continue;
        if (vec.len(o + d * vec.s(t) - p) > 0.45) continue;
        best = i;
        best_t = t;
    }
    return best;
}

/// F on the gun of ride i. Offline the gun goes back at once (an event
/// "picked"). In deathmatch the server decides (a "pick").
pub fn takeGun(i: usize) void {
    const r = &rides[i];
    if (r.drop == null) return;
    if (net) {
        emit(.{ .kind = .pick, .owner = r.owner });
        return;
    }
    r.drop = null;
    event(.{ .kind = .picked, .ride = i });
}

// ---- The model ------------------------------------------------------------------------

const body_c = v3(0.08, 0.1, 0.14);
const black = v3(0.02, 0.02, 0.022);
const rubber = v3(0.025, 0.025, 0.025);
const chrome = v3(0.55, 0.56, 0.58);
const dark_metal = v3(0.12, 0.12, 0.13);
const paint: f32 = 0;
const metal: f32 = 3;
const emissive: f32 = 4;
const cloth: f32 = 6;

fn part(out: *mesh.Mesh, f: Mat4, lo: V3, hi: V3, c: V3, mat: f32) void {
    out.orientedBox(f, lo, hi, c, mat);
}

/// A scooter with a top box, in the frame f (origin on the ground, -Z the
/// front). `lights`: the headlight and the tail light glow (the engine
/// runs).
fn buildMoped(out: *mesh.Mesh, f: Mat4, lights: bool) void {
    // The wheels: a tyre and a hub, the axle along X.
    for ([_]f32{ -0.62, 0.58 }) |wz| {
        const w = f.mul(vec.translate(v3(0, 0.2, wz)).mul(Mat4.rotationY(std.math.pi / 2.0)));
        out.disc(w, 0.2, 0.11, rubber, cloth);
        out.disc(w, 0.11, 0.12, chrome, metal);
    }
    // The front fork and the mudguard.
    for ([_]f32{ -1, 1 }) |sx| part(out, f, v3(sx * 0.075 - 0.018, 0.2, -0.66), v3(sx * 0.075 + 0.018, 0.66, -0.6), chrome, metal);
    part(out, f, v3(-0.085, 0.4, -0.8), v3(0.085, 0.45, -0.46), body_c, paint);
    // The leg shield, the floorboard and the body over the engine.
    part(out, f, v3(-0.24, 0.3, -0.54), v3(0.24, 0.96, -0.44), body_c, paint);
    part(out, f, v3(-0.2, 0.26, -0.44), v3(0.2, 0.34, 0.04), dark_metal, paint);
    part(out, f, v3(-0.2, 0.3, 0.04), v3(0.2, 0.7, 0.74), body_c, paint);
    part(out, f, v3(-0.16, 0.34, 0.74), v3(0.16, 0.64, 0.9), body_c, paint);
    // The seat: the rider, and the passenger a step higher.
    part(out, f, v3(-0.17, 0.7, -0.14), v3(0.17, 0.8, 0.3), black, cloth);
    part(out, f, v3(-0.165, 0.7, 0.3), v3(0.165, 0.86, 0.62), black, cloth);
    // The rack and the top box, with a reflector on its back.
    part(out, f, v3(-0.15, 0.8, 0.62), v3(0.15, 0.84, 0.96), chrome, metal);
    part(out, f, v3(-0.21, 0.84, 0.6), v3(0.21, 1.18, 0.99), black, paint);
    part(out, f, v3(-0.215, 1.08, 0.595), v3(0.215, 1.1, 0.995), dark_metal, paint);
    part(out, f, v3(-0.12, 0.92, 0.995), v3(0.12, 0.96, 1.005), v3(0.6, 0.04, 0.03), if (lights) emissive else paint);
    // The tail light and the yellow number plate.
    part(out, f, v3(-0.09, 0.6, 0.9), v3(0.09, 0.65, 0.915), v3(0.7, 0.05, 0.03), if (lights) emissive else paint);
    part(out, f, v3(-0.1, 0.4, 0.86), v3(0.1, 0.5, 0.875), v3(0.85, 0.7, 0.1), paint);
    // The exhaust on the right.
    part(out, f, v3(0.12, 0.17, 0.18), v3(0.2, 0.27, 0.74), dark_metal, metal);
    part(out, f, v3(0.135, 0.185, 0.74), v3(0.185, 0.255, 0.79), chrome, metal);
    // The steering: the column, the headset with the headlight, the bars
    // with the grips, and the mirrors.
    part(out, f, v3(-0.04, 0.62, -0.6), v3(0.04, 1.0, -0.52), dark_metal, metal);
    part(out, f, v3(-0.13, 0.95, -0.63), v3(0.13, 1.08, -0.46), body_c, paint);
    part(out, f, v3(-0.08, 0.98, -0.645), v3(0.08, 1.05, -0.63), v3(1.0, 0.92, 0.75), if (lights) emissive else paint);
    part(out, f, v3(-0.3, 1.01, -0.56), v3(0.3, 1.04, -0.52), dark_metal, metal);
    for ([_]f32{ -1, 1 }) |sx| {
        part(out, f, v3(sx * 0.33 - 0.04, 1.0, -0.565), v3(sx * 0.33 + 0.04, 1.05, -0.515), black, cloth);
        part(out, f, v3(sx * 0.22 - 0.01, 1.04, -0.55), v3(sx * 0.22 + 0.01, 1.22, -0.53), chrome, metal);
        part(out, f, v3(sx * 0.22 - 0.06, 1.2, -0.56), v3(sx * 0.22 + 0.06, 1.27, -0.53), black, paint);
    }
}

/// The gun of the thief in his hand.
fn buildGun(out: *mesh.Mesh, sk: npc.Skeleton, right: bool, gun: weapon.Item) void {
    const h = npc.handFrame(sk, right);
    weapon.addModel(out, gun.model, h, Mat4.identity(), 0);
}

/// The mopeds, the riders, the bodies, the guns and the marks, into the
/// dynamic mesh.
pub fn build(out: *mesh.Mesh) void {
    for (&rides) |*r| {
        if (!r.on) continue;
        if (!r.moped.gone) buildMoped(out, frameOf(&r.moped), r.stage != .crash);
        for ([_]Rider{ .driver, .thief }) |rider| {
            const sk = riderSkeleton(r, rider) orelse continue;
            npc.buildSkeleton(out, sk, false, 0);
            if (rider == .thief and r.held) {
                if (r.gun) |g| buildGun(out, sk, r.thief == .running or r.side > 0, g);
            }
        }
        for (r.bodies) |b| {
            if (b.on) npc.buildSkeleton(out, b.skeleton(), false, 0);
        }
        if (r.drop) |p| if (r.gun) |g| {
            const m = vec.translate(p + v3(0, 0.035, 0)).mul(Mat4.rotationY(r.drop_yaw).mul(Mat4.rotationZ(std.math.pi / 2.0)));
            weapon.addModel(out, g.model, m, Mat4.identity(), 0);
        };
    }
    // The marks: thin dark strips 6 mm over the road, under the paint of
    // the road markings (15 mm).
    for (marks[0..@min(mark_n, marks.len)]) |k| {
        if (k.life <= 0) continue;
        const a = vec.clamp01(k.life / 10);
        const side = v3(-k.d[2], 0, k.d[0]) * vec.s(k.w / 2);
        const fw = k.d * vec.s(0.12);
        const y = k.p[1] + 0.006;
        const c = v3(0.012, 0.012, 0.013) * vec.s(1 - 0.3 * a) + v3(0.1, 0.1, 0.11) * vec.s(1 - a);
        const p0 = v3(k.p[0], y, k.p[2]);
        out.quad(p0 - side - fw, p0 + side - fw, p0 + side + fw, p0 - side + fw, v3(0, 1, 0), c, paint);
    }
}

/// The number of rides: the tests and the debug screen.
pub fn count() usize {
    var c: usize = 0;
    for (&rides) |*r| c += @intFromBool(r.on);
    return c;
}
