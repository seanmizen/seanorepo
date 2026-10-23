// Where: apps/action/game/src/shooter_test.zig (zig build test)
// When: after a change to the NPC shooter (shooter.zig), to its station on
// the range (maps/arena.zig), to the arena, or to the impact effects
// (impact_fx.zig).
// Why: checks that each round of the NPC hits the target board and passes
// 1 to 2 m from the head of the player, that with no board a round flies
// past with no impact near the player, that the NPC hides no dummy, that it
// fires only after START and stops when the player leaves the range, that
// the eye of the player can press each button of the panel, and that each
// material has an impact effect.
const std = @import("std");
const testing = std.testing;
const map = @import("map.zig");
const mesh = @import("mesh.zig");
const vec = @import("vec.zig");
const weapon = @import("weapon.zig");
const guns = @import("guns.zig");
const arena = @import("maps/arena.zig");
const shooter = @import("shooter.zig");
const impact_fx = @import("impact_fx.zig");
const V3 = vec.V3;
const v3 = vec.v3;

/// Load the arena and the gun models. Free them with `done`.
fn setup(gpa: *std.heap.ArenaAllocator) !void {
    map.init(testing.allocator);
    map.load(.arena);
    try weapon.loadModels(gpa.allocator());
    shooter.surface = .concrete;
    shooter.stop = 2;
    shooter.fire = .single;
    shooter.gun = gunIndex("AssaultRifle_2");
    shooter.reset();
}

fn done(gpa: *std.heap.ArenaAllocator) void {
    weapon.models = &.{};
    gpa.deinit();
    map.deinit();
}

/// The distance from p to the line through a with direction d (a unit
/// vector).
fn lineDistance(p: V3, a: V3, d: V3) f32 {
    const w = p - a;
    return vec.len(w - d * vec.s(vec.dot(w, d)));
}

/// The aim points at the edge of the largest group, and the centre.
fn groupPoints() [9]V3 {
    var out: [9]V3 = undefined;
    out[0] = arena.shooter_aim;
    for (0..8) |i| {
        const a = @as(f32, @floatFromInt(i)) * std.math.pi / 4.0;
        out[i + 1] = arena.shooter_aim + v3(@cos(a) * shooter.max_group, @sin(a) * shooter.max_group, 0);
    }
    return out;
}

/// The guns of each grip of buildBody: a long gun and a handgun.
const test_guns = [_][]const u8{ "AssaultRifle_2", "Pistol_1", "Shotgun_1" };

fn gunIndex(name: []const u8) u8 {
    for (guns.builds, 0..) |b, i| if (std.mem.eql(u8, b.name, name)) return @intCast(i);
    unreachable;
}

/// The muzzle of the NPC with gun g at place i, aimed.
fn muzzleAt(g: u8, i: usize) V3 {
    shooter.gun = g;
    shooter.stop = i;
    shooter.reset();
    return shooter.muzzle();
}

test "the target board takes each material, and each look except flesh fits it" {
    var gpa: std.heap.ArenaAllocator = .init(testing.allocator);
    try setup(&gpa);
    defer done(&gpa);
    const bi = arena.shooter_target.?;
    for (std.enums.values(map.Surface)) |s| {
        shooter.surface = s;
        shooter.applySurface();
        const b = map.boxes[bi];
        try testing.expectEqual(s, b.surface);
        try testing.expect(b.solid and b.visible and b.dynamic);
        try testing.expect(s == .flesh or map.surfaceFits(b.mat, s));
    }
    shooter.surface = null;
    shooter.applySurface();
    try testing.expect(!map.boxes[bi].solid and !map.boxes[bi].visible);
    // The cycle: no board after the last material, then the first one.
    try testing.expectEqual(@as(?map.Surface, null), shooter.nextSurface(.flesh));
    try testing.expectEqual(@as(?map.Surface, .concrete), shooter.nextSurface(null));
    try testing.expectEqual(@as(?map.Surface, .flesh), shooter.prevSurface(null));
}

