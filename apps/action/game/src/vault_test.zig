// Where: apps/action/game/src/vault_test.zig (zig build test)
// When: after a change to the vault (vault.zig), the player movement
// (player.zig), the collision (map.zig), the gates (gates.zig), or a wall,
// a railing or a gate line of a map.
// Why: vaults a player natively, with no browser. Each vault checks that:
//   - the player ends on the top of the shape, on the ground, and out of
//     all solid shapes,
//   - the player stays on the top while standing still (one second),
//   - a railing over the tracks of Earl's Court holds the player,
//   - a vault onto the ticket gates is a fare dodge (gates.onGates),
//   - past the barrier at a District platform end, the live rail kills
//     (earls_court.liveRail).
// A shape that is too high or too low, or with no room above it, gives no
// vault. A walk into the closed gates does not cross the gate line.
const std = @import("std");
const map = @import("map.zig");
const player = @import("player.zig");
const vault = @import("vault.zig");
const gates = @import("gates.zig");
const arena = @import("maps/arena.zig");
const ec = @import("maps/earls_court.zig");
const vec = @import("vec.zig");
const V3 = vec.V3;
const v3 = vec.v3;

/// The game tick (main.zig tick_hz).
const dt: f32 = 1.0 / 120.0;

/// The yaws for a walk along each axis (forward is (-sin yaw, 0, -cos yaw)).
const to_pz: f32 = std.math.pi;
const to_nx: f32 = std.math.pi / 2.0;

fn load(id: map.Id) void {
    map.init(std.testing.allocator);
    map.load(id);
}

fn unload() void {
    map.deinit();
}

fn bodyFree(p: V3) bool {
    const r = player.radius;
    return !map.overlaps(p - v3(r, 0, r), p + v3(r, player.height, r));
}

/// A player at `start`, landed and at rest.
fn landed(start: V3, yaw: f32) player.Player {
    var p: player.Player = .{ .pos = start, .yaw = yaw };
    for (0..120) |_| p.step(dt, v3(0, 0, 0), false, 1);
    return p;
}

/// Walk forward for `secs` (into a wall: the player stops at it).
fn walk(p: *player.Player, secs: f32) void {
    const f = v3(-@sin(p.yaw), 0, -@cos(p.yaw));
    const n: usize = @intFromFloat(secs / dt);
    for (0..n) |_| p.step(dt, f, false, 1);
}

/// Space while walking forward, as main.zig gameplayTick does it: a vault
/// when there is one, else a jump. Then stand still for `stand` seconds.
/// Returns the lowest feet height while standing.
fn vaultThenStand(p: *player.Player, stand: f32) !f32 {
    const to = vault.find(p.*) orelse return error.NoVault;
    var v: vault.Vault = .{ .from = p.pos, .to = to };
    var ticks: usize = 0;
    while (!v.step(p, dt)) ticks += 1;
    // 0.45 s at 120 Hz.
    try std.testing.expect(ticks >= 50 and ticks <= 56);
    try std.testing.expectEqual(to, p.pos);
    var low = p.pos[1];
    const n: usize = @intFromFloat(stand / dt);
    for (0..n) |_| {
        p.step(dt, v3(0, 0, 0), false, 1);
        low = @min(low, p.pos[1]);
    }
    return low;
}

fn expectOnTop(p: player.Player, top: f32, low: f32) !void {
    errdefer std.debug.print("feet ({d:.3} {d:.3} {d:.3}) grounded {} lowest {d:.3} top {d:.3}\n", .{ p.pos[0], p.pos[1], p.pos[2], p.grounded, low, top });
    try std.testing.expect(p.grounded);
    try std.testing.expect(@abs(p.pos[1] - top) < 0.01);
    try std.testing.expect(low > top - 0.01);
    try std.testing.expect(bodyFree(p.pos));
}

// The 10 m row of the range (maps/arena.zig range): five walls 1.05 m high,
// 3 m long and 0.3 m deep, across the range. The middle one is at x = 0.
fn rangeWallZ() f32 {
    return arena.dummyHome(arena.range_dummies[0])[2] - 0.9;
}

test "vault onto a waist-high wall of the range" {
    load(.arena);
    defer unload();
    const wz = rangeWallZ();
    for ([_]f32{ -0.8, 0, 0.8 }) |x| {
        var p = landed(v3(x, 0, wz - 2), to_pz);
        walk(&p, 1);
        // The walk stops at the wall.
        try std.testing.expect(p.pos[2] < wz - 0.15 - player.radius + 0.01);
        const low = try vaultThenStand(&p, 1);
        try expectOnTop(p, 1.05, low);
        // A thin shape: the feet are over the middle.
        try std.testing.expect(@abs(p.pos[2] - wz) < 0.05);
    }
}

test "vault onto the railing of the east concourse: no fall onto the tracks" {
    load(.earls_court);
    defer unload();
    // The railing along the shed edge at x = 45 to 45.12, at the street
    // level, between the stairs down to the islands (z -11.6 to 3.2).
    const top = ec.street_y + 1.1;
    for ([_]f32{ -8, -4, 0 }) |z| {
        var p = landed(v3(47, ec.street_y, z), to_nx);
        try std.testing.expect(@abs(p.pos[1] - ec.street_y) < 0.01);
        walk(&p, 1);
        try std.testing.expect(p.pos[0] > 45.12 + player.radius - 0.01);
        const low = try vaultThenStand(&p, 3);
        try expectOnTop(p, top, low);
        try std.testing.expect(@abs(p.pos[0] - 45.06) < 0.05);
    }
}

