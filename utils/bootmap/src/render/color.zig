//! Colour: palettes, colour spaces, ramps and pixel patterns.
//!
//! This is the userspace renderer only (replay, CLI, daemon): it uses
//! floats. The kernel draws with the stage colours of palette.zig until it
//! gets lookup tables made from this file.
//!
//!   color=stage|group|kind|hash|time|duration|mono   what decides a colour
//!   palette=<name>                 the colours (see `palettes`)
//!   space=oklab|oklch|srgb|linear|hsl   where ramps blend
//!   jitter=12                      lightness change between boxes, in %
//!   pattern=solid|bayer|grain|scanline|checker|gradient   pixel texture

const std = @import("std");

pub const By = enum { stage, group, kind, hash, time, duration, mono };
pub const Space = enum { oklab, oklch, srgb, linear, hsl };
pub const Pattern = enum { solid, bayer, grain, scanline, checker, gradient };

pub const Palette = struct { name: []const u8, stops: []const u32 };

/// Each palette is a list of colours. color=stage|group|kind|hash uses it as
/// categories, in order. color=time|duration uses it as the stops of a ramp.
pub const palettes = [_]Palette{
    // The dataviz reference palette, dark steps (validated on black).
    .{ .name = "dataviz", .stops = &.{ 0x3987e5, 0xd95926, 0x199e70, 0xc98500, 0xd55181, 0x008300, 0x9085e9, 0xe66767 } },
    // Okabe and Ito (2008): safe for the common colour-vision deficiencies.
    .{ .name = "okabe-ito", .stops = &.{ 0xe69f00, 0x56b4e9, 0x009e73, 0xf0e442, 0x0072b2, 0xd55e00, 0xcc79a7, 0x999999 } },
    // Perceptual ramps (matplotlib): even steps of lightness.
    .{ .name = "viridis", .stops = &.{ 0x440154, 0x482878, 0x3e4989, 0x31688e, 0x26828e, 0x1f9e89, 0x35b779, 0x6ece58, 0xb5de2b, 0xfde725 } },
    .{ .name = "magma", .stops = &.{ 0x1c1044, 0x4f127b, 0x812581, 0xb5367a, 0xe55964, 0xfb8761, 0xfec287, 0xfcfdbf } },
    .{ .name = "inferno", .stops = &.{ 0x1f0c48, 0x550f6d, 0x88226a, 0xba3655, 0xe35933, 0xf98e09, 0xf9cb35, 0xfcffa4 } },
    .{ .name = "cividis", .stops = &.{ 0x00224e, 0x123570, 0x3b496c, 0x575d6d, 0x707173, 0x8a8779, 0xa69d75, 0xc4b56c, 0xe4cf5b, 0xfee838 } },
    // Terminals.
    .{ .name = "phosphor", .stops = &.{ 0x0b3d0b, 0x1a7a1a, 0x33cc33, 0x66ff66, 0xb3ffb3 } },
    .{ .name = "amber", .stops = &.{ 0x3d2400, 0x7a4a00, 0xcc7a00, 0xffb000, 0xffd780 } },
    // Moods.
    .{ .name = "ice", .stops = &.{ 0x0b1d3a, 0x1f4e79, 0x3a7ca5, 0x7fb3d5, 0xd6eaf8 } },
    .{ .name = "sunset", .stops = &.{ 0x2d1e5f, 0x6a2c70, 0xb83b5e, 0xf08a5d, 0xf9ed69 } },
    .{ .name = "neon", .stops = &.{ 0xff00ff, 0x00ffff, 0x39ff14, 0xff3131, 0xfff01f, 0xbc13fe } },
    .{ .name = "pastel", .stops = &.{ 0xfbb4ae, 0xb3cde3, 0xccebc5, 0xdecbe4, 0xfed9a6, 0xffffcc, 0xe5d8bd, 0xfddaec } },
    .{ .name = "gray", .stops = &.{ 0x303030, 0x606060, 0x909090, 0xc0c0c0, 0xf0f0f0 } },
    // Editor themes.
    .{ .name = "nord", .stops = &.{ 0x5e81ac, 0x81a1c1, 0x88c0d0, 0x8fbcbb, 0xa3be8c, 0xebcb8b, 0xd08770, 0xbf616a, 0xb48ead } },
    .{ .name = "gruvbox", .stops = &.{ 0xcc241d, 0x98971a, 0xd79921, 0x458588, 0xb16286, 0x689d6a, 0xd65d0e, 0xa89984 } },
    .{ .name = "solarized", .stops = &.{ 0xb58900, 0xcb4b16, 0xdc322f, 0xd33682, 0x6c71c4, 0x268bd2, 0x2aa198, 0x859900 } },
};