test "each round of the NPC hits the board and passes 1 to 2 m from the head" {
    var gpa: std.heap.ArenaAllocator = .init(testing.allocator);
    try setup(&gpa);
    defer done(&gpa);
    const eye = shooter.placeEye();
    for (test_guns) |name| {
        for (0..arena.shooter_stops.len) |i| {
            const o = muzzleAt(gunIndex(name), i);
            for (groupPoints()) |p| {
                const d = vec.norm(p - o);
                const h = map.raycast(o, d, 400).?;
                try testing.expectEqual(arena.shooter_target.?, h.box);
                try testing.expectEqual(map.Surface.concrete, map.surfaceAt(o + d * vec.s(h.t), h.box));
                const miss = lineDistance(eye, o, d);
                try testing.expect(miss > 1.0 and miss < 2.0);
            }
        }
    }
}

test "with no board, a round flies past the player with no impact near" {
    var gpa: std.heap.ArenaAllocator = .init(testing.allocator);
    try setup(&gpa);
    defer done(&gpa);
    shooter.surface = null;
    shooter.applySurface();
    const eye = shooter.placeEye();
    for (test_guns) |name| {
        for (0..arena.shooter_stops.len) |i| {
            const o = muzzleAt(gunIndex(name), i);
            for (groupPoints()) |p| {
                const d = vec.norm(p - o);
                // Past the player the round goes through the doorway of the
                // arena. It hits the north wall, or flies over it. Both are
                // past the default snd_impact_distance (60 m), so no impact
                // sound plays.
                if (map.raycast(o, d, 400)) |h| {
                    try testing.expect(vec.len(o + d * vec.s(h.t) - eye) > 60);
                }
                const miss = lineDistance(eye, o, d);
                try testing.expect(miss > 1.0 and miss < 2.0);
            }
        }
    }
}

test "seen from the spawn, the NPC at each place hides no dummy behind it" {
    const eye = shooter.placeEye();
    const half: f32 = 0.3;
    for (0..arena.shooter_stops.len) |i| {
        const n = shooter.home(i);
        const nd = n[2] - eye[2];
        const na = std.math.atan2(n[0], nd);
        const nw = std.math.atan2(half, nd);
        for (arena.range_dummies) |dm| {
            const h = arena.dummyHome(dm);
            const dd = h[2] - eye[2];
            if (dd <= nd) continue;
            // The angles of the dummy, over its walk. The pillar hides the
            // leaner (maps/arena.zig): only its head shows, in a strip of
            // 0.5 m past the edge of the pillar, 0.55 m from its place.
            var x0 = h[0] - dm.walk - half;
            var x1 = h[0] + dm.walk + half;
            if (dm.peek < 0) {
                x1 = h[0] - 0.55;
                x0 = x1 - 0.5;
            } else if (dm.peek > 0) {
                x0 = h[0] + 0.55;
                x1 = x0 + 0.5;
            }
            const lo = std.math.atan2(x0, dd);
            const hi = std.math.atan2(x1, dd);
            try testing.expect(na + nw < lo or na - nw > hi);
        }
    }
}

test "the fire modes of each action" {
    const rifle = &guns.table[gunIndex("AssaultRifle_2")];
    const bullpup = &guns.table[gunIndex("Bullpup_1")];
    const pistol = &guns.table[gunIndex("Pistol_1")];
    const shotgun = &guns.table[gunIndex("Shotgun_1")];
    try testing.expectEqual(@as(usize, 3), shooter.modeCount(rifle));
    try testing.expect(shooter.allowed(bullpup, .burst) and shooter.modeCount(bullpup) == 1);
    try testing.expect(shooter.allowed(pistol, .single) and shooter.modeCount(pistol) == 1);
    try testing.expect(shooter.allowed(shotgun, .single) and shooter.modeCount(shotgun) == 1);
}

/// Run the NPC for `secs` with the player at `feet`. Returns the rounds.
fn run(secs: f32, feet: V3) usize {
    const dt: f32 = 1.0 / 120.0;
    var n: usize = 0;
    var t: f32 = 0;
    while (t < secs) : (t += dt) {
        if (shooter.step(dt, feet)) |s| {
            n += 1;
            // A round hits the board: never the player or a dummy.
            std.debug.assert(s.surface != null);
        }
    }
    return n;
}

