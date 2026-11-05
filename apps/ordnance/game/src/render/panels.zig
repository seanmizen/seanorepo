//! The content of each window panel. ui/wm.zig draws the window, then calls
//! `Content.panel` for the panel of the active tab.
const std = @import("std");
const map = @import("../core/map.zig");
const sim = @import("../core/sim.zig");
const logistics = @import("../core/logistics.zig");
const wm = @import("../ui/wm.zig");
const icons = @import("icons.zig");
const layers = @import("layers.zig");
const style = @import("../style.zig");
const view = @import("view.zig");

const Color = style.Color;
const ink = style.ink;
const dim = style.dim;
const blue = style.blue;
const red = style.red;
const amber = style.amber;

pub const Content = struct {
    f: view.Frame,

    pub fn panel(c: Content, p: anytype, id: wm.Panel, r: wm.Rect, a: f32) !void {
        switch (id) {
            .forces => try forces(c, p, r, a),
            .supply => try supply(c, p, r, a),
            .square => try square(c, p, r, a),
            .keys => try keys(c, p, r, a),
            .minimap => try minimap(c, p, r, a),
        }
    }
};

fn forces(c: Content, p: anytype, r: wm.Rect, a: f32) !void {
    const s = c.f.s;
    var inf: u32 = 0;
    var eng: u32 = 0;
    var trucks: u32 = 0;
    var red_inf: u32 = 0;
    for (s.units) |u| if (u.alive) switch (u.kind) {
        .infantry => if (u.side == .blue) {
            inf += 1;
        } else if (!s.rules.fog or u.spotted) {
            red_inf += 1;
        },
        .engineer => eng += 1,
        .truck => trucks += 1,
    };
    const x = r.x + 12;
    var y = r.y + 10;
    var buf: [4][16]u8 = undefined;
    const rows = [_]struct { label: []const u8, value: []const u8 }{
        .{ .label = "Infantry", .value = std.fmt.bufPrint(&buf[0], "{d}", .{inf}) catch "" },
        .{ .label = "Engineers", .value = std.fmt.bufPrint(&buf[1], "{d}", .{eng}) catch "" },
        .{ .label = "Trucks", .value = std.fmt.bufPrint(&buf[2], "{d}/{d}", .{ trucks, sim.truck_count }) catch "" },
        .{ .label = if (s.rules.fog) "Enemy seen" else "Enemy infantry", .value = std.fmt.bufPrint(&buf[3], "{d}", .{red_inf}) catch "" },
    };
    for (rows, 0..) |row, i| {
        const ix = x + 8;
        const iy = y + 9;
        switch (i) {
            0 => try icons.squad(p, ix, iy, 14, 0, -1, 0.6, blue.alpha(a)),
            1 => try icons.engineer(p, ix, iy, 13, layers.engineer_c.alpha(a)),
            2 => try icons.truck(p, ix, iy, 11, 1, 0, true, layers.truck_c.alpha(a)),
            else => try icons.enemy(p, ix, iy, 13, 0.6, red.alpha(a)),
        }
        try p.text(row.label, x + 24, y, 15, ink.alpha(a));
        try p.text(row.value, r.x + r.w - 14 - p.measure(row.value, 15), y, 15, ink.alpha(a));
        y += 24;
    }
    var lb: [40]u8 = undefined;
    try p.text(std.fmt.bufPrint(&lb, "Trucks lost: {d}", .{s.stats.trucks_lost}) catch "", x, y + 2, 13, dim.alpha(a));
}

fn supply(c: Content, p: anytype, r: wm.Rect, a: f32) !void {
    const s = c.f.s;
    const x = r.x + 12;
    var y = r.y + 10;
    const bars = [_]struct { label: []const u8, v: f32, max: f32, col: Color }{
        .{ .label = "Supply", .v = s.supply, .max = logistics.supply_cap, .col = amber },
        .{ .label = "Materials", .v = s.materials, .max = logistics.materials_cap, .col = layers.engineer_c },
    };
    for (bars) |bar| {
        var vb: [16]u8 = undefined;
        const v = std.fmt.bufPrint(&vb, "{d:.0}", .{bar.v}) catch "";
        try p.text(bar.label, x, y, 15, ink.alpha(a));
        try p.text(v, r.x + r.w - 14 - p.measure(v, 15), y, 15, ink.alpha(a));
        const bw = r.w - 24;
        try p.fill(x, y + 21, bw, 4, bar.col.alpha(0.2 * a));
        try p.fill(x, y + 21, bw * bar.v / bar.max, 4, bar.col.alpha(a));
        y += 34;
    }
    var jobs: u32 = 0;
    for (s.jobs) |j| if (j.active) {
        jobs += 1;
    };
    var lb: [64]u8 = undefined;
    const line = if (s.rules.town_supply)
        std.fmt.bufPrint(&lb, "Towns: blue {d}, red {d}   Jobs {d}", .{ s.towns_held[0], s.towns_held[1], jobs }) catch ""
    else
        std.fmt.bufPrint(&lb, "Jobs {d}   Delivered {d:.0}", .{ jobs, s.stats.supply_delivered }) catch "";
    try p.text(line, x, y, 13, dim.alpha(a));
}

