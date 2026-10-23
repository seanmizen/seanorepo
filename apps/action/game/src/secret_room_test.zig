// Where: apps/action/game/src/secret_room_test.zig (zig build test)
// When: after a change to the secret room of VAPES N MORE (secret_room.zig,
// maps/earls_court.zig vapeShop and secretRoom) or to the player movement.
// Why: checks that the shut door is a wall and shows nothing, that GET
// MORE opens it, that a player then walks from the shop to the plinth,
// that the golden vape is in reach there, and that the room lights stay
// dark until the door opens.
const std = @import("std");
const testing = std.testing;
const map = @import("map.zig");
const player = @import("player.zig");
const secret = @import("secret_room.zig");
const vec = @import("vec.zig");
const V3 = vec.V3;
const v3 = vec.v3;

const dt: f32 = 1.0 / 120.0;
/// The back wall of the shop (maps/earls_court.zig vapeShop bx) and the
/// axis of the door.
const bx: f32 = 92.6 + 7;
const door_z: f32 = -33.325;

/// Walk along +X from `start` for `time` s. Returns the end.
fn walk(start: V3, time: f32) V3 {
    var p: player.Player = .{ .pos = start };
    for (0..120) |_| p.step(dt, v3(0, 0, 0), false, 1);
    const n: usize = @intFromFloat(time / dt);
    for (0..n) |_| {
        p.step(dt, v3(1, 0, 0), false, 1);
        secret.step(dt);
    }
    return p.pos;
}

/// The ray from `eye` to `at`: the direction.
fn toward(eye: V3, at: V3) V3 {
    return vec.norm(at - eye);
}

test "the secret room: GET MORE opens the door, and the room is behind it" {
    map.init(testing.allocator);
    defer map.deinit();
    map.load(.earls_court);
    try testing.expect(!secret.isOpen());
    try testing.expectEqual(@as(f32, 0), secret.glow());

    // The GET MORE pack: the second shelf from the top, in the middle of
    // the door. An eye in front of the shelf sees it.
    const eye = v3(bx - 1.6, 4.92 + 1.6, door_z);
    const pack = v3(bx - 0.42, 4.8 + 1.45 + 0.12, -33.4);
    try testing.expect(secret.pickGetMore(eye, toward(eye, pack)));
    // A pack beside it on the same shelf is an ordinary pack.
    try testing.expect(!secret.pickGetMore(eye, toward(eye, pack + v3(0, 0, 0.5))));
    // Shut, the door is a wall, and the golden vape is out of sight.
    const plinth = v3(bx + 0.3 + 4.7, 4.92 + 1.2 + 0.24, door_z);
    try testing.expect(map.raycast(eye, v3(1, 0, 0), 10).?.t < 1.7);
    try testing.expect(!secret.pickMore(eye, toward(eye, plinth)));
    const stopped = walk(v3(bx - 1.5, 4.92, door_z), 3);
    try testing.expect(stopped[0] < bx - 0.4);

    // GET MORE: the door pushes back and slides aside. The lights come up.
    try testing.expect(secret.open());
    try testing.expect(!secret.open());
    for (0..@as(usize, @intFromFloat(6 / dt))) |_| secret.step(dt);
    try testing.expect(secret.glow() > 0.95);
    try testing.expect(!secret.pickGetMore(eye, toward(eye, pack)));

    // A player walks from the shop through the doorway to the dais.
    const end = walk(v3(bx - 1.5, 4.92, door_z), 4);
    try testing.expect(end[0] > bx + 3);
    // In front of the plinth, the golden vape is in reach.
    const near = v3(plinth[0] - 1.5, 4.92 + 0.15 + 1.6, door_z);
    try testing.expect(secret.pickMore(near, toward(near, plinth)));

    // The room has no sun, and four lights that follow the door.
    try testing.expect(@reduce(.And, plinth > map.sealed[0]) and @reduce(.And, plinth < map.sealed[1]));
    var room_lights: usize = 0;
    for (0..map.light_count) |i| {
        if (secret.isRoomLight(i)) room_lights += 1;
    }
    try testing.expectEqual(@as(usize, 4), room_lights);

    // A new match shuts the door. A late join opens it with no motion.
    secret.shut();
    try testing.expect(map.raycast(eye, v3(1, 0, 0), 10).?.t < 1.7);
    secret.openNow();
    try testing.expect(secret.glow() > 0.95);
    try testing.expect(map.raycast(eye, v3(1, 0, 0), 10).?.t > 3);
}

test "a map with no secret room has no door" {
    map.init(testing.allocator);
    defer map.deinit();
    map.load(.arena);
    try testing.expect(!secret.open());
    try testing.expect(!secret.pickGetMore(v3(0, 1.6, 0), v3(1, 0, 0)));
    try testing.expectEqual(@as(f32, 0), secret.glow());
    try testing.expect(!secret.isRoomLight(0));
}
