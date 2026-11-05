//! The small types that the view (view.zig) and the window manager
//! (wm.zig) share: the colour, the palette and the modes. This file imports
//! nothing, so the two modules do not import each other.

pub const Color = struct {
    r: f32,
    g: f32,
    b: f32,
    a: f32 = 1,
    pub fn rgb(r: u8, g: u8, b: u8, a: f32) Color {
        return .{ .r = @as(f32, @floatFromInt(r)) / 255, .g = @as(f32, @floatFromInt(g)) / 255, .b = @as(f32, @floatFromInt(b)) / 255, .a = a };
    }
    pub fn alpha(c: Color, a: f32) Color {
        var o = c;
        o.a = c.a * a;
        return o;
    }
};

pub const blue = Color.rgb(90, 230, 255, 1);
pub const red = Color.rgb(255, 64, 88, 1);
pub const amber = Color.rgb(255, 170, 60, 1);
pub const ink = Color.rgb(185, 212, 216, 1);
pub const dim = Color.rgb(110, 138, 144, 1);

/// The game modes. The keys: Esc, L, K, I.
pub const Mode = enum(u8) { view, logistics, kill, intel };
pub const mode_count = 4;
