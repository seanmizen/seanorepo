// Where: apps/action/game/src/pigeons_test.zig (zig build test)
// When: after a change to the pigeons (pigeons.zig) or to the roof of
// Earl's Court (maps/earls_court.zig).
// Why: simulates the pigeons tick by tick. Each pigeon sits on a tie rod.
// A shot kills one, and its body falls to a floor and rests there, where
// a player can pick it up and throw it. A miss sends the pigeons off on a
// path that is not straight. In flight a pigeon stays out of the solid
// shapes and under the roof. It leaves through the roof and does not come
// back.
const std = @import("std");
const testing = std.testing;
const map = @import("map.zig");
const vec = @import("vec.zig");
const ec = @import("maps/earls_court.zig");
const pigeons = @import("pigeons.zig");
const V3 = vec.V3;
const v3 = vec.v3;

const dt: f32 = 1.0 / 120.0;

fn setup(seed: u64) void {
    map.init(testing.allocator);
    map.load(.earls_court);
    pigeons.reset(seed);
}

fn tick() void {
    pigeons.step(dt);
    pigeons.event_n = 0;
}

fn run(secs: f32) void {
    var t: f32 = 0;
    while (t < secs) : (t += dt) tick();
}

/// True when p is the body centre of a pigeon on a tie rod.
fn onRod(p: V3) bool {
    var x = ec.rib_x[0] + ec.rib_step;
    while (x < ec.rib_x[1] - 0.01) : (x += ec.rib_step) {
        const r = ec.tieRod(x);
        if (@abs(p[0] - x) < 1e-3 and @abs(p[1] - (r[0][1] + ec.tie_half + pigeons.perch_lift)) < 1e-3 and
            p[2] > r[0][2] and p[2] < r[1][2]) return true;
    }
    return false;
}

fn wrap(a: f32) f32 {
    var x = a;
    while (x > std.math.pi) x -= std.math.tau;
    while (x < -std.math.pi) x += std.math.tau;
    return x;
}

fn inSolid(p: V3, half: f32) bool {
    return map.overlaps(p - vec.s(half), p + vec.s(half));
}

/// A place on the floor under p (1.6 m eye height) with a clear line to
/// p: no solid box between.
fn eyeBelow(p: V3) ?V3 {
    const offs = [_][2]f32{ .{ 3, 2 }, .{ -3, 2 }, .{ 3, -2 }, .{ -3, -2 }, .{ 5, 0 }, .{ -5, 0 }, .{ 0, 4 }, .{ 0, -4 } };
    for (offs) |o| {
        const top = p + v3(o[0], 0, o[1]);
        const h = map.raycast(top, v3(0, -1, 0), 30) orelse continue;
        const eye = top - v3(0, h.t - 1.6, 0);
        const to = p - eye;
        if (map.raycast(eye, vec.norm(to), vec.len(to)) == null) return eye;
    }
    return null;
}

test "pigeons: each one sits on a tie rod, clear of solid shapes and of the others; the arena has none" {
    setup(1);
    defer map.deinit();
    try testing.expectEqual(@as(usize, pigeons.max_birds), pigeons.bird_n);
    for (pigeons.birds[0..pigeons.bird_n], 0..) |b, i| {
        try testing.expectEqual(pigeons.State.perched, b.state);
        try testing.expect(onRod(b.pos));
        try testing.expect(!inSolid(b.pos, 0.06));
        for (pigeons.birds[i + 1 .. pigeons.bird_n]) |o| try testing.expect(vec.len(o.pos - b.pos) > 0.4);
    }
    // They stay on the rods when nothing startles them, a joyride or two
    // aside.
    run(20);
    var perched: usize = 0;
    for (pigeons.birds[0..pigeons.bird_n]) |b| {
        if (b.state == .perched) {
            perched += 1;
            try testing.expect(onRod(b.pos));
        }
    }
    try testing.expect(perched >= pigeons.max_birds - 2);
    map.load(.arena);
    pigeons.reset(1);
    try testing.expectEqual(@as(usize, 0), pigeons.bird_n);
}

test "pigeons: a hit kills; the body falls to a floor and rests; F picks it up and throws it" {
    setup(2);
    defer map.deinit();
    const b = pigeons.birds[0];
    const eye = eyeBelow(b.pos) orelse return error.NoLineOfSight;
    const d = vec.norm(b.pos - eye);
    const h = pigeons.ray(eye, d, 200) orelse return error.Missed;
    try testing.expectEqual(@as(?usize, 0), h.bird);
    try testing.expect(pigeons.shoot(h, d));
    try testing.expectEqual(@as(usize, 1), pigeons.corpse_n);
    try testing.expectEqual(pigeons.State.away, pigeons.birds[0].state);

    run(10);
    const c = pigeons.corpses[0];
    try testing.expect(c.rest);
    try testing.expect(!inSolid(c.pos, pigeons.corpse_half - 0.005));
    // It lies on the floor: the floor is just under it.
    const fl = map.raycast(c.pos, v3(0, -1, 0), 30) orelse return error.NoFloor;
    try testing.expect(fl.t < pigeons.corpse_half + 0.03);
    try testing.expect(c.pos[1] < b.pos[1] - 5);

    // Pick it up from 1.5 m away, carry it, throw it.
    const me = c.pos + v3(0, 1.5 - pigeons.corpse_half, 1.0);
    try testing.expectEqual(@as(?usize, 0), pigeons.pick(me, vec.norm(c.pos - me), 2.6));
    pigeons.grab(0);
    const hand = me + v3(0, -0.3, -0.7);
    for (0..30) |_| {
        pigeons.holdAt(me, hand, 0, dt);
        tick();
    }
    try testing.expect(vec.len(pigeons.corpses[0].pos - hand) < 0.01);
    pigeons.release(v3(0, 2, -4));
    try testing.expectEqual(@as(?usize, null), pigeons.held);
    run(8);
    const c2 = pigeons.corpses[0];
    try testing.expect(c2.rest);
    try testing.expect(!inSolid(c2.pos, pigeons.corpse_half - 0.005));
    try testing.expect(vec.len(c2.pos - c.pos) > 0.5);

    // No new pigeon comes.
    run(60);
    try testing.expectEqual(pigeons.State.away, pigeons.birds[0].state);
}

