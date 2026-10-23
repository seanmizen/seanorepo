// Where: apps/action/game/src/audio/tests.zig (zig build test, from
// src/tests.zig)
// When: after a change to the near-miss model, the impact sounds or the
// spatial model (audio/), or the choir.
// Why: checks the geometry of the Mach cone, Whitham's N-wave laws, the
// order of the crack, the muzzle report and the whiz, the head cues, the
// Doppler shift of the whiz, the distance law, and that each material
// makes its own bounded sound. The choir is bounded and wide, and it
// starts and ends quiet.
const std = @import("std");
const testing = std.testing;
const root = @import("root.zig");
const dsp = root.dsp;
const space = root.space;
const nm = root.near_miss;
const impact = root.impact;
const V3 = space.V3;

fn v3(x: f32, y: f32, z: f32) V3 {
    return .{ x, y, z };
}

/// A 5.56 mm bullet at Mach 2 along +X from the origin.
fn rifle(speed: f32, length: f32) nm.Bullet {
    return .{ .from = v3(0, 0, 0), .dir = v3(1, 0, 0), .length = length, .speed = speed, .diameter = 0.0057, .body = 0.023 };
}

var left: [96000]f32 = undefined;
var right: [96000]f32 = undefined;
var mono: [96000]f32 = undefined;

fn out() space.Out {
    return .{ .l = &left, .r = &right };
}

test "the crack leaves the path at the Mach angle and comes before the muzzle report" {
    const c: f32 = 343;
    const b = rifle(2 * c, 200);
    const p = nm.pass(b, v3(50, 2, 0), c);
    const cr = p.crack.?;
    const k = @sqrt(@as(f32, 3));
    // s* = x - b / sqrt(M^2 - 1)
    try testing.expectApproxEqAbs(50 - 2 / k, cr.from[0], 1e-3);
    // t = (x + b sqrt(M^2 - 1)) / v
    try testing.expectApproxEqAbs((50 + 2 * k) / (2 * c), cr.time, 1e-5);
    // The shock leaves at acos(1/M) = 60 degrees to the path.
    try testing.expectApproxEqAbs(0.5, space.dot(b.dir, space.norm(v3(50, 2, 0) - cr.from)), 1e-4);
    // Downrange the crack is first: the muzzle report comes 68 ms later.
    try testing.expect(cr.time < p.muzzle);
    try testing.expectApproxEqAbs(@sqrt(@as(f32, 2504)) / c, p.muzzle, 1e-5);
}

test "no crack behind the Mach cone of the muzzle, or past the end of the path" {
    const c: f32 = 343;
    // Behind the shooter.
    try testing.expect(nm.pass(rifle(2 * c, 200), v3(-5, 1, 0), c).crack == null);
    // Beside the muzzle: s* = 1 - 5 / sqrt(3) < 0.
    try testing.expect(nm.pass(rifle(2 * c, 200), v3(1, 5, 0), c).crack == null);
    // The bullet hits a wall at 30 m, before the emission point (59 m).
    try testing.expect(nm.pass(rifle(2 * c, 30), v3(60, 1, 0), c).crack == null);
    // At a constant speed the crack never comes after the muzzle report.
    // The two come together at the edge of the cone (x = b / sqrt(M^2 - 1)),
    // and the gap grows downrange.
    const b = rifle(2.6 * c, 200);
    const k = @sqrt(2.6 * 2.6 - 1);
    var last_gap: f32 = -1;
    for ([_]f32{ 1.001, 2, 5, 20 }) |f| {
        const p = nm.pass(b, v3(f * 10 / k, 10, 0), c);
        const gap = p.muzzle - p.crack.?.time;
        try testing.expect(gap >= -1e-6 and gap > last_gap);
        last_gap = gap;
    }
    const edge = nm.pass(b, v3(1.001 * 10 / k, 10, 0), c);
    try testing.expectApproxEqAbs(edge.muzzle, edge.crack.?.time, 1e-4);
}

test "Whitham: the peak falls as b^-3/4 and the length grows as b^1/4" {
    const c: f32 = 343;
    const near = nm.nwave(900 / c, 1, 0.0057, 0.023, c);
    const far = nm.nwave(900 / c, 16, 0.0057, 0.023, c);
    try testing.expectApproxEqRel(@as(f32, 1.0 / 8.0), far.peak / near.peak, 1e-4);
    try testing.expectApproxEqRel(@as(f32, 2), far.width / near.width, 1e-4);
    // A 5.56 mm bullet at a 1 m miss: about 1 kPa and 0.1 ms.
    try testing.expect(near.peak > 800 and near.peak < 1200);
    try testing.expect(near.width > 80e-6 and near.width < 150e-6);
}

