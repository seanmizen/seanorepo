// Where: apps/action/game/src/body_test.zig (zig build test)
// When: after a change to the player model (body.zig), the movement
// (player.zig) or the stairs of a map.
// Why: checks your own body in first person, natively and with no browser:
//   - the camera never comes near a part of the body that it shows, at each
//     look up and down, each lean, each step of the walk and on stairs,
//   - the head, the arms and the held weapon cast a shadow only,
//   - a planted foot does not slide on the floor,
//   - on the stairs of Earl's Court each planted foot is on the tread
//     under it, and the legs keep their length.
const std = @import("std");
const map = @import("map.zig");
const mesh = @import("mesh.zig");
const player = @import("player.zig");
const weapon = @import("weapon.zig");
const body = @import("body.zig");
const vec = @import("vec.zig");
const V3 = vec.V3;
const v3 = vec.v3;

/// The game tick (main.zig tick_hz).
const dt: f32 = 1.0 / 120.0;

fn pose(p: *const player.Player, feet: *const body.Feet, view: body.View) body.Pose {
    var out: body.Pose = .{
        .pos = p.pos,
        .yaw = p.yaw,
        .pitch = p.pitch,
        .lean = p.lean,
        .stride = p.stride,
        .vel = if (p.grounded) p.vel else v3(0, 0, 0),
        .color = v3(0.5, 0.5, 0.5),
        .w = .rifle,
        .m = weapon.firstOf(.rifle),
        .view = view,
    };
    feet.apply(&out);
    return out;
}

/// The point of triangle abc nearest to p (Ericson, Real-Time Collision
/// Detection, 5.1.5).
fn nearest(p: V3, a: V3, b: V3, c: V3) V3 {
    const ab = b - a;
    const ac = c - a;
    const ap = p - a;
    const d1 = vec.dot(ab, ap);
    const d2 = vec.dot(ac, ap);
    if (d1 <= 0 and d2 <= 0) return a;
    const bp = p - b;
    const d3 = vec.dot(ab, bp);
    const d4 = vec.dot(ac, bp);
    if (d3 >= 0 and d4 <= d3) return b;
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 and d1 >= 0 and d3 <= 0) return a + ab * vec.s(d1 / (d1 - d3));
    const cp = p - c;
    const d5 = vec.dot(ab, cp);
    const d6 = vec.dot(ac, cp);
    if (d6 >= 0 and d5 <= d6) return c;
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 and d2 >= 0 and d6 <= 0) return a + ac * vec.s(d2 / (d2 - d6));
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 and (d4 - d3) >= 0 and (d5 - d6) >= 0) return b + (c - b) * vec.s((d4 - d3) / ((d4 - d3) + (d5 - d6)));
    const denom = 1 / (va + vb + vc);
    return a + ab * vec.s(vb * denom) + ac * vec.s(vc * denom);
}

fn pos(v: mesh.Vertex) V3 {
    return v3(v.pos[0], v.pos[1], v.pos[2]);
}

/// The distance from the eye to the nearest triangle that the camera
/// shows (a material under 100), or a large number.
fn nearestShown(m: *const mesh.Mesh, eye: V3) f32 {
    var best: f32 = 100;
    var i: usize = 0;
    while (i + 2 < m.verts.items.len) : (i += 3) {
        const t = m.verts.items[i .. i + 3];
        if (t[0].mat >= 99.5) continue;
        best = @min(best, vec.len(nearest(eye, pos(t[0]), pos(t[1]), pos(t[2])) - eye));
    }
    return best;
}

fn loadModels(arena: *std.heap.ArenaAllocator) !void {
    try weapon.loadModels(arena.allocator());
}

fn unloadModels(arena: *std.heap.ArenaAllocator) void {
    weapon.models = &.{};
    arena.deinit();
}

/// The near plane is 0.04 m (render.zig). The head bob moves the eye up to
/// 0.02 m up and down and 0.015 m to the side (main.zig playerView). So no
/// part that the camera shows may come nearer than this.
const min_clearance: f32 = 0.12;

