//! Bitmap text, 1 px per glyph pixel (REQ-BOOTMAP-006). The fonts are the
//! kernel's (font_data.zig), so kernel/bootmap.c draws the same pixels.

const std = @import("std");
const font_data = @import("font_data.zig");
const canvas_mod = @import("canvas.zig");

pub const Font = struct {
    w: u8,
    h: u8,
    rows: []const u8,

    pub fn pixel(f: Font, ch: u8, x: u8, y: u8) bool {
        const b = f.rows[@as(usize, ch) * f.h + y];
        return (b >> @intCast(7 - x)) & 1 == 1;
    }
};

pub const mini_4x6: Font = .{ .w = font_data.mini_4x6_w, .h = font_data.mini_4x6_h, .rows = &font_data.mini_4x6_rows };
pub const f6x8: Font = .{ .w = font_data.f6x8_w, .h = font_data.f6x8_h, .rows = &font_data.f6x8_rows };

pub const Overflow = enum { wrap, cut, hide };

/// How each text pixel gets its colour.
pub const Ink = union(enum) {
    /// The colour opposite to the pixel under it: `on_empty` over the empty
    /// colour, `empty` over any other colour.
    inverse: struct { empty: u32, on_empty: u32 },
    solid: u32,
};

/// Draw `s` in the area (x, y, w, h). Return the number of lines drawn.
pub fn draw(c: canvas_mod.Canvas, font: Font, x: i32, y: i32, w: i32, h: i32, s: []const u8, overflow: Overflow, ink: Ink) u32 {
    if (w < font.w or h < font.h or s.len == 0) return 0;
    const per_line: usize = @intCast(@divTrunc(w, font.w));
    const max_lines: usize = switch (overflow) {
        .wrap => @intCast(@divTrunc(h, font.h)),
        .cut, .hide => 1,
    };
    if (overflow == .hide and s.len > per_line) return 0;
    var line: usize = 0;
    var i: usize = 0;
    while (line < max_lines and i < s.len) : (line += 1) {
        const n = @min(per_line, s.len - i);
        for (s[i .. i + n], 0..) |ch, col| {
            glyph(c, font, x + @as(i32, @intCast(col)) * font.w, y + @as(i32, @intCast(line)) * font.h, ch, ink);
        }
        i += n;
    }
    return @intCast(line);
}

fn glyph(c: canvas_mod.Canvas, font: Font, x: i32, y: i32, ch: u8, ink: Ink) void {
    var gy: u8 = 0;
    while (gy < font.h) : (gy += 1) {
        var gx: u8 = 0;
        while (gx < font.w) : (gx += 1) {
            if (!font.pixel(ch, gx, gy)) continue;
            const px = x + gx;
            const py = y + gy;
            if (px < 0 or py < 0 or px >= c.width or py >= c.height) continue;
            const p = &c.pixels[@intCast(py * c.stride + px)];
            p.* = switch (ink) {
                .solid => |col| col,
                .inverse => |inv| if (p.* == inv.empty) inv.on_empty else inv.empty,
            };
        }
    }
}

test "wrap, cut and hide" {
    var px: [20 * 12]u32 = @splat(0);
    const c: canvas_mod.Canvas = .{ .pixels = &px, .width = 20, .height = 12, .stride = 20 };
    // 20 px / 4 = 5 chars per line, 12 px / 6 = 2 lines.
    try std.testing.expectEqual(@as(u32, 2), draw(c, mini_4x6, 0, 0, 20, 12, "abcdefghij", .wrap, .{ .solid = 1 }));
    try std.testing.expectEqual(@as(u32, 1), draw(c, mini_4x6, 0, 0, 20, 12, "abcdefghij", .cut, .{ .solid = 1 }));
    try std.testing.expectEqual(@as(u32, 0), draw(c, mini_4x6, 0, 0, 20, 12, "abcdefghij", .hide, .{ .solid = 1 }));
    try std.testing.expectEqual(@as(u32, 1), draw(c, mini_4x6, 0, 0, 20, 12, "abc", .hide, .{ .solid = 1 }));
}
