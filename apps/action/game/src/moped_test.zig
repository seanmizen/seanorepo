// Where: apps/action/game/src/moped_test.zig (zig build test)
// When: after a change to the moped thieves (moped.zig), their ragdoll
// (ragdoll.zig), the NPC model (npc.zig), the loadout (weapon.zig) or
// Warwick Road (maps/earls_court.zig).
// Why: simulates the moped thieves tick by tick, offline. A player on the
// street gets a moped from out of view, and the thief takes the primary.
// One snatch in each life, and the slot stays empty. The driver death
// gives a crash and a thief on foot. The thief death drops the gun, and F
// gets it back. In deathmatch two clients get the same crash from the
// same "die".
const std = @import("std");
const testing = std.testing;
const map = @import("map.zig");
const vec = @import("vec.zig");
const ec = @import("maps/earls_court.zig");
const moped = @import("moped.zig");
const ragdoll = @import("ragdoll.zig");
const roadmen = @import("roadmen.zig");
const npc = @import("npc.zig");
const weapon = @import("weapon.zig");
const player = @import("player.zig");
const V3 = vec.V3;
const v3 = vec.v3;

const dt: f32 = 1.0 / 120.0;
const north = v3(0, 0, -1);
/// The middle of the east pavement (x).
const pave_x: f32 = ec.warwick_lanes[2];

fn setup() void {
    map.init(testing.allocator);
    map.load(.earls_court);
    moped.reset();
    moped.net = false;
}

/// A rifle and a pistol (gun models 0 and 23), with rounds.
const rifle = weapon.Item{ .class = .rifle, .model = 0, .ammo = 17, .reserve = 60 };
const pistol = weapon.Item{ .class = .pistol, .model = 23, .ammo = 12, .reserve = 36 };

/// The player of this client.
const Me = struct {
    pos: V3,
    vel: V3 = v3(0, 0, 0),
    look: V3 = north,
    alive: bool = true,
    loadout: weapon.Loadout = .{},
    snatched: u32 = 0,
    snatch_at: ?f32 = null,
    crashes: u32 = 0,
    sparks: u32 = 0,

    fn arm(self: *Me) void {
        self.loadout = .{};
        self.loadout.slots[0] = rifle;
        self.loadout.slots[1] = pistol;
        self.loadout.slots[2] = .{ .class = .knife };
    }

    fn eye(self: *const Me) V3 {
        return self.pos + v3(0, player.eye, 0);
    }
};

/// One tick offline, as main.zig does it: the snatch takes the primary,
/// a pick gives it back.
fn tick(me: *Me, t: f32) void {
    me.pos += me.vel * vec.s(dt);
    const primary = if (me.loadout.slots[0]) |it| it else null;
    moped.local(0, me.pos, me.vel, me.alive, primary, me.look);
    moped.step(dt, me.eye(), me.look);
    for (moped.events[0..moped.event_n]) |e| switch (e.kind) {
        .snatched => {
            me.snatched += 1;
            if (me.snatch_at == null) me.snatch_at = t;
            _ = me.loadout.takePrimary();
        },
        .picked => me.loadout.givePrimary(moped.rides[e.ride].gun.?),
        .crash => me.crashes += 1,
        .spark => me.sparks += 1,
        else => {},
    };
    moped.event_n = 0;
    moped.out_n = 0;
}

/// Run until `done` or `limit` s.
fn runUntil(me: *Me, t0: f32, limit: f32, comptime done: fn (*Me) bool) f32 {
    var t = t0;
    while (t < t0 + limit and !done(me)) : (t += dt) tick(me, t);
    return t;
}

fn hasSnatched(me: *Me) bool {
    return me.snatched > 0;
}

fn mine() *moped.Ride {
    return moped.rideOf(0, true).?;
}

/// The moped is near the player: 12 m or less.
fn mopedNear(me: *Me) bool {
    const r = moped.rideOf(0, true) orelse return false;
    return vec.len(r.moped.pos - me.pos) < 12;
}