// The barrier at each end of each District island (maps/earls_court.zig
// platformEnd): 1.1 m high, its far face at shock_x. A player can vault it,
// and the live rail kills past it.
test "vault onto a platform-end barrier: the live rail starts past it" {
    load(.earls_court);
    defer unload();
    // The railing of island A, its gate, and the railing of island B.
    for ([_]f32{ -1, 1 }) |dir| {
        for ([_]f32{ -10.5, -12.8, 6.5 }) |z| {
            errdefer std.debug.print("barrier vault toward {d} at z {d:.2}\n", .{ dir, z });
            var p = landed(v3(dir * (ec.shock_x - 2.5), 0, z), if (dir > 0) -to_nx else to_nx);
            walk(&p, 1.5);
            try std.testing.expect(@abs(p.pos[0]) < ec.shock_x - 0.1 - player.radius + 0.01);
            try std.testing.expect(!ec.liveRail(p.pos));
            const low = try vaultThenStand(&p, 1);
            try expectOnTop(p, 1.1, low);
            try std.testing.expect(!ec.liveRail(p.pos));
            walk(&p, 0.5);
            try std.testing.expect(ec.liveRail(p.pos));
        }
    }
}

test "no vault: too high, too low, no room above" {
    load(.arena);
    defer unload();
    // The pillar of the leaning dummy (2.5 m) on the range.
    const dm = arena.range_dummies[5];
    const pz = arena.dummyHome(dm)[2] - 1.15;
    var p = landed(v3(dm.x - 0.55 + 1.1, 0, pz - 2), to_pz);
    walk(&p, 1);
    try std.testing.expect(vault.find(p) == null);
    // The arena wall (7 m): the south wall of the range at its far end.
    p = landed(v3(5, 0, arena.range_line + 75), to_pz);
    walk(&p, 3);
    try std.testing.expect(p.pos[2] > arena.range_line + 75.5);
    try std.testing.expect(vault.find(p) == null);

    // Built cases in the open, west of the range walls (x = -9 to 9).
    const grey = v3(0.5, 0.5, 0.5);
    const z0 = rangeWallZ() - 6;
    // A step (0.3 m): the walk goes up it.
    _ = map.add(v3(-11.5, 0, z0), v3(-10.5, 0.3, z0 + 2), grey, .concrete, .concrete);
    p = landed(v3(-11, 0, z0 - 1.5), to_pz);
    walk(&p, 0.12);
    try std.testing.expect(vault.find(p) == null);
    // A wall 1.05 m high with a ceiling 2.4 m over the floor: 1.35 m of
    // room over the top, less than the body.
    _ = map.add(v3(10.5, 0, z0), v3(11.5, 1.05, z0 + 0.3), grey, .concrete, .concrete);
    _ = map.add(v3(9.5, 2.4, z0 - 2), v3(12.5, 2.6, z0 + 2), grey, .concrete, .concrete);
    p = landed(v3(11, 0, z0 - 1.5), to_pz);
    walk(&p, 1);
    try std.testing.expect(p.pos[2] > z0 - 0.4);
    try std.testing.expect(vault.find(p) == null);
}

// The gate line on the Earls Court Road side (maps/earls_court.zig eastEnd):
// x = 71, 8 lanes about z = -2. Cabinet i is 0.3 m wide from z = -6.55 +
// 1.1 i; the lanes are the 0.8 m between them. A player who goes in walks
// to -X.
const gate_x: f32 = 71;
fn cabinetZ(i: usize) f32 {
    return -6.55 + 1.1 * @as(f32, @floatFromInt(i)) + 0.15;
}
fn laneZ(i: usize) f32 {
    return cabinetZ(i) + 0.55;
}

test "vault onto the ticket gates is a fare dodge" {
    load(.earls_court);
    defer unload();
    try std.testing.expectEqual(@as(usize, 2), gates.line_n);
    var zs: [16]f32 = undefined;
    var n: usize = 0;
    // Toward a cabinet and toward the paddles of a lane.
    for ([_]usize{ 0, 4, 8 }) |i| {
        zs[n] = cabinetZ(i);
        n += 1;
    }
    for ([_]usize{ 1, 5 }) |i| {
        zs[n] = laneZ(i);
        n += 1;
    }
    for (zs[0..n]) |z| {
        errdefer std.debug.print("gate vault at z {d:.2}\n", .{z});
        var p = landed(v3(gate_x + 2.5, ec.street_y, z), to_nx);
        walk(&p, 1);
        try std.testing.expect(p.pos[0] > gate_x);
        try std.testing.expect(!gates.onGates(p.pos));
        const to = vault.find(p) orelse return error.NoVault;
        try std.testing.expect(gates.onGates(to));
        _ = try vaultThenStand(&p, 1);
        try std.testing.expect(gates.onGates(p.pos));
        try std.testing.expect(p.grounded and bodyFree(p.pos));
    }
}

test "a walk into the closed gates does not cross" {
    load(.earls_court);
    defer unload();
    // The paddles close on the first gate step.
    _ = gates.step(dt, null, null, &.{}, player.radius, player.height);
    for ([_]f32{ cabinetZ(2), laneZ(2), laneZ(6) }) |z| {
        var p = landed(v3(gate_x + 2.5, ec.street_y, z), to_nx);
        const before = p.pos;
        walk(&p, 2);
        try std.testing.expect(p.pos[0] > gate_x + 0.08);
        try std.testing.expect(@abs(p.pos[1] - ec.street_y) < 0.01);
        try std.testing.expect(gates.step(dt, before, p.pos, &.{}, player.radius, player.height) == .none);
    }
}
