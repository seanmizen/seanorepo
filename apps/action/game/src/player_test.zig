// Where: apps/action/game/src/player_test.zig (zig build test)
// When: after a change to the player movement (player.zig), the collision
// or the lifts (map.zig), or the stairs, escalators and lifts of a map.
// Why: walks a player over each staircase and escalator of Earl's Court,
// natively and with no browser. Each walk checks that:
//   - the feet stay on the ground,
//   - nothing stops the player (for example the head on a ceiling edge),
//   - the eye height changes by a small amount in each tick,
//   - the head bob follows the walking speed.
// It also rides each lift up and down from six places in the cab, at the
// lift speed, at 60 m/s and with server corrections. The feet must stay on
// the cab floor and the body out of all solid shapes. Then the player walks
// out onto the landing and back in.
const std = @import("std");
const map = @import("map.zig");
const player = @import("player.zig");
const ec = @import("maps/earls_court.zig");
const vec = @import("vec.zig");
const V3 = vec.V3;
const v3 = vec.v3;

/// The game tick (main.zig tick_hz).
const dt: f32 = 1.0 / 120.0;
/// The largest change of the eye height in one tick. A step of the stairs
/// is 0.4 m: a jump of the view is much more than this.
const max_eye_step: f32 = 0.05;

const Walk = struct {
    name: []const u8,
    start: V3,
    /// The direction of travel along X, 1 or -1.
    dir: f32,
    /// True to walk, false to stand on an escalator.
    walk: bool = true,
    /// The end is past end_x, at the height end_y.
    end_x: f32,
    end_y: f32,
    /// The time limit in seconds.
    time: f32,
};

const Result = struct {
    reached: bool = false,
    end: V3 = v3(0, 0, 0),
    air_ticks: usize = 0,
    /// Ticks in which the player walked but moved less than half the walk
    /// speed along X: something stopped the body or the head.
    stopped_ticks: usize = 0,
    max_eye_step: f32 = 0,
    min_bob: f32 = 10,
    max_bob: f32 = 0,
};

fn run(w: Walk) Result {
    var p: player.Player = .{ .pos = w.start };
    // Land and come to rest.
    for (0..120) |_| p.step(dt, v3(0, 0, 0), false, 1);
    var r: Result = .{};
    var prev_eye = p.eyePos()[1];
    const wish = if (w.walk) v3(w.dir, 0, 0) else v3(0, 0, 0);
    const limit: usize = @intFromFloat(w.time / dt);
    var t: usize = 0;
    while (t < limit) : (t += 1) {
        const before = p.pos;
        p.step(dt, wish, false, 1);
        const eye = p.eyePos()[1];
        r.max_eye_step = @max(r.max_eye_step, @abs(eye - prev_eye));
        prev_eye = eye;
        if (!p.grounded) r.air_ticks += 1;
        // After 0.25 s the player walks at full speed.
        if (t > 30) {
            if (w.walk and @abs(p.pos[0] - before[0]) < 3.2 * dt) r.stopped_ticks += 1;
            r.min_bob = @min(r.min_bob, p.bob);
            r.max_bob = @max(r.max_bob, p.bob);
        }
        if ((p.pos[0] - w.end_x) * w.dir > 0 and @abs(p.pos[1] - w.end_y) < 0.01) {
            r.reached = true;
            break;
        }
    }
    r.end = p.pos;
    return r;
}

fn check(w: Walk) !void {
    const r = run(w);
    errdefer std.debug.print("{s}: reached {} end ({d:.2} {d:.2} {d:.2}) air {d} stopped {d} eye step {d:.3} bob {d:.2}..{d:.2}\n", .{
        w.name, r.reached, r.end[0], r.end[1], r.end[2], r.air_ticks, r.stopped_ticks, r.max_eye_step, r.min_bob, r.max_bob,
    });
    try std.testing.expect(r.reached);
    try std.testing.expectEqual(@as(usize, 0), r.air_ticks);
    try std.testing.expectEqual(@as(usize, 0), r.stopped_ticks);
    try std.testing.expect(r.max_eye_step <= max_eye_step);
    if (w.walk) {
        // Walking: the bob follows the speed on the ground (1 at the walk
        // speed), on the stairs too.
        try std.testing.expect(r.min_bob > 0.9 and r.max_bob < 1.1);
    } else {
        // Riding an escalator is not walking: no bob.
        try std.testing.expect(r.max_bob < 0.05);
    }
}

