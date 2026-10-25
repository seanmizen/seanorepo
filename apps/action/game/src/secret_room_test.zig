// Where: apps/action/game/src/secret_room_test.zig (zig build test)
// When: after a change to the secret room of VAPES N MORE (secret_room.zig,
// maps/earls_court.zig vapeShop and secretRoom) or to the player movement.
// Why: checks that the shut door is a wall and shows nothing, that GET
// MORE opens it, that a player then walks from the shop to the plinth,
// that the golden pigeon is in reach there and gives a blessing of 45 s,
// that the room lights stay dark until the door opens, and that the aim
// of a blessing moves the shot and not the camera.
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
    // Shut, the door is a wall, and the golden pigeon is out of sight.
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
    // In front of the plinth, the golden pigeon is in reach.
    const near = v3(plinth[0] - 1.5, 4.92 + 0.15 + 1.6, door_z);
    try testing.expect(secret.pickMore(near, toward(near, plinth)));
    // MORE: a blessing of 45 s. The golden pigeon is out of use until it
    // ends. The shine comes up fast and fades at the end.
    secret.bless();
    try testing.expect(!secret.pickMore(near, toward(near, plinth)));
    try testing.expect(secret.shine(secret.bless_time - 1) > 0.99);
    try testing.expect(secret.shine(0.5) < 0.2);
    for (0..@as(usize, @intFromFloat(44 / dt))) |_| secret.step(dt);
    try testing.expect(secret.blessed != null);
    for (0..@as(usize, @intFromFloat(1.5 / dt))) |_| secret.step(dt);
    try testing.expect(secret.blessed == null);
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

/// The angle between two unit directions.
fn angle(a: V3, b: V3) f32 {
    return std.math.acos(std.math.clamp(vec.dot(a, b), -1, 1));
}

test "the aim of a blessing: the shot goes to the head, the camera does not move" {
    map.init(testing.allocator);
    defer map.deinit();
    map.load(.earls_court);
    // High over the map: no wall near the eye.
    var p: player.Player = .{ .pos = v3(0, 300, 0), .yaw = 0.4, .pitch = -0.1 };
    const eye = p.eyePos();
    const f = vec.forward(p.yaw, p.pitch);
    try testing.expect(map.raycast(eye - f * vec.s(20), f, 40) == null);
    var aim: secret.Aim = .{};
    // No blessing: the aim is the camera forward.
    try testing.expect(aim.idle());
    try testing.expectEqual(f, aim.dir(eye, p.yaw, p.pitch));
    try testing.expectEqual(v3(0, 0, -1), aim.local(eye, p.yaw, p.pitch));

    // Two heads 12 m away: 0.25 rad and 0.4 rad off the middle. A third
    // one is out of the cone.
    const right = vec.norm(vec.cross(f, v3(0, 1, 0)));
    const near_head = eye + vec.norm(f + right * vec.s(@tan(@as(f32, 0.25)))) * vec.s(12);
    const far_head = eye + vec.norm(f - right * vec.s(@tan(@as(f32, 0.4)))) * vec.s(12);
    const out_head = eye + vec.norm(f + right * vec.s(@tan(@as(f32, 0.8)))) * vec.s(12);
    const heads = [_]secret.Head{ .{ .id = 3, .pos = far_head }, .{ .id = 7, .pos = near_head }, .{ .id = 9, .pos = out_head } };
    const yaw0 = p.yaw;
    const pitch0 = p.pitch;

    // One tick: the aim starts to glide. It does not jump.
    aim.step(dt, eye, p.yaw, p.pitch, &heads, true);
    try testing.expectEqual(@as(?u32, 7), aim.id);
    const to = vec.norm(near_head - eye);
    try testing.expect(angle(aim.dir(eye, p.yaw, p.pitch), f) < 0.05);
    // After the glide time: on the head nearest the middle.
    for (0..@as(usize, @intFromFloat(secret.aim_glide / dt))) |_| aim.step(dt, eye, p.yaw, p.pitch, &heads, true);
    const shot = aim.dir(eye, p.yaw, p.pitch);
    try testing.expect(angle(shot, to) < 0.001);
    try testing.expect(angle(shot, f) > 0.24);
    // The yaw and the pitch do not change. The camera forward stays.
    try testing.expectEqual(yaw0, p.yaw);
    try testing.expectEqual(pitch0, p.pitch);
    try testing.expectEqual(f, vec.forward(p.yaw, p.pitch));
    // In camera space the aim is to the right of the middle.
    const l = aim.local(eye, p.yaw, p.pitch);
    try testing.expect(l[0] > 0.2 and l[2] < -0.9);
    try testing.expect(vec.len(aim.point(eye, p.yaw, p.pitch) - near_head) < 0.01);

    // The mouse turns the camera: the aim stays on the head.
    p.yaw -= 0.1;
    aim.step(dt, eye, p.yaw, p.pitch, &heads, true);
    try testing.expect(angle(aim.dir(eye, p.yaw, p.pitch), to) < 0.001);

    // Walls between the eye and the two heads in the cone: no target. The
    // aim glides back to the camera forward.
    const mid_near = eye + (near_head - eye) * vec.s(0.5);
    const mid_far = eye + (far_head - eye) * vec.s(0.5);
    _ = map.add(mid_near - vec.s(1), mid_near + vec.s(1), v3(1, 1, 1), .paint, .wood);
    _ = map.add(mid_far - vec.s(1), mid_far + vec.s(1), v3(1, 1, 1), .paint, .wood);
    aim.step(dt, eye, p.yaw, p.pitch, &heads, true);
    try testing.expectEqual(@as(?u32, null), aim.id);
    const back_f = vec.forward(p.yaw, p.pitch);
    try testing.expect(angle(aim.dir(eye, p.yaw, p.pitch), back_f) > 0.1);
    for (0..@as(usize, @intFromFloat(secret.aim_glide / dt))) |_| aim.step(dt, eye, p.yaw, p.pitch, &heads, true);
    try testing.expect(aim.idle());
    try testing.expectEqual(back_f, aim.dir(eye, p.yaw, p.pitch));

    // No blessing: no target.
    var off: secret.Aim = .{};
    off.step(dt, eye, yaw0, pitch0, &heads, false);
    try testing.expect(off.idle());
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
