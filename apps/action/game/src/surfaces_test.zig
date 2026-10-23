// Where: apps/action/game/src/surfaces_test.zig (zig build test)
// When: after a change to a map, to map.zig, or to the gun model.
// Why: checks that each map fits in map.max_boxes, that a full map does
// not overwrite a box, that every box and decoration has a material that
// fits its look, that a hit takes the material of the decoration on the
// hit point, and that the bullet of each gun (guns.zig) gives a crack
// when it is supersonic and a whiz when it is subsonic.
const std = @import("std");
const testing = std.testing;
const map = @import("map.zig");
const guns = @import("guns.zig");
const weapon = @import("weapon.zig");
const nm = @import("audio/near_miss.zig");
const ec = @import("maps/earls_court.zig");
const vec = @import("vec.zig");
const v3 = vec.v3;

fn unload() void {
    map.deinit();
}

test "each map fits in max_boxes, and each surface has a material that fits its look" {
    map.init(testing.allocator);
    defer unload();
    for (std.enums.values(map.Id)) |id| {
        map.load(id);
        try testing.expectEqual(@as(usize, 0), map.dropped);
        try testing.expect(map.box_count <= map.max_boxes);
        for (map.boxes[0..map.box_count]) |b| try testing.expect(map.surfaceFits(b.mat, b.surface));
        for (map.decor.items) |d| try testing.expect(map.surfaceFits(d.mat, d.surface));
    }
}

test "a full map drops the next box and changes no box" {
    map.init(testing.allocator);
    defer unload();
    map.box_count = 0;
    map.dropped = 0;
    for (0..map.max_boxes) |i| {
        const x: f32 = @floatFromInt(i);
        const b = map.add(v3(x, 0, 0), v3(x + 1, 1, 1), v3(0, 0, 0), .concrete, .concrete);
        try testing.expectEqual(@as(?usize, i), map.indexOf(b));
    }
    const last = map.boxes[map.max_boxes - 1];
    const extra = map.add(v3(-5, -5, -5), v3(5, 5, 5), v3(1, 1, 1), .metal, .metal);
    extra.solid = false;
    map.addSolid(v3(-1, -1, -1), v3(1, 1, 1), .metal);
    try testing.expectEqual(map.max_boxes, map.box_count);
    try testing.expectEqual(@as(usize, 2), map.dropped);
    try testing.expectEqual(@as(?usize, null), map.indexOf(extra));
    const now = map.boxes[map.max_boxes - 1];
    try testing.expectEqual(last.min, now.min);
    try testing.expectEqual(last.surface, now.surface);
    try testing.expect(now.solid);
}

/// The surface that a shot straight down at (x, z) from y hits.
fn surfaceUnder(x: f32, y: f32, z: f32) map.Surface {
    const o = v3(x, y, z);
    const h = map.raycast(o, v3(0, -1, 0), 20).?;
    return map.surfaceAt(o + v3(0, -h.t, 0), h.box);
}

test "a hit takes the material of the decoration on the hit point" {
    map.init(testing.allocator);
    defer unload();
    map.load(.earls_court);
    // Track e1 of the District line, east of the shed: the sleepers are
    // decoration on the ballast, 0.9 m apart (maps/earls_court.zig lines).
    // 0.4 m south of the track centre there is no rail.
    const z: f32 = (-21.0 + -16.8) / 2.0 + 0.4;
    var sleeper: ?[2]vec.V3 = null;
    for (map.decor.items, map.decor_bounds.items) |d, bb| {
        if (d.surface == .wood and bb[0][0] > 50 and bb[1][0] < 60 and bb[0][2] < z and bb[1][2] > z and @abs(bb[0][1] - ec.bed_y) < 0.01) {
            sleeper = bb;
            break;
        }
    }
    const s = sleeper.?;
    const mid = (s[0][0] + s[1][0]) / 2;
    try testing.expectEqual(map.Surface.wood, surfaceUnder(mid, 0.5, z));
    try testing.expectEqual(map.Surface.ballast, surfaceUnder(mid + 0.45, 0.5, z));
    // The platform of island A, and its yellow edge.
    try testing.expectEqual(map.Surface.concrete, surfaceUnder(-10, 2, -12.8));
    // The hall floor (tile) under the road (concrete) of Earls Court Road.
    try testing.expectEqual(map.Surface.concrete, surfaceUnder(85, ec.street_y + 2, 20));
    try testing.expectEqual(map.Surface.tile, surfaceUnder(70, ec.street_y + 2, 0));
}

test "the bullet of each gun: a crack when supersonic, a whiz when subsonic" {
    var subsonic: usize = 0;
    for (&guns.table) |*st| {
        try testing.expect(st.bullet_d > 0 and st.bullet_l >= st.bullet_d);
        const b: nm.Bullet = .{ .from = v3(0, 0, 0), .dir = v3(1, 0, 0), .length = 200, .speed = st.velocity, .diameter = st.bullet_d / 1000, .body = st.bullet_l / 1000 };
        const p = nm.pass(b, v3(50, 1, 0), guns.sound_speed);
        try testing.expectEqual(st.supersonic(), p.crack != null);
        if (!st.supersonic()) subsonic += 1;
    }
    // CARBINE 4 (.300 BLK), SMG 1, PISTOL 1 (.45 ACP), PISTOL 3 (.40 S&W)
    // and REVOLVER 5 (.38 Special).
    try testing.expectEqual(@as(usize, 5), subsonic);
    // The knife and the grenade have no bullet.
    try testing.expectEqual(@as(f32, 0), weapon.stats(.knife).bullet_d);
}
