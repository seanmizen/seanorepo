//! Ordnance: the browser entry point. It reads the input, gives the commands
//! to the simulation (sim.zig), and draws the frame (view.zig) with the 2D
//! renderer of swindowzig.
//!
//! The keys:
//!   L logistics, K kill, I intel, Esc view, H heightmap, Ctrl+D debug
//!   Hold V: the sightlines from the square under the pointer
//!   Tab, Shift+Tab: the next window. Tap Alt: the menu bar.
//!   Space pause, - and + speed (also on the numpad)
//!   Drag: move the map. Wheel: zoom (Ctrl: faster). WASD or arrows: pan.
//!   Alt+G, Alt+M, Alt+V, Alt+W: the menus.
//!   Logistics: 1 track, 2 road. Click: one square. Shift+drag: a line.
//!     Right click cancels a job.
//!   Kill: click a square to pick its sector, then 1 push, 2 hold,
//!     3 fall back.
const std = @import("std");
const builtin = @import("builtin");
const sw = @import("sw_app");
const gfx = @import("sw_gfx2d");
const sw_text = @import("sw_text");
const map = @import("map.zig");
const sim = @import("sim.zig");
const terrain = @import("terrain.zig");
const view = @import("view.zig");
const wm_mod = @import("wm.zig");

pub const std_options: std.Options = .{
    .logFn = if (builtin.cpu.arch.isWasm()) sw.webLogFn else std.log.defaultLog,
};

pub fn main() void {}

comptime {
    sw.exportWeb(config, Callbacks);
}

const config: sw.Config = .{
    .title = "ORDNANCE",
    .size = .{ .w = 1280, .h = 900 },
    .tick_hz = sim.tick_hz,
    .surface_follows_window = true,
};

const font_bytes = @embedFile("assets/Lato-Regular.ttf");

var game: sim.Sim = undefined;
var shapes: terrain.Shapes = .{};
var ui: view.Ui = .{};
var wm: wm_mod.Wm = undefined;
var cam: view.Camera = .{ .s = 20, .ox = 0, .oy = 0 };
var fitted = false;

/// The state of a press of the left button on the map.
const MapDrag = struct {
    active: bool = false,
    sx: f32 = 0,
    sy: f32 = 0,
    lx: f32 = 0,
    ly: f32 = 0,
    panning: bool = false,
    painting: bool = false,
    last_paint: ?u16 = null,
};
var drag: MapDrag = .{};

/// "Layout per mode": each mode keeps its own windows.
var layout_per_mode = false;
var layouts: [4]?wm_mod.Layout = @splat(null);

/// Alt went down, and no other key yet.
var alt_clean = false;

/// Hold V: the viewshed from the square under the pointer.
const sight_eye = 2;
const sight_range = view.sight_range;
var sight_from: ?u16 = null;
var sight: [map.cells]bool = @splat(false);

var renderer: ?gfx.Renderer = null;
var text_renderer: ?sw_text.TextRenderer = null;
const no_texture: gfx.Texture = .{ .id = 0, .width = 1, .height = 1 };
var hatch_tex: gfx.Texture = no_texture;
var line_tex: gfx.Texture = no_texture;
var glow_tex: gfx.Texture = no_texture;

// The debug numbers (Ctrl+D).
var frame_ms: f32 = 0;
var last_frame_ns: u64 = 0;
var last_quads: usize = 0;
var last_calls: usize = 0;

const hatch_size = 24;

fn makeHatch() [hatch_size * hatch_size * 4]u8 {
    var px: [hatch_size * hatch_size * 4]u8 = undefined;
    for (0..hatch_size) |y| for (0..hatch_size) |x| {
        const i = (y * hatch_size + x) * 4;
        px[i] = 255;
        px[i + 1] = 255;
        px[i + 2] = 255;
        px[i + 3] = if ((x + y) % 6 == 0) 255 else 0;
    };
    return px;
}

const profile_w = 64;