test "the NPC fires only after START, at the rate of the gun, and stops off the range" {
    var gpa: std.heap.ArenaAllocator = .init(testing.allocator);
    try setup(&gpa);
    defer done(&gpa);
    const feet = arena.range_spawn.pos;
    try testing.expectEqual(@as(usize, 0), run(3, feet));
    try testing.expectEqual(shooter.Status.stopped, shooter.status());
    try testing.expect(shooter.press(.start));
    try testing.expect(!shooter.press(.start));
    // Single: the first round after 0.6 s, then one each second.
    try testing.expectEqual(@as(usize, 3), run(2.7, feet));
    // Auto, AKM: 561 rounds a minute.
    try testing.expect(shooter.press(.mode_next));
    try testing.expect(shooter.press(.mode_next));
    try testing.expectEqual(shooter.Fire.auto, shooter.fire);
    _ = run(1.1, feet);
    const rate = run(1.0, feet);
    try testing.expect(rate >= 8 and rate <= 10);
    // The player walks into the arena: the NPC stops.
    _ = run(0.1, v3(0, 0, 20));
    try testing.expect(!shooter.on);
    try testing.expectEqual(@as(usize, 0), run(2, feet));
    // A new distance: the NPC runs there, and fires on arrival.
    try testing.expect(shooter.press(.dist_next));
    try testing.expect(!shooter.press(.dist_next));
    try testing.expect(shooter.press(.start));
    _ = run(0.5, feet);
    try testing.expectEqual(shooter.Status.moving, shooter.status());
    try testing.expect(run(5, feet) > 0);
    try testing.expectEqual(shooter.home(3), shooter.pos);
}

test "the eye on the spawn presses each button of the panel" {
    var gpa: std.heap.ArenaAllocator = .init(testing.allocator);
    try setup(&gpa);
    defer done(&gpa);
    const eye = shooter.placeEye();
    const f = shooter.frame();
    for (std.enums.values(shooter.Button)) |b| {
        const rc = shooter.rect(b);
        const p = shooter.point(f, (rc[0] + rc[2]) / 2, (rc[1] + rc[3]) / 2, shooter.button_depth);
        const d = vec.norm(p - eye);
        try testing.expect(vec.len(p - eye) < 2.6);
        try testing.expectEqual(@as(?shooter.Button, b), shooter.pick(eye, d, 2.6));
    }
    // Not from behind the panel.
    const back = f.c - f.n * vec.s(1.5);
    try testing.expectEqual(@as(?shooter.Button, null), shooter.pick(back, f.n, 2.6));
}

test "the crack comes before the muzzle report, and the gap grows with the distance" {
    var gpa: std.heap.ArenaAllocator = .init(testing.allocator);
    try setup(&gpa);
    defer done(&gpa);
    var last: f32 = 0;
    for (0..arena.shooter_stops.len) |i| {
        shooter.stop = i;
        const t = shooter.timing();
        const crack = t.crack.?;
        try testing.expect(crack < t.report);
        try testing.expect(t.report - crack > last);
        last = t.report - crack;
    }
    // A subsonic gun: the whiz comes after the report.
    shooter.gun = gunIndex("Pistol_1");
    for (0..arena.shooter_stops.len) |i| {
        shooter.stop = i;
        const t = shooter.timing();
        try testing.expectEqual(@as(?f32, null), t.crack);
        try testing.expect(t.whiz > t.report);
    }
}

test "each material has an impact effect, and a late effect waits" {
    impact_fx.reset();
    var m = mesh.Mesh.init(testing.allocator);
    defer m.verts.deinit(testing.allocator);
    for (std.enums.values(map.Surface)) |s| {
        impact_fx.reset();
        impact_fx.spawn(v3(0, 1, 0), v3(0, 0, 1), s, 1, 0);
        impact_fx.step(0.02);
        m.clear();
        impact_fx.buildTranslucent(&m, v3(1, 0, 0), v3(0, 1, 0));
        try testing.expect(m.verts.items.len > 0);
    }
    impact_fx.reset();
    impact_fx.spawn(v3(0, 1, 0), v3(0, 0, 1), .concrete, 1, 0.2);
    impact_fx.step(0.1);
    m.clear();
    impact_fx.buildTranslucent(&m, v3(1, 0, 0), v3(0, 1, 0));
    try testing.expectEqual(@as(usize, 0), m.verts.items.len);
    impact_fx.step(0.15);
    impact_fx.buildTranslucent(&m, v3(1, 0, 0), v3(0, 1, 0));
    try testing.expect(m.verts.items.len > 0);
    // The pools have a fixed size.
    for (0..1000) |_| impact_fx.spawn(v3(0, 1, 0), v3(0, 0, 1), .metal, 1, 0);
    try testing.expect(impact_fx.count() <= 640);
}
