// The compare bars: a bar for each stat of a gun (damage, fire rate, range,
// recoil, mobility, reload), with the value at the right. With a second
// gun (the gun in the same slot of the player), the bar shows the
// difference: green where the shown gun is better, red where it is worse.
// The weapon menu (B) uses it. It needs no state, so any panel can draw it,
// for example for a gun on the ground.
const std = @import("std");
const gfx = @import("sw_gfx2d");
const sw_text = @import("sw_text");
const weapon = @import("weapon.zig");
const guns = @import("guns.zig");

pub const row_h: f32 = 19;
pub const better = gfx.Color.rgba8(96, 214, 120, 255);
pub const worse = gfx.Color.rgba8(236, 82, 68, 255);
const label_w: f32 = 84;
const value_w: f32 = 62;

/// The value of a stat as text: "30", "13 x9", "522 rpm", "62 m", "0.8 deg",
/// "93%", "2.3 s".
pub fn valueText(buf: []u8, st: *const weapon.Stats, s: guns.Stat) []const u8 {
    const v = guns.value(st, s);
    return switch (s) {
        .damage => if (st.pellets > 1)
            std.fmt.bufPrint(buf, "{d:.0} x{d}", .{ st.body, st.pellets }) catch ""
        else
            std.fmt.bufPrint(buf, "{d:.0}", .{v}) catch "",
        .rate => std.fmt.bufPrint(buf, "{d:.0} rpm", .{v}) catch "",
        .range => std.fmt.bufPrint(buf, "{d:.0} m", .{v}) catch "",
        .recoil => std.fmt.bufPrint(buf, "{d:.2} deg", .{v * 180 / std.math.pi}) catch "",
        .mobility => std.fmt.bufPrint(buf, "{d:.0}%", .{v * 100}) catch "",
        .reload => std.fmt.bufPrint(buf, "{d:.1} s", .{v}) catch "",
    };
}

/// -1 when gun `a` is worse than gun `b` in the stat, 1 when it is better,
/// 0 when they are the same.
pub fn compare(a: *const weapon.Stats, b: *const weapon.Stats, s: guns.Stat) i2 {
    const va = guns.value(a, s);
    const vb = guns.value(b, s);
    if (@abs(va - vb) <= 1e-4 * @max(@abs(va), @abs(vb))) return 0;
    return if ((va > vb) == guns.higherIsBetter(s)) 1 else -1;
}

/// Draw the bars of `model` at (x, y), `w` wide. With `current` (a gun of
/// the same slot), each bar shows the difference to it. Returns the height.
pub fn draw(r: *gfx.Renderer, text: *sw_text.TextRenderer, x: f32, y: f32, w: f32, model: u8, current: ?u8) !f32 {
    const dim = gfx.Color.rgba8(245, 240, 232, 150);
    const white = gfx.Color.rgba8(245, 240, 232, 255);
    const fill = gfx.Color.rgba8(245, 240, 232, 200);
    const track = gfx.Color.rgba8(255, 255, 255, 35);
    const st = weapon.gunStats(model);
    const slot = st.slot;
    const other: ?*const weapon.Stats = if (current) |c| (if (c != model) weapon.gunStats(c) else null) else null;
    const bw = w - label_w - value_w;
    var buf: [24]u8 = undefined;
    var yy = y;
    for (std.enums.values(guns.Stat)) |s| {
        _ = try text.draw(r, guns.stat_labels.get(s), x, yy, .{ .size = 12, .color = dim });
        const bx = x + label_w;
        const by = yy + 4;
        try r.fillRect(.{ .x = bx, .y = by, .w = bw, .h = 6 }, track);
        const a = guns.bar(slot, s, guns.value(st, s));
        var color = white;
        if (other) |o| {
            const b = guns.bar(slot, s, guns.value(o, s));
            const lo = @min(a, b);
            const hi = @max(a, b);
            try r.fillRect(.{ .x = bx, .y = by, .w = bw * lo, .h = 6 }, fill);
            const c = compare(st, o, s);
            if (c != 0) {
                color = if (c > 0) better else worse;
                // A small difference still shows.
                const seg = @max(hi - lo, 0.01);
                try r.fillRect(.{ .x = bx + bw * lo, .y = by, .w = bw * seg, .h = 6 }, color);
            }
        } else {
            try r.fillRect(.{ .x = bx, .y = by, .w = bw * a, .h = 6 }, fill);
        }
        const t = valueText(&buf, st, s);
        _ = try text.draw(r, t, x + w - text.measure(t, 12).w, yy, .{ .size = 12, .color = color });
        yy += row_h;
    }
    return yy - y;
}
