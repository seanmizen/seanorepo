//! The frame: the terrain image, the overlays, the units and the HUD. It
//! draws through a painter (`p: anytype`) with these methods:
//!   fill(x, y, w, h, Color), stroke(x, y, w, h, line_width, Color),
//!   terrain(x, y, w, h), hatch(x, y, w, h, Color), text(str, x, y, size, Color)
//! The game uses the GPU painter (main.zig). The preview tool uses a CPU
//! painter (preview.zig), so a frame can go to an image file.
const std = @import("std");
const map = @import("map.zig");
const sim = @import("sim.zig");

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
pub const truck_c = Color.rgb(150, 250, 255, 1);
pub const engineer_c = Color.rgb(190, 255, 220, 1);
pub const red = Color.rgb(255, 64, 88, 1);
pub const amber = Color.rgb(255, 170, 60, 1);
pub const ink = Color.rgb(170, 200, 205, 1);
pub const dim = Color.rgb(90, 115, 120, 1);
pub const grid = Color.rgb(50, 75, 85, 1);

pub const Mode = enum { view, logistics, kill, intel };

/// The state of the interface that the frame shows.
pub const Ui = struct {
    mode: Mode = .view,
    tool: sim.JobKind = .track,
    hover: ?u16 = null,
    sector: u8 = 0,
    paused: bool = false,
    speed: u8 = 1,
};

pub const top_bar = 30;
pub const bottom_bar = 26;

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
    /// The square under the screen point, or null off the map.
    pub fn cellAt(c: Camera, sx: f32, sy: f32) ?u16 {
        const mx = (sx - c.ox) / c.s;
        const my = (sy - c.oy) / c.s;
        if (mx < 0 or my < 0 or mx >= map.size or my >= map.size) return null;
        return map.cellAt(mx, my);
    }
    /// Zoom by `f` about the screen point (sx, sy).
    pub fn zoom(c: *Camera, f: f32, sx: f32, sy: f32) void {
        const ns = std.math.clamp(c.s * f, 6, 160);
        const k = ns / c.s;
        c.ox = sx - (sx - c.ox) * k;
        c.oy = sy - (sy - c.oy) * k;
        c.s = ns;
    }
};

fn cellRect(p: anytype, cam: Camera, c: u16, inset: f32, col: Color, filled: bool, lw: f32) !void {
    const x = cam.x(@floatFromInt(map.cellX(c))) + inset;
    const y = cam.y(@floatFromInt(map.cellY(c))) + inset;
    const w = cam.s - 2 * inset;
    if (filled) try p.fill(x, y, w, w, col) else try p.stroke(x, y, w, w, lw, col);
}