/// A profile across a line, white with an alpha: `hard` gives a line with
/// soft edges (anti-aliasing), else a glow that fades to the edges.
fn makeProfile(hard: bool) [profile_w * 4]u8 {
    var px: [profile_w * 4]u8 = undefined;
    for (0..profile_w) |x| {
        const d = @abs((@as(f32, @floatFromInt(x)) + 0.5) / profile_w - 0.5) * 2;
        const a: f32 = if (hard) std.math.clamp((1 - d) / 0.35, 0, 1) else (1 - d) * (1 - d);
        px[x * 4] = 255;
        px[x * 4 + 1] = 255;
        px[x * 4 + 2] = 255;
        px[x * 4 + 3] = @intFromFloat(a * 255);
    }
    return px;
}

const GpuPainter = struct {
    r: *gfx.Renderer,
    tr: *sw_text.TextRenderer,

    fn col(c: view.Color) gfx.Color {
        return .{ .r = c.r, .g = c.g, .b = c.b, .a = c.a };
    }
    pub fn fill(p: *GpuPainter, x: f32, y: f32, w: f32, h: f32, c: view.Color) !void {
        try p.r.fillRect(.{ .x = x, .y = y, .w = w, .h = h }, col(c));
    }
    pub fn stroke(p: *GpuPainter, x: f32, y: f32, w: f32, h: f32, lw: f32, c: view.Color) !void {
        try p.r.strokeRect(.{ .x = x, .y = y, .w = w, .h = h }, lw, col(c));
    }
    pub fn hatch(p: *GpuPainter, x: f32, y: f32, w: f32, h: f32, c: view.Color) !void {
        try p.r.drawTexture(hatch_tex, .{ .x = x, .y = y, .w = w, .h = h }, null, col(c));
    }
    pub fn text(p: *GpuPainter, s: []const u8, x: f32, y: f32, size: f32, c: view.Color) !void {
        _ = try p.tr.draw(p.r, s, x, y, .{ .size = size, .color = col(c) });
    }
    pub fn measure(p: *GpuPainter, s: []const u8, size: f32) f32 {
        return p.tr.measure(s, size).w;
    }
    pub fn line(p: *GpuPainter, ax: f32, ay: f32, bx: f32, by: f32, w: f32, c: view.Color) !void {
        // One pixel more on each side for the soft edge.
        try p.band(line_tex, ax, ay, bx, by, w / 2 + 1, c);
    }
    pub fn glow(p: *GpuPainter, ax: f32, ay: f32, bx: f32, by: f32, w: f32, c: view.Color) !void {
        try p.band(glow_tex, ax, ay, bx, by, w / 2, c);
    }

    /// A quad along the segment, `half` wide on each side. The texture
    /// profile goes across it. The ends go on a little, so the joins close.
    fn band(p: *GpuPainter, tex: gfx.Texture, ax: f32, ay: f32, bx: f32, by: f32, half: f32, c: view.Color) !void {
        const dx = bx - ax;
        const dy = by - ay;
        const len = @sqrt(dx * dx + dy * dy);
        if (len < 0.01) return;
        const ux = dx / len;
        const uy = dy / len;
        const nx = -uy * half;
        const ny = ux * half;
        const ext: f32 = if (tex.id == line_tex.id) 0.5 else half * 0.3;
        const x0 = ax - ux * ext;
        const y0 = ay - uy * ext;
        const x1 = bx + ux * ext;
        const y1 = by + uy * ext;
        const b = &p.r.batch;
        const alloc = p.r.alloc;
        const color = [4]f32{ c.r, c.g, c.b, c.a };
        const base: u32 = @intCast(b.vertices.items.len);
        const first: u32 = @intCast(b.indices.items.len);
        try b.vertices.appendSlice(alloc, &[4]gfx.Vertex{
            .{ .pos = .{ x0 + nx, y0 + ny }, .uv = .{ 0, 0.5 }, .color = color },
            .{ .pos = .{ x1 + nx, y1 + ny }, .uv = .{ 0, 0.5 }, .color = color },
            .{ .pos = .{ x1 - nx, y1 - ny }, .uv = .{ 1, 0.5 }, .color = color },
            .{ .pos = .{ x0 - nx, y0 - ny }, .uv = .{ 1, 0.5 }, .color = color },
        });
        try b.indices.appendSlice(alloc, &[6]u32{ base, base + 1, base + 2, base, base + 2, base + 3 });
        if (b.calls.items.len > 0) {
            const last = &b.calls.items[b.calls.items.len - 1];
            if (last.texture == tex.id) {
                last.index_count += 6;
                return;
            }
        }
        try b.calls.append(alloc, .{ .texture = tex.id, .first_index = first, .index_count = 6 });
    }
};