test "your body: no part that the camera shows comes near the eye" {
    var arena: std.heap.ArenaAllocator = .init(std.testing.allocator);
    try loadModels(&arena);
    defer unloadModels(&arena);
    var m = mesh.Mesh.init(std.testing.allocator);
    defer m.verts.deinit(std.testing.allocator);
    var worst: f32 = 100;
    const pitches = [_]f32{ -1.5, -1.3, -1.0, -0.6, 0, 0.6, 1.5 };
    const leans = [_]f32{ -1, -0.5, 0, 0.5, 1 };
    for (pitches) |pitch| for (leans) |lean| for (0..12) |k| for ([_]f32{ 0, 0.45 }) |sink| for ([_]f32{ 0, 6.4 }) |speed| {
        const p: player.Player = .{ .pos = v3(1, 2, 3), .yaw = 0.7, .pitch = pitch, .lean = lean, .stride = @as(f32, @floatFromInt(k)) * 0.31, .grounded = true, .vel = v3(-@sin(@as(f32, 0.7)) * speed, 0, -@cos(@as(f32, 0.7)) * speed) };
        const feet: body.Feet = .{ .ground = .{ -sink, -sink }, .sink = sink };
        m.clear();
        body.build(&m, pose(&p, &feet, .first_person));
        const d = nearestShown(&m, p.eyePos());
        if (d < worst) worst = d;
        if (d < min_clearance) {
            std.debug.print("pitch {d:.2} lean {d:.2} step {d} sink {d:.2} speed {d:.1}: a shown part is {d:.3} m from the eye\n", .{ pitch, lean, k, sink, speed, d });
            return error.TestUnexpectedResult;
        }
    };
    try std.testing.expect(worst >= min_clearance);
}

test "your body: the head, the arms and the weapon cast a shadow only" {
    var arena: std.heap.ArenaAllocator = .init(std.testing.allocator);
    try loadModels(&arena);
    defer unloadModels(&arena);
    var m = mesh.Mesh.init(std.testing.allocator);
    defer m.verts.deinit(std.testing.allocator);
    const p: player.Player = .{ .pos = v3(0, 0, 0), .grounded = true };
    const feet: body.Feet = .{};
    for ([_]body.View{ .third_person, .first_person, .shadow }) |view| {
        m.clear();
        body.build(&m, pose(&p, &feet, view));
        var shown: usize = 0;
        var top: f32 = -10;
        for (m.verts.items) |v| {
            if (v.mat >= body.shadow_only - 0.5) continue;
            shown += 1;
            top = @max(top, v.pos[1]);
        }
        switch (view) {
            // Another player: every part shows.
            .third_person => try std.testing.expectEqual(m.verts.items.len, shown),
            // Your body: the legs and the torso show, up to the shoulders
            // (1.45 m). The head and the weapon do not.
            .first_person => {
                try std.testing.expect(shown > 0 and shown < m.verts.items.len);
                try std.testing.expect(top < 1.46);
            },
            // own_body 0: nothing shows. Every part casts its shadow.
            .shadow => try std.testing.expectEqual(@as(usize, 0), shown),
        }
    }
}

test "your body: a planted foot does not slide on the floor" {
    map.init(std.testing.allocator);
    map.load(.arena);
    defer map.deinit();
    // Walk along -Z, 6 m from the arena centre, at the walk speed and
    // slower (the sights).
    for ([_]f32{ 1, 0.55 }) |scale| {
        var p: player.Player = .{ .pos = v3(6, 1, 10) };
        var feet: body.Feet = .{};
        for (0..60) |_| p.step(dt, v3(0, 0, 0), false, 1);
        var last: [2]?V3 = .{ null, null };
        var max_slide: f32 = 0;
        var planted_ticks: usize = 0;
        for (0..240) |t| {
            p.step(dt, v3(0, 0, -1), false, scale);
            feet.update(pose(&p, &feet, .first_person), dt, p.grounded);
            const ps = pose(&p, &feet, .first_person);
            const soles = body.soles(ps);
            for (0..2) |i| {
                // Full speed after 0.25 s.
                if (t < 30 or !body.planted(ps, i)) {
                    last[i] = null;
                    continue;
                }
                if (last[i]) |l| {
                    const d = soles[i] - l;
                    max_slide = @max(max_slide, @sqrt(d[0] * d[0] + d[2] * d[2]));
                    planted_ticks += 1;
                }
                last[i] = soles[i];
            }
        }
        errdefer std.debug.print("speed {d:.2}: slide {d:.4} m in a tick, {d} planted ticks\n", .{ scale, max_slide, planted_ticks });
        try std.testing.expect(planted_ticks > 20);
        // The body moves 5.3 cm in a tick at the walk speed.
        try std.testing.expect(max_slide < 0.003);
    }
}

const Stairs = struct {
    name: []const u8,
    start: V3,
    dir: f32,
    end_x: f32,
    /// The floor heights at the bottom and at the top of the stairs. The
    /// player drops onto the stairs from up to 0.5 m over the top floor,
    /// onto a floor down to 0.5 m under the bottom floor. So a ceiling
    /// near the stairs (the deep ceiling at the foot of the escalators) is
    /// not a floor.
    floors: [2]f32,
    /// An escalator carries the player, and so the planted feet, over its
    /// steps. The steps are static boxes (main.zig buildEscalatorSteps), so
    /// a carried foot can cross the edge of a step. The walk check skips it.
    carries: bool = false,
};

