//! The frame: the map, the overlays, the units, the windows and the bars.
//! It draws through a painter (`p: anytype`) with these methods:
//!   fill(x, y, w, h, Color), stroke(x, y, w, h, line_width, Color),
//!   hatch(x, y, w, h, Color), text(str, x, y, size, Color),
//!   measure(str, size) f32, line(ax, ay, bx, by, width, Color),
//!   glow(ax, ay, bx, by, width, Color)
//! The game uses the GPU painter (main.zig). The preview tool uses a CPU
//! painter (preview.zig), so a frame can go to an image file.
//!
//! The map is vector shapes (terrain.zig) in squares. Each frame draws them
//! at the screen resolution, so the lines stay sharp at each zoom.
const std = @import("std");
const map = @import("map.zig");
const sim = @import("sim.zig");
const terrain = @import("terrain.zig");
const wm_mod = @import("wm.zig");

const ui_types = @import("ui_types.zig");
pub const Color = ui_types.Color;
pub const blue = ui_types.blue;
pub const red = ui_types.red;
pub const amber = ui_types.amber;
pub const ink = ui_types.ink;
pub const dim = ui_types.dim;
pub const truck_c = Color.rgb(150, 250, 255, 1);
pub const engineer_c = Color.rgb(190, 255, 220, 1);
pub const grid = Color.rgb(50, 75, 85, 1);

const contour_c = Color.rgb(40, 112, 120, 0.55);
const index_c = Color.rgb(60, 150, 160, 0.8);
const bank_c = Color.rgb(60, 125, 200, 0.85);
const water_c = Color.rgb(45, 95, 170, 0.9);
const wood_c = Color.rgb(40, 125, 62, 0.95);
const wood_big_c = Color.rgb(70, 160, 85, 1);
const hedge_c = Color.rgb(64, 150, 80, 0.6);
const building_c = Color.rgb(120, 104, 78, 0.9);
const road_c = Color.rgb(255, 158, 48, 1);
const track_c = Color.rgb(215, 140, 56, 1);

pub const Mode = ui_types.Mode;

/// The state of the interface that the frame shows.
pub const Ui = struct {
    mode: Mode = .view,
    tool: sim.JobKind = .track,
    hover: ?u16 = null,
    sector: u8 = 0,
    paused: bool = false,
    speed: u8 = 1,
    heightmap: bool = false,
    debug: bool = false,
    /// Hold V: the square that the sightlines come from.
    sight: ?u16 = null,
};

/// Hold V: the eye height and the range of the sightlines (main.zig).
pub const sight_range = 14;

pub const top_bar = 34;
pub const bottom_bar = 30;

/// The map on the screen: a square of the map is `s` pixels, and the map
/// origin is at (ox, oy).
pub const Camera = struct {
    s: f32,
    ox: f32,
    oy: f32,

    /// The camera that shows the whole map in a w x h window.
    pub fn fit(w: f32, h: f32) Camera {
        const avail_h = h - top_bar - bottom_bar;
        const s = @max(4, @min(w, avail_h) / map.size);
        return .{ .s = s, .ox = (w - s * map.size) / 2, .oy = top_bar + (avail_h - s * map.size) / 2 };
    }
    pub fn x(c: Camera, mx: f32) f32 {
        return c.ox + mx * c.s;
    }
    pub fn y(c: Camera, my: f32) f32 {
        return c.oy + my * c.s;
    }
    /// The map point under the screen point.
    pub fn toMap(c: Camera, sx: f32, sy: f32) [2]f32 {
        return .{ (sx - c.ox) / c.s, (sy - c.oy) / c.s };
    }
    /// The square under the screen point, or null off the map.
    pub fn cellAt(c: Camera, sx: f32, sy: f32) ?u16 {
        const p = c.toMap(sx, sy);
        if (p[0] < 0 or p[1] < 0 or p[0] >= map.size or p[1] >= map.size) return null;
        return map.cellAt(p[0], p[1]);
    }
    /// Zoom by `f` about the screen point (sx, sy).
    pub fn zoom(c: *Camera, f: f32, sx: f32, sy: f32) void {
        const ns = std.math.clamp(c.s * f, 6, 400);
        const k = ns / c.s;
        c.ox = sx - (sx - c.ox) * k;
        c.oy = sy - (sy - c.oy) * k;
        c.s = ns;
    }
};

