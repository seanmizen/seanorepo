//! Ordnance: the browser entry point. It reads the input, gives the commands
//! to the simulation (sim.zig), and draws the frame (view.zig) with the 2D
//! renderer of swindowzig.
//!
//! The keys:
//!   L logistics, K kill, I intel, Esc view
//!   Space pause, - and + speed, WASD or the arrows pan, the wheel zooms
//!   Logistics: 1 track, 2 road. Drag with the left button to lay the way.
//!     Right click cancels a job.
//!   Kill: click a sector, then 1 push, 2 hold, 3 fall back.
const std = @import("std");
const builtin = @import("builtin");
const sw = @import("sw_app");
const gfx = @import("sw_gfx2d");
const sw_text = @import("sw_text");
const map = @import("map.zig");
const sim = @import("sim.zig");
const raster = @import("raster.zig");
const view = @import("view.zig");

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
var ui: view.Ui = .{};
var cam: view.Camera = .{ .s = 20, .ox = 0, .oy = 0 };
var fitted: [2]f32 = .{ 0, 0 };
var last_paint: ?u16 = null;

var renderer: ?gfx.Renderer = null;
var text_renderer: ?sw_text.TextRenderer = null;
var terrain_tex: gfx.Texture = .{ .id = 0, .width = 1, .height = 1 };
var hatch_tex: gfx.Texture = .{ .id = 0, .width = 1, .height = 1 };
var base_img: []u8 = &.{};
var terrain_img: []u8 = &.{};
/// The ways and hedges that the terrain texture shows now.
var shown_way: [map.cells]map.Way = undefined;
var shown_hedges: [2][map.cells]bool = undefined;

const hatch_size = 24;

fn makeHatch() [hatch_size * hatch_size * 4]u8 {
    var px: [hatch_size * hatch_size * 4]u8 = undefined;
    for (0..hatch_size) |y| for (0..hatch_size) |x| {
        const on = (x + y) % 6 == 0;
        const i = (y * hatch_size + x) * 4;
        px[i] = 255;
        px[i + 1] = 255;
        px[i + 2] = 255;
        px[i + 3] = if (on) 255 else 0;
    };
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
    pub fn terrain(p: *GpuPainter, x: f32, y: f32, w: f32, h: f32) !void {
        try p.r.drawTexture(terrain_tex, .{ .x = x, .y = y, .w = w, .h = h }, null, gfx.Color.white);
    }
    pub fn hatch(p: *GpuPainter, x: f32, y: f32, w: f32, h: f32, c: view.Color) !void {
        try p.r.drawTexture(hatch_tex, .{ .x = x, .y = y, .w = w, .h = h }, null, col(c));
    }
    pub fn text(p: *GpuPainter, s: []const u8, x: f32, y: f32, size: f32, c: view.Color) !void {
        _ = try p.tr.draw(p.r, s, x, y, .{ .size = size, .color = col(c) });
    }
};

fn terrainChanged() bool {
    return !std.mem.eql(map.Way, &shown_way, &game.m.way) or
        !std.mem.eql(bool, &shown_hedges[0], &game.m.hedge_e) or
        !std.mem.eql(bool, &shown_hedges[1], &game.m.hedge_s);
}

fn remember() void {
    shown_way = game.m.way;
    shown_hedges = .{ game.m.hedge_e, game.m.hedge_s };
}

