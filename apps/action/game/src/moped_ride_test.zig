// Where: apps/action/game/src/moped_ride_test.zig (zig build test)
// When: after a change to the rideable moped (moped_ride.zig), the moped
// thieves (moped.zig), the ticket gates (gates.zig), the junk ramp or the
// floors of Earl's Court (maps/earls_court.zig).
// Why: rides the moped tick by tick on Earl's Court. A crash leaves one
// moped, F gets on it and Space gets off. The junk ramp jumps the gate line
// into the passage with no fare dodge, and on foot the rule is the same.
// The moped rides into the station, down the stairs and an escalator. A
// wall at speed throws the rider, and a lift cab stops a moped. A hit does
// damage by the speed. Two clients see the same moped stop at the same
// place, and a rider who dies is a ragdoll.
const std = @import("std");
const testing = std.testing;
const map = @import("map.zig");
const vec = @import("vec.zig");
const ec = @import("maps/earls_court.zig");
const moped = @import("moped.zig");
const ride = @import("moped_ride.zig");
const gates = @import("gates.zig");
const player = @import("player.zig");
const roadmen = @import("roadmen.zig");
const V3 = vec.V3;
const v3 = vec.v3;

const dt: f32 = 1.0 / 120.0;
/// The yaw that looks to +X (east), and to -Z (north).
const east: f32 = -std.math.pi / 2.0;
const north: f32 = 0;

fn setup() void {
    map.init(testing.allocator);
    map.load(.earls_court);
    moped.reset();
    ride.reset();
    ride.net = false;
    _ = gates.step(dt, null, null, &.{}, player.radius, player.height, .foot);
}

/// A moped of this client at p, with the player on it.
fn bikeAt(p: V3, yaw: f32) *ride.Bike {
    const b = ride.add(1, 0, p, yaw, 1);
    ride.mount(b, 0, true);
    return b;
}

fn angleDiff(a: f32, b: f32) f32 {
    return @mod(a - b + std.math.pi, std.math.tau) - std.math.pi;
}

/// The keys that steer moped b toward the point `to` on the ground, at
/// most at `max_speed`.
fn steerTo(b: *const ride.Bike, to: V3, max_speed: f32) ride.Input {
    const d = to - b.pos;
    const want = std.math.atan2(-d[0], -d[2]);
    const diff = angleDiff(want, b.yaw);
    const fast = b.speed > max_speed or (@abs(diff) > 0.5 and b.speed > 4);
    return .{ .throttle = if (fast) 0 else 1, .steer = std.math.clamp(-diff * 3, -1, 1) };
}

fn flat(d: V3) f32 {
    return @sqrt(d[0] * d[0] + d[2] * d[2]);
}

/// Ride moped b along the points, each within 1.5 m. Fails on a crash.
fn rideThrough(b: *ride.Bike, pts: []const V3, max_speed: f32, limit: f32) !void {
    var t: f32 = 0;
    for (pts) |p| {
        while (flat(p - b.pos) > 1.5) : (t += dt) {
            if (t > limit) {
                std.debug.print("stuck at ({d:.2} {d:.2} {d:.2}) on the way to ({d:.1} {d:.1} {d:.1})\n", .{ b.pos[0], b.pos[1], b.pos[2], p[0], p[1], p[2] });
                return error.TestStuck;
            }
            try testing.expectEqual(ride.Outcome.none, ride.ride(b, steerTo(b, p, max_speed), dt));
            ride.event_n = 0;
        }
    }
}