test "moped: a player on the street gets a moped from out of view, and the thief takes the primary" {
    setup();
    defer map.deinit();
    // Inside the station: no moped. On the pavement: a moped.
    try testing.expect(!moped.onStreet(v3(-80, ec.street_y, ec.warwick_exit_z)));
    try testing.expect(!moped.onStreet(v3(pave_x, 0, -20)));
    try testing.expect(moped.onStreet(v3(pave_x, ec.street_y + 0.12, -20)));
    var me = Me{ .pos = v3(pave_x, ec.street_y + 0.12, ec.warwick_exit_z - 20) };
    me.arm();
    moped.local(0, me.pos, me.vel, true, rifle, me.look);
    try testing.expectEqual(@as(usize, 1), moped.out_n);
    try testing.expectEqual(moped.OutKind.go, moped.outbox[0].kind);
    moped.out_n = 0;
    // It starts behind the player, out of view, and comes north.
    const r = mine();
    try testing.expect(vec.len(r.moped.pos - me.pos) > 60);
    try testing.expect(!roadmen.visible(me.eye(), me.look, r.moped.pos));
    try testing.expect(r.moped.pos[2] > me.pos[2] and r.dir == -1);
    // The player walks slowly north. The snatch comes within 15 s.
    me.vel = north * vec.s(1.5);
    var max_roll: f32 = 0;
    var t: f32 = 0;
    while (t < 15 and me.snatched == 0) : (t += dt) {
        tick(&me, t);
        max_roll = @max(max_roll, @abs(r.moped.roll));
    }
    try testing.expectEqual(@as(u32, 1), me.snatched);
    // It pulled in to the kerb: a lean in the turn.
    try testing.expect(max_roll > 0.05);
    // The primary slot is empty, and the pistol is in the hands.
    try testing.expect(me.loadout.slots[0] == null);
    try testing.expect(me.loadout.primary_locked);
    try testing.expectEqual(weapon.Slot.secondary, me.loadout.current);
    try testing.expect(r.held and r.gun.?.ammo == rifle.ammo);
    try testing.expectEqual(moped.Stage.away, r.stage);
    // The getaway: the moped goes near the fence, with the gun.
    me.vel = v3(0, 0, 0);
    var u: f32 = 0;
    while (u < 20 and !r.moped.gone) : (u += dt) tick(&me, t + u);
    try testing.expect(r.moped.gone);
    try testing.expect(roadmen.along(r.moped.pos) > moped.gone_at - 26);
    try testing.expect(r.moped.speed > 14);
    try testing.expectEqual(moped.Thief.gone, r.thief);
    try testing.expect(r.drop == null);
}

test "moped: near the fence the moped goes when the player cannot see it" {
    setup();
    defer map.deinit();
    var me = Me{ .pos = v3(pave_x, ec.street_y + 0.12, ec.warwick_exit_z - 20) };
    me.arm();
    const t = runUntil(&me, 0, 20, hasSnatched);
    const r = mine();
    // The player turns to the south: the moped goes north out of sight.
    me.look = v3(0, 0, 1);
    var u: f32 = 0;
    while (u < 20 and !r.moped.gone) : (u += dt) tick(&me, t + u);
    try testing.expect(r.moped.gone);
    try testing.expect(roadmen.along(r.moped.pos) < moped.gone_at);
    try testing.expect(roadmen.along(r.moped.pos) > moped.gone_at - 26);
}