pub fn paletteIndex(name: []const u8) ?u8 {
    for (palettes, 0..) |p, i| if (std.mem.eql(u8, p.name, name)) return @intCast(i);
    return null;
}

// ---- Colour spaces ----------------------------------------------------

const V3 = [3]f32;

fn unpack(c: u32) V3 {
    return .{ @as(f32, @floatFromInt((c >> 16) & 0xff)) / 255, @as(f32, @floatFromInt((c >> 8) & 0xff)) / 255, @as(f32, @floatFromInt(c & 0xff)) / 255 };
}

fn pack(v: V3) u32 {
    var out: u32 = 0;
    for (v) |x| out = (out << 8) | @as(u32, @intFromFloat(@round(std.math.clamp(x, 0, 1) * 255)));
    return out;
}

fn toLinear(x: f32) f32 {
    return if (x <= 0.04045) x / 12.92 else std.math.pow(f32, (x + 0.055) / 1.055, 2.4);
}

fn toSrgb(x: f32) f32 {
    const y = std.math.clamp(x, 0, 1);
    return if (y <= 0.0031308) y * 12.92 else 1.055 * std.math.pow(f32, y, 1.0 / 2.4) - 0.055;
}

/// sRGB -> OKLab (Björn Ottosson, 2020).
fn oklab(c: V3) V3 {
    const r = toLinear(c[0]);
    const g = toLinear(c[1]);
    const b = toLinear(c[2]);
    const l = std.math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = std.math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = std.math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return .{
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    };
}

fn fromOklab(c: V3) V3 {
    const l_ = c[0] + 0.3963377774 * c[1] + 0.2158037573 * c[2];
    const m_ = c[0] - 0.1055613458 * c[1] - 0.0638541728 * c[2];
    const s_ = c[0] - 0.0894841775 * c[1] - 1.2914855480 * c[2];
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    return .{
        toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    };
}

fn toLch(lab: V3) V3 {
    return .{ lab[0], @sqrt(lab[1] * lab[1] + lab[2] * lab[2]), std.math.atan2(lab[2], lab[1]) };
}

fn fromLch(lch: V3) V3 {
    return .{ lch[0], lch[1] * @cos(lch[2]), lch[1] * @sin(lch[2]) };
}

fn toHsl(c: V3) V3 {
    const mx = @max(c[0], c[1], c[2]);
    const mn = @min(c[0], c[1], c[2]);
    const l = (mx + mn) / 2;
    if (mx == mn) return .{ 0, 0, l };
    const d = mx - mn;
    const s = if (l > 0.5) d / (2 - mx - mn) else d / (mx + mn);
    var h: f32 = if (mx == c[0]) (c[1] - c[2]) / d + (if (c[1] < c[2]) @as(f32, 6) else 0) else if (mx == c[1]) (c[2] - c[0]) / d + 2 else (c[0] - c[1]) / d + 4;
    h /= 6;
    return .{ h, s, l };
}

fn hue2rgb(p: f32, q: f32, t0: f32) f32 {
    var t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1.0 / 6.0) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6;
    return p;
}

fn fromHsl(hsl: V3) V3 {
    const h = hsl[0];
    const s = hsl[1];
    const l = hsl[2];
    if (s == 0) return .{ l, l, l };
    const q = if (l < 0.5) l * (1 + s) else l + s - l * s;
    const p = 2 * l - q;
    return .{ hue2rgb(p, q, h + 1.0 / 3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0 / 3.0) };
}

fn lerp(a: f32, b: f32, t: f32) f32 {
    return a + (b - a) * t;
}

/// The shortest way round the circle, for hue angles (period `full`).
fn lerpAngle(a: f32, b: f32, t: f32, full: f32) f32 {
    var d = @mod(b - a, full);
    if (d > full / 2) d -= full;
    return a + d * t;
}