fn loadEarlsCourt() void {
    map.init(std.testing.allocator);
    map.load(.earls_court);
}

fn unload() void {
    map.deinit();
}

// The island centres and the stair wells (maps/earls_court.zig).
const islands = [_]f32{ -12.8, 4.4 };
const z_offsets = [_]f32{ -0.7, 0, 0.7 };

test "the stairs from the islands down to the intermediate level, down and up" {
    loadEarlsCourt();
    defer unload();
    for (islands) |cz| for (z_offsets) |dz| for ([_]f32{ -1, 1 }) |side| {
        const z = cz + dz;
        // The wells are from |x| = 22 to 29. The stairs go down outward.
        try check(.{ .name = "island down", .start = v3(20 * side, 0, z), .dir = side, .end_x = 30.5 * side, .end_y = ec.mid_y, .time = 3 });
        try check(.{ .name = "island up", .start = v3(30.5 * side, ec.mid_y, z), .dir = -side, .end_x = 20 * side, .end_y = 0, .time = 3 });
    };
}

test "the stairs from the concourses down to the islands, down and up" {
    loadEarlsCourt();
    defer unload();
    for (islands) |cz| for (z_offsets) |dz| for ([_]f32{ -1, 1 }) |side| {
        const z = cz + dz;
        // The concourse edges are at |x| = 45, the stairs go down inward to
        // |x| = 39. The benches start at |x| = 37.
        try check(.{ .name = "concourse down", .start = v3(47 * side, ec.street_y, z), .dir = -side, .end_x = 37.8 * side, .end_y = 0, .time = 3 });
        try check(.{ .name = "concourse up", .start = v3(37.8 * side, 0, z), .dir = side, .end_x = 47 * side, .end_y = ec.street_y, .time = 3 });
    };
}

test "the escalators: walk and ride, down and up" {
    loadEarlsCourt();
    defer unload();
    // The north lane goes down (east), the south lane comes up.
    const down_z: f32 = -23.35;
    const up_z: f32 = -21.65;
    const top = ec.esc_top_x;
    const bottom = ec.esc_bottom_x;
    try check(.{ .name = "escalator walk down", .start = v3(top - 2, ec.mid_y, down_z), .dir = 1, .end_x = bottom + 1, .end_y = ec.deep_y, .time = 5 });
    try check(.{ .name = "escalator walk up", .start = v3(bottom + 1, ec.deep_y, up_z), .dir = -1, .end_x = top - 2, .end_y = ec.mid_y, .time = 5 });
    // Stand on the escalator near its start, and ride to the floor at its
    // end (0.65 m/s).
    const ride_time = (bottom - top) / 0.65 + 2;
    try check(.{ .name = "escalator ride down", .start = v3(top + 0.6, ec.mid_y, down_z), .dir = 1, .walk = false, .end_x = bottom + 0.3, .end_y = ec.deep_y, .time = ride_time });
    try check(.{ .name = "escalator ride up", .start = v3(bottom - 0.6, ec.deep_y + 1, up_z), .dir = -1, .walk = false, .end_x = top + 0.05, .end_y = ec.mid_y, .time = ride_time });
}

// ---- The lifts -------------------------------------------------------------

/// One game tick near the lifts, in the order of main.zig tick: find the
/// platform under the feet, let the server correct the lift (`fix`: the
/// cab height of the server), step the lifts, ride, and then the player
/// step.
fn liftTick(p: *player.Player, i: usize, wish: V3, fix: ?f32) void {
    const on = map.platformUnder(p.pos);
    if (fix) |y| {
        const l = map.lifts[i];
        map.syncLift(i, y, l.door, l.level, @backingInt(l.phase));
    }
    map.stepLifts(dt);
    if (on) |pl| p.ride(pl);
    p.step(dt, wish, false, 1);
}

/// Put lift i at level lv with its doors open.
fn parkLift(i: usize, lv: usize) void {
    const l = &map.lifts[i];
    l.y = l.levels[lv];
    l.level = lv;
    l.door = 1;
    l.phase = .open;
    l.hold = map.door_hold;
    l.pending = null;
    // syncLift places the cab and the doors.
    map.syncLift(i, l.y, l.door, lv, @backingInt(map.Phase.open));
}

fn bodyFree(p: V3) bool {
    return !map.overlaps(p - v3(player.radius, 0, player.radius), p + v3(player.radius, player.height, player.radius));
}