test "moped ride: a crash leaves one moped, F gets on, W rides, Space gets off (REQ-MOPED-001)" {
    setup();
    defer map.deinit();
    // A moped of player 5 on Warwick Road. A shot kills its driver.
    const q: moped.State = .{ ec.warwick_lanes[1] + 2.2, ec.street_y, ec.warwick_exit_z - 30, 0, 12, 0, 0.3, 0, -0.9, 0 };
    moped.applyGo(5, q, v3(ec.warwick_lanes[2], ec.street_y, ec.warwick_exit_z - 30));
    moped.applyDie(5, false, .driver, q, 3, 0);
    const r = moped.rideOf(5, false).?;
    var rested: ?usize = null;
    var t: f32 = 0;
    while (t < 8 and rested == null) : (t += dt) {
        moped.step(dt, v3(0, 10, 0), v3(0, 0, -1));
        for (moped.events[0..moped.event_n]) |e| {
            if (e.kind == .rest) rested = e.ride;
        }
        moped.event_n = 0;
    }
    try testing.expect(rested != null);
    try testing.expect(r.moped.gone and r.rested and r.bike != 0);
    const b = ride.add(r.bike, r.owner, r.moped.pos, r.moped.yaw, r.moped.fall_side);
    try testing.expectEqual(@as(usize, 1), ride.count());
    try testing.expect(b.fall == 1 and b.rider == null);
    // A player beside it looks at it: F gets on. It stands up.
    const eye = b.pos + v3(1.6, 1.6, 0);
    const i = ride.aim(eye, vec.norm(b.pos + v3(0, 0.3, 0) - eye)) orelse return error.TestNoAim;
    ride.tryMount(i);
    try testing.expect(b.mine and b.rider.? == 0 and b.fall == 0);
    try testing.expect(ride.mineBike() == b);
    // W: it rides north along the road and leans in a turn.
    b.pos[0] = ec.warwick_lanes[1];
    b.yaw = north;
    const start = b.pos;
    var max_roll: f32 = 0;
    t = 0;
    while (t < 3) : (t += dt) {
        const steer: f32 = if (t > 2 and t < 2.3) 1 else if (t >= 2.3 and t < 2.6) -1 else 0;
        try testing.expectEqual(ride.Outcome.none, ride.ride(b, .{ .throttle = 1, .steer = steer }, dt));
        max_roll = @max(max_roll, b.roll);
    }
    try testing.expect(b.speed > 9);
    try testing.expect(start[2] - b.pos[2] > 12);
    try testing.expect(max_roll > 0.1);
    // S brakes, and reverses.
    t = 0;
    while (t < 3) : (t += dt) _ = ride.ride(b, .{ .throttle = -1 }, dt);
    try testing.expect(b.speed < 0);
    // Space: off at speed. The player stands beside the moped, and the
    // moped falls on its side and stops.
    t = 0;
    while (t < 2) : (t += dt) _ = ride.ride(b, .{ .throttle = 1 }, dt);
    const at = b.pos;
    try testing.expect(ride.leave(.jump) == b);
    try testing.expect(b.rider == null and !b.mine);
    const feet = ride.dismountSpot(b);
    try testing.expect(!map.overlaps(feet + v3(-player.radius, 0.02, -player.radius), feet + v3(player.radius, player.height, player.radius)));
    t = 0;
    while (t < 6) : (t += dt) ride.step(dt);
    try testing.expect(b.fall == 1 and b.speed == 0);
    try testing.expect(flat(b.pos - at) > 1);
    // A new crash of the same player: the old moped is a wreck, and F does
    // nothing on it.
    _ = ride.add(r.bike + 1, r.owner, b.pos + v3(0, 0, -6), 0, 1);
    try testing.expect(b.wreck);
    const eye2 = b.pos + v3(1.6, 1.6, 0);
    try testing.expectEqual(@as(?usize, null), ride.aim(eye2, vec.norm(b.pos + v3(0, 0.3, 0) - eye2)));
}

/// Ride from Warwick Road at the junk ramp. Returns the crossing of the
/// gate line (the gates step of the moped and of the same move on foot),
/// the height at the line, the speed at the lip and the place of the
/// landing.
const Jump = struct { moped: gates.Cross = .none, foot: gates.Cross = .none, y: f32 = 0, lip_speed: f32 = 0, land_x: f32 = 0 };

fn jumpFrom(x: f32) !Jump {
    const b = bikeAt(v3(x, ec.street_y, -2), east);
    var out: Jump = .{};
    var flew = false;
    var t: f32 = 0;
    while (t < 8 and out.land_x == 0) : (t += dt) {
        const before = b.pos;
        const was_ground = b.grounded;
        try testing.expectEqual(ride.Outcome.none, ride.ride(b, .{ .throttle = 1 }, dt));
        ride.event_n = 0;
        if (was_ground and !b.grounded and before[0] > ec.junk_ramp.x0) {
            flew = true;
            out.lip_speed = b.speed;
        }
        if (flew and b.grounded) out.land_x = b.pos[0];
        const c = gates.step(dt, before, b.pos, &.{}, player.radius, player.height, .moped);
        if (c != .none) {
            out.moped = c;
            out.y = b.pos[1];
            // The same move on foot.
            _ = gates.step(dt, null, null, &.{}, player.radius, player.height, .foot);
            out.foot = gates.step(dt, before, b.pos, &.{}, player.radius, player.height, .foot);
        }
    }
    return out;
}