/// Blend two colours in a colour space. t = 0 gives a, t = 1 gives b.
pub fn mix(a: u32, b: u32, t: f32, space: Space) u32 {
    const ca = unpack(a);
    const cb = unpack(b);
    return switch (space) {
        .srgb => pack(.{ lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t) }),
        .linear => pack(.{
            toSrgb(lerp(toLinear(ca[0]), toLinear(cb[0]), t)),
            toSrgb(lerp(toLinear(ca[1]), toLinear(cb[1]), t)),
            toSrgb(lerp(toLinear(ca[2]), toLinear(cb[2]), t)),
        }),
        .oklab => blk: {
            const la = oklab(ca);
            const lb = oklab(cb);
            break :blk pack(fromOklab(.{ lerp(la[0], lb[0], t), lerp(la[1], lb[1], t), lerp(la[2], lb[2], t) }));
        },
        .oklch => blk: {
            const la = toLch(oklab(ca));
            const lb = toLch(oklab(cb));
            break :blk pack(fromOklab(fromLch(.{ lerp(la[0], lb[0], t), lerp(la[1], lb[1], t), lerpAngle(la[2], lb[2], t, 2 * std.math.pi) })));
        },
        .hsl => blk: {
            const ha = toHsl(ca);
            const hb = toHsl(cb);
            break :blk pack(fromHsl(.{ @mod(lerpAngle(ha[0], hb[0], t, 1), 1), lerp(ha[1], hb[1], t), lerp(ha[2], hb[2], t) }));
        },
    };
}

/// A colour on a ramp through the palette's stops, t in [0, 1].
pub fn ramp(p: Palette, t: f32, space: Space) u32 {
    const n = p.stops.len;
    if (n == 1) return p.stops[0];
    const x = std.math.clamp(t, 0, 1) * @as(f32, @floatFromInt(n - 1));
    const i: usize = @min(@as(usize, @intFromFloat(x)), n - 2);
    return mix(p.stops[i], p.stops[i + 1], x - @as(f32, @floatFromInt(i)), space);
}

/// Change the lightness by `d` (OKLab L, -1..1), keeping the hue.
pub fn shade(c: u32, d: f32) u32 {
    var lab = oklab(unpack(c));
    lab[0] = std.math.clamp(lab[0] + d, 0, 1);
    return pack(fromOklab(lab));
}

// ---- Patterns ---------------------------------------------------------

const bayer4 = [16]u8{ 0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5 };

fn hash2(x: i32, y: i32) u32 {
    var h: u32 = @bitCast(x *% 374761393 +% y *% 668265263);
    h = (h ^ (h >> 13)) *% 1274126177;
    return h ^ (h >> 16);
}

/// The colour of one filled pixel. (x, y) is on the screen. by and bh are
/// the top and the height of its box (for gradient). `lo` and `hi` are the
/// two shades that a pattern uses around `c`.
pub fn patternPixel(p: Pattern, c: u32, lo: u32, hi: u32, x: i32, y: i32, by: i32, bh: i32) u32 {
    return switch (p) {
        .solid => c,
        .bayer => blk: {
            // Half of the pixels are lo and half are hi, in a 4x4 order.
            const v = bayer4[@intCast(@mod(y, 4) * 4 + @mod(x, 4))];
            break :blk if (v < 8) lo else hi;
        },
        .grain => blk: {
            const v = hash2(x, y) % 4;
            break :blk switch (v) {
                0 => lo,
                3 => hi,
                else => c,
            };
        },
        .scanline => if (@mod(y, 2) == 1) lo else c,
        .checker => if (@mod(x + y, 2) == 0) lo else hi,
        .gradient => blk: {
            // hi at the top of the box, lo at the bottom.
            if (bh <= 1) break :blk c;
            const t = @as(f32, @floatFromInt(y - by)) / @as(f32, @floatFromInt(bh - 1));
            break :blk mix(hi, lo, t, .oklab);
        },
    };
}

test "mix ends are the inputs, in every space" {
    for (std.enums.values(Space)) |s| {
        const a: u32 = 0x3987e5;
        const b: u32 = 0xd95926;
        const ea = mix(a, b, 0, s);
        const eb = mix(a, b, 1, s);
        // One step of rounding at most, per channel.
        for ([_]u5{ 0, 8, 16 }) |sh| {
            const d1: i32 = @as(i32, @intCast((ea >> sh) & 0xff)) - @as(i32, @intCast((a >> sh) & 0xff));
            const d2: i32 = @as(i32, @intCast((eb >> sh) & 0xff)) - @as(i32, @intCast((b >> sh) & 0xff));
            try std.testing.expect(@abs(d1) <= 1 and @abs(d2) <= 1);
        }
    }
}

test "every palette name is unique" {
    for (palettes, 0..) |a, i| for (palettes[i + 1 ..]) |b| try std.testing.expect(!std.mem.eql(u8, a.name, b.name));
}