fn handleInput(ctx: *sw.Context, w: f32, h: f32) void {
    const in = ctx.input();
    if (fitted[0] != w or fitted[1] != h) {
        cam = view.Camera.fit(w, h);
        fitted = .{ w, h };
    }

    if (in.keyPressed(.L)) ui.mode = if (ui.mode == .logistics) .view else .logistics;
    if (in.keyPressed(.K)) ui.mode = if (ui.mode == .kill) .view else .kill;
    if (in.keyPressed(.I)) ui.mode = if (ui.mode == .intel) .view else .intel;
    if (in.keyPressed(.Escape)) ui.mode = .view;
    if (in.keyPressed(.Space)) ui.paused = !ui.paused;
    if (in.keyPressed(.Minus)) ui.speed = if (ui.speed == 4) 2 else 1;
    if (in.keyPressed(.Equal)) ui.speed = if (ui.speed == 1) 2 else 4;

    const pan: f32 = 10;
    if (in.keyDown(.W) or in.keyDown(.Up)) cam.oy += pan;
    if (in.keyDown(.S) or in.keyDown(.Down)) cam.oy -= pan;
    if (in.keyDown(.A) or in.keyDown(.Left)) cam.ox += pan;
    if (in.keyDown(.D) or in.keyDown(.Right)) cam.ox -= pan;
    if (in.wheel.delta_y != 0) cam.zoom(std.math.pow(f32, 1.12, -in.wheel.delta_y), in.mouse.x, in.mouse.y);

    ui.hover = cam.cellAt(in.mouse.x, in.mouse.y);
    switch (ui.mode) {
        .logistics => {
            if (in.keyPressed(.Num1)) ui.tool = .track;
            if (in.keyPressed(.Num2)) ui.tool = .road;
            if (in.buttonDown(.left)) {
                if (ui.hover) |c| if (last_paint != c) {
                    game.apply(.{ .build = .{ .cell = c, .kind = ui.tool } });
                    last_paint = c;
                };
            } else last_paint = null;
            if (in.buttonPressed(.right)) if (ui.hover) |c| game.apply(.{ .cancel = .{ .cell = c } });
        },
        .kill => {
            if (in.buttonPressed(.left)) if (ui.hover) |c| {
                ui.sector = sim.Sim.sectorOf(@floatFromInt(map.cellX(c)));
            };
            if (in.keyPressed(.Num1)) game.apply(.{ .posture = .{ .sector = ui.sector, .posture = .push } });
            if (in.keyPressed(.Num2)) game.apply(.{ .posture = .{ .sector = ui.sector, .posture = .hold } });
            if (in.keyPressed(.Num3)) game.apply(.{ .posture = .{ .sector = ui.sector, .posture = .back } });
        },
        else => {},
    }
}

const Callbacks = struct {
    pub fn init(ctx: *sw.Context) !void {
        game.init();
        const gpu = ctx.gpu();
        if (!gpu.isReady()) return;
        const alloc = ctx.allocator();
        var r = try gfx.Renderer.init(alloc, gpu, .{});
        base_img = try alloc.alloc(u8, raster.bytes);
        terrain_img = try alloc.alloc(u8, raster.bytes);
        raster.base(&game.m, base_img);
        raster.compose(&game.m, base_img, terrain_img);
        remember();
        terrain_tex = try r.createTexture(raster.width, raster.height, terrain_img, .linear);
        const hp = makeHatch();
        hatch_tex = try r.createTexture(hatch_size, hatch_size, &hp, .linear);
        renderer = r;
        text_renderer = try sw_text.TextRenderer.init(alloc, font_bytes);
        std.log.info("ordnance: ready", .{});
    }

    pub fn tick(ctx: *sw.Context) !void {
        const win = ctx.window();
        const logical = gfx.projection.logicalSize(win.width, win.height, win.dpi_scale);
        handleInput(ctx, logical.w, logical.h);
        if (ui.paused) return;
        for (0..ui.speed) |_| game.step();
    }

    pub fn render(ctx: *sw.Context) !void {
        const gpu = ctx.gpu();
        if (!gpu.isReady()) return;
        const r = if (renderer) |*p| p else return;
        const tr = if (text_renderer) |*p| p else return;

        if (terrainChanged()) {
            raster.compose(&game.m, base_img, terrain_img);
            try r.updateTexture(terrain_tex, terrain_img);
            remember();
        }

        const win = ctx.window();
        r.beginFrame(win.width, win.height, win.dpi_scale);
        tr.setDpiScale(win.dpi_scale);
        const logical = gfx.projection.logicalSize(win.width, win.height, win.dpi_scale);
        var painter: GpuPainter = .{ .r = r, .tr = tr };
        try view.draw(&painter, &game, cam, ui, logical.w, logical.h);

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
        _ = ctx;
        if (text_renderer) |*t| t.deinit();
        text_renderer = null;
        if (renderer) |*r| r.deinit();
        renderer = null;
    }
};