test "moped: one snatch in each life, and the primary slot stays empty" {
    setup();
    defer map.deinit();
    var me = Me{ .pos = v3(pave_x, ec.street_y + 0.12, ec.warwick_exit_z - 20) };
    me.arm();
    const t = runUntil(&me, 0, 20, hasSnatched);
    try testing.expectEqual(@as(u32, 1), me.snatched);
    // A new pick in the weapon menu does not fill the slot in this life.
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    try weapon.loadModels(arena.allocator());
    defer {
        weapon.models = &.{};
        arena.deinit();
    }
    me.loadout.rearm(.{ .primary = 1, .secondary = 23 }, false);
    try testing.expect(me.loadout.slots[0] == null);
    // A gun in the slot (from any place) gets no second moped in this
    // life.
    me.loadout.slots[0] = rifle;
    var u: f32 = 0;
    var go = false;
    while (u < 30) : (u += dt) {
        me.pos += me.vel * vec.s(dt);
        moped.local(0, me.pos, me.vel, true, me.loadout.slots[0], me.look);
        moped.step(dt, me.eye(), me.look);
        for (moped.outbox[0..moped.out_n]) |o| go = go or o.kind == .go;
        moped.out_n = 0;
        moped.event_n = 0;
    }
    try testing.expect(!go);
    try testing.expect(me.loadout.slots[0] != null);
    // A new life: the slot fills again, and a new moped comes.
    moped.newLife();
    me.arm();
    try testing.expect(!me.loadout.primary_locked);
    me.snatched = 0;
    _ = runUntil(&me, t + u, 20, hasSnatched);
    try testing.expectEqual(@as(u32, 1), me.snatched);
}

test "moped: the driver dies, the moped crashes and the thief runs" {
    setup();
    defer map.deinit();
    var me = Me{ .pos = v3(pave_x, ec.street_y + 0.12, ec.warwick_exit_z - 20) };
    me.arm();
    var t = runUntil(&me, 0, 20, mopedNear);
    const r = mine();
    try testing.expectEqual(moped.Stage.approach, r.stage);
    // A rifle shot in the head of the driver, from the player.
    const sk = moped.riderSkeleton(r, .driver).?;
    const head = npc.joints(sk)[@backingInt(npc.Joint.head_top)] - v3(0, 0.1, 0);
    const d = vec.norm(head - me.eye());
    const h = moped.ray(me.eye(), d, 60) orelse return error.TestNoHit;
    try testing.expectEqual(moped.Rider.driver, h.rider.?);
    moped.shoot(h, d);
    moped.hurt(h.ride, .driver, 120, d, 0);
    try testing.expectEqual(moped.Stage.crash, r.stage);
    try testing.expect(r.bodies[0].on);
    const crash_at = r.moped.pos;
    // The skid, the fall with a crash and sparks, and the thief on foot.
    t = runUntil(&me, t, 3, struct {
        fn f(m: *Me) bool {
            _ = m;
            return mine().thief == .running and mine().moped.speed < 0.1;
        }
    }.f);
    try testing.expect(me.crashes == 1 and me.sparks > 0);
    try testing.expect(@abs(r.moped.roll) > 1.2 and r.moped.fall == 1);
    try testing.expectEqual(moped.Thief.running, r.thief);
    // The player keeps the rifle: no snatch.
    try testing.expectEqual(@as(u32, 0), me.snatched);
    try testing.expect(me.loadout.slots[0] != null);
    // The thief runs on, away from the crash, and goes at the fence.
    const from = roadmen.along(r.runner.pos);
    var u: f32 = 0;
    while (u < 2) : (u += dt) tick(&me, t + u);
    try testing.expect(roadmen.along(r.runner.pos) > from + 10);
    try testing.expect(vec.len(r.moped.pos - crash_at) < 30);
    while (u < 40 and r.thief == .running) : (u += dt) tick(&me, t + u);
    try testing.expectEqual(moped.Thief.gone, r.thief);
    // The driver lies on the road.
    try testing.expect(r.bodies[0].asleep);
    try testing.expect(@abs(r.bodies[0].centre()[1] - ec.street_y) < 0.5);
}