test "moped ride: the junk ramp jumps the gate line into the passage, with no fare dodge (REQ-MOPED-003, REQ-MOPED-004)" {
    setup();
    defer map.deinit();
    // From the hoarding across the road: about 14 m to the ramp.
    const j = try jumpFrom(-95);
    errdefer std.debug.print("jump {any}\n", .{j});
    try testing.expect(j.lip_speed > 10);
    // Over the paddles (1.15 m) and the cabinets.
    try testing.expectEqual(gates.Cross.jumped, j.moped);
    try testing.expect(j.y > ec.street_y + 1.2);
    // The same crossing on foot is a fare dodge.
    try testing.expectEqual(gates.Cross.dodged, j.foot);
    // It lands in the passage, past the gates.
    try testing.expect(j.land_x > -73.4 and j.land_x < -66.4);
}

test "gates: on foot a jump from the junk ramp over the gate line is still a fare dodge (REQ-MOPED-004)" {
    setup();
    defer map.deinit();
    // The ramp is solid: a player walks up it.
    var p = player.Player{ .pos = v3(-83, ec.street_y, -2), .grounded = true };
    var t: f32 = 0;
    while (t < 3 and p.pos[0] < ec.junk_ramp.x1 - 0.6) : (t += dt) p.step(dt, v3(1, 0, 0), false, 1);
    try testing.expect(p.pos[1] > ec.street_y + 0.9);
    // A running jump from the lip, over the gates.
    p = .{ .pos = v3(ec.junk_ramp.x1, ec.junk_ramp.y1, -2), .vel = v3(player.walk_speed, 0, 0), .grounded = true };
    var cross: gates.Cross = .none;
    var jump = true;
    t = 0;
    while (t < 3 and cross == .none) : (t += dt) {
        const before = p.pos;
        p.step(dt, v3(1, 0, 0), jump, 1);
        jump = false;
        const c = gates.step(dt, before, p.pos, &.{}, player.radius, player.height, .foot);
        if (c != .none) cross = c;
    }
    try testing.expectEqual(gates.Cross.dodged, cross);
}

test "moped ride: into the station, the concourse, down the stairs onto a platform (REQ-MOPED-002)" {
    setup();
    defer map.deinit();
    // From the passage past the gates to the west concourse, then down the
    // stairs to island A of the District line.
    const b = bikeAt(v3(-71, ec.street_y, -2), east);
    try rideThrough(b, &.{
        v3(-62, 0, -2),
        v3(-52, 0, -12.8),
        v3(-47, 0, -12.8),
        v3(-36.5, 0, -12.8),
    }, 7, 30);
    try testing.expectApproxEqAbs(@as(f32, 0), b.pos[1], 0.05);
    try testing.expect(b.grounded);
}

test "moped ride: down an escalator to the deep level (REQ-MOPED-002)" {
    setup();
    defer map.deinit();
    const z = ec.esc_lane_z[0];
    const b = bikeAt(v3(ec.esc_top_x - 5, ec.mid_y, z), east);
    try rideThrough(b, &.{ v3(ec.esc_top_x, 0, z), v3(ec.esc_bottom_x + 3, 0, z) }, 5, 30);
    try testing.expectApproxEqAbs(ec.deep_y, b.pos[1], 0.1);
}

test "moped ride: a wall at speed throws the rider, a bump does not, and a lift cab stops a moped (REQ-MOPED-002)" {
    setup();
    defer map.deinit();
    // North across the west concourse into its wall at full speed.
    var b = bikeAt(v3(-55, ec.street_y, -12), north);
    var out: ride.Outcome = .none;
    var t: f32 = 0;
    while (t < 5 and out == .none) : (t += dt) out = ride.ride(b, .{ .throttle = 1 }, dt);
    try testing.expectEqual(ride.Outcome.crash, out);
    try testing.expect(b.pos[2] > -25 + 0.8);
    // Slowly into the same wall: it stops.
    ride.reset();
    b = bikeAt(v3(-55, ec.street_y, -22), north);
    t = 0;
    while (t < 3) : (t += dt) try testing.expectEqual(ride.Outcome.none, ride.ride(b, .{ .throttle = 1 }, dt));
    try testing.expect(b.speed == 0);
    // The cab floor of each lift is a wall to a moped. The floor next to
    // the District lift on its island is not.
    for (map.lifts[0..map.lift_count]) |l| {
        const fb = map.boxes[l.floor_box];
        const c = (fb.min + fb.max) * vec.s(0.5);
        try testing.expect(!ride.fits(v3(c[0], fb.max[1], c[2]), 0));
    }
    try testing.expect(ride.fits(v3(-5, 0, -12.8), east));
}