/// The places in a cab: the centre, the four corners (two of them against
/// the doors), and the middle of the doors.
const Spot = enum { centre, door_left, door_right, back_left, back_right, doors };

/// The plan of a lift, in arrays (a vector takes no index that is known
/// only at run time). `a` runs along the doors. `b` goes across them, and
/// `out` is the direction along b from the cab to the landing.
const Cab = struct {
    a: usize,
    b: usize,
    min: [3]f32,
    max: [3]f32,
    mid_a: f32,
    face_b: f32,
    out: f32,

    fn of(i: usize) Cab {
        const l = map.lifts[i];
        const fb = map.boxes[l.floor_box];
        const a: usize = if (l.door_on_x) 2 else 0;
        const b: usize = if (l.door_on_x) 0 else 2;
        const d0_min: [3]f32 = l.door_closed[0][0][0];
        const d0_max: [3]f32 = l.door_closed[0][0][1];
        const d1_max: [3]f32 = l.door_closed[0][1][1];
        const mn: [3]f32 = fb.min;
        const mx: [3]f32 = fb.max;
        const face_b = (d0_min[b] + d0_max[b]) / 2;
        return .{
            .a = a,
            .b = b,
            .min = mn,
            .max = mx,
            .mid_a = (d0_min[a] + d1_max[a]) / 2,
            .face_b = face_b,
            .out = if ((mn[b] + mx[b]) / 2 > face_b) -1 else 1,
        };
    }

    /// The feet at a spot, at height y, 1 cm clear of the walls and the
    /// doors.
    fn at(c: Cab, s: Spot, y: f32) V3 {
        const m = player.radius + 0.01;
        const lo_a = c.min[c.a] + m;
        const hi_a = c.max[c.a] - m;
        // The door end and the back end of the cab, along b.
        const door_b = if (c.out < 0) c.min[c.b] + m else c.max[c.b] - m;
        const back_b = if (c.out < 0) c.max[c.b] - m else c.min[c.b] + m;
        const ab: [2]f32 = switch (s) {
            .centre => .{ (lo_a + hi_a) / 2, (c.min[c.b] + c.max[c.b]) / 2 },
            .door_left => .{ lo_a, door_b },
            .door_right => .{ hi_a, door_b },
            .back_left => .{ lo_a, back_b },
            .back_right => .{ hi_a, back_b },
            .doors => .{ c.mid_a, door_b },
        };
        var p = [3]f32{ 0, y, 0 };
        p[c.a] = ab[0];
        p[c.b] = ab[1];
        return p;
    }

    fn get(v: V3, axis: usize) f32 {
        const arr: [3]f32 = v;
        return arr[axis];
    }

    /// A wish to walk along one axis, of length 1 at most.
    fn wish(axis: usize, amount: f32) V3 {
        var w = [3]f32{ 0, 0, 0 };
        w[axis] = std.math.clamp(amount, -1, 1);
        return w;
    }
};

const Ride = struct {
    lift: usize,
    from: usize,
    spot: Spot,
    /// The cab speed in m/s. 0: the speed of the lift.
    speed: f32 = 0,
    /// Server corrections during the ride: the cab jumps by these heights
    /// (syncLift), one each 0.5 s.
    fixes: []const f32 = &.{},
};