test "moped: the thief dies, his body falls, the gun drops, and F gets it back" {
    setup();
    defer map.deinit();
    var me = Me{ .pos = v3(pave_x, ec.street_y + 0.12, ec.warwick_exit_z - 20) };
    me.arm();
    var t = runUntil(&me, 0, 20, hasSnatched);
    const r = mine();
    // A short way into the getaway: shots in the thief.
    var u: f32 = 0;
    while (u < 0.6) : (u += dt) tick(&me, t + u);
    t += u;
    const sk = moped.riderSkeleton(r, .thief).?;
    const chest = npc.joints(sk)[@backingInt(npc.Joint.neck)] - v3(0, 0.2, 0);
    const d = vec.norm(chest - me.eye());
    const h = moped.ray(me.eye(), d, 80) orelse return error.TestNoHit;
    try testing.expectEqual(moped.Rider.thief, h.rider.?);
    for (0..4) |_| moped.hurt(h.ride, .thief, 30, d, 0);
    try testing.expectEqual(moped.Thief.dead, r.thief);
    try testing.expect(r.bodies[1].on and !r.held);
    const drop = r.drop.?;
    // The moped continues with the driver.
    try testing.expectEqual(moped.Stage.away, r.stage);
    u = 0;
    while (u < 4) : (u += dt) tick(&me, t + u);
    t += u;
    try testing.expect(r.moped.gone or vec.len(r.moped.pos - drop) > 20);
    // The body lies on the street near the gun, with each part on the
    // ground or over it.
    const b = &r.bodies[1];
    try testing.expect(b.asleep);
    try testing.expect(vec.len(b.centre() - drop) < 4);
    for (b.p) |q| try testing.expect(q[1] > ec.street_y - 0.02 and q[1] < ec.street_y + 0.6);
    try testing.expectApproxEqAbs(@as(f32, ec.street_y), drop[1], 0.13);
    // The player walks to the gun and presses F on it.
    me.pos = drop + v3(1.2, 0, 0.3);
    me.pos[1] = map.floorTop(me.pos - v3(0.2, 0.5, 0.2), me.pos + v3(0.2, 0.5, 0.2)).?;
    const aim = vec.norm(drop + v3(0, 0.05, 0) - me.eye());
    try testing.expect(moped.pickGun(me.eye(), aim, 2.6) == h.ride);
    // Not from the wrong way.
    try testing.expect(moped.pickGun(me.eye(), -aim, 2.6) == null);
    moped.takeGun(h.ride);
    tick(&me, t);
    try testing.expect(r.drop == null);
    const back = me.loadout.slots[0].?;
    try testing.expectEqual(rifle.model, back.model);
    try testing.expectEqual(rifle.ammo, back.ammo);
    try testing.expectEqual(weapon.Slot.primary, me.loadout.current);
    // Still no new primary from the weapon menu, and no new moped.
    try testing.expect(me.loadout.primary_locked);
}

test "moped: in deathmatch the snatch waits for the server" {
    setup();
    defer map.deinit();
    moped.net = true;
    defer moped.net = false;
    var me = Me{ .pos = v3(pave_x, ec.street_y + 0.12, ec.warwick_exit_z - 20) };
    me.arm();
    var asked: ?moped.State = null;
    var t: f32 = 0;
    while (t < 20 and asked == null) : (t += dt) {
        me.pos += me.vel * vec.s(dt);
        moped.local(7, me.pos, me.vel, true, me.loadout.slots[0], me.look);
        moped.step(dt, me.eye(), me.look);
        for (moped.outbox[0..moped.out_n]) |o| {
            if (o.kind == .snatch) asked = o.q;
        }
        moped.out_n = 0;
        try testing.expectEqual(@as(usize, 0), moped.event_n);
    }
    const q = asked orelse return error.TestNoSnatch;
    const r = moped.rideOf(7, true).?;
    try testing.expect(r.waiting > 0 and !r.held);
    // The server says yes: the thief has the gun at q.
    moped.applySnatch(7, true, q, rifle);
    try testing.expect(r.held and r.stage == .away);
    try testing.expectEqual(moped.EventKind.snatched, moped.events[0].kind);
}

