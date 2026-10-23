// Where: apps/action/game/src/player_test.zig (zig build test)
// When: after a change to the player movement (player.zig), the collision
// (map.zig) or the stairs and escalators of a map.
// Why: walks a player over each staircase and escalator of Earl's Court,
// natively and with no browser. Each walk checks that:
//   - the feet stay on the ground,
//   - nothing stops the player (for example the head on a ceiling edge),
//   - the eye height changes by a small amount in each tick,
//   - the head bob follows the walking speed.
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