/// The part of the map on the screen, in squares, with a margin.
const Bounds = struct {
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    fn of(cam: Camera, w: f32, h: f32) Bounds {
        const a = cam.toMap(0, 0);
        const b = cam.toMap(w, h);
        return .{ .x0 = a[0] - 0.5, .y0 = a[1] - 0.5, .x1 = b[0] + 0.5, .y1 = b[1] + 0.5 };
    }
    fn seg(b: Bounds, s: terrain.Seg) bool {
        return @max(s.a[0], s.b[0]) >= b.x0 and @min(s.a[0], s.b[0]) <= b.x1 and @max(s.a[1], s.b[1]) >= b.y0 and @min(s.a[1], s.b[1]) <= b.y1;
    }
    fn pt(b: Bounds, x: f32, y: f32) bool {
        return x >= b.x0 and x <= b.x1 and y >= b.y0 and y <= b.y1;
    }
};

fn cellRect(p: anytype, cam: Camera, c: u16, inset: f32, col: Color, filled: bool, lw: f32) !void {
    const x = cam.x(@floatFromInt(map.cellX(c))) + inset;
    const y = cam.y(@floatFromInt(map.cellY(c))) + inset;
    const w = cam.s - 2 * inset;
    if (filled) try p.fill(x, y, w, w, col) else try p.stroke(x, y, w, w, lw, col);
}

fn segLine(p: anytype, cam: Camera, s: terrain.Seg, w: f32, c: Color) !void {
    try p.line(cam.x(s.a[0]), cam.y(s.a[1]), cam.x(s.b[0]), cam.y(s.b[1]), w, c);
}

fn dot(p: anytype, cam: Camera, x: f32, y: f32, size: f32, c: Color) !void {
    try p.fill(cam.x(x) - size / 2, cam.y(y) - size / 2, size, size, c);
}

/// The colour of a height in the heightmap view: low is dark teal, high is
/// amber.
pub fn heightColor(h: f32) Color {
    const t = std.math.clamp((h - 38) / (135 - 38), 0, 1);
    const lo = [3]f32{ 0.05, 0.22, 0.28 };
    const mid = [3]f32{ 0.20, 0.42, 0.30 };
    const hi = [3]f32{ 0.85, 0.55, 0.20 };
    var c: [3]f32 = undefined;
    for (0..3) |i| c[i] = if (t < 0.5) lo[i] + (mid[i] - lo[i]) * t * 2 else mid[i] + (hi[i] - mid[i]) * (t - 0.5) * 2;
    return .{ .r = c[0], .g = c[1], .b = c[2], .a = 0.55 };
}