test "moped ride: a hit on a player does damage by the speed" {
    setup();
    defer map.deinit();
    try testing.expectEqual(@as(f32, 0), ride.hitDamage(2));
    try testing.expect(ride.hitDamage(8) > 20 and ride.hitDamage(8) < ride.hitDamage(14));
    try testing.expectEqual(@as(f32, 100), ride.hitDamage(30));
    const b = bikeAt(v3(-55, ec.street_y, -2), north);
    b.speed = 10;
    const ahead = [_]V3{b.pos + v3(0, 0, -0.9)};
    const ids = [_]u32{4};
    try testing.expectEqual(@as(usize, 1), ride.hits(b, &ahead, &ids, dt));
    try testing.expectEqual(ride.OutKind.hit, ride.outbox[0].kind);
    try testing.expectEqual(@as(u32, 4), ride.outbox[0].victim);
    try testing.expect(ride.outbox[0].speed == 10 and b.speed < 10);
    // Once each 0.6 s, and not at a walk.
    try testing.expectEqual(@as(usize, 0), ride.hits(b, &ahead, &ids, dt));
    ride.out_n = 0;
    b.speed = 2;
    b.hit_t = @splat(0);
    try testing.expectEqual(@as(usize, 0), ride.hits(b, &ahead, &ids, dt));
    // A player to the side is safe.
    b.speed = 10;
    const side = [_]V3{b.pos + v3(1.5, 0, 0)};
    try testing.expectEqual(@as(usize, 0), ride.hits(b, &side, &ids, dt));
}

/// The place where moped 1 stops after an "off" at q.
fn stopFrom(q: ride.State, died: bool) V3 {
    const b = ride.find(1).?;
    ride.applyOff(1, q, false, died, 9);
    var t: f32 = 0;
    while (t < 6) : (t += dt) {
        ride.step(dt);
        ride.event_n = 0;
    }
    return b.pos;
}

test "moped ride: in deathmatch two clients see the moped stop at the same place, and a rider who dies is a ragdoll" {
    setup();
    defer map.deinit();
    ride.net = true;
    defer ride.net = false;
    // Client A: its player rides along the concourse and gets off. The
    // "off" goes to the server.
    const b = ride.add(1, 3, v3(-60, ec.street_y, 8), north, 1);
    _ = ride.applyMount(1, 0, true, ride.stateOf(b));
    var t: f32 = 0;
    while (t < 2) : (t += dt) _ = ride.ride(b, .{ .throttle = 1, .steer = 0.2 }, dt);
    _ = ride.leave(.jump);
    try testing.expectEqual(ride.OutKind.off, ride.outbox[0].kind);
    const q = ride.outbox[0].q;
    ride.out_n = 0;
    // The two clients slide it from the same state.
    const a = stopFrom(q, false);
    ride.reset();
    _ = ride.add(1, 3, v3(-60, ec.street_y, 8), north, 1);
    _ = ride.applyMount(1, 9, false, .{ -60, ec.street_y, 8, north, 0, 0, 0 });
    const c = stopFrom(q, true);
    try testing.expect(vec.len(a - c) < 1e-4);
    // The rider died on client B: a ragdoll that lies on the floor.
    const body = ride.corpseOf(9) orelse return error.TestNoBody;
    try testing.expect(body.body.asleep);
    for (body.body.p) |p| try testing.expect(p[1] > ec.street_y - 0.05 and p[1] < ec.street_y + 0.6);
}

test "moped ride: a roadman near a rider past the line pulls him off" {
    setup();
    defer map.deinit();
    roadmen.reset();
    defer roadmen.reset();
    const feet = v3(ec.warwick_lanes[1], ec.street_y, ec.warwick_exit_z - roadmen.line - 10);
    roadmen.gangs[0] = .{ .on = true, .mine = true, .target = feet };
    roadmen.gangs[0].men[0].body.pos = feet + v3(3, 0, 0);
    roadmen.gangs[0].men[1].body.pos = feet + v3(-6, 0, 0);
    try testing.expect(!roadmen.knocks(feet));
    roadmen.gangs[0].men[0].body.pos = feet + v3(0.9, 0, 0.4);
    try testing.expect(roadmen.knocks(feet));
    // A gang that walks away does not.
    roadmen.gangs[0].state = .leave;
    try testing.expect(!roadmen.knocks(feet));
}
