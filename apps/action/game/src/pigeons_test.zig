// Where: apps/action/game/src/pigeons_test.zig (zig build test)
// When: after a change to the pigeons (pigeons.zig) or to the roof of
// Earl's Court (maps/earls_court.zig).
// Why: simulates the pigeons tick by tick. Each pigeon sits on a tie rod.
// A shot kills one, and its body falls to a floor and rests there, where
// a player can pick it up and throw it. A miss sends the pigeons off on a
// path that is not straight. In flight a pigeon stays out of the solid
// shapes and under the roof. It leaves through the roof, and 60 to 180 s
// later it comes back down through the roof to a free perch. Deathmatch:
// two clients with the same seed and the same events fly the same paths.
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
}

test "pigeons: a miss sends them off; the path wanders, stays clear of walls and the roof; they leave" {
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
        // leaves through the roof.
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

test "pigeons: a pigeon that died or left comes back down through the roof to a free perch" {
    for ([_]u64{ 9, 3, 17 }) |seed| try returnFrom(seed);
}

fn returnFrom(seed: u64) !void {
    setup(seed);
    defer map.deinit();
    // The server (server/pigeons.ts RODS) has the same number of rods.
    try testing.expectEqual(@as(usize, 14), pigeons.rodCount());
    const b0 = pigeons.birds[0];
    const eye = eyeBelow(b0.pos) orelse return error.NoLineOfSight;
    const d = vec.norm(b0.pos - eye);
    const h = pigeons.ray(eye, d, 200) orelse return error.Missed;
    try testing.expect(pigeons.shoot(h, d));
    // A miss sends the others off.
    pigeons.shot(v3(0, 1.6, 4), v3(0, 11, -4));
    var t: f32 = 0;
    var away_at: ?f32 = null;
    var back_at: ?f32 = null;
    while (t < 260) : (t += dt) {
        tick();
        const b = pigeons.birds[0];
        if (b.state == .away and away_at == null) away_at = t;
        if (b.state == .flying and b.goal == .enter) {
            if (back_at == null) back_at = t;
        }
        for (pigeons.birds[0..pigeons.bird_n]) |o| {
            if (o.state != .flying or o.goal == .enter) continue;
            if (@abs(o.pos[0]) < 46 and o.pos[1] < ec.archY(o.pos[2])) try testing.expect(!inSolid(o.pos, 0.06));
        }
    }
    // It was away for 60 to 180 s, then it came back. Now it sits on a rod
    // as a new generation, and its old body is still there.
    const gone = (back_at orelse return error.NoReturn) - (away_at orelse return error.NeverAway);
    try testing.expect(gone >= pigeons.return_delay[0] - 0.1 and gone <= pigeons.return_delay[1] + 0.1);
    try testing.expectEqual(pigeons.State.perched, pigeons.birds[0].state);
    try testing.expect(onRod(pigeons.birds[0].perch.pos));
    try testing.expectEqual(@as(u16, 1), pigeons.birds[0].gen);
    try testing.expectEqual(@as(usize, 1), pigeons.corpse_n);
    // All of them are back on the rods, apart from each other.
    var perched: usize = 0;
    for (pigeons.birds[0..pigeons.bird_n], 0..) |b, i| {
        if (b.state != .perched) continue;
        perched += 1;
        try testing.expect(onRod(b.perch.pos));
        for (pigeons.birds[i + 1 .. pigeons.bird_n]) |o| {
            if (o.state == .perched) try testing.expect(vec.len(o.perch.pos - b.perch.pos) > 0.4);
        }
    }
    try testing.expect(perched >= pigeons.max_birds - 2);
}

/// One tick of the flock as a client sees it: the state of each pigeon,
/// the perch of a perched one and the place of a flying one, and the
/// bodies.
const Frame = struct {
    st: [pigeons.max_birds]pigeons.State,
    p: [pigeons.max_birds]V3,
    corpse_n: usize,
    c: [pigeons.max_corpses]V3,
};

fn frame() Frame {
    var f: Frame = .{ .st = undefined, .p = undefined, .corpse_n = pigeons.corpse_n, .c = @splat(v3(0, 0, 0)) };
    for (pigeons.birds[0..pigeons.max_birds], 0..) |b, i| {
        f.st[i] = b.state;
        f.p[i] = switch (b.state) {
            .perched => b.perch.pos,
            .flying => b.pos,
            .away => v3(0, 0, 0),
        };
    }
    for (pigeons.corpses[0..pigeons.corpse_n], 0..) |c, i| f.c[i] = c.pos;
    return f;
}

const Sent = struct { tick: usize, e: pigeons.NetEvent };

/// The events of the server: a joyride at tick 30, the return of pigeon 0
/// at tick 4800.
fn serverEvents(k: usize) void {
    if (k == 30) pigeons.applyJoy(6, 1234, pigeons.perchAt(2, 0.5).?);
    if (k == 4800) pigeons.applyBack(0, 1, 777, pigeons.perchAt(7, 0.3).?);
}

test "pigeons: deathmatch: two clients with the same seed and the same events fly the same paths" {
    const ticks = 7200;
    const frames = try testing.allocator.alloc(Frame, ticks);
    defer testing.allocator.free(frames);
    var sent: [256]Sent = undefined;
    var sent_n: usize = 0;

    // Client A decides: a miss near pigeon 0, then a kill of the pigeon
    // furthest from it. Its outbox is what the server relays.
    setup(41);
    defer map.deinit();
    pigeons.net = true;
    defer pigeons.net = false;
    var far: usize = 1;
    for (pigeons.birds[0..pigeons.bird_n], 0..) |b, i| {
        if (vec.len(b.pos - pigeons.birds[0].pos) > vec.len(pigeons.birds[far].pos - pigeons.birds[0].pos)) far = i;
    }
    for (0..ticks) |k| {
        serverEvents(k);
        tick();
        if (k == 120) {
            const p0 = pigeons.birds[0].pos;
            pigeons.shot(p0 + v3(1.5, -9, 0.5), p0 + v3(1.5, 3, 0.5));
        }
        if (k == 600 and pigeons.birds[far].state != .away) {
            const b = pigeons.birds[far];
            const eye = eyeBelow(b.pos) orelse return error.NoLineOfSight;
            const d = vec.norm(b.pos - eye);
            const h = pigeons.ray(eye, d, 200) orelse return error.Missed;
            _ = pigeons.shoot(h, d);
        }
        for (pigeons.outbox[0..pigeons.out_n]) |e| {
            if (sent_n < sent.len) sent[sent_n] = .{ .tick = k, .e = e };
            sent_n += 1;
        }
        pigeons.out_n = 0;
        frames[k] = frame();
    }
    try testing.expect(sent_n <= sent.len);
    var ups: usize = 0;
    var dies: usize = 0;
    for (sent[0..sent_n]) |m| switch (m.e.kind) {
        .up => ups += 1,
        .die => dies += 1,
        else => {},
    };
    try testing.expect(ups >= 1 and dies == 1);

    // Client B: the same seed. It applies the events of A at the same
    // ticks, and makes no decisions of its own.
    pigeons.reset(41);
    var next: usize = 0;
    for (0..ticks) |k| {
        serverEvents(k);
        tick();
        while (next < sent_n and sent[next].tick == k) : (next += 1) {
            const e = sent[next].e;
            switch (e.kind) {
                .up => pigeons.applyUp(e.bird, e.seed, e.p, e.v),
                .die => pigeons.applyDie(e.bird, e.gen, e.p, e.v),
                .push => pigeons.applyPush(e.bird, e.gen, e.p, e.v),
                .grab, .drop => {},
            }
        }
        pigeons.out_n = 0;
        const f = frame();
        const a = frames[k];
        for (0..pigeons.max_birds) |i| {
            try testing.expectEqual(a.st[i], f.st[i]);
            try testing.expectEqual(a.p[i], f.p[i]);
        }
        try testing.expectEqual(a.corpse_n, f.corpse_n);
        try testing.expectEqual(a.c, f.c);
    }
    // Pigeon 0 is back on the perch of the server.
    try testing.expectEqual(pigeons.State.perched, pigeons.birds[0].state);
    try testing.expectEqual(pigeons.perchAt(7, 0.3).?.pos, pigeons.birds[0].perch.pos);
    try testing.expectEqual(@as(u16, 1), pigeons.birds[0].gen);
}

test "pigeons: deathmatch: a body is held by one player; a drop gives it back" {
    setup(5);
    defer map.deinit();
    pigeons.net = true;
    defer pigeons.net = false;
    pigeons.applyDie(2, 0, v3(0, 3, -4), v3(0, 0, 0));
    try testing.expectEqual(@as(usize, 1), pigeons.corpse_n);
    run(6);
    const rest = pigeons.corpses[0].pos;
    // This client (id 1) grabs it, but the server gives it to player 7.
    pigeons.grab(0);
    try testing.expectEqual(pigeons.NetKind.grab, pigeons.outbox[0].kind);
    pigeons.out_n = 0;
    pigeons.applyGrab(2, 0, 7, 1);
    try testing.expectEqual(@as(?usize, null), pigeons.held);
    try testing.expectEqual(@as(?usize, null), pigeons.pick(rest + v3(0, 1, 1), vec.norm(v3(0, -1, -1)), 2.6));
    // Player 7 carries it, then throws it.
    for (0..30) |_| {
        pigeons.carryFor(7, v3(2, 1.6, -4), v3(2, 1.3, -4.6), 0, dt);
        tick();
    }
    try testing.expect(vec.len(pigeons.corpses[0].pos - v3(2, 1.3, -4.6)) < 0.01);
    pigeons.applyDrop(2, 0, v3(2, 1.3, -4.6), v3(0, 1, -3));
    run(6);
    try testing.expectEqual(@as(u32, 0), pigeons.corpses[0].holder);
    try testing.expect(pigeons.corpses[0].rest);
    try testing.expect(vec.len(pigeons.corpses[0].pos - rest) > 0.5);
}
