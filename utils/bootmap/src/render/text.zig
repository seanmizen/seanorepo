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

pub const Overflow = enum { wrap, cut };

/// How each text pixel gets its colour.
pub const Ink = union(enum) {
    /// The colour opposite to the pixel under it: `on_empty` over the empty
    /// colour, `empty` over any other colour.
    inverse: struct { empty: u32, on_empty: u32 },
    solid: u32,
};

/// When a label is shown. `shown` is the number of characters that fit.
pub const Fit = union(enum) {
    /// Show what fits.
    any,
    /// Show only when the whole name fits.
    whole,
    /// Show only when the first word is not split ("systemd-", "acpi_").
    word,
    /// Show only when the whole name fits and no word is split.
    words,
    /// Show only when at least n characters fit.
    chars: u32,
    /// Show only when at least n % of the name fits.
    percent: u32,
};

pub const Line = struct { start: usize, len: usize };

fn isWord(ch: u8) bool {
    return std.ascii.isAlphanumeric(ch);
}

/// The end of the first word of s: the first non-word character is part of
/// the word before it ("systemd-udev" -> "systemd-").
fn wordEnd(s: []const u8, from: usize) usize {
    var j = from;
    while (j < s.len) : (j += 1) if (!isWord(s[j])) return j + 1;
    return s.len;
}

pub const Broken = struct {
    n: usize,
    /// The characters in the lines.
    shown: usize,
    /// The number of words that are split over two lines.
    splits: usize,
    /// The first word is split.
    first_split: bool,
};

/// Break s into lines of at most per_line characters. With wrap, a line
/// ends after a non-word character when it can ("xyz." / "service"), but
/// only if the line keeps at least one letter or digit. A word that is
/// longer than a line is split inside the word.
pub fn breakLines(s: []const u8, per_line: usize, max_lines: usize, overflow: Overflow, out: []Line) Broken {
    var r: Broken = .{ .n = 0, .shown = 0, .splits = 0, .first_split = false };
    var i: usize = 0;
    const lines = if (overflow == .cut) @min(max_lines, 1) else max_lines;
    const first_end = wordEnd(s, 0);
    while (r.n < lines and r.n < out.len and i < s.len and per_line > 0) : (r.n += 1) {
        var end = @min(i + per_line, s.len);
        if (end < s.len and isWord(s[end - 1])) {
            // end is inside a word (a word ends after its non-word
            // character: "sock_"). Go back to the last word break, if the
            // line before it has a letter or a digit.
            var j = end;
            while (j > i and isWord(s[j - 1])) j -= 1;
            var has_word = false;
            for (s[i..j]) |ch| has_word = has_word or isWord(ch);
            if (j > i and has_word and overflow == .wrap) {
                end = j;
            } else {
                r.splits += 1;
                if (end < first_end) r.first_split = true;
            }
        }
        out[r.n] = .{ .start = i, .len = end - i };
        i = end;
    }
    r.shown = i;
    if (i < first_end) r.first_split = true;
    return r;
}

pub fn fits(fit: Fit, s: []const u8, b: Broken) bool {
    return switch (fit) {
        .any => b.shown > 0,
        .whole => b.shown == s.len,
        .word => !b.first_split,
        .words => b.shown == s.len and b.splits == 0,
        .chars => |m| b.shown >= @min(m, s.len),
        .percent => |p| b.shown * 100 >= p * s.len,
    };
}

/// Draw `s` in the area (x, y, w, h). Return the number of lines drawn.
pub fn draw(c: canvas_mod.Canvas, font: Font, x: i32, y: i32, w: i32, h: i32, s: []const u8, overflow: Overflow, fit: Fit, ink: Ink) u32 {
    if (w < font.w or h < font.h or s.len == 0) return 0;
    var lines: [32]Line = undefined;
    // 1 px of leading between lines: the bottom row of a glyph ("_") must
    // not touch the line below it.
    const line_h: i32 = font.h + 1;
    const r = breakLines(s, @intCast(@divTrunc(w, font.w)), @intCast(@divTrunc(h + 1, line_h)), overflow, &lines);
    if (!fits(fit, s, r)) return 0;
    for (lines[0..r.n], 0..) |ln, row| {
        for (s[ln.start .. ln.start + ln.len], 0..) |ch, col| {
            glyph(c, font, x + @as(i32, @intCast(col)) * font.w, y + @as(i32, @intCast(row)) * line_h, ch, ink);
        }
    }
    return @intCast(r.n);
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

test "word wrap breaks after non-word characters" {
    var lines: [8]Line = undefined;
    const s = "systemd-udev-trigger.service";
    const r = breakLines(s, 14, 8, .wrap, &lines);
    // "systemd-udev-" is 13 chars, then "trigger." and "service".
    try std.testing.expectEqual(@as(usize, 3), r.n);
    try std.testing.expectEqualStrings("systemd-udev-", s[lines[0].start..][0..lines[0].len]);
    try std.testing.expectEqualStrings("trigger.", s[lines[1].start..][0..lines[1].len]);
    try std.testing.expectEqualStrings("service", s[lines[2].start..][0..lines[2].len]);
    // A word longer than the line breaks inside the word.
    const r2 = breakLines("abcdefghij", 4, 8, .wrap, &lines);
    try std.testing.expectEqual(@as(usize, 3), r2.n);
}

test "a separator does not get a line of its own" {
    var lines: [8]Line = undefined;
    const s = "sock_init";
    // 4 per line: "sock_" is split, so "sock" / "_ini" / "t", not "_" alone.
    const r = breakLines(s, 4, 8, .wrap, &lines);
    try std.testing.expectEqualStrings("sock", s[lines[0].start..][0..lines[0].len]);
    try std.testing.expectEqualStrings("_ini", s[lines[1].start..][0..lines[1].len]);
    try std.testing.expect(r.first_split);
}

test "fit rules" {
    var lines: [8]Line = undefined;
    const s = "acpi_init";
    const narrow = breakLines(s, 4, 8, .wrap, &lines); // "acpi" "_ini" "t"
    const wide = breakLines(s, 5, 8, .wrap, &lines); // "acpi_" "init"
    const one = breakLines(s, 6, 1, .wrap, &lines); // "acpi_"
    try std.testing.expect(fits(.any, s, narrow));
    try std.testing.expect(fits(.whole, s, narrow));
    try std.testing.expect(!fits(.word, s, narrow));
    try std.testing.expect(fits(.word, s, wide));
    try std.testing.expect(fits(.words, s, wide));
    try std.testing.expect(!fits(.words, s, one));
    try std.testing.expect(fits(.word, s, one));
    try std.testing.expect(fits(.{ .chars = 5 }, s, one));
    try std.testing.expect(!fits(.{ .percent = 75 }, s, one));
    try std.testing.expect(fits(.{ .percent = 50 }, s, one));
}