/// Ride a lift from one level to the other at a spot in the cab, then walk
/// out of the doors onto the landing. In each tick of the ride, the feet
/// must be on the cab floor at the same place on the plan, and the body
/// must be out of all solid shapes. The walk out must stay on the ground,
/// not stop, not go into a solid shape, and end on the landing.
fn rideLift(r: Ride) !void {
    const i = r.lift;
    const l = &map.lifts[i];
    const speed = l.speed;
    defer l.speed = speed;
    if (r.speed > 0) l.speed = r.speed;
    const to = 1 - r.from;
    const c = Cab.of(i);
    parkLift(i, r.from);
    const start = c.at(r.spot, l.levels[r.from]);
    var p: player.Player = .{ .pos = start };
    errdefer std.debug.print("lift {d} from level {d} at {s}, speed {d:.1}, {d} fixes: feet ({d:.3} {d:.3} {d:.3}), cab {d:.3} {s}\n", .{
        i, r.from, @tagName(r.spot), l.speed, r.fixes.len, p.pos[0], p.pos[1], p.pos[2], l.y, @tagName(l.phase),
    });
    for (0..30) |_| liftTick(&p, i, v3(0, 0, 0), null);
    try std.testing.expect(p.grounded and @abs(p.pos[1] - l.y) < 1e-4);

    // The ride: the doors close, the cab moves, the doors open.
    map.callLift(i, to);
    var t: usize = 0;
    var next_fix: usize = 0;
    while (!(l.phase == .open and l.level == to)) : (t += 1) {
        try std.testing.expect(t < 20 * 120);
        var fix: ?f32 = null;
        if (l.phase == .moving and t % 60 == 0 and next_fix < r.fixes.len) {
            fix = std.math.clamp(l.y + r.fixes[next_fix], @min(l.levels[0], l.levels[1]), @max(l.levels[0], l.levels[1]));
            next_fix += 1;
        }
        liftTick(&p, i, v3(0, 0, 0), fix);
        try std.testing.expect(p.grounded);
        try std.testing.expect(@abs(p.pos[1] - map.boxes[l.floor_box].max[1]) < 1e-4);
        try std.testing.expect(@abs(p.pos[0] - start[0]) < 1e-4 and @abs(p.pos[2] - start[2]) < 1e-4);
        try std.testing.expect(bodyFree(p.pos));
    }
    try std.testing.expectEqual(r.fixes.len, next_fix);
    try std.testing.expect(@abs(p.pos[1] - l.levels[to]) < 1e-4);

    // Walk out: first to the middle of the doors, then out onto the
    // landing, 1.2 m past the doors.
    t = 0;
    while (@abs(Cab.get(p.pos, c.a) - c.mid_a) > 0.01) : (t += 1) {
        try std.testing.expect(t < 120);
        liftTick(&p, i, Cab.wish(c.a, (c.mid_a - Cab.get(p.pos, c.a)) * 4), null);
        try std.testing.expect(p.grounded and bodyFree(p.pos));
    }
    const end_b = c.face_b + c.out * 1.2;
    t = 0;
    while ((Cab.get(p.pos, c.b) - end_b) * c.out < 0) : (t += 1) {
        try std.testing.expect(t < 120);
        const before = Cab.get(p.pos, c.b);
        liftTick(&p, i, Cab.wish(c.b, c.out), null);
        try std.testing.expect(p.grounded and bodyFree(p.pos));
        // The floor: the cab, or the landing 2 cm lower.
        try std.testing.expect(p.pos[1] <= l.levels[to] + 1e-4 and p.pos[1] >= l.levels[to] - 0.03);
        // After 0.15 s the player walks at full speed: nothing stops the
        // feet at the threshold.
        if (t > 18) try std.testing.expect(@abs(Cab.get(p.pos, c.b) - before) > 3.2 * dt);
    }
    try std.testing.expect(@abs(p.pos[1] - (l.levels[to] - 0.02)) < 1e-3);

    // And back in, 1 m into the cab: the step up of 2 cm stops nothing.
    const in_b = c.face_b - c.out * 1.0;
    for (0..30) |_| liftTick(&p, i, v3(0, 0, 0), null);
    t = 0;
    while ((Cab.get(p.pos, c.b) - in_b) * c.out > 0) : (t += 1) {
        try std.testing.expect(t < 120);
        const before = Cab.get(p.pos, c.b);
        liftTick(&p, i, Cab.wish(c.b, -c.out), null);
        try std.testing.expect(p.grounded and bodyFree(p.pos));
        if (t > 18) try std.testing.expect(@abs(Cab.get(p.pos, c.b) - before) > 3.2 * dt);
    }
    try std.testing.expect(@abs(p.pos[1] - l.levels[to]) < 1e-4);
}

test "the lifts: ride up and down from each place in the cab, and walk out at each landing" {
    loadEarlsCourt();
    defer unload();
    try std.testing.expectEqual(@as(usize, 3), map.lift_count);
    for (0..map.lift_count) |i| for (0..2) |from| {
        for (std.enums.values(Spot)) |s| try rideLift(.{ .lift = i, .from = from, .spot = s });
        // Faster than the step down (0.45 m) in one tick.
        try rideLift(.{ .lift = i, .from = from, .spot = .centre, .speed = 60 });
        // The server corrects the cab by more than syncLift allows (0.3 m),
        // up and down.
        try rideLift(.{ .lift = i, .from = from, .spot = .doors, .fixes = &.{ 0.5, -0.5, 1.0, -1.0 } });
    };
}
