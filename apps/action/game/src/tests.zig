// Where: apps/action/game/src/tests.zig (zig build test)
// When: after a change to the player movement, the maps, the console or
// the server cvars.
// Why: one native test binary: the walks over the stairs and escalators
// (player_test.zig), the console framework (console/tests.zig), and the
// server cvar file of the game.
const std = @import("std");
const schema = @import("console/schema.zig");

test {
    _ = @import("player_test.zig");
    _ = @import("console/tests.zig");
}

test "server_cvars.json: valid, and the defaults are safe" {
    var arena: std.heap.ArenaAllocator = .init(std.testing.allocator);
    defer arena.deinit();
    const defs = try schema.parseDefs(arena.allocator(), @embedFile("server_cvars.json"), .{ .server = true });
    var despawn = false;
    var admin = false;
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
    }
    try std.testing.expect(despawn and admin);
}