/// Where a planted foot is from the tread under its ball: the sole minus
/// the tread. Null when no tread is near.
fn treadError(p: body.Pose, sole: V3) ?f32 {
    const fwd = v3(-@sin(p.yaw), 0, -@cos(p.yaw));
    const ball = sole + fwd * vec.s(0.06);
    const top = body.treadUnder(ball, sole[1]) orelse return null;
    return sole[1] - top;
}

test "your body: on the stairs each planted foot is on its tread" {
    map.init(std.testing.allocator);
    map.load(.earls_court);
    defer map.deinit();
    // The stairs and the escalators of player_test.zig.
    const ec = @import("maps/earls_court.zig");
    const walks = [_]Stairs{
        .{ .name = "island down", .start = v3(20, 0, 4.4), .dir = 1, .end_x = 30.5, .floors = .{ ec.mid_y, 0 } },
        .{ .name = "island up", .start = v3(-30.5, ec.mid_y, 4.4), .dir = 1, .end_x = -20, .floors = .{ ec.mid_y, 0 } },
        .{ .name = "concourse down", .start = v3(-47, ec.street_y, -12.8), .dir = 1, .end_x = -37.8, .floors = .{ 0, ec.street_y } },
        .{ .name = "escalator down", .start = v3(ec.esc_top_x - 2, ec.mid_y, ec.esc_lane_z[0]), .dir = 1, .end_x = ec.esc_bottom_x + 1, .floors = .{ ec.deep_y, ec.mid_y }, .carries = true },
        .{ .name = "escalator up", .start = v3(ec.esc_bottom_x + 1, ec.deep_y, ec.esc_lane_z[1]), .dir = -1, .end_x = ec.esc_top_x - 2, .floors = .{ ec.deep_y, ec.mid_y }, .carries = true },
    };
    for (walks) |w| {
        // Stand still at points along the stairs: both feet on a tread.
        // The escalators stop for this check: the steps are static boxes,
        // so a carried foot crosses the edge of a step.
        const escalators = map.escalator_count;
        if (w.carries) map.escalator_count = 0;
        var x = w.start[0];
        var worst_stand: f32 = 0;
        while ((w.end_x - x) * w.dir > 0) : (x += 0.13 * w.dir) {
            // Drop onto the ramp from over it, and come to rest.
            const top = map.floorTop(v3(x - 0.3, w.floors[0] - 0.5, w.start[2] - 0.3), v3(x + 0.3, w.floors[1] + 0.5, w.start[2] + 0.3)) orelse continue;
            var p: player.Player = .{ .pos = v3(x, top + 0.05, w.start[2]), .yaw = -w.dir * std.math.pi / 2.0 };
            var feet: body.Feet = .{};
            for (0..90) |_| {
                p.step(dt, v3(0, 0, 0), false, 1);
                feet.update(pose(&p, &feet, .first_person), dt, p.grounded);
            }
            const ps = pose(&p, &feet, .first_person);
            for (body.soles(ps)) |sole| {
                const e = treadError(ps, sole) orelse continue;
                worst_stand = @max(worst_stand, @abs(e));
            }
        }
        map.escalator_count = escalators;
        // Walk at the walk speed and slower (the sights). Check each planted
        // foot after its first 6 ticks (50 ms) on the floor: in that time
        // the foot goes down or up to its tread.
        var worst_walk: f32 = 0;
        var legs_ok = true;
        for ([_]f32{ 1, 0.55 }) |scale| {
            var p: player.Player = .{ .pos = w.start, .yaw = -w.dir * std.math.pi / 2.0 };
            var feet: body.Feet = .{};
            for (0..120) |_| p.step(dt, v3(0, 0, 0), false, 1);
            var down_ticks: [2]usize = .{ 0, 0 };
            var t: usize = 0;
            while ((w.end_x - p.pos[0]) * w.dir > 0 and t < 600) : (t += 1) {
                p.step(dt, v3(w.dir, 0, 0), false, scale);
                feet.update(pose(&p, &feet, .first_person), dt, p.grounded);
                const ps = pose(&p, &feet, .first_person);
                const soles = body.soles(ps);
                for (body.legs(ps)) |l| {
                    legs_ok = legs_ok and @abs(vec.len(l.knee - l.hip) - 0.4) < 0.001 and vec.len(l.ankle - l.knee) <= 0.401;
                }
                for (0..2) |i| {
                    down_ticks[i] = if (body.planted(ps, i)) down_ticks[i] + 1 else 0;
                    if (down_ticks[i] < 6 or w.carries) continue;
                    const e = treadError(ps, soles[i]) orelse continue;
                    worst_walk = @max(worst_walk, @abs(e));
                }
            }
        }
        errdefer std.debug.print("{s}: standing {d:.3} m, walking {d:.3} m from the tread, legs {}\n", .{ w.name, worst_stand, worst_walk, legs_ok });
        try std.testing.expect(legs_ok);
        try std.testing.expect(worst_stand < 0.03);
        try std.testing.expect(worst_walk < 0.05);
    }
}