/// Draw the map: the heightmap tint, water, contours, woods, hedges,
/// buildings and ways.
fn drawMap(p: anytype, s: *const sim.Sim, shapes: *const terrain.Shapes, cam: Camera, ui: Ui, b: Bounds) !void {
    const ds = std.math.clamp(cam.s * 0.07, 1.3, 3);
    if (ui.heightmap) {
        for (0..map.cells) |ci| {
            const c: u16 = @intCast(ci);
            const fx: f32 = @floatFromInt(map.cellX(c));
            const fy: f32 = @floatFromInt(map.cellY(c));
            if (!b.pt(fx + 0.5, fy + 0.5)) continue;
            try cellRect(p, cam, c, 0, heightColor(s.m.cellHeight(c)), true, 0);
        }
    }
    for (shapes.water.items) |d| if (b.pt(d.x, d.y)) try dot(p, cam, d.x, d.y, ds, water_c);
    for (shapes.banks.items) |sg| if (b.seg(sg)) try segLine(p, cam, sg, 1.3, bank_c);
    for (shapes.contours.items) |sg| if (b.seg(sg)) try segLine(p, cam, sg, 1, contour_c);
    for (shapes.index.items) |sg| if (b.seg(sg)) try segLine(p, cam, sg, 1.4, index_c);
    for (shapes.wood.items) |d| if (b.pt(d.x, d.y)) {
        if (d.big) try dot(p, cam, d.x, d.y, ds * 1.8, wood_big_c) else try dot(p, cam, d.x, d.y, ds, wood_c);
    };

    // The hedges.
    var hd: [10]terrain.Dot = undefined;
    for (0..map.cells) |ci| {
        const c: u16 = @intCast(ci);
        const fx: f32 = @floatFromInt(map.cellX(c));
        const fy: f32 = @floatFromInt(map.cellY(c));
        if (!b.pt(fx + 0.5, fy + 0.5)) continue;
        if (s.m.hedge_e[c]) {
            const k = terrain.hedgeDots(fx + 1, fy, true, &hd);
            for (hd[0..k]) |d| try dot(p, cam, d.x, d.y, if (d.big) ds * 1.7 else ds * 0.9, hedge_c);
        }
        if (s.m.hedge_s[c]) {
            const k = terrain.hedgeDots(fx, fy + 1, false, &hd);
            for (hd[0..k]) |d| try dot(p, cam, d.x, d.y, if (d.big) ds * 1.7 else ds * 0.9, hedge_c);
        }
    }

    for (shapes.buildings.items) |r| if (b.pt(r[0], r[1])) {
        try p.fill(cam.x(r[0]), cam.y(r[1]), r[2] * cam.s, r[3] * cam.s, building_c);
    };

    // The ways: a wide soft glow, then the line.
    const S = struct {
        var road: [terrain.max_way_segs]terrain.Seg = undefined;
        var track: [terrain.max_way_segs]terrain.Seg = undefined;
    };
    const counts = terrain.waySegments(&s.m, &S.road, &S.track);
    const core = std.math.clamp(cam.s * 0.08, 1.8, 7);
    for (S.track[0..counts[1]]) |sg| if (b.seg(sg)) try p.glow(cam.x(sg.a[0]), cam.y(sg.a[1]), cam.x(sg.b[0]), cam.y(sg.b[1]), core * 4, track_c.alpha(0.18));
    for (S.road[0..counts[0]]) |sg| if (b.seg(sg)) try p.glow(cam.x(sg.a[0]), cam.y(sg.a[1]), cam.x(sg.b[0]), cam.y(sg.b[1]), core * 6, road_c.alpha(0.28));
    for (S.track[0..counts[1]]) |sg| if (b.seg(sg)) try dashed(p, cam, sg, core * 0.7, track_c);
    for (S.road[0..counts[0]]) |sg| if (b.seg(sg)) try segLine(p, cam, sg, core, road_c);
}

/// A dashed line: 0.12 of a square on, 0.08 off.
fn dashed(p: anytype, cam: Camera, sg: terrain.Seg, w: f32, c: Color) !void {
    const dx = sg.b[0] - sg.a[0];
    const dy = sg.b[1] - sg.a[1];
    const len = @sqrt(dx * dx + dy * dy);
    if (len == 0) return;
    // The phase comes from the map position, so the dashes of two
    // segments line up.
    var t: f32 = -@mod(@abs(sg.a[0]) + @abs(sg.a[1]), 0.2);
    while (t < len) : (t += 0.2) {
        const t0 = @max(t, 0) / len;
        const t1 = @min(t + 0.12, len) / len;
        if (t1 <= t0) continue;
        try p.line(cam.x(sg.a[0] + dx * t0), cam.y(sg.a[1] + dy * t0), cam.x(sg.a[0] + dx * t1), cam.y(sg.a[1] + dy * t1), w, c);
    }
}

