//! Ordnance: the browser entry point. It owns the lifecycle and the GPU
//! objects. Each tick it reads the engine input into ui/input.zig, and
//! steps the simulation (core/sim.zig). Each frame it draws (render/).
//!
//! The page picks the style and the map seed (src/boot.ts gives them as
//! the imports jsStyle and jsSeed).
const std = @import("std");
const builtin = @import("builtin");
const sw = @import("sw_app");
const gfx = @import("sw_gfx2d");
const sw_text = @import("sw_text");
const map = @import("core/map.zig");
const sim = @import("core/sim.zig");
const rules = @import("core/rules.zig");
const terrain = @import("render/terrain.zig");
const minimap = @import("render/minimap.zig");
const view = @import("render/view.zig");
const gpu = @import("render/gpu.zig");
const input = @import("ui/input.zig");

pub const std_options: std.Options = .{
    .logFn = if (builtin.cpu.arch.isWasm()) sw.webLogFn else std.log.defaultLog,
};

pub fn main() void {}

comptime {
    sw.exportWeb(config, Callbacks);
}

/// The style (0..5, rules.zig) and the map seed, from the page.
extern "env" fn jsStyle() u32;
extern "env" fn jsSeed() u32;

const config: sw.Config = .{
    .title = "ORDNANCE",
    .size = .{ .w = 1280, .h = 900 },
    .tick_hz = sim.tick_hz,
    .surface_follows_window = true,
};

const font_bytes = @embedFile("assets/Lato-Regular.ttf");

var game: sim.Sim = undefined;
var shapes: terrain.Shapes = .{};
var ways: terrain.Ways = .{};
var state: input.State = .{};
var minimap_rgba: [minimap.bytes]u8 = undefined;
var minimap_ways: u64 = 0;

var renderer: ?gfx.Renderer = null;
var text_renderer: ?sw_text.TextRenderer = null;
var textures: ?gpu.Textures = null;

// The debug numbers (Ctrl+D).
var frame_ms: f32 = 0;
var last_frame_ns: u64 = 0;
var last_quads: usize = 0;
var last_calls: usize = 0;

/// The engine input as ui/input.zig reads it.
fn readKeys(ctx: *sw.Context) input.Keys {
    const in = ctx.input();
    var letter: ?u8 = null;
    for (0..26) |i| if (letter == null and in.keyPressed(@fromBackingInt(@intCast(i)))) {
        letter = @intCast('A' + i);
    };
    var digit: ?u8 = null;
    if (in.keyPressed(.Num1)) digit = 1;
    if (in.keyPressed(.Num2)) digit = 2;
    if (in.keyPressed(.Num3)) digit = 3;
    if (in.keyPressed(.Num4)) digit = 4;
    if (in.keyPressed(.Num5)) digit = 5;
    return .{
        .mx = in.mouse.x,
        .my = in.mouse.y,
        .left_down = in.buttonDown(.left),
        .left_pressed = in.buttonPressed(.left),
        .left_released = in.buttonReleased(.left),
        .right_pressed = in.buttonPressed(.right),
        .wheel_y = in.wheel.delta_y,
        .ctrl = in.mods.ctrl or in.mods.super,
        .shift = in.mods.shift,
        .alt = in.mods.alt,
        .alt_pressed = in.keyboard.isKeyPressed(.Alt),
        .alt_released = in.keyboard.isKeyReleased(.Alt),
        .letter = letter,
        .pressed = .{
            .escape = in.keyPressed(.Escape),
            .space = in.keyPressed(.Space),
            .minus = in.keyPressed(.Minus),
            .equal = in.keyPressed(.Equal),
            .tab = in.keyPressed(.Tab),
            .enter = in.keyPressed(.Enter),
            .up = in.keyPressed(.Up),
            .down = in.keyPressed(.Down),
            .left = in.keyPressed(.Left),
            .right = in.keyPressed(.Right),
            .digit = digit,
        },
        .held = .{
            .w = in.keyDown(.W),
            .a = in.keyDown(.A),
            .s = in.keyDown(.S),
            .d = in.keyDown(.D),
            .v = in.keyDown(.V),
            .up = in.keyDown(.Up),
            .down = in.keyDown(.Down),
            .left = in.keyDown(.Left),
            .right = in.keyDown(.Right),
        },
    };
}