fn square(c: Content, p: anytype, r: wm.Rect, a: f32) !void {
    const s = c.f.s;
    const x = r.x + 12;
    var y = r.y + 10;
    const cell = c.f.ui.hover orelse {
        try p.text("Point at a square.", x, y, 15, dim.alpha(a));
        return;
    };
    var lb: [64]u8 = undefined;
    try p.text(std.fmt.bufPrint(&lb, "GR {d:0>3}{d:0>3}   {d:.0} m", .{ map.cellX(cell), map.size - 1 - map.cellY(cell), s.m.cellHeight(cell) }) catch "", x, y, 15, ink.alpha(a));
    y += 22;
    const way: []const u8 = switch (s.m.way[cell]) {
        .none => "",
        .track => ", track",
        .road => ", road",
    };
    try p.text(std.fmt.bufPrint(&lb, "{s}{s}{s}", .{ @tagName(s.m.ground[cell]), way, if (s.m.net[cell]) ", netted" else "" }) catch "", x, y, 15, ink.alpha(a));
    y += 22;
    if (s.seen[cell]) {
        try p.text("The enemy sees this square.", x, y, 15, red.alpha(a));
    } else try p.text("Out of enemy sight.", x, y, 15, blue.alpha(a));
}

fn keys(c: Content, p: anytype, r: wm.Rect, a: f32) !void {
    const s = c.f.s;
    const x = r.x + 12;
    var y = r.y + 10;
    try p.text(s.rules.name, x, y, 15, amber.alpha(a));
    y += 20;
    try p.text(s.rules.blurb, x, y, 13, dim.alpha(a));
    y += 24;
    const lines: []const []const u8 = switch (c.f.ui.mode) {
        .view => &.{ "L logistics   K kill   I intel", "H heightmap   hold V sightlines", "Drag: move   wheel: zoom (Ctrl: fast)", "Space pause   - + speed", "Tab: next window   Alt, V, K: keys" },
        .logistics => &.{ "1 track (8)   2 road (20)   3 net (6)", "Click: one square", "Shift+drag: a line", "Right click: cancel a job", "Esc: view" },
        .kill => &.{ "Click a square: pick its sector", "1 push   2 hold   3 fall back", "4: the sector objective here", "5: clear the objective", "Esc: view" },
        .intel => &.{ "Red hatch: the enemy sees it.", "Blue tint: your units see it.", "A truck pays 12 s of risk", "for each seen square.", "Esc: view" },
    };
    for (lines) |l| {
        try p.text(l, x, y, 14, ink.alpha(a));
        y += 21;
    }
}

/// The whole map, small: the terrain image, the units as dots, and the
/// part that the screen shows. A press moves the view there.
fn minimap(c: Content, p: anytype, r: wm.Rect, a: f32) !void {
    const s = c.f.s;
    const side = @min(r.w, r.h) - 12;
    const x0 = r.x + (r.w - side) / 2;
    const y0 = r.y + 6;
    try p.image(x0, y0, side, side);
    const k = side / map.size;
    for (s.units) |u| {
        if (!u.alive or u.kind == .truck) continue;
        if (s.rules.fog and u.side == .red and !u.spotted) continue;
        const col = if (u.side == .blue) blue else red;
        try p.fill(x0 + u.x * k - 1.5, y0 + u.y * k - 1.5, 3, 3, col.alpha(a));
    }
    const oc = map.centre(s.setup.objective[0]);
    try icons.circle(p, x0 + oc[0] * k, y0 + oc[1] * k, 4, 1.2, ink.alpha(a));
    // The view.
    const cam = c.f.cam;
    const tl = cam.toMap(0, view.top_bar);
    const br = cam.toMap(c.f.w, c.f.h - view.bottom_bar);
    const vx0 = std.math.clamp(tl[0], 0, map.size) * k;
    const vy0 = std.math.clamp(tl[1], 0, map.size) * k;
    const vx1 = std.math.clamp(br[0], 0, map.size) * k;
    const vy1 = std.math.clamp(br[1], 0, map.size) * k;
    try p.stroke(x0 + vx0, y0 + vy0, @max(2, vx1 - vx0), @max(2, vy1 - vy0), 1, ink.alpha(0.8 * a));
}