test "an N-wave: up, down, and no net pressure" {
    var buf: [64]f32 = @splat(0);
    nm.addNWave(&buf, 10.3 / dsp.rate, 8 / dsp.rate, 1);
    var sum: f32 = 0;
    var first: ?usize = null;
    for (buf, 0..) |x, i| {
        sum += x;
        if (first == null and @abs(x) > 0.1) first = i;
    }
    try testing.expectApproxEqAbs(@as(f32, 0), sum, 1e-4);
    try testing.expectEqual(@as(?usize, 10), first);
    try testing.expect(buf[10] > 0.5 and buf[17] < -0.5);
}

test "a subsonic bullet: no crack, and the muzzle report comes before the whiz" {
    const c: f32 = 343;
    const b: nm.Bullet = .{ .from = v3(0, 0, 0), .dir = v3(1, 0, 0), .length = 100, .speed = 255, .diameter = 0.0115, .body = 0.017 };
    const p = nm.pass(b, v3(30, 1, 0), c);
    try testing.expect(p.crack == null);
    try testing.expect(p.nearest + p.miss / c > p.muzzle);
}

/// The first sample over 5% of the peak of a channel.
fn onset(ch: []const f32) usize {
    const pk = dsp.peak(ch);
    for (ch, 0..) |x, i| if (@abs(x) > 0.05 * pk) return i;
    return ch.len;
}

test "render a crack: at its time, from the side of the emission point, the near ear first" {
    const c: f32 = 343;
    const b = rifle(900, 200);
    // The listener faces the shooter (-X). Its right is -Z, and the path
    // passes 2 m to that side.
    const lis: space.Listener = .{ .pos = v3(50, 0, 2), .right = v3(0, 0, -1), .forward = v3(-1, 0, 0) };
    var o = out();
    var rng = dsp.Rng.init(3);
    const room: space.Room = .{};
    try testing.expect(nm.render(&o, &mono, b, lis, &room, &rng, .{}));
    const cr = nm.pass(b, lis.pos, c).crack.?;
    const r0 = onset(o.r[0..o.n]);
    const l0 = onset(o.l[0..o.n]);
    try testing.expect(r0 < l0);
    try testing.expectApproxEqAbs(cr.time, o.t0 + @as(f32, @floatFromInt(r0)) / dsp.rate, 0.0005);
    // The N-wave starts with the rise of pressure.
    try testing.expect(o.r[r0] > 0);
    try testing.expect(dsp.peak(o.r[0..o.n]) > dsp.peak(o.l[0..o.n]));
}

/// Zero crossings a sample of the sum of the two channels in [a, b).
fn crossRate(o: *const space.Out, a: usize, b: usize) f32 {
    var n: f32 = 0;
    var prev = o.l[a] + o.r[a];
    for (a + 1..b) |i| {
        const x = o.l[i] + o.r[i];
        if ((x > 0) != (prev > 0)) n += 1;
        prev = x;
    }
    return n / @as(f32, @floatFromInt(b - a));
}

test "render a whiz: higher while the bullet comes than after it goes" {
    const c: f32 = 343;
    const b: nm.Bullet = .{ .from = v3(0, 0, 0), .dir = v3(1, 0, 0), .length = 100, .speed = 255, .diameter = 0.0115, .body = 0.017 };
    const lis: space.Listener = .{ .pos = v3(30, 0, 1), .right = v3(0, 0, 1), .forward = v3(-1, 0, 0) };
    var o = out();
    var rng = dsp.Rng.init(5);
    const room: space.Room = .{};
    try testing.expect(nm.render(&o, &mono, b, lis, &room, &rng, .{}));
    const p = nm.pass(b, lis.pos, c);
    const at_pass = o.index(p.nearest + p.miss / c);
    const ms: usize = @intFromFloat(dsp.rate / 1000);
    const coming = crossRate(&o, at_pass - 4 * ms, at_pass);
    const going = crossRate(&o, at_pass + 3 * ms, at_pass + 15 * ms);
    try testing.expect(coming > 1.3 * going);
    try testing.expect(dsp.peak(o.l[0..o.n]) > 0.01);
    try testing.expect(dsp.peak(o.l[0..o.n]) < 1);
}

test "the near miss is silent past max_miss" {
    const lis: space.Listener = .{ .pos = v3(50, 0, 30), .right = v3(0, 0, -1), .forward = v3(-1, 0, 0) };
    var o = out();
    var rng = dsp.Rng.init(1);
    const room: space.Room = .{};
    try testing.expect(!nm.render(&o, &mono, rifle(900, 200), lis, &room, &rng, .{ .max_miss = 25 }));
}

/// The mean step between samples against the mean level: more for a
/// brighter sound.
fn brightness(buf: []const f32) f32 {
    var d: f32 = 0;
    var a: f32 = 0;
    for (buf[1..], 1..) |x, i| {
        d += @abs(x - buf[i - 1]);
        a += @abs(x);
    }
    return d / @max(a, 1e-9);
}

/// The energy after `t` s.
fn tailEnergy(buf: []const f32, t: f32) f32 {
    const k = dsp.at(t);
    if (k >= buf.len) return 0;
    return space.energy(buf[k..]);
}