/// The first letter key pressed in this tick, 'A' to 'Z'.
fn pressedLetter(in: anytype) ?u8 {
    for (0..26) |i| {
        if (in.keyPressed(@fromBackingInt(@intCast(i)))) return @intCast('A' + i);
    }
    return null;
}

/// Change the mode. With "Layout per mode" on, the windows of the old
/// mode go away and the windows of the new mode come back.
fn setMode(m: view.Mode) void {
    if (m == ui.mode) return;
    if (layout_per_mode) {
        const area = wm.area;
        const bar = wm.bar_h;
        layouts[@backingInt(ui.mode)] = wm.save();
        if (layouts[@backingInt(m)]) |l| wm.load(l) else {
            wm = wm_mod.Wm.initFor(m);
        }
        wm.area = area;
        wm.bar_h = bar;
    }
    ui.mode = m;
}

fn doAction(a: wm_mod.Action) void {
    switch (a) {
        .none => {},
        .pause => ui.paused = !ui.paused,
        .speed => |s| ui.speed = s,
        .mode => |m| setMode(m),
        .toggle => |p| wm.toggle(p),
        .heightmap => ui.heightmap = !ui.heightmap,
        .debug => ui.debug = !ui.debug,
        .layout_per_mode => {
            layout_per_mode = !layout_per_mode;
            layouts = @splat(null);
        },
    }
}

