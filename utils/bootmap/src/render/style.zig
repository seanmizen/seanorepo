//! The drawing options and the fill rules. kernel/bootmap.c has the same
//! options (kernel command line: bootmap.<key>=<value>) and the same rules.
//!
//!   fill=raster|rows-up|spiral   the order in which a box fills
//!   fill_ms=250                  the shortest fill animation of a box
//!   outline=1                    the outline width when a box spawns (0: none)
//!   empty=white|black|dim|#rrggbb  the colour of the part that is not full
//!   spawn=start|plan             a box appears when its step starts, or all
//!                                boxes appear in the first frame
//!   gap=2                        the space between two boxes
//!   pad=6,3,2                    the inset of the screen, a stage, a group
//!   warn_ms=500, stuck_ms=3000   an in-flight box gets a yellow outline
//!                                when slow, and a red one when stuck

const std = @import("std");
const palette = @import("palette.zig");

pub const Fill = enum { raster, rows_up, spiral };
pub const Spawn = enum { start, plan };
pub const Empty = union(enum) {
    color: u32,
    /// The stage colour at 25 %.
    dim,
};

pub const Style = struct {
    fill: Fill = .raster,
    fill_ms: u32 = 250,
    outline: u8 = 1,
    empty: Empty = .{ .color = 0xffffff },
    spawn: Spawn = .start,
    gap: u8 = 2,
    pads: [3]u8 = .{ 6, 3, 2 },
    warn_ms: u32 = 500,
    stuck_ms: u32 = 3000,

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
        } else if (std.mem.eql(u8, key, "stuck_ms")) {
            s.stuck_ms = try std.fmt.parseInt(u32, v, 10);
        } else if (std.mem.eql(u8, key, "gap")) {
            s.gap = try std.fmt.parseInt(u8, v, 10);
        } else if (std.mem.eql(u8, key, "pad")) {
            var it = std.mem.splitScalar(u8, v, ',');
            for (&s.pads) |*p| p.* = try std.fmt.parseInt(u8, it.next() orelse return error.BadPad, 10);
        } else return error.UnknownOption;
    }
};

/// How full a box is, in permille, at time `now_us`.
///   While active: elapsed / max(expected, fill_ms), at most 900.
///   After the end: the value at the end, plus 1000 for each fill_ms.
/// `expected_us` is 0 when nothing is known (the kernel). Integer math, so
/// kernel/bootmap.c gives the same value.
pub fn permille(start_us: u64, end_us: ?u64, expected_us: u64, fill_ms: u32, now_us: u64) u32 {
    if (now_us < start_us) return 0;
    const fill_us: u64 = @as(u64, fill_ms) * 1000;
    const span = @max(expected_us, fill_us);
    const active_at = struct {
        fn f(t: u64, s: u64) u64 {
            return @min((t * 1000) / s, 900);
        }
    }.f;
    if (end_us == null or now_us < end_us.?) return @intCast(active_at(now_us - start_us, span));
    const at_end = active_at(end_us.? - start_us, span);
    const after = ((now_us - end_us.?) * 1000) / fill_us;
    return @intCast(@min(at_end + after, 1000));
}

pub const Heat = enum(u8) { normal, slow, stuck };

/// How late an in-flight box is. A box that has ended is always normal.
///   stuck: elapsed > max(4 * expected, stuck_ms)
///   slow:  elapsed > max(2 * expected, warn_ms)
pub fn heat(s: Style, start_us: u64, ended: bool, expected_us: u64, now_us: u64) Heat {
    if (ended or now_us < start_us) return .normal;
    const e = now_us - start_us;
    if (e > @max(expected_us * 4, @as(u64, s.stuck_ms) * 1000)) return .stuck;
    if (e > @max(expected_us * 2, @as(u64, s.warn_ms) * 1000)) return .slow;
    return .normal;
}

test "heat" {
    const s: Style = .{};
    try std.testing.expectEqual(Heat.normal, heat(s, 0, false, 0, 400_000));
    try std.testing.expectEqual(Heat.slow, heat(s, 0, false, 0, 600_000));
    try std.testing.expectEqual(Heat.stuck, heat(s, 0, false, 0, 3_100_000));
    try std.testing.expectEqual(Heat.normal, heat(s, 0, true, 0, 9_000_000));
    // A step that normally takes 2 s is not slow at 3 s.
    try std.testing.expectEqual(Heat.normal, heat(s, 0, false, 2_000_000, 3_000_000));
}

test "permille" {
    try std.testing.expectEqual(@as(u32, 0), permille(10, null, 0, 250, 5));
    try std.testing.expectEqual(@as(u32, 400), permille(0, null, 0, 250, 100_000));
    try std.testing.expectEqual(@as(u32, 900), permille(0, null, 0, 250, 900_000));
    // Done after 1 ms: 4 at the end, then full 250 ms later.
    try std.testing.expectEqual(@as(u32, 4), permille(0, 1000, 0, 250, 1000));
    try std.testing.expectEqual(@as(u32, 1000), permille(0, 1000, 0, 250, 300_000));
    // A long step with a known time fills in proportion.
    try std.testing.expectEqual(@as(u32, 500), permille(0, null, 2_000_000, 250, 1_000_000));
}

test "set options" {
    var s: Style = .{};
    try s.set("bootmap.fill=spiral");
    try s.set("empty=#102030");
    try s.set("pad=1,2,3");
    try std.testing.expectEqual(Fill.spiral, s.fill);
    try std.testing.expectEqual(@as(u32, 0x102030), s.emptyColor(0));
    try std.testing.expectEqual([3]u8{ 1, 2, 3 }, s.pads);
    try std.testing.expectError(error.UnknownOption, s.set("nope=1"));
}