test "each material makes a bounded sound of its own" {
    var rng = dsp.Rng.init(9);
    var e: std.enums.EnumArray(impact.Material, f32) = .initFill(0);
    var br: std.enums.EnumArray(impact.Material, f32) = .initFill(0);
    for (std.enums.values(impact.Material)) |m| {
        const n = impact.strike(&mono, m, 1, &rng);
        const s = mono[0..n];
        try testing.expect(n > 100);
        const pk = dsp.peak(s);
        try testing.expect(pk > 0.1 and pk <= 1.0001);
        for (s) |x| try testing.expect(std.math.isFinite(x));
        e.set(m, tailEnergy(s, 0.15) / space.energy(s));
        br.set(m, brightness(s));
    }
    // Steel rings for longer than wood and stone.
    try testing.expect(e.get(.metal) > 2 * e.get(.wood));
    try testing.expect(e.get(.metal) > 2 * e.get(.concrete));
    try testing.expect(e.get(.sheet_metal) > e.get(.wood));
    // Glass and tile are brighter than earth, fabric and flesh.
    try testing.expect(br.get(.glass) > 2 * br.get(.earth));
    try testing.expect(br.get(.tile) > 2 * br.get(.fabric));
    try testing.expect(br.get(.concrete) > br.get(.flesh));
}

test "impact: twice the distance, half the level, and the delay of the path" {
    const c: f32 = 343;
    const lis: space.Listener = .{ .pos = v3(0, 0, 0), .right = v3(1, 0, 0), .forward = v3(0, 0, -1) };
    const room: space.Room = .{ .wet = 0 };
    var peaks: [2]f32 = undefined;
    for ([_]f32{ 4, 8 }, 0..) |d, i| {
        var o = out();
        var rng = dsp.Rng.init(11);
        impact.render(&o, &mono, .{ .pos = v3(0, 0, -d), .material = .concrete, .time = 0.01 }, lis, &room, &rng, c);
        try testing.expectApproxEqAbs(0.01 + d / c, o.t0, 1e-5);
        peaks[i] = dsp.peak(o.l[0..o.n]);
    }
    try testing.expectApproxEqRel(@as(f32, 0.5), peaks[1] / peaks[0], 0.1);
}

test "the floor reflection comes after the direct sound, from below" {
    const lis: space.Listener = .{ .pos = v3(0, 1.7, 0), .right = v3(1, 0, 0), .forward = v3(0, 0, -1) };
    var room: space.Room = .{};
    room.add(.{ .n = v3(0, 1, 0), .d = 0, .k = 0.9 });
    var buf: [4]space.Arrival = undefined;
    const src = v3(5, 1, 0);
    const refl = space.reflections(&buf, lis, &room, src, 0, 343, 1);
    try testing.expectEqual(@as(usize, 1), refl.len);
    const d = space.direct(lis, src, 0, 343, 1);
    try testing.expect(refl[0].time > d.time);
    try testing.expectApproxEqAbs(@sqrt(@as(f32, 25 + 2.7 * 2.7)) / 343, refl[0].time, 1e-5);
    try testing.expect(refl[0].dir[1] < d.dir[1]);
    // A source under the floor has no image.
    try testing.expectEqual(@as(usize, 0), space.reflections(&buf, lis, &room, v3(5, -1, 0), 0, 343, 1).len);
}

test "the head: the far ear is later by up to about 0.66 ms" {
    try testing.expectApproxEqAbs(@as(f32, 0), space.itd(0), 1e-6);
    const full = space.itd(1);
    try testing.expect(full > 0.0006 and full < 0.0007);
    try testing.expect(space.itd(0.5) < full);
}

test "the choir: bounded, quiet at both ends, and wide" {
    const choir = root.choir;
    const l = try testing.allocator.alloc(f32, choir.frames);
    defer testing.allocator.free(l);
    const r = try testing.allocator.alloc(f32, choir.frames);
    defer testing.allocator.free(r);
    choir.render(l, r, 7);
    var peak: f32 = 0;
    var diff: f32 = 0;
    for (l, r) |a, b| {
        try testing.expect(std.math.isFinite(a) and std.math.isFinite(b));
        peak = @max(peak, @max(@abs(a), @abs(b)));
        diff += @abs(a - b);
    }
    try testing.expectApproxEqAbs(@as(f32, 0.9), peak, 1e-3);
    // The two ears are not the same: the singers stand apart.
    try testing.expect(diff / @as(f32, @floatFromInt(choir.frames)) > 0.01);
    // A swell from silence, and the tail dies away before the end.
    const rate: usize = @intFromFloat(choir.rate);
    try testing.expect(dsp.peak(l[0 .. rate / 10]) < 0.05);
    try testing.expect(dsp.peak(l[choir.frames - rate / 2 ..]) < 0.01);
    // The same seed gives the same sound.
    const l2 = try testing.allocator.alloc(f32, choir.frames);
    defer testing.allocator.free(l2);
    choir.render(l2, r, 7);
    try testing.expectEqualSlices(f32, l, l2);
}
