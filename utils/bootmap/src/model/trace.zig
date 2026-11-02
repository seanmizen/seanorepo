//! A recorded boot: the output of vm/collect-trace.py.
//! All times are microseconds of CLOCK_MONOTONIC.

const std = @import("std");

pub const Box = struct {
    /// [stage, group, name]
    path: []const []const u8,
    start_us: u64,
    end_us: u64,
    failed: bool = false,
};

pub const Trace = struct {
    version: u32,
    source: []const u8 = "",
    end_us: u64,
    boxes: []const Box,
};

pub const Parsed = std.json.Parsed(Trace);

pub fn parse(alloc: std.mem.Allocator, bytes: []const u8) !Parsed {
    const p = try std.json.parseFromSlice(Trace, alloc, bytes, .{ .ignore_unknown_fields = true, .allocate = .alloc_always });
    errdefer p.deinit();
    if (p.value.version != 1) return error.UnsupportedTraceVersion;
    return p;
}

test "parse a trace" {
    const json =
        \\{"version": 1, "source": "t", "end_us": 10,
        \\ "boxes": [{"path": ["kernel", "core", "a"], "start_us": 0, "end_us": 10, "failed": false}]}
    ;
    const p = try parse(std.testing.allocator, json);
    defer p.deinit();
    try std.testing.expectEqual(@as(usize, 1), p.value.boxes.len);
    try std.testing.expectEqualStrings("core", p.value.boxes[0].path[1]);
}
