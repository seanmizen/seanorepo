// Buttons: the game actions that a key holds, as in Quake. For each action
// "x" the console has the command "+x" (a key goes down) and "-x" (the key
// comes up). A bind to "+x" runs "-x" on the release. The game reads
// down, pressed and released in its tick, then calls endTick.
//
// The game gives its actions as an enum, so this file knows no game.
const std = @import("std");
const console = @import("console.zig");
const parse = @import("parse.zig");

pub fn Buttons(comptime Action: type) type {
    const Indexer = std.enums.EnumIndexer(Action);
    const n = Indexer.count;
    return struct {
        const Self = @This();

        /// The keys that hold each action. Two keys can hold one action.
        holds: [n]u8 = @splat(0),
        pressed_: [n]bool = @splat(false),
        released_: [n]bool = @splat(false),

        /// Add "+x" and "-x" for each action. `help` describes each action.
        /// The buttons must stay at this address.
        pub fn register(self: *Self, con: *console.Console, help: std.enums.EnumArray(Action, []const u8)) !void {
            inline for (0..n) |i| {
                const a = comptime Indexer.keyForIndex(i);
                try con.addCommand(.{ .name = "+" ++ @tagName(a), .description = help.get(a), .handler = press, .ctx = self, .data = i });
                try con.addCommand(.{ .name = "-" ++ @tagName(a), .description = help.get(a), .handler = release, .ctx = self, .data = i, .hidden = true });
            }
        }

        fn press(_: *console.Console, cmd: *const console.Command, _: *const parse.Args) void {
            const self: *Self = @ptrCast(@alignCast(cmd.ctx.?));
            self.holds[cmd.data] +|= 1;
            self.pressed_[cmd.data] = true;
        }

        fn release(_: *console.Console, cmd: *const console.Command, _: *const parse.Args) void {
            const self: *Self = @ptrCast(@alignCast(cmd.ctx.?));
            // A "-x" from a script with no "+x" does nothing.
            if (self.holds[cmd.data] == 0) return;
            self.holds[cmd.data] -= 1;
            if (self.holds[cmd.data] == 0) self.released_[cmd.data] = true;
        }

        /// A key holds the action now.
        pub fn down(self: *const Self, a: Action) bool {
            return self.holds[Indexer.indexOf(a)] > 0;
        }

        /// The action started in this tick. A press and a release in one tick
        /// (a short click) give pressed and released, and not down.
        pub fn pressed(self: *const Self, a: Action) bool {
            return self.pressed_[Indexer.indexOf(a)];
        }

        pub fn released(self: *const Self, a: Action) bool {
            return self.released_[Indexer.indexOf(a)];
        }

        /// Clear the presses and the releases of this tick.
        pub fn endTick(self: *Self) void {
            self.pressed_ = @splat(false);
            self.released_ = @splat(false);
        }
    };
}