/// Draw one frame.
pub fn draw(p: anytype, s: *const sim.Sim, cam: Camera, ui: Ui, w: f32, h: f32) !void {
    const size: f32 = map.size;
    try p.terrain(cam.x(0), cam.y(0), cam.s * size, cam.s * size);

    // The grid: a line each kilometre (4 squares). In the build and order
    // modes, a faint line for each square too.
    const fine_grid = ui.mode == .logistics or ui.mode == .kill;
    for (0..map.size + 1) |i| {
        const f: f32 = @floatFromInt(i);
        const km = i % 4 == 0;
        if (!km and !fine_grid) continue;
        const col = if (km) grid.alpha(0.55) else grid.alpha(0.18);
        try p.fill(cam.x(f), cam.y(0), 1, cam.s * size, col);
        try p.fill(cam.x(0), cam.y(f), cam.s * size, 1, col);
    }

    // The threat: each square that red can see.
    if (ui.mode == .intel or ui.mode == .logistics) {
        const a: f32 = if (ui.mode == .intel) 0.55 else 0.25;
        for (0..map.cells) |ci| if (s.seen[ci]) {
            const c: u16 = @intCast(ci);
            try p.hatch(cam.x(@floatFromInt(map.cellX(c))), cam.y(@floatFromInt(map.cellY(c))), cam.s, cam.s, red.alpha(a));
        };
    }

    // The objective.
    {
        const held = s.hold_ticks > 0;
        const col = if (held) blue.alpha(0.8) else ink.alpha(0.45);
        try p.stroke(cam.x(19), cam.y(11), cam.s * 3, cam.s * 2, 1.5, col);
        try p.text("OBJ", cam.x(19), cam.y(11) - 14, 11, col);
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
            try p.text(label, sx + 6, cam.y(size) - 18, 13, if (i == ui.sector) blue else blue.alpha(0.55));
        }
    }

    // The build jobs.
    for (s.jobs) |j| {
        if (!j.active) continue;
        const working = j.engineer != sim.none;
        try cellRect(p, cam, j.cell, cam.s * 0.12, amber.alpha(if (working) 0.9 else 0.45), false, if (working) 1.5 else 1);
        if (j.kind == .road) try cellRect(p, cam, j.cell, cam.s * 0.25, amber.alpha(0.35), false, 1);
    }

    // The units.
    for (s.units) |u| {
        if (!u.alive) continue;
        const ux = cam.x(u.x);
        const uy = cam.y(u.y);
        switch (u.kind) {
            .infantry => {
                const col = if (u.side == .blue) blue else red;
                const b = @max(7, cam.s * 0.5);
                try p.fill(ux - b / 2, uy - b / 2, b, b, col.alpha(0.12 + 0.35 * u.strength / 100));
                try p.stroke(ux - b / 2, uy - b / 2, b, b, 1.5, col);
                if (u.engaged) try p.stroke(ux - b / 2 - 3, uy - b / 2 - 3, b + 6, b + 6, 1, col.alpha(0.5));
                if (u.side == .blue) {
                    try p.fill(ux - b / 2, uy + b / 2 + 2, b, 2, amber.alpha(0.25));
                    try p.fill(ux - b / 2, uy + b / 2 + 2, b * u.supply / 100, 2, amber);
                }
            },
            .engineer => {
                const b = @max(5, cam.s * 0.28);
                try p.fill(ux - b / 2, uy - b / 2, b, b, engineer_c);
                if (u.task == .working) try p.stroke(ux - b, uy - b, b * 2, b * 2, 1, engineer_c.alpha(0.6));
            },
            .truck => {
                const b = @max(4, cam.s * 0.2);
                try p.fill(ux - b / 2, uy - b / 2, b, b, truck_c);
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

    try hud(p, s, ui, w, h);
}

fn hud(p: anytype, s: *const sim.Sim, ui: Ui, w: f32, h: f32) !void {
    try p.fill(0, 0, w, top_bar, Color.rgb(0, 0, 0, 0.85));
    try p.fill(0, top_bar - 1, w, 1, grid.alpha(0.8));
    try p.fill(0, h - bottom_bar, w, bottom_bar, Color.rgb(0, 0, 0, 0.85));
    try p.fill(0, h - bottom_bar, w, 1, grid.alpha(0.8));

    var trucks: u32 = 0;
    var infantry: u32 = 0;
    for (s.units) |u| if (u.alive and u.side == .blue) switch (u.kind) {
        .truck => trucks += 1,
        .infantry => infantry += 1,
        else => {},
    };
    const secs = s.tick / sim.tick_hz;
    var buf: [200]u8 = undefined;
    const mode_name = switch (ui.mode) {
        .view => "VIEW",
        .logistics => "LOGISTICS",
        .kill => "KILL",
        .intel => "INTEL",
    };
    const mode_col = switch (ui.mode) {
        .view => ink,
        .logistics => amber,
        .kill => blue,
        .intel => red,
    };
    try p.text("ORDNANCE", 10, 8, 14, ink);
    try p.text(mode_name, 100, 8, 14, mode_col);
    const line = std.fmt.bufPrint(&buf, "SUPPLY {d:.0}   MATERIALS {d:.0}   TRUCKS {d}/{d}   SQUADS {d}   LOST TRUCKS {d}   {d:0>2}:{d:0>2}  {s}", .{
        s.supply,
        s.materials,
        trucks,
        sim.truck_count,
        infantry,
        s.stats.trucks_lost,
        secs / 60,
        secs % 60,
        if (ui.paused) "PAUSED" else switch (ui.speed) {
            1 => "x1",
            2 => "x2",
            else => "x4",
        },
    }) catch "";
    try p.text(line, 200, 8, 14, ink);

    const help = switch (ui.mode) {
        .view => "L logistics   K kill   I intel   Space pause   - + speed   WASD pan   wheel zoom",
        .logistics => if (ui.tool == .track)
            "TRACK: drag to lay a track (8 materials)   2 road   right click cancels   Esc view"
        else
            "ROAD: drag to upgrade to road (20 materials)   1 track   right click cancels   Esc view",
        .kill => "click a sector   1 push   2 hold   3 fall back   Esc view",
        .intel => "red hatch: squares the enemy sees. Trucks pay 12 s of risk for each one.   Esc view",
    };
    try p.text(help, 10, h - bottom_bar + 6, 13, dim);

    if (ui.hover) |c| {
        const g = s.m.ground[c];
        const way = s.m.way[c];
        const info = std.fmt.bufPrint(&buf, "GR {d:0>2}{d:0>2}  {s}{s}  {d:.0} m{s}", .{
            map.cellX(c),
            map.size - 1 - map.cellY(c),
            @tagName(g),
            switch (way) {
                .none => "",
                .track => " + track",
                .road => " + road",
            },
            s.m.cellHeight(c),
            if (s.seen[c]) "  SEEN BY ENEMY" else "",
        }) catch "";
        try p.text(info, w - 330, h - bottom_bar + 6, 13, if (s.seen[c]) red else ink);
    }

    if (s.outcome != .playing) {
        const msg = if (s.outcome == .won) "VILLAGE HELD. YOU WIN." else "THE LINE BROKE. YOU LOSE.";
        try p.fill(w / 2 - 180, h / 2 - 30, 360, 60, Color.rgb(0, 0, 0, 0.9));
        try p.stroke(w / 2 - 180, h / 2 - 30, 360, 60, 1.5, if (s.outcome == .won) blue else red);
        try p.text(msg, w / 2 - 140, h / 2 - 9, 18, if (s.outcome == .won) blue else red);
    } else if (s.hold_ticks > 0) {
        const left = sim.hold_to_win_s - s.hold_ticks / sim.tick_hz;
        const msg = std.fmt.bufPrint(&buf, "HOLDING THE VILLAGE: {d} s", .{left}) catch "";
        try p.text(msg, w / 2 - 90, top_bar + 8, 14, blue);
    }
}