test "pigeons: a miss sends them off; the path wanders, stays clear of walls and the roof; they leave and do not come back" {
    var seed: u64 = 1;
    while (seed <= 8) : (seed += 1) {
        setup(seed * 31);
        defer map.deinit();
        const p0 = pigeons.birds[0].pos;
        // A shot that passes 1.5 m from pigeon 0.
        pigeons.shot(p0 + v3(1.5, -9, 0.5), p0 + v3(1.5, 3, 0.5));
        run(0.3);
        try testing.expectEqual(@as(usize, 0), pigeons.corpse_n);
        try testing.expectEqual(pigeons.State.flying, pigeons.birds[0].state);

        // Follow pigeon 0 for its first 4 s of flight.
        var path: [41]V3 = undefined;
        var turn_sum: f32 = 0;
        var last_yaw = pigeons.birds[0].yaw;
        var window_yaw = last_yaw;
        var lefts: u32 = 0;
        var rights: u32 = 0;
        var k: usize = 0;
        while (k < 4 * 120) : (k += 1) {
            if (k % 12 == 0) path[k / 12] = pigeons.birds[0].pos;
            tick();
            const b = pigeons.birds[0];
            turn_sum += @abs(wrap(b.yaw - last_yaw));
            last_yaw = b.yaw;
            // The turn of each quarter second: to the left or to the right.
            if (k % 30 == 29) {
                const dy = wrap(b.yaw - window_yaw);
                if (dy > 0.05) lefts += 1;
                if (dy < -0.05) rights += 1;
                window_yaw = b.yaw;
            }
        }
        path[40] = pigeons.birds[0].pos;
        // Not a straight line: it turns more than a half turn in all, both
        // ways, and the path bends more than 1 m from its chord.
        try testing.expect(turn_sum > 1.5);
        try testing.expect(lefts > 0 and rights > 0);
        var bend: f32 = 0;
        const chord = vec.norm(path[40] - path[0]);
        for (path) |p| {
            const w = p - path[0];
            bend = @max(bend, vec.len(w - chord * vec.s(vec.dot(w, chord))));
        }
        try testing.expect(bend > 1);

        // All the flights: clear of solid shapes, under the roof. Pigeon 0
        // leaves through the roof and stays away.
        var left_shed = false;
        var t: f32 = 0;
        while (t < 90) : (t += dt) {
            tick();
            for (pigeons.birds[0..pigeons.bird_n]) |b| {
                try testing.expect(!std.math.isNan(b.pos[0]) and !std.math.isNan(b.pos[1]));
                if (b.state != .flying) continue;
                const inside = @abs(b.pos[0]) < 46 and b.pos[1] < ec.archY(b.pos[2]);
                if (!inside) continue;
                try testing.expect(!inSolid(b.pos, 0.06));
                if (b.goal == .wander) try testing.expect(b.pos[1] < ec.archY(b.pos[2]) - 0.05);
            }
            if (pigeons.birds[0].state == .away) left_shed = true;
        }
        try testing.expect(left_shed);
        try testing.expectEqual(pigeons.State.away, pigeons.birds[0].state);
    }
}

test "pigeons: a busy match: shots, kills and blasts for 2 minutes, then the bodies rest" {
    setup(77);
    defer map.deinit();
    var prng: std.Random.DefaultPrng = .init(5);
    const r = prng.random();
    var t: f32 = 0;
    var kills: usize = 0;
    while (t < 120) : (t += dt) {
        tick();
        if (@mod(t, 1.5) < dt) {
            const b = pigeons.birds[r.uintLessThan(usize, pigeons.bird_n)];
            if (b.state == .away) continue;
            const eye = v3(r.float(f32) * 60 - 30, 1.6, 4.4);
            const d = vec.norm(b.pos + v3(r.float(f32) - 0.5, r.float(f32) - 0.5, r.float(f32) - 0.5) - eye);
            if (pigeons.ray(eye, d, 100)) |h| {
                if (pigeons.shoot(h, d)) kills += 1;
            }
            pigeons.shot(eye, eye + d * vec.s(40));
        }
        if (@mod(t, 20) < dt) pigeons.blast(v3(r.float(f32) * 40 - 20, 9, -4), 5);
        for (pigeons.birds[0..pigeons.bird_n]) |b| {
            if (b.state == .perched) try testing.expect(onRod(b.pos));
            if (b.state == .flying and @abs(b.pos[0]) < 46 and b.pos[1] < ec.archY(b.pos[2])) try testing.expect(!inSolid(b.pos, 0.06));
        }
        for (pigeons.corpses[0..pigeons.corpse_n]) |c| try testing.expect(!inSolid(c.pos, pigeons.corpse_half - 0.01));
    }
    try testing.expect(kills > 0);
    try testing.expect(pigeons.corpse_n <= pigeons.max_corpses);
    run(90);
    for (pigeons.corpses[0..pigeons.corpse_n]) |c| try testing.expect(c.rest);
}
