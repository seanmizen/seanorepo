//! The frame: the order of the layers, the camera, and the bars. It draws
//! through a painter (`p: anytype`) with these methods:
//!   fill(x, y, w, h, Color), stroke(x, y, w, h, line_width, Color),
//!   line(ax, ay, bx, by, width, Color), tri(ax, ay, bx, by, cx, cy, Color),
//!   hatch(x, y, w, h, Color), image(x, y, w, h) (the minimap),
//!   text(str, x, y, size, Color), measure(str, size) f32
//! The game uses the GPU painter (main.zig). The preview tool uses a CPU
//! painter (tools/preview.zig), so a frame can go to an image file.
//!
//! The layers, bottom to top:
//!   layers.map       the terrain, the ways, the hedges (terrain.zig shapes)
//!   layers.overlays  the grid, the threat, the sightlines, the jobs, the
//!                    sectors, the objective, the depot, the posts
//!   layers.units     the unit icons (icons.zig)
//!   layers.effects   the shots, the shells, the bursts, the wrecks
//!   wm               the windows (panels.zig) and the menu bar
//!   the bottom bar, the outcome, the debug text
const std = @import("std");
const map = @import("../core/map.zig");
const sim = @import("../core/sim.zig");
const terrain = @import("terrain.zig");
const layers = @import("layers.zig");
const panels = @import("panels.zig");
const wm_mod = @import("../ui/wm.zig");
const style = @import("../style.zig");

pub const Color = style.Color;
pub const Mode = style.Mode;
const blue = style.blue;
const red = style.red;
const ink = style.ink;
const dim = style.dim;

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
    layout_per_mode: bool = false,
};

/// Hold V: the range of the sightlines, in squares.
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
        const s = @max(2, @min(w, avail_h) / map.size);
        return .{ .s = s, .ox = (w - s * map.size) / 2, .oy = top_bar + (avail_h - s * map.size) / 2 };
    }
    /// The camera with the map point (mx, my) at the centre, `s` pixels
    /// for each square.
    pub fn at(mx: f32, my: f32, s: f32, w: f32, h: f32) Camera {
        return .{ .s = s, .ox = w / 2 - mx * s, .oy = (h + top_bar - bottom_bar) / 2 - my * s };
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
        const ns = std.math.clamp(c.s * f, 2, 400);
        const k = ns / c.s;
        c.ox = sx - (sx - c.ox) * k;
        c.oy = sy - (sy - c.oy) * k;
        c.s = ns;
    }
};

/// What a frame needs, apart from the painter.
pub const Frame = struct {
    s: *const sim.Sim,
    shapes: *const terrain.Shapes,
    ways: *const terrain.Ways,
    cam: Camera,
    ui: Ui,
    wm: *wm_mod.Wm,
    w: f32,
    h: f32,
    debug_lines: []const []const u8 = &.{},
    sight: *const [map.cells]bool,
};

