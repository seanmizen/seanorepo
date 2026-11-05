//! The icons: simple geometry that reads at a glance, in the spirit of a
//! shooter minimap, with the frame rules of NATO map symbols (APP-6):
//!
//!   friendly squad   a cyan arrowhead that points where it moves
//!   enemy squad      a red diamond (the hostile frame)
//!   engineer         a box with the engineer bridge sign
//!   truck            a cyan capsule along its heading; an amber dot when it
//!                    carries supply
//!   depot            an amber ring with a centre dot
//!   objective        a circle with a letter
//!   observation post a red triangle with an eye dot
//!   battery          a red ring with a cross
//!
//! Each function draws at a screen point with a size in pixels, through the
//! painter of view.zig (fill, line, tri).
const std = @import("std");
const style = @import("../style.zig");
const Color = style.Color;

/// A filled circle (a fan of triangles), or a ring when `width` > 0.
pub fn circle(p: anytype, x: f32, y: f32, r: f32, width: f32, c: Color) !void {
    const steps: usize = if (r < 6) 10 else if (r < 20) 18 else 32;
    for (0..steps) |k| {
        const a0 = @as(f32, @floatFromInt(k)) / @as(f32, @floatFromInt(steps)) * 2 * std.math.pi;
        const a1 = @as(f32, @floatFromInt(k + 1)) / @as(f32, @floatFromInt(steps)) * 2 * std.math.pi;
        if (width > 0) {
            try p.line(x + r * @cos(a0), y + r * @sin(a0), x + r * @cos(a1), y + r * @sin(a1), width, c);
        } else {
            try p.tri(x, y, x + r * @cos(a0), y + r * @sin(a0), x + r * @cos(a1), y + r * @sin(a1), c);
        }
    }
}

/// A closed outline through the points.
fn outline(p: anytype, pts: []const [2]f32, w: f32, c: Color) !void {
    for (pts, 0..) |a, i| {
        const b = pts[(i + 1) % pts.len];
        try p.line(a[0], a[1], b[0], b[1], w, c);
    }
}

/// A friendly squad: an arrowhead along (hx, hy). `fill` (0..1) is the
/// strength.
pub fn squad(p: anytype, x: f32, y: f32, size: f32, hx: f32, hy: f32, fill: f32, c: Color) !void {
    const r = size / 2;
    // The forward and the side directions.
    const fx = hx;
    const fy = hy;
    const sx = -hy;
    const sy = hx;
    const tip = [2]f32{ x + fx * r * 1.15, y + fy * r * 1.15 };
    const left = [2]f32{ x - fx * r * 0.8 + sx * r * 0.85, y - fy * r * 0.8 + sy * r * 0.85 };
    const notch = [2]f32{ x - fx * r * 0.35, y - fy * r * 0.35 };
    const right = [2]f32{ x - fx * r * 0.8 - sx * r * 0.85, y - fy * r * 0.8 - sy * r * 0.85 };
    try p.tri(tip[0], tip[1], left[0], left[1], notch[0], notch[1], c.alpha(0.15 + 0.6 * fill));
    try p.tri(tip[0], tip[1], notch[0], notch[1], right[0], right[1], c.alpha(0.15 + 0.6 * fill));
    try outline(p, &.{ tip, left, notch, right }, 1.6, c);
}

/// An enemy squad: a diamond. `fill` (0..1) is the strength.
pub fn enemy(p: anytype, x: f32, y: f32, size: f32, fill: f32, c: Color) !void {
    const r = size / 2 * 1.1;
    const pts = [_][2]f32{ .{ x, y - r }, .{ x + r, y }, .{ x, y + r }, .{ x - r, y } };
    try p.tri(pts[0][0], pts[0][1], pts[1][0], pts[1][1], pts[2][0], pts[2][1], c.alpha(0.15 + 0.55 * fill));
    try p.tri(pts[0][0], pts[0][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1], c.alpha(0.15 + 0.55 * fill));
    try outline(p, &pts, 1.6, c);
}

/// An engineer: a box with the engineer sign (a bridge: a bar with three
/// legs).
pub fn engineer(p: anytype, x: f32, y: f32, size: f32, c: Color) !void {
    const w = size;
    const h = size * 0.72;
    const x0 = x - w / 2;
    const y0 = y - h / 2;
    try p.fill(x0, y0, w, h, Color.rgb(0, 0, 0, 0.6));
    try p.stroke(x0, y0, w, h, 1.4, c);
    const bar_y = y0 + h * 0.35;
    try p.line(x0 + w * 0.2, bar_y, x0 + w * 0.8, bar_y, 1.4, c);
    for ([_]f32{ 0.2, 0.5, 0.8 }) |t| try p.line(x0 + w * t, bar_y, x0 + w * t, y0 + h * 0.72, 1.4, c);
}

/// A truck: a capsule along (hx, hy), with a dot when it carries cargo.
pub fn truck(p: anytype, x: f32, y: f32, size: f32, hx: f32, hy: f32, loaded: bool, c: Color) !void {
    const len = size;
    try p.line(x - hx * len / 2, y - hy * len / 2, x + hx * len / 2, y + hy * len / 2, size * 0.55, c);
    if (loaded) try p.fill(x - 1.5, y - 1.5, 3, 3, style.amber);
}

pub fn depot(p: anytype, x: f32, y: f32, size: f32) !void {
    try circle(p, x, y, size / 2, 2, style.amber);
    try circle(p, x, y, size / 6, 0, style.amber);
}

/// A circle with a letter: an objective.
pub fn objective(p: anytype, x: f32, y: f32, size: f32, letter: []const u8, c: Color) !void {
    try circle(p, x, y, size / 2, 0, Color.rgb(0, 0, 0, 0.6));
    try circle(p, x, y, size / 2, 2, c);
    const ts = size * 0.62;
    try p.text(letter, x - p.measure(letter, ts) / 2, y - ts / 2 - 1, ts, c);
}

pub fn post(p: anytype, x: f32, y: f32, size: f32, c: Color) !void {
    const r = size / 2;
    const pts = [_][2]f32{ .{ x, y - r }, .{ x + r * 0.95, y + r * 0.7 }, .{ x - r * 0.95, y + r * 0.7 } };
    try outline(p, &pts, 1.6, c);
    try circle(p, x, y + r * 0.15, r * 0.22, 0, c);
}

pub fn battery(p: anytype, x: f32, y: f32, size: f32, c: Color) !void {
    const r = size / 2;
    try circle(p, x, y, r, 1.5, c);
    try p.line(x - r * 1.3, y, x + r * 1.3, y, 1.2, c);
    try p.line(x, y - r * 1.3, x, y + r * 1.3, 1.2, c);
}

/// An incoming shell: a reticle that closes as the shell falls (t from 1
/// down to 0).
pub fn shell(p: anytype, x: f32, y: f32, r: f32, t: f32, c: Color) !void {
    try circle(p, x, y, r, 1.2, c.alpha(0.9 - 0.5 * t));
    const g = r * (0.4 + 0.6 * t);
    try p.line(x - r - 4, y, x - g, y, 1.2, c);
    try p.line(x + g, y, x + r + 4, y, 1.2, c);
    try p.line(x, y - r - 4, x, y - g, 1.2, c);
    try p.line(x, y + g, x, y + r + 4, 1.2, c);
}

pub fn wreck(p: anytype, x: f32, y: f32, size: f32, c: Color) !void {
    const r = size / 2;
    try p.line(x - r, y - r, x + r, y + r, 1.5, c);
    try p.line(x - r, y + r, x + r, y - r, 1.5, c);
}