/// The state of a ride after a crash, for the comparison of two clients.
const Snap = struct { moped: V3, runner: V3, pelvis: V3, roll: f32 };

fn crashFrom(q: moped.State, owner: u32, mine_ride: bool, eye: V3) Snap {
    moped.applyDie(owner, mine_ride, .driver, q, 3, 0);
    const r = moped.rideOf(owner, mine_ride).?;
    var u: f32 = 0;
    while (u < 3) : (u += dt) {
        moped.step(dt, eye, north);
        moped.event_n = 0;
    }
    return .{ .moped = r.moped.pos, .runner = r.runner.pos, .pelvis = r.bodies[0].centre(), .roll = r.moped.roll };
}

test "moped: in deathmatch two clients see the crash at the same place" {
    setup();
    defer map.deinit();
    // Client A: its player gets a moped. Its approach decides.
    var me = Me{ .pos = v3(pave_x, ec.street_y + 0.12, ec.warwick_exit_z - 20) };
    me.arm();
    moped.local(0, me.pos, me.vel, true, rifle, me.look);
    const go = moped.outbox[0].q;
    _ = runUntil(&me, 0, 20, mopedNear);
    // A shot of player 3 kills the driver: the server sends this state.
    const q = moped.stateOf(mine(), .driver, v3(0.3, 0, -0.95));
    const eye = me.eye();
    const a = crashFrom(q, 0, true, eye);
    // Client B: the moped of player 7 from the go, a part of the approach
    // from the snapshots, then the same "die".
    moped.reset();
    moped.applyGo(7, go, me.pos);
    var u: f32 = 0;
    while (u < 1) : (u += dt) {
        moped.remote(7, me.pos, v3(0, 0, 0), true);
        moped.step(dt, eye, north);
        try testing.expectEqual(@as(usize, 0), moped.out_n);
    }
    const b = crashFrom(q, 7, false, eye);
    try testing.expect(vec.len(a.moped - b.moped) < 1e-4);
    try testing.expect(vec.len(a.runner - b.runner) < 1e-4);
    try testing.expect(vec.len(a.pelvis - b.pelvis) < 1e-4);
    try testing.expectApproxEqAbs(a.roll, b.roll, 1e-4);
}

test "ragdoll: a body falls to the ground, keeps its parts and sleeps" {
    setup();
    defer map.deinit();
    const at = v3(ec.warwick_lanes[1], ec.street_y + 1, ec.warwick_exit_z - 30);
    var b = ragdoll.Body.start(npc.skeleton(.{ .pos = at, .yaw = 0.4, .action = .run, .stride = 0.7 }), v3(0, 0, -6), v3(0.5, 1, 0));
    const lens = struct {
        fn of(p: npc.Joints) [4]f32 {
            const J = npc.Joint;
            return .{
                vec.len(p[@backingInt(J.shoulder_l)] - p[@backingInt(J.elbow_l)]),
                vec.len(p[@backingInt(J.hip_r)] - p[@backingInt(J.knee_r)]),
                vec.len(p[@backingInt(J.knee_r)] - p[@backingInt(J.foot_r)]),
                vec.len(p[@backingInt(J.pelvis)] - p[@backingInt(J.neck)]),
            };
        }
    }.of;
    const l0 = lens(npc.joints(npc.skeleton(.{ .pos = at, .yaw = 0 })));
    var t: f32 = 0;
    while (t < 6 and !b.asleep) : (t += dt) b.step(dt);
    try testing.expect(b.asleep);
    // It slid on from the run, and lies on the road.
    try testing.expect(b.centre()[2] < at[2] - 1);
    for (b.p) |q| try testing.expect(q[1] > ec.street_y - 0.02 and q[1] < ec.street_y + 0.5);
    for (lens(b.p), l0) |l, r| try testing.expectApproxEqAbs(r, l, 0.03);
}