/// Draw one frame.
pub fn draw(p: anytype, f: Frame) !void {
    const b = layers.Bounds.of(f.cam, f.w, f.h);
    try layers.drawMap(p, f, b);
    try layers.overlays(p, f, b);
    try layers.units(p, f, b);
    try layers.effects(p, f);

    // The windows and the menu bar.
    var status_buf: [200]u8 = undefined;
    const s = f.s;
    const ui = f.ui;
    const secs = s.tick / sim.tick_hz;
    const status = std.fmt.bufPrint(&status_buf, "{s}   {s}    SUPPLY {d:.0}    MATERIALS {d:.0}    {d:0>2}:{d:0>2}  {s}", .{
        s.rules.name,
        switch (ui.mode) {
            .view => "VIEW",
            .logistics => if (ui.tool == .track) "LOGISTICS: TRACK" else if (ui.tool == .road) "LOGISTICS: ROAD" else "LOGISTICS: NET",
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
    try f.wm.draw(p, panels.Content{ .f = f }, .{
        .paused = ui.paused,
        .speed = ui.speed,
        .mode = ui.mode,
        .heightmap = ui.heightmap,
        .debug = ui.debug,
        .layout_per_mode = ui.layout_per_mode,
    }, status);

    // The bottom bar.
    try p.fill(0, f.h - bottom_bar, f.w, bottom_bar, wm_mod.Wm.bar_bg);
    try p.fill(0, f.h - bottom_bar, f.w, 1, wm_mod.Wm.edge);
    const help = switch (ui.mode) {
        .view => "L logistics   K kill   I intel   H heightmap   hold V sightlines   drag to move   wheel to zoom",
        .logistics => switch (ui.tool) {
            .track => "TRACK: click a square, or Shift+drag a line   2 road   3 drone net   right click cancels",
            .road => "ROAD: click a square, or Shift+drag a line   1 track   3 drone net   right click cancels",
            .net => "DRONE NET: click a way square, or Shift+drag   1 track   2 road   right click cancels",
        },
        .kill => "click a square to pick its sector   1 push   2 hold   3 fall back   4 objective here",
        .intel => "red hatch: the enemy sees it. Trucks pay 12 s of risk for each seen square",
    };
    try p.text(help, 12, f.h - bottom_bar + 7, 15, dim);
    if (ui.hover) |c| {
        var buf: [96]u8 = undefined;
        const info = std.fmt.bufPrint(&buf, "GR {d:0>3}{d:0>3}   {s}   {d:.0} m{s}", .{
            map.cellX(c),
            map.size - 1 - map.cellY(c),
            @tagName(s.m.ground[c]),
            s.m.cellHeight(c),
            if (s.seen[c]) "   SEEN" else "",
        }) catch "";
        try p.text(info, f.w - 12 - p.measure(info, 15), f.h - bottom_bar + 7, 15, if (s.seen[c]) red else ink);
    }

    if (s.outcome != .playing) {
        const msg = if (s.outcome == .won) s.rules.win_text else s.rules.lose_text;
        const bw = @max(400, p.measure(msg, 20) + 60);
        try p.fill(f.w / 2 - bw / 2, f.h / 2 - 34, bw, 68, Color.rgb(0, 0, 0, 0.9));
        try p.stroke(f.w / 2 - bw / 2, f.h / 2 - 34, bw, 68, 1.5, if (s.outcome == .won) blue else red);
        try p.text(msg, f.w / 2 - p.measure(msg, 20) / 2, f.h / 2 - 11, 20, if (s.outcome == .won) blue else red);
    } else if (s.hold_ticks > 0) {
        var buf: [48]u8 = undefined;
        const left = sim.hold_to_win_s - s.hold_ticks / sim.tick_hz;
        const msg = std.fmt.bufPrint(&buf, "HOLDING THE OBJECTIVE: {d} s", .{left}) catch "";
        try p.text(msg, f.w / 2 - p.measure(msg, 16) / 2, top_bar + 10, 16, blue);
    } else if (s.rules.survive_s > 0) {
        var buf: [48]u8 = undefined;
        const left = s.rules.survive_s -| @as(u32, @intCast(s.tick / sim.tick_hz));
        const msg = std.fmt.bufPrint(&buf, "HOLD THE LINE: {d}:{d:0>2}", .{ left / 60, left % 60 }) catch "";
        try p.text(msg, f.w / 2 - p.measure(msg, 16) / 2, top_bar + 10, 16, style.amber);
    }

    // The debug text (Ctrl+D).
    if (f.debug_lines.len > 0) {
        var bw: f32 = 0;
        for (f.debug_lines) |l| bw = @max(bw, p.measure(l, 13));
        const bh = @as(f32, @floatFromInt(f.debug_lines.len)) * 17 + 12;
        const x0 = f.w / 2 - bw / 2 - 10;
        try p.fill(x0, top_bar + 40, bw + 20, bh, Color.rgb(0, 0, 0, 0.8));
        for (f.debug_lines, 0..) |l, i| try p.text(l, x0 + 10, top_bar + 46 + @as(f32, @floatFromInt(i)) * 17, 13, Color.rgb(160, 255, 160, 1));
    }
}
