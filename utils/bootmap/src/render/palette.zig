//! Colours, as XRGB8888.
//!
//! One categorical hue per stage, in boot order (the dataviz reference
//! palette, dark steps). Checked against the black surface with
//! validate_palette.js: all checks pass. Red is not a stage colour. It is
//! kept for "failed", which also gets a cross (canvas.cross).

const std = @import("std");

pub const surface: u32 = 0x000000;
pub const critical: u32 = 0xd03b3b;
/// The outline of a box that is in flight and slow (style.heat).
pub const warning: u32 = 0xfab219;

/// Index = the index in plan.stage_order.
pub const stage = [_]u32{
    0x3987e5, // firmware: blue
    0xd95926, // loader: orange
    0x199e70, // kernel: aqua
    0xc98500, // initrd: yellow
    0xd55181, // systemd: magenta
};

/// The stage colour with a small change of lightness from the name, so
/// that two boxes side by side are not the same colour. 88 % to 100 %.
pub fn leafColor(stage_index: u8, name: []const u8) u32 {
    const base = stage[@min(stage_index, stage.len - 1)];
    const pct: u32 = 88 + @as(u32, @intCast(std.hash.Fnv1a_32.hash(name) % 13));
    return scale(base, pct);
}

/// The colour of the filled part of an active box.
pub fn dim(color: u32) u32 {
    return scale(color, 55);
}

pub fn scale(color: u32, pct: u32) u32 {
    const r = ((color >> 16) & 0xff) * pct / 100;
    const g = ((color >> 8) & 0xff) * pct / 100;
    const b = (color & 0xff) * pct / 100;
    return (r << 16) | (g << 8) | b;
}