fn handleInput(ctx: *sw.Context, w: f32, h: f32) !void {
    const in = ctx.input();
    if (!fitted) {
        cam = view.Camera.fit(w, h);
        fitted = true;
    }
    wm.area = .{ .x = 0, .y = view.top_bar, .w = w, .h = h - view.top_bar - view.bottom_bar };
    wm.bar_h = view.top_bar;
    const ctrl = in.mods.ctrl or in.mods.super;
    const alt = in.mods.alt;
    // A tap of Alt: down and up with no other key between.
    const letter = pressedLetter(in);
    if (in.keyboard.isKeyPressed(.Alt)) alt_clean = true;
    if (letter != null or in.keyPressed(.Tab) or in.buttonPressed(.left)) alt_clean = false;
    const alt_tap = alt_clean and in.keyboard.isKeyReleased(.Alt);
    if (alt_tap) alt_clean = false;

    const r = if (renderer) |*p| p else return;
    const tr = if (text_renderer) |*p| p else return;
    var painter: GpuPainter = .{ .r = r, .tr = tr };
    const u = wm.update(&painter, .{
        .mx = in.mouse.x,
        .my = in.mouse.y,
        .down = in.buttonDown(.left),
        .pressed = in.buttonPressed(.left) and !drag.active,
        .released = in.buttonReleased(.left),
        .alt = alt,
        .alt_tap = alt_tap,
        .shift = in.mods.shift,
        .letter = letter,
        .up = in.keyPressed(.Up),
        .down_key = in.keyPressed(.Down),
        .left = in.keyPressed(.Left),
        .right = in.keyPressed(.Right),
        .enter = in.keyPressed(.Enter),
        .escape = in.keyPressed(.Escape),
        .tab = in.keyPressed(.Tab) and !ctrl and !alt,
    });
    doAction(u.action);

    if (ctrl and in.keyPressed(.D)) ui.debug = !ui.debug;
    if (!u.keys and !ctrl and !alt) {
        if (in.keyPressed(.L)) setMode(if (ui.mode == .logistics) .view else .logistics);
        if (in.keyPressed(.K)) setMode(if (ui.mode == .kill) .view else .kill);
        if (in.keyPressed(.I)) setMode(if (ui.mode == .intel) .view else .intel);
        if (in.keyPressed(.H)) ui.heightmap = !ui.heightmap;
        if (in.keyPressed(.Escape)) setMode(.view);
        if (in.keyPressed(.Space)) ui.paused = !ui.paused;
        if (in.keyPressed(.Minus)) ui.speed = if (ui.speed == 4) 2 else 1;
        if (in.keyPressed(.Equal)) ui.speed = if (ui.speed == 1) 2 else 4;
        const pan: f32 = 12;
        if (in.keyDown(.W) or in.keyDown(.Up)) cam.oy += pan;
        if (in.keyDown(.S) or in.keyDown(.Down)) cam.oy -= pan;
        if (in.keyDown(.A) or in.keyDown(.Left)) cam.ox += pan;
        if (in.keyDown(.D) or in.keyDown(.Right)) cam.ox -= pan;
        switch (ui.mode) {
            .logistics => {
                if (in.keyPressed(.Num1)) ui.tool = .track;
                if (in.keyPressed(.Num2)) ui.tool = .road;
            },
            .kill => {
                if (in.keyPressed(.Num1)) game.apply(.{ .posture = .{ .sector = ui.sector, .posture = .push } });
                if (in.keyPressed(.Num2)) game.apply(.{ .posture = .{ .sector = ui.sector, .posture = .hold } });
                if (in.keyPressed(.Num3)) game.apply(.{ .posture = .{ .sector = ui.sector, .posture = .back } });
            },
            else => {},
        }
    }

    // The wheel zooms about the pointer. Down zooms out. Ctrl makes each
    // step bigger.
    if (!u.mouse and in.wheel.delta_y != 0) {
        const base: f32 = if (ctrl) 1.15 else 1.04;
        cam.zoom(std.math.pow(f32, base, in.wheel.delta_y), in.mouse.x, in.mouse.y);
    }

    const on_map = !u.mouse and in.mouse.y > view.top_bar and in.mouse.y < h - view.bottom_bar;
    ui.hover = if (on_map or drag.active) cam.cellAt(in.mouse.x, in.mouse.y) else null;

    // The left button on the map: a drag moves the map. A click builds (in
    // logistics) or picks a sector (in kill). Shift+drag in logistics lays
    // a line.
    if (on_map and in.buttonPressed(.left)) {
        drag = .{ .active = true, .sx = in.mouse.x, .sy = in.mouse.y, .lx = in.mouse.x, .ly = in.mouse.y };
        drag.painting = ui.mode == .logistics and in.mods.shift;
    }
    if (drag.active) {
        if (drag.painting) {
            if (ui.hover) |c| if (drag.last_paint != c) {
                game.apply(.{ .build = .{ .cell = c, .kind = ui.tool } });
                drag.last_paint = c;
            };
        } else {
            if (!drag.panning and @abs(in.mouse.x - drag.sx) + @abs(in.mouse.y - drag.sy) > 4) drag.panning = true;
            if (drag.panning) {
                cam.ox += in.mouse.x - drag.lx;
                cam.oy += in.mouse.y - drag.ly;
            }
        }
        drag.lx = in.mouse.x;
        drag.ly = in.mouse.y;
        if (!in.buttonDown(.left)) {
            if (!drag.panning and !drag.painting) if (ui.hover) |c| switch (ui.mode) {
                .logistics => game.apply(.{ .build = .{ .cell = c, .kind = ui.tool } }),
                .kill => ui.sector = sim.Sim.sectorOf(@floatFromInt(map.cellX(c))),
                else => {},
            };
            drag = .{};
        }
    }
    if (on_map and ui.mode == .logistics and in.buttonPressed(.right)) {
        if (ui.hover) |c| game.apply(.{ .cancel = .{ .cell = c } });
    }

    // Hold V: the sightlines from the square under the pointer. The
    // viewshed is new only when the square changes.
    const want: ?u16 = if (in.keyDown(.V) and !ctrl and !alt and !u.keys) ui.hover else null;
    if (want != sight_from) {
        sight_from = want;
        if (want) |c| {
            const cx = @as(f32, @floatFromInt(map.cellX(c))) + 0.5;
            const cy = @as(f32, @floatFromInt(map.cellY(c))) + 0.5;
            game.m.viewshed(cx, cy, sight_eye, sight_range, &sight);
        }
    }
    ui.sight = sight_from;
}

