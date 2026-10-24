// Where: apps/action/game/src/tests.zig (zig build test)
// When: after a change to the player movement, the player model, the maps,
// the vault, the console, the session, the server cvars, the gun model, the
// bullet sounds or the NPC shooter.
// Why: one native test binary: the walks over the stairs and escalators
// and the lift rides (player_test.zig), the vault (vault_test.zig), your
// own body in first person (body_test.zig), the console framework
// (console/tests.zig), the session layer (session/tests.zig), the gun model
// (guns_test.zig), the box limit and the surface materials
// (surfaces_test.zig), the bullet sound models (audio/tests.zig), the NPC
// shooter of the range and the impact effects (shooter_test.zig), the
// secret room of VAPES N MORE (secret_room_test.zig), the server cvar file
// and the protocol version of the game.
const std = @import("std");
const schema = @import("console/schema.zig");
const line = @import("console/line.zig");

test {
    _ = @import("player_test.zig");
    _ = @import("vault_test.zig");
    _ = @import("body_test.zig");
    _ = @import("console/tests.zig");
    _ = @import("guns_test.zig");
    _ = @import("session/tests.zig");
    _ = @import("surfaces_test.zig");
    _ = @import("audio/tests.zig");
    _ = @import("shooter_test.zig");
    _ = @import("pigeons_test.zig");
    _ = @import("secret_room_test.zig");
    _ = @import("train_sound.zig");
    _ = @import("train_car.zig");
    _ = @import("ao_grid.zig");
}

test "protocol_version.txt: one number, 1 or more" {
    // net.zig reads the file at compile time. server/session.ts reads it
    // at start.
    try std.testing.expect(@import("net.zig").protocol_version >= 1);
}

test "server_cvars.json: valid, and the defaults are safe" {
    var arena: std.heap.ArenaAllocator = .init(std.testing.allocator);
    defer arena.deinit();
    const defs = try schema.parseDefs(arena.allocator(), @embedFile("server_cvars.json"), .{ .server = true });
    var despawn = false;
    var admin = false;
    var chat = false;
    for (defs) |d| {
        try std.testing.expect(d.flags.server);
        if (std.mem.eql(u8, d.name, "despawn_cadaver_timer")) {
            despawn = true;
            // Unset: bodies never despawn.
            try std.testing.expect(d.default.float < 0);
        }
        if (std.mem.eql(u8, d.name, "admin_password")) {
            admin = true;
            // Remote admin is off until the server config sets a password.
            try std.testing.expect(d.flags.protected);
            try std.testing.expectEqualStrings("", d.default.string);
        }
        if (std.mem.eql(u8, d.name, "chat_max_length")) {
            chat = true;
            // The chat input line of the client holds line.max_len bytes.
            try std.testing.expect(d.max.? <= line.max_len);
        }
    }
    try std.testing.expect(despawn and admin and chat);
}