/// The text in the panels and the bars.
pub const Content = struct {
    s: *const sim.Sim,
    ui: Ui,

    pub fn panel(c: Content, p: anytype, panel_id: wm_mod.Panel, r: wm_mod.Rect, a: f32) !void {
        const x = r.x + 12;
        var y = r.y + 10;
        const s = c.s;
        switch (panel_id) {
            .forces => {
                var inf: u32 = 0;
                var eng: u32 = 0;
                var trucks: u32 = 0;
                var red_inf: u32 = 0;
                for (s.units) |u| if (u.alive) switch (u.kind) {
                    .infantry => if (u.side == .blue) {
                        inf += 1;
                    } else {
                        red_inf += 1;
                    },
                    .engineer => eng += 1,
                    .truck => trucks += 1,
                };
                var buf: [32]u8 = undefined;
                const rows = [_]struct { icon: u8, label: []const u8, value: []const u8, col: Color }{
                    .{ .icon = 0, .label = "Infantry", .value = std.fmt.bufPrint(buf[0..8], "{d}", .{inf}) catch "", .col = blue },
                    .{ .icon = 1, .label = "Engineers", .value = std.fmt.bufPrint(buf[8..16], "{d}", .{eng}) catch "", .col = engineer_c },
                    .{ .icon = 2, .label = "Trucks", .value = std.fmt.bufPrint(buf[16..24], "{d}/{d}", .{ trucks, sim.truck_count }) catch "", .col = truck_c },
                    .{ .icon = 0, .label = "Enemy infantry", .value = std.fmt.bufPrint(buf[24..32], "{d}", .{red_inf}) catch "", .col = red },
                };
                for (rows) |row| {
                    switch (row.icon) {
                        0 => {
                            try p.fill(x, y + 3, 13, 13, row.col.alpha(0.3 * a));
                            try p.stroke(x, y + 3, 13, 13, 1.5, row.col.alpha(a));
                        },
                        1 => try p.fill(x + 2, y + 5, 9, 9, row.col.alpha(a)),
                        else => try p.fill(x + 3, y + 6, 7, 7, row.col.alpha(a)),
                    }
                    try p.text(row.label, x + 24, y, 15, ink.alpha(a));
                    try p.text(row.value, r.x + r.w - 14 - p.measure(row.value, 15), y, 15, ink.alpha(a));
                    y += 24;
                }
                var lb: [40]u8 = undefined;
                try p.text(std.fmt.bufPrint(&lb, "Trucks lost: {d}", .{s.stats.trucks_lost}) catch "", x, y + 2, 13, dim.alpha(a));
            },
            .supply => {
                const bars = [_]struct { label: []const u8, v: f32, max: f32, col: Color }{
                    .{ .label = "Supply", .v = s.supply, .max = sim.supply_cap, .col = amber },
                    .{ .label = "Materials", .v = s.materials, .max = sim.materials_cap, .col = engineer_c },
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
                try p.text(std.fmt.bufPrint(&lb, "Jobs {d}   Delivered {d:.0}", .{ jobs, s.stats.supply_delivered }) catch "", x, y, 13, dim.alpha(a));
            },
            .square => {
                const cell = c.ui.hover orelse {
                    try p.text("Point at a square.", x, y, 15, dim.alpha(a));
                    return;
                };
                var lb: [64]u8 = undefined;
                try p.text(std.fmt.bufPrint(&lb, "GR {d:0>2}{d:0>2}   {d:.0} m", .{ map.cellX(cell), map.size - 1 - map.cellY(cell), s.m.cellHeight(cell) }) catch "", x, y, 15, ink.alpha(a));
                y += 22;
                const way: []const u8 = switch (s.m.way[cell]) {
                    .none => "",
                    .track => ", track",
                    .road => ", road",
                };
                try p.text(std.fmt.bufPrint(&lb, "{s}{s}", .{ @tagName(s.m.ground[cell]), way }) catch "", x, y, 15, ink.alpha(a));
                y += 22;
                if (s.seen[cell]) {
                    try p.text("The enemy sees this square.", x, y, 15, red.alpha(a));
                } else try p.text("Out of enemy sight.", x, y, 15, blue.alpha(a));
            },
            .keys => {
                const lines: []const []const u8 = switch (c.ui.mode) {
                    .view => &.{ "L logistics   K kill   I intel", "H heightmap   Ctrl+D debug", "Hold V: sightlines from the pointer", "Drag: move the map", "Wheel: zoom (Ctrl: faster)", "Space pause   - + speed", "Tab: next window   Alt: menus", "Alt, V, K: this window" },
                    .logistics => &.{ "1 track (8)   2 road (20)", "Click: build one square", "Shift+drag: lay a line", "Right click: cancel a job", "Drag: move the map", "Esc: view" },
                    .kill => &.{ "Click a square: select its sector", "1 push   2 hold   3 fall back", "Drag: move the map", "Esc: view" },
                    .intel => &.{ "Red hatch: the enemy sees it.", "A truck pays 12 s of risk", "for each seen square.", "Esc: view" },
                };
                for (lines) |l| {
                    try p.text(l, x, y, 14, ink.alpha(a));
                    y += 22;
                }
            },
        }
    }
};

/// Draw one frame.
pub fn draw(p: anytype, s: *const sim.Sim, shapes: *const terrain.Shapes, cam: Camera, ui: Ui, wm: *wm_mod.Wm, w: f32, h: f32, debug_lines: []const []const u8, sight: *const [map.cells]bool, layout_per_mode: bool) !void {
    const size: f32 = map.size;
    const b = Bounds.of(cam, w, h);
    try drawMap(p, s, shapes, cam, ui, b);

    // The grid: a line each kilometre (4 squares). In the build and order
    // modes, a faint line for each square too.
    const fine_grid = ui.mode == .logistics or ui.mode == .kill or ui.heightmap;
    for (0..map.size + 1) |i| {
        const f: f32 = @floatFromInt(i);
        const km = i % 4 == 0;
        if (!km and !fine_grid) continue;
        const col = if (km) grid.alpha(0.6) else grid.alpha(0.22);
        try p.fill(cam.x(f), cam.y(0), 1, cam.s * size, col);
        try p.fill(cam.x(0), cam.y(f), cam.s * size, 1, col);
    }
    // The heights, when the squares are big enough to hold the text.
    if (ui.heightmap and cam.s >= 34) {
        for (0..map.cells) |ci| {
            const c: u16 = @intCast(ci);
            const fx: f32 = @floatFromInt(map.cellX(c));
            const fy: f32 = @floatFromInt(map.cellY(c));
            if (!b.pt(fx + 0.5, fy + 0.5)) continue;
            var hb: [8]u8 = undefined;
            try p.text(std.fmt.bufPrint(&hb, "{d:.0}", .{s.m.cellHeight(c)}) catch "", cam.x(fx) + 4, cam.y(fy) + 3, 12, ink.alpha(0.8));
        }
    }

    // The threat: each square that red can see.
    if (ui.mode == .intel or ui.mode == .logistics) {
        const a: f32 = if (ui.mode == .intel) 0.55 else 0.25;
        for (0..map.cells) |ci| if (s.seen[ci]) {
            const c: u16 = @intCast(ci);
            try p.hatch(cam.x(@floatFromInt(map.cellX(c))), cam.y(@floatFromInt(map.cellY(c))), cam.s, cam.s, red.alpha(a));
        };
    }

    // Hold V: the sightlines. Each square that a man at the pointer sees,
    // and the edge of the range.
    if (ui.sight) |from| {
        for (0..map.cells) |ci| if (sight[ci]) {
            const c: u16 = @intCast(ci);
            try cellRect(p, cam, c, 0, blue.alpha(0.16), true, 0);
        };
        try cellRect(p, cam, from, 0, blue, false, 2);
        const fx = @as(f32, @floatFromInt(map.cellX(from))) + 0.5;
        const fy = @as(f32, @floatFromInt(map.cellY(from))) + 0.5;
        const r: f32 = sight_range;
        const steps = 72;
        for (0..steps) |k| {
            const a0 = @as(f32, @floatFromInt(k)) / steps * 2 * std.math.pi;
            const a1 = @as(f32, @floatFromInt(k + 1)) / steps * 2 * std.math.pi;
            try p.line(cam.x(fx + r * @cos(a0)), cam.y(fy + r * @sin(a0)), cam.x(fx + r * @cos(a1)), cam.y(fy + r * @sin(a1)), 1, blue.alpha(0.5));
        }
        try p.text("SIGHTLINES", cam.x(fx) + 10, cam.y(fy) - 22, 13, blue);
    }

    // The objective.
    {
        const held = s.hold_ticks > 0;
        const col = if (held) blue.alpha(0.85) else ink.alpha(0.5);
        try p.stroke(cam.x(19), cam.y(11), cam.s * 3, cam.s * 2, 1.5, col);
        try p.text("OBJECTIVE", cam.x(19), cam.y(11) - 17, 13, col);
    }

    // The sectors and their postures.
    if (ui.mode == .kill) {
        for (0..sim.sectors) |i| {
            const sx = cam.x(@floatFromInt(i * sim.sector_w));
            if (i > 0) try p.fill(sx, cam.y(0), 1, cam.s * size, blue.alpha(0.35));
            if (i == ui.sector) try p.fill(sx, cam.y(0), cam.s * sim.sector_w, cam.s * size, blue.alpha(0.05));
            const posture = s.posture[@backingInt(sim.Side.blue)][i];
            const label = switch (posture) {
                .push => "PUSH",
                .hold => "HOLD",
                .back => "FALL BACK",
            };
            try p.text(label, sx + 8, cam.y(size) - 22, 16, if (i == ui.sector) blue else blue.alpha(0.55));
        }
    }

    // The build jobs.
    for (s.jobs) |j| {
        if (!j.active) continue;
        const working = j.engineer != sim.none;
        try cellRect(p, cam, j.cell, cam.s * 0.12, amber.alpha(if (working) 0.9 else 0.45), false, if (working) 1.5 else 1);
        if (j.kind == .road) try cellRect(p, cam, j.cell, cam.s * 0.25, amber.alpha(0.35), false, 1);
    }

    // The units, with labels: the squads by number, the engineers E1, E2.
    var squad_n: u32 = 0;
    var eng_n: u32 = 0;
    for (s.units) |u| {
        if (!u.alive) continue;
        const ux = cam.x(u.x);
        const uy = cam.y(u.y);
        var lb: [8]u8 = undefined;
        switch (u.kind) {
            .infantry => {
                const col = if (u.side == .blue) blue else red;
                const bs = @max(9, cam.s * 0.5);
                try p.fill(ux - bs / 2, uy - bs / 2, bs, bs, col.alpha(0.12 + 0.35 * u.strength / 100));
                try p.stroke(ux - bs / 2, uy - bs / 2, bs, bs, 1.5, col);
                if (u.engaged) try p.stroke(ux - bs / 2 - 3, uy - bs / 2 - 3, bs + 6, bs + 6, 1, col.alpha(0.5));
                if (u.side == .blue) {
                    squad_n += 1;
                    try p.fill(ux - bs / 2, uy + bs / 2 + 2, bs, 2, amber.alpha(0.25));
                    try p.fill(ux - bs / 2, uy + bs / 2 + 2, bs * u.supply / 100, 2, amber);
                    try p.text(std.fmt.bufPrint(&lb, "{d}", .{squad_n}) catch "", ux + bs / 2 + 3, uy - bs / 2 - 4, 13, blue);
                }
            },
            .engineer => {
                eng_n += 1;
                const bs = @max(6, cam.s * 0.28);
                try p.fill(ux - bs / 2, uy - bs / 2, bs, bs, engineer_c);
                if (u.task == .working) try p.stroke(ux - bs, uy - bs, bs * 2, bs * 2, 1, engineer_c.alpha(0.6));
                try p.text(std.fmt.bufPrint(&lb, "E{d}", .{eng_n}) catch "", ux + bs / 2 + 3, uy - bs / 2 - 4, 12, engineer_c.alpha(0.8));
            },
            .truck => {
                const bs = @max(5, cam.s * 0.2);
                try p.fill(ux - bs / 2, uy - bs / 2, bs, bs, truck_c);
                if (u.client != sim.none) try p.fill(ux - 1, uy - 1, 2, 2, amber);
            },
        }
    }

    // The shells in flight, and the marks.
    for (s.shells) |sh| {
        if (!sh.active) continue;
        const r = sim.shell_radius * cam.s;
        const t = @as(f32, @floatFromInt(sh.timer)) / (sim.shell_flight_s * sim.tick_hz);
        try p.stroke(cam.x(sh.x) - r, cam.y(sh.y) - r, r * 2, r * 2, 1, red.alpha(0.9 - 0.6 * t));
    }
    for (s.marks) |mk| {
        const age = @as(f32, @floatFromInt(s.tick -| mk.tick)) / sim.tick_hz;
        switch (mk.kind) {
            .none => {},
            .burst => if (age < 1.2) {
                const r = cam.s * (0.3 + age * 0.6);
                try p.fill(cam.x(mk.x) - r, cam.y(mk.y) - r, r * 2, r * 2, Color.rgb(255, 120, 40, 0.5 * (1 - age / 1.2)));
            },
            .wreck => if (age < 25) {
                const a = 0.6 * (1 - age / 25);
                try p.fill(cam.x(mk.x) - 3, cam.y(mk.y) - 0.5, 6, 1, red.alpha(a));
                try p.fill(cam.x(mk.x) - 0.5, cam.y(mk.y) - 3, 1, 6, red.alpha(a));
            },
        }
    }

    if (ui.hover) |c| if (ui.mode != .view) try cellRect(p, cam, c, 0, ink.alpha(0.7), false, 1);

    // The windows and the menu bar.
    var status_buf: [160]u8 = undefined;
    const secs = s.tick / sim.tick_hz;
    const status = std.fmt.bufPrint(&status_buf, "{s}    SUPPLY {d:.0}    MATERIALS {d:.0}    {d:0>2}:{d:0>2}  {s}", .{
        switch (ui.mode) {
            .view => "VIEW",
            .logistics => if (ui.tool == .track) "LOGISTICS: TRACK" else "LOGISTICS: ROAD",
            .kill => "KILL",
            .intel => "INTEL",
        },
        s.supply,
        s.materials,
        secs / 60,
        secs % 60,
        if (ui.paused) "PAUSED" else switch (ui.speed) {
            1 => "x1",
            2 => "x2",
            else => "x4",
        },
    }) catch "";
    try wm.draw(p, Content{ .s = s, .ui = ui }, .{ .paused = ui.paused, .speed = ui.speed, .mode = ui.mode, .heightmap = ui.heightmap, .debug = ui.debug, .layout_per_mode = layout_per_mode }, status);

    // The bottom bar.
    try p.fill(0, h - bottom_bar, w, bottom_bar, wm_mod.Wm.bar_bg);
    try p.fill(0, h - bottom_bar, w, 1, wm_mod.Wm.edge);
    const help = switch (ui.mode) {
        .view => "L logistics   K kill   I intel   H heightmap   drag to move   wheel to zoom",
        .logistics => if (ui.tool == .track) "TRACK: click a square, or Shift+drag a line   2 road   right click cancels" else "ROAD: click a square, or Shift+drag a line   1 track   right click cancels",
        .kill => "click a square to pick its sector   1 push   2 hold   3 fall back",
        .intel => "red hatch: the enemy sees it. Trucks pay 12 s of risk for each seen square",
    };
    try p.text(help, 12, h - bottom_bar + 7, 15, dim);
    if (ui.hover) |c| {
        var buf: [96]u8 = undefined;
        const info = std.fmt.bufPrint(&buf, "GR {d:0>2}{d:0>2}   {s}   {d:.0} m{s}", .{
            map.cellX(c),
            map.size - 1 - map.cellY(c),
            @tagName(s.m.ground[c]),
            s.m.cellHeight(c),
            if (s.seen[c]) "   SEEN" else "",
        }) catch "";
        try p.text(info, w - 12 - p.measure(info, 15), h - bottom_bar + 7, 15, if (s.seen[c]) red else ink);
    }

    if (s.outcome != .playing) {
        const msg = if (s.outcome == .won) "VILLAGE HELD. YOU WIN." else "THE LINE BROKE. YOU LOSE.";
        try p.fill(w / 2 - 200, h / 2 - 34, 400, 68, Color.rgb(0, 0, 0, 0.9));
        try p.stroke(w / 2 - 200, h / 2 - 34, 400, 68, 1.5, if (s.outcome == .won) blue else red);
        try p.text(msg, w / 2 - p.measure(msg, 20) / 2, h / 2 - 11, 20, if (s.outcome == .won) blue else red);
    } else if (s.hold_ticks > 0) {
        var buf: [48]u8 = undefined;
        const left = sim.hold_to_win_s - s.hold_ticks / sim.tick_hz;
        const msg = std.fmt.bufPrint(&buf, "HOLDING THE VILLAGE: {d} s", .{left}) catch "";
        try p.text(msg, w / 2 - p.measure(msg, 16) / 2, top_bar + 10, 16, blue);
    }

    // The debug text (Ctrl+D).
    if (debug_lines.len > 0) {
        var bw: f32 = 0;
        for (debug_lines) |l| bw = @max(bw, p.measure(l, 13));
        const bh = @as(f32, @floatFromInt(debug_lines.len)) * 17 + 12;
        const x0 = w / 2 - bw / 2 - 10;
        try p.fill(x0, top_bar + 40, bw + 20, bh, Color.rgb(0, 0, 0, 0.8));
        for (debug_lines, 0..) |l, i| try p.text(l, x0 + 10, top_bar + 46 + @as(f32, @floatFromInt(i)) * 17, 13, Color.rgb(160, 255, 160, 1));
    }
}