fn debugLines(ctx: *sw.Context, buf: *[12][128]u8) [12][]const u8 {
    const in = ctx.input();
    const win = ctx.window();
    var out: [12][]const u8 = @splat("");
    const mp = cam.toMap(in.mouse.x, in.mouse.y);
    var alive: u32 = 0;
    for (game.units) |u| if (u.alive) {
        alive += 1;
    };
    var shells: u32 = 0;
    for (game.shells) |s| if (s.active) {
        shells += 1;
    };
    out[0] = std.fmt.bufPrint(&buf[0], "{d:.0} fps   {d:.2} ms", .{ if (frame_ms > 0) 1000 / frame_ms else 0, frame_ms }) catch "";
    out[1] = std.fmt.bufPrint(&buf[1], "canvas {d}x{d}  dpi {d:.2}", .{ win.width, win.height, win.dpi_scale }) catch "";
    out[2] = std.fmt.bufPrint(&buf[2], "quads {d}  draw calls {d}", .{ last_quads, last_calls }) catch "";
    out[3] = std.fmt.bufPrint(&buf[3], "map: contours {d} + {d}  banks {d}  water dots {d}  wood dots {d}", .{ shapes.contours.items.len, shapes.index.items.len, shapes.banks.items.len, shapes.water.items.len, shapes.wood.items.len }) catch "";
    out[4] = std.fmt.bufPrint(&buf[4], "tick {d}  speed x{d}  {s}  outcome {s}", .{ game.tick, ui.speed, if (ui.paused) "paused" else "running", @tagName(game.outcome) }) catch "";
    out[5] = std.fmt.bufPrint(&buf[5], "camera {d:.1} px/square  origin {d:.0},{d:.0}", .{ cam.s, cam.ox, cam.oy }) catch "";
    out[6] = std.fmt.bufPrint(&buf[6], "mouse {d:.0},{d:.0}  map {d:.2},{d:.2}", .{ in.mouse.x, in.mouse.y, mp[0], mp[1] }) catch "";
    out[7] = std.fmt.bufPrint(&buf[7], "mods ctrl {d}  cmd {d}  shift {d}  alt {d}", .{ @intFromBool(in.mods.ctrl), @intFromBool(in.mods.super), @intFromBool(in.mods.shift), @intFromBool(in.mods.alt) }) catch "";
    out[8] = std.fmt.bufPrint(&buf[8], "mode {s}  tool {s}  sector {d}  map drag {s}  window drag {s}", .{ @tagName(ui.mode), @tagName(ui.tool), ui.sector, if (drag.painting) "paint" else if (drag.panning) "pan" else if (drag.active) "press" else "none", @tagName(wm.drag) }) catch "";
    out[9] = std.fmt.bufPrint(&buf[9], "units {d}  shells {d}  supply {d:.0}  materials {d:.0}  lost trucks {d}", .{ alive, shells, game.supply, game.materials, game.stats.trucks_lost }) catch "";
    if (ui.hover) |c| {
        out[10] = std.fmt.bufPrint(&buf[10], "square {d},{d}  h {d:.1}  {s}  {s}  seen {d}", .{ map.cellX(c), map.cellY(c), game.m.cellHeight(c), @tagName(game.m.ground[c]), @tagName(game.m.way[c]), @intFromBool(game.seen[c]) }) catch "";
    }
    out[11] = "Ctrl+D: hide";
    return out;
}

