//! The drawing options and the fill rules. kernel/bootmap.c has the same
//! options (kernel command line: bootmap.<key>=<value>) and the same rules.
//!
//!   fill=raster|rows-up|spiral   the order in which a box fills
//!   fill_ms=250                  the shortest fill animation of a box
//!   outline=1                    the outline width when a box spawns (0: none)
//!   empty=black|white|dim|#rrggbb  the colour of the part that is not full
//!   spawn=start|plan             a box appears when its step starts, or all
//!                                boxes appear in the first frame
//!   gap=1                        the space between two boxes
//!   pad=1,1,1                    the inset of the screen, a stage, a group
//!   warn_ms=500                  a step is late after this time (or after 2x
//!                                its expected time): the pixels that it
//!                                paints from then on are yellow
//!   late=clear|keep              when a late step completes, its yellow
//!                                pixels get the stage colour (clear), or stay
//!
//! One pixel is one unit (REQ-BOOTMAP-006). Nothing is drawn wider than 1 px
//! for emphasis. State shows in the colour of single pixels.

const std = @import("std");
const palette = @import("palette.zig");

pub const Fill = enum { raster, rows_up, spiral };
pub const Spawn = enum { start, plan };
pub const Late = enum { clear, keep };
pub const Empty = union(enum) {
    color: u32,
    /// The stage colour at 25 %.
    dim,
};

pub const Style = struct {
    fill: Fill = .raster,
    fill_ms: u32 = 250,
    outline: u8 = 1,
    empty: Empty = .{ .color = 0 },
    spawn: Spawn = .start,
    gap: u8 = 1,
    pads: [3]u8 = .{ 1, 1, 1 },
    warn_ms: u32 = 500,
    late: Late = .clear,

    pub fn emptyColor(s: Style, stage_color: u32) u32 {
        return switch (s.empty) {
            .color => |c| c,
            .dim => palette.scale(stage_color, 25),
        };
    }

    /// Set one option from "key=value". The key may have the "bootmap."
    /// prefix of the kernel command line.
    pub fn set(s: *Style, kv: []const u8) !void {
        const eq = std.mem.indexOfScalar(u8, kv, '=') orelse return error.NoValue;
        var key = kv[0..eq];
        const v = kv[eq + 1 ..];
        if (std.mem.startsWith(u8, key, "bootmap.")) key = key["bootmap.".len..];
        if (std.mem.eql(u8, key, "fill")) {
            s.fill = if (std.mem.eql(u8, v, "raster")) .raster else if (std.mem.eql(u8, v, "rows-up")) .rows_up else if (std.mem.eql(u8, v, "spiral")) .spiral else return error.BadFill;
        } else if (std.mem.eql(u8, key, "fill_ms")) {
            s.fill_ms = @max(try std.fmt.parseInt(u32, v, 10), 1);
        } else if (std.mem.eql(u8, key, "outline")) {
            s.outline = try std.fmt.parseInt(u8, v, 10);
        } else if (std.mem.eql(u8, key, "empty")) {
            s.empty = if (std.mem.eql(u8, v, "white")) .{ .color = 0xffffff } else if (std.mem.eql(u8, v, "black")) .{ .color = 0 } else if (std.mem.eql(u8, v, "dim")) .dim else if (v.len == 7 and v[0] == '#') .{ .color = try std.fmt.parseInt(u32, v[1..], 16) } else return error.BadEmpty;
        } else if (std.mem.eql(u8, key, "spawn")) {
            s.spawn = if (std.mem.eql(u8, v, "start")) .start else if (std.mem.eql(u8, v, "plan")) .plan else return error.BadSpawn;
        } else if (std.mem.eql(u8, key, "warn_ms")) {
            s.warn_ms = try std.fmt.parseInt(u32, v, 10);
        } else if (std.mem.eql(u8, key, "late")) {
            s.late = if (std.mem.eql(u8, v, "clear")) .clear else if (std.mem.eql(u8, v, "keep")) .keep else return error.BadLate;
        } else if (std.mem.eql(u8, key, "gap")) {
            s.gap = try std.fmt.parseInt(u8, v, 10);
        } else if (std.mem.eql(u8, key, "pad")) {
            var it = std.mem.splitScalar(u8, v, ',');
            for (&s.pads) |*p| p.* = try std.fmt.parseInt(u8, it.next() orelse return error.BadPad, 10);
        } else return error.UnknownOption;
    }
};

/// How full a box is, in permille, at time `now_us`.
///   While active, up to span = max(expected, fill_ms): elapsed / span * 900.
///   While active, after span: 1000 - 100 * span / elapsed. The fill keeps
///   moving towards 1000 and never gets there, so a late step still paints
///   pixels, and they show how late it is.
///   After the end: the value at the end, plus 1000 for each fill_ms.
/// `expected_us` is 0 when nothing is known (the kernel). Integer math, so
/// kernel/bootmap.c gives the same value.
pub fn permille(start_us: u64, end_us: ?u64, expected_us: u64, fill_ms: u32, now_us: u64) u32 {
    if (now_us < start_us) return 0;
    const fill_us: u64 = @as(u64, fill_ms) * 1000;
    const span = @max(expected_us, fill_us);
    if (end_us == null or now_us < end_us.?) return @intCast(activeAt(now_us - start_us, span));
    const at_end = activeAt(end_us.? - start_us, span);
    const after = ((now_us - end_us.?) * 1000) / fill_us;
    return @intCast(@min(at_end + after, 1000));
}

fn activeAt(t: u64, span: u64) u64 {
    if (t <= span) return (t * 900) / span;
    return @min(1000 - (100 * span) / t, 999);
}

/// The time after which a step in flight is late: start + max(2 * expected,
/// warn_ms). The pixels that it paints from then until it ends are yellow.
pub fn lateAt(s: Style, start_us: u64, expected_us: u64) u64 {
    return start_us + @max(expected_us * 2, @as(u64, s.warn_ms) * 1000);
}

test "permille" {
    try std.testing.expectEqual(@as(u32, 0), permille(10, null, 0, 250, 5));
    try std.testing.expectEqual(@as(u32, 360), permille(0, null, 0, 250, 100_000));
    try std.testing.expectEqual(@as(u32, 900), permille(0, null, 0, 250, 250_000));
    // Late: 1000 - 100 * 250 / 1000 = 975, and never 1000 while in flight.
    try std.testing.expectEqual(@as(u32, 975), permille(0, null, 0, 250, 1_000_000));
    try std.testing.expectEqual(@as(u32, 999), permille(0, null, 0, 250, 1_000_000_000));
    // Done after 1 ms: 3 at the end, then full 250 ms later.
    try std.testing.expectEqual(@as(u32, 3), permille(0, 1000, 0, 250, 1000));
    try std.testing.expectEqual(@as(u32, 1000), permille(0, 1000, 0, 250, 300_000));
    // A long step with a known time fills in proportion.
    try std.testing.expectEqual(@as(u32, 450), permille(0, null, 2_000_000, 250, 1_000_000));
}

test "set options" {
    var s: Style = .{};
    try s.set("bootmap.fill=spiral");
    try s.set("empty=#102030");
    try s.set("pad=1,2,3");
    try std.testing.expectEqual(Fill.spiral, s.fill);
    try std.testing.expectEqual(@as(u32, 0x102030), s.emptyColor(0));
    try s.set("late=keep");
    try std.testing.expectEqual(Late.keep, s.late);
    try std.testing.expectEqual([3]u8{ 1, 2, 3 }, s.pads);
    try std.testing.expectError(error.UnknownOption, s.set("nope=1"));
}
