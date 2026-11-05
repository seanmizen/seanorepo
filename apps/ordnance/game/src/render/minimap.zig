//! The minimap image: one pixel for each square, RGBA. The ground tint by
//! height, water, woods, towns and ways. main.zig makes the texture from it
//! again when the ways change.
const std = @import("std");
const map = @import("../core/map.zig");

pub const bytes = map.cells * 4;

pub fn build(m: *const map.Map, out: *[bytes]u8) void {
    for (0..map.cells) |ci| {
        const c: u16 = @intCast(ci);
        const h = m.cellHeight(c);
        const t = std.math.clamp((h - 20) / 170, 0, 1);
        var rgb = [3]f32{ 6 + 26 * t, 16 + 34 * t, 20 + 22 * t };
        switch (m.ground[c]) {
            .water => rgb = .{ 25, 60, 120 },
            .wood => rgb = .{ rgb[0] * 0.6, rgb[1] * 0.8 + 28, rgb[2] * 0.6 },
            .town => rgb = .{ 110, 96, 74 },
            .grass => {},
        }
        switch (m.way[c]) {
            .road => rgb = .{ 220, 140, 50 },
            .track => rgb = .{ 140, 92, 40 },
            .none => {},
        }
        for (0..3) |k| out[ci * 4 + k] = @intFromFloat(std.math.clamp(rgb[k], 0, 255));
        out[ci * 4 + 3] = 255;
    }
}