const Callbacks = struct {
    pub fn init(ctx: *sw.Context) !void {
        game.init();
        wm = wm_mod.Wm.init();
        const gpu = ctx.gpu();
        if (!gpu.isReady()) return;
        const alloc = ctx.allocator();
        shapes = try terrain.build(alloc, &game.m);
        var r = try gfx.Renderer.init(alloc, gpu, .{});
        const hp = makeHatch();
        hatch_tex = try r.createTexture(hatch_size, hatch_size, &hp, .linear);
        const lp = makeProfile(true);
        line_tex = try r.createTexture(profile_w, 1, &lp, .linear);
        const gp = makeProfile(false);
        glow_tex = try r.createTexture(profile_w, 1, &gp, .linear);
        renderer = r;
        text_renderer = try sw_text.TextRenderer.init(alloc, font_bytes);
        std.log.info("ordnance: ready, {d} contour segments", .{shapes.contours.items.len + shapes.index.items.len});
    }

    pub fn tick(ctx: *sw.Context) !void {
        const win = ctx.window();
        const logical = gfx.projection.logicalSize(win.width, win.height, win.dpi_scale);
        try handleInput(ctx, logical.w, logical.h);
        if (ui.paused) return;
        for (0..ui.speed) |_| game.step();
    }

    pub fn render(ctx: *sw.Context) !void {
        const gpu = ctx.gpu();
        if (!gpu.isReady()) return;
        const r = if (renderer) |*p| p else return;
        const tr = if (text_renderer) |*p| p else return;

        const now = ctx.timeNs();
        if (last_frame_ns != 0) {
            const ms = @as(f32, @floatFromInt(now -| last_frame_ns)) / 1e6;
            frame_ms = if (frame_ms == 0) ms else frame_ms * 0.9 + ms * 0.1;
        }
        last_frame_ns = now;

        const win = ctx.window();
        r.beginFrame(win.width, win.height, win.dpi_scale);
        tr.setDpiScale(win.dpi_scale);
        const logical = gfx.projection.logicalSize(win.width, win.height, win.dpi_scale);
        var painter: GpuPainter = .{ .r = r, .tr = tr };
        var dbuf: [12][128]u8 = undefined;
        const dl = debugLines(ctx, &dbuf);
        try view.draw(&painter, &game, &shapes, cam, ui, &wm, logical.w, logical.h, if (ui.debug) &dl else &.{}, &sight, layout_per_mode);
        last_quads = r.batch.quadCount();
        last_calls = r.drawCallCount();

        var view_tex = try gpu.getCurrentTextureView();
        const encoder = try gpu.createCommandEncoder();
        const pass = try encoder.beginRenderPass(.{
            .color_attachments = &[_]sw.gpu_types.RenderPassColorAttachment{.{
                .view = &view_tex,
                .load_op = .clear,
                .store_op = .store,
                .clear_value = .{ .r = 0, .g = 0, .b = 0, .a = 1.0 },
            }},
        });
        try r.flush(pass);
        pass.end();
        const cmd = try encoder.finish();
        gpu.submit(&[_]sw.gpu_types.CommandBuffer{cmd});
        view_tex.release();
        gpu.present();
    }

    pub fn shutdown(ctx: *sw.Context) !void {
        shapes.deinit(ctx.allocator());
        if (text_renderer) |*t| t.deinit();
        text_renderer = null;
        if (renderer) |*r| r.deinit();
        renderer = null;
    }
};