fn debugLines(ctx: *sw.Context, buf: *[12][128]u8) [12][]const u8 {
    const in = ctx.input();
    const win = ctx.window();
    var out: [12][]const u8 = @splat("");
    const cam = state.cam;
    const mp = cam.toMap(in.mouse.x, in.mouse.y);
    var alive: u32 = 0;
    for (game.units) |u| if (u.alive) {
        alive += 1;
    };
    out[0] = std.fmt.bufPrint(&buf[0], "{d:.0} fps   {d:.2} ms   style {s}   seed {d}", .{ if (frame_ms > 0) 1000 / frame_ms else 0, frame_ms, game.rules.name, game.seed }) catch "";
    out[1] = std.fmt.bufPrint(&buf[1], "canvas {d}x{d}  dpi {d:.2}", .{ win.width, win.height, win.dpi_scale }) catch "";
    out[2] = std.fmt.bufPrint(&buf[2], "quads {d}  draw calls {d}", .{ last_quads, last_calls }) catch "";
    out[3] = std.fmt.bufPrint(&buf[3], "map {d}x{d}: contours {d} + {d} (far {d})  banks {d}  dots {d} + {d}", .{ map.size, map.size, shapes.contours.items.items.len, shapes.index.items.items.len, shapes.index_far.items.items.len, shapes.banks.items.items.len, shapes.water.items.items.len, shapes.wood.items.items.len }) catch "";
    out[4] = std.fmt.bufPrint(&buf[4], "tick {d}  speed x{d}  {s}  outcome {s}  wave {d}", .{ game.tick, state.ui.speed, if (state.ui.paused) "paused" else "running", @tagName(game.outcome), game.wave }) catch "";
    out[5] = std.fmt.bufPrint(&buf[5], "camera {d:.1} px/square  origin {d:.0},{d:.0}", .{ cam.s, cam.ox, cam.oy }) catch "";
    out[6] = std.fmt.bufPrint(&buf[6], "mouse {d:.0},{d:.0}  map {d:.2},{d:.2}", .{ in.mouse.x, in.mouse.y, mp[0], mp[1] }) catch "";
    out[7] = std.fmt.bufPrint(&buf[7], "mods ctrl {d}  cmd {d}  shift {d}  alt {d}", .{ @intFromBool(in.mods.ctrl), @intFromBool(in.mods.super), @intFromBool(in.mods.shift), @intFromBool(in.mods.alt) }) catch "";
    out[8] = std.fmt.bufPrint(&buf[8], "mode {s}  tool {s}  sector {d}  window drag {s}", .{ @tagName(state.ui.mode), @tagName(state.ui.tool), state.ui.sector, @tagName(state.wm.drag) }) catch "";
    out[9] = std.fmt.bufPrint(&buf[9], "units {d}  supply {d:.0}  materials {d:.0}  lost trucks {d}  towns {d}/{d}", .{ alive, game.supply, game.materials, game.stats.trucks_lost, game.towns_held[0], game.towns_held[1] }) catch "";
    if (state.ui.hover) |c| {
        out[10] = std.fmt.bufPrint(&buf[10], "square {d},{d}  h {d:.1}  {s}  {s}  seen {d}  blue sees {d}", .{ map.cellX(c), map.cellY(c), game.m.cellHeight(c), @tagName(game.m.ground[c]), @tagName(game.m.way[c]), @intFromBool(game.seen[c]), @intFromBool(game.blue_seen[c]) }) catch "";
    }
    out[11] = "Ctrl+D: hide";
    return out;
}

fn painter() ?gpu.Painter {
    const r = if (renderer) |*p| p else return null;
    const tr = if (text_renderer) |*p| p else return null;
    return .{ .r = r, .tr = tr, .tex = textures orelse return null };
}

const Callbacks = struct {
    pub fn init(ctx: *sw.Context) !void {
        const style: rules.Style = @fromBackingInt(@intCast(@min(jsStyle(), rules.style_count - 1)));
        game.init(jsSeed(), style);
        const g = ctx.gpu();
        if (!g.isReady()) return;
        const alloc = ctx.allocator();
        shapes = try terrain.build(alloc, &game.m);
        try ways.update(alloc, &game.m);
        minimap.build(&game.m, &minimap_rgba);
        minimap_ways = ways.shown;
        var r = try gfx.Renderer.init(alloc, g, .{});
        textures = try gpu.makeTextures(&r, map.size, &minimap_rgba);
        renderer = r;
        text_renderer = try sw_text.TextRenderer.init(alloc, font_bytes);
        std.log.info("ordnance: {s}, seed {d}, {d} contour segments", .{ game.rules.name, game.seed, shapes.contours.items.items.len });
    }

    pub fn tick(ctx: *sw.Context) !void {
        const win = ctx.window();
        const logical = gfx.projection.logicalSize(win.width, win.height, win.dpi_scale);
        var p = painter() orelse return;
        state.tick(&p, &game, readKeys(ctx), logical.w, logical.h);
        if (state.ui.paused) return;
        for (0..state.ui.speed) |_| game.step();
    }

    pub fn render(ctx: *sw.Context) !void {
        const g = ctx.gpu();
        if (!g.isReady()) return;
        var p = painter() orelse return;
        const r = p.r;

        const now = ctx.timeNs();
        if (last_frame_ns != 0) {
            const ms = @as(f32, @floatFromInt(now -| last_frame_ns)) / 1e6;
            frame_ms = if (frame_ms == 0) ms else frame_ms * 0.9 + ms * 0.1;
        }
        last_frame_ns = now;

        try ways.update(ctx.allocator(), &game.m);
        if (ways.shown != minimap_ways) {
            minimap.build(&game.m, &minimap_rgba);
            try r.updateTexture(p.tex.minimap, &minimap_rgba);
            minimap_ways = ways.shown;
        }

        const win = ctx.window();
        r.beginFrame(win.width, win.height, win.dpi_scale);
        p.tr.setDpiScale(win.dpi_scale);
        const logical = gfx.projection.logicalSize(win.width, win.height, win.dpi_scale);
        var dbuf: [12][128]u8 = undefined;
        const dl = debugLines(ctx, &dbuf);
        try view.draw(&p, .{
            .s = &game,
            .shapes = &shapes,
            .ways = &ways,
            .cam = state.cam,
            .ui = state.ui,
            .wm = &state.wm,
            .w = logical.w,
            .h = logical.h,
            .debug_lines = if (state.ui.debug) &dl else &.{},
            .sight = &state.sight,
        });
        last_quads = r.batch.quadCount();
        last_calls = r.drawCallCount();

        var view_tex = try g.getCurrentTextureView();
        const encoder = try g.createCommandEncoder();
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
        g.submit(&[_]sw.gpu_types.CommandBuffer{cmd});
        view_tex.release();
        g.present();
    }

    pub fn shutdown(ctx: *sw.Context) !void {
        shapes.deinit(ctx.allocator());
        ways.deinit(ctx.allocator());
        if (text_renderer) |*t| t.deinit();
        text_renderer = null;
        if (renderer) |*r| r.deinit();
        renderer = null;
    }
};
