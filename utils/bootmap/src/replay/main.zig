//! bootmap-replay: play a recorded boot in a window.
//!
//!   zig build replay -- <trace.json> [--speed <x>] [key=value ...]
//!
//! key=value: a style option (src/render/style.zig), for example fill=spiral.
//!
//! The treemap is drawn by the same canvas code as the loader and the
//! daemon, into a 1280x800 XRGB8888 buffer. This app copies the buffer to a
//! texture each frame and draws it, with a status line and a legend above.
//!
//! Keys:
//!   Space pause, B play backwards (rewind) or forwards,
//!   Left and Right jump 1 s back or forward (with Shift: 10 s),
//!   Home and End go to the start and the end, R restarts,
//!   Up and Down change the speed,
//!   F next fill order, E next empty colour, O outline on and off,
//!   S spawn at start or at plan,
//!   C colour by (stage, group, kind, hash, time, duration, mono),
//!   P palette, V colour space, J jitter, G pixel pattern,
//!   H show or hide this key list on the screen.
//! The picture is a function of the time only, so every frame is the same
//! when you go back to it.

const std = @import("std");
const builtin = @import("builtin");
const sw = @import("sw_app");
const gfx = @import("sw_gfx2d");
const sw_text = @import("sw_text");
const bootmap = @import("bootmap");

const fb_w = 1280;
const fb_h = 800;
const bar_h = 36;

const font_paths = [_][]const u8{
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
};

const speeds = [_]f64{ 0.1, 0.25, 0.5, 1, 2, 4, 8, 16 };

var plan: bootmap.plan.Plan = undefined;
var pixels: [fb_w * fb_h]u32 = undefined;
var rgba: [fb_w * fb_h * 4]u8 = undefined;
var renderer: ?gfx.Renderer = null;
var texture: gfx.Texture = .{ .id = 0, .width = 1, .height = 1 };
var text: ?sw_text.TextRenderer = null;
var font_bytes: ?[]u8 = null;

var style: bootmap.style.Style = .{};
var t_us: f64 = 0;
var speed_index: usize = 3;
var paused = false;
var backwards = false;
/// The key list. It shows at the start. H shows it or hides it.
var show_help = true;
var last_ns: u64 = 0;

pub fn main(init: std.process.Init) !void {
    const alloc = init.arena.allocator();
    const args = try init.minimal.args.toSlice(alloc);
    if (args.len < 2) {
        std.debug.print("usage: bootmap-replay <trace.json> [--speed <x>]\n", .{});
        std.process.exit(2);
    }
    var i: usize = 2;
    while (i < args.len) : (i += 1) {
        if (std.mem.eql(u8, args[i], "--speed") and i + 1 < args.len) {
            i += 1;
            const want = try std.fmt.parseFloat(f64, args[i]);
            for (speeds, 0..) |s, k| if (s <= want) {
                speed_index = k;
            };
        } else {
            style.set(args[i]) catch |err| {
                std.debug.print("bootmap-replay: bad option {s}: {s}\n", .{ args[i], @errorName(err) });
                std.process.exit(2);
            };
        }
    }

    const bytes = try std.Io.Dir.cwd().readFileAlloc(init.io, args[1], alloc, .limited(64 << 20));
    const parsed = try bootmap.trace.parse(alloc, bytes);
    plan = try bootmap.plan.fromTrace(alloc, parsed.value, style.other);
    try plan.layout(.{ .w = fb_w, .h = fb_h }, style.pads, style.headerH(), style.order);

    for (font_paths) |p| {
        font_bytes = std.Io.Dir.cwd().readFileAlloc(init.io, p, alloc, .limited(16 << 20)) catch continue;
        break;
    }
    if (font_bytes == null) std.log.warn("bootmap-replay: no font found. The status line is not shown.", .{});

    try sw.run(.{
        .title = "bootmap replay",
        .size = .{ .w = fb_w, .h = fb_h + bar_h },
        .tick_hz = 60,
        .surface_follows_window = true,
        .io = init.io,
    }, Callbacks);
}

/// The key list, with the value that each key changes now.
fn drawHelp(r: *gfx.Renderer, tr: *sw_text.TextRenderer, win_w: f32) !void {
    var bufs: [16][96]u8 = undefined;
    var lines: [16][]const u8 = undefined;
    var n: usize = 0;
    const rows = .{
        .{ "H", "hide or show these keys", "" },
        .{ "Space", "pause", if (paused) "paused" else "playing" },
        .{ "B", "rewind / forward", if (backwards) "rewind" else "forward" },
        .{ "Left Right", "jump 1 s (Shift: 10 s)", "" },
        .{ "Home End R", "start / end", "" },
        .{ "Up Down", "speed", "" },
        .{ "F", "fill", @tagName(style.fill) },
        .{ "E", "empty colour", switch (style.empty) {
            .dim => "dim",
            .color => |c| if (c == 0) "black" else if (c == 0xffffff) "white" else "custom",
        } },
        .{ "O", "outline", if (style.outline == 0) "off" else "on" },
        .{ "S", "spawn", @tagName(style.spawn) },
        .{ "C", "colour by", @tagName(style.color_by) },
        .{ "P", "palette", bootmap.color.palettes[style.palette].name },
        .{ "V", "colour space", @tagName(style.space) },
        .{ "J", "jitter", jitterName() },
        .{ "G", "pattern", @tagName(style.pattern) },
    };
    inline for (rows) |row| {
        lines[n] = std.fmt.bufPrint(&bufs[n], "{s: <11} {s: <24} {s}", .{ row[0], row[1], row[2] }) catch "";
        n += 1;
    }
    const line_h: f32 = 17;
    const w: f32 = 430;
    const x = win_w - w - 12;
    const y: f32 = bar_h + 12;
    try r.fillRect(.{ .x = x, .y = y, .w = w, .h = line_h * @as(f32, @floatFromInt(n)) + 16 }, gfx.Color.rgba8(0, 0, 0, 215));
    for (lines[0..n], 0..) |ln, i| {
        _ = try tr.draw(r, ln, x + 10, y + 8 + line_h * @as(f32, @floatFromInt(i)), .{ .size = 13, .color = gfx.Color.rgba8(240, 239, 236, 255) });
    }
}

fn jitterName() []const u8 {
    return switch (style.jitter) {
        0 => "0",
        6 => "6",
        12 => "12",
        24 => "24",
        else => "custom",
    };
}

fn nextEnum(v: anytype) @TypeOf(v) {
    const vals = std.enums.values(@TypeOf(v));
    for (vals, 0..) |x, i| if (x == v) return vals[(i + 1) % vals.len];
    return v;
}

fn toRgba() void {
    for (pixels, 0..) |p, k| {
        rgba[k * 4 ..][0..4].* = .{ @truncate(p >> 16), @truncate(p >> 8), @truncate(p), 255 };
    }
}

/// Text in the legend, in stage order. The colours come from the palette.
fn stageColor(i: usize) gfx.Color {
    const c = bootmap.palette.stage[i];
    return gfx.Color.rgba8(@truncate(c >> 16), @truncate(c >> 8), @truncate(c), 255);
}

fn counts(t: u64) struct { done: usize, active: usize, total: usize } {
    var done: usize = 0;
    var active: usize = 0;
    var total: usize = 0;
    for (plan.nodes, 0..) |nd, k| {
        if (nd.depth != 3) continue;
        total += 1;
        switch (plan.state(k, t)) {
            .done, .failed => done += 1,
            .active => active += 1,
            .pending => {},
        }
    }
    return .{ .done = done, .active = active, .total = total };
}

const Callbacks = struct {
    pub fn init(ctx: *sw.Context) !void {
        const gpu = ctx.gpu();
        if (!gpu.isReady()) return;
        var r = try gfx.Renderer.init(ctx.allocator(), gpu, .{});
        const c: bootmap.canvas.Canvas = .{ .pixels = &pixels, .width = fb_w, .height = fb_h, .stride = fb_w };
        c.clear(bootmap.palette.surface);
        toRgba();
        texture = try r.createTexture(fb_w, fb_h, &rgba, .nearest);
        renderer = r;
        if (font_bytes) |fb| text = try sw_text.TextRenderer.init(ctx.allocator(), fb);
        last_ns = ctx.timeNs();
    }

    pub fn tick(ctx: *sw.Context) !void {
        const input = ctx.input();
        if (input.keyPressed(.Space)) paused = !paused;
        const end: f64 = @floatFromInt(plan.end_us);
        if (input.keyPressed(.R) or input.keyPressed(.Home)) t_us = 0;
        if (input.keyPressed(.End)) t_us = end;
        if (input.keyPressed(.B)) backwards = !backwards;
        const jump: f64 = if (input.mods.shift) 10e6 else 1e6;
        if (input.keyPressed(.Left)) t_us = @max(t_us - jump, 0);
        if (input.keyPressed(.Right)) t_us = @min(t_us + jump, end);
        if (input.keyPressed(.Down) and speed_index > 0) speed_index -= 1;
        if (input.keyPressed(.Up) and speed_index + 1 < speeds.len) speed_index += 1;
        if (input.keyPressed(.F)) style.fill = switch (style.fill) {
            .raster => .rows_up,
            .rows_up => .spiral,
            .spiral => .raster,
        };
        if (input.keyPressed(.E)) style.empty = switch (style.empty) {
            .dim => .{ .color = 0xffffff },
            .color => |c| if (c == 0xffffff) .{ .color = 0 } else if (c == 0) .dim else .{ .color = 0xffffff },
        };
        if (input.keyPressed(.O)) style.outline = if (style.outline == 0) 1 else 0;
        if (input.keyPressed(.S)) style.spawn = if (style.spawn == .start) .plan else .start;
        if (input.keyPressed(.H)) show_help = !show_help;
        if (input.keyPressed(.C)) style.color_by = nextEnum(style.color_by);
        if (input.keyPressed(.P)) style.palette = @intCast((style.palette + 1) % bootmap.color.palettes.len);
        if (input.keyPressed(.V)) style.space = nextEnum(style.space);
        if (input.keyPressed(.G)) style.pattern = nextEnum(style.pattern);
        if (input.keyPressed(.J)) style.jitter = switch (style.jitter) {
            0 => 6,
            6 => 12,
            12 => 24,
            else => 0,
        };

        const now = ctx.timeNs();
        const dt_ns = now -| last_ns;
        last_ns = now;
        if (!paused) {
            const step = @as(f64, @floatFromInt(dt_ns)) / 1000.0 * speeds[speed_index];
            t_us = if (backwards) @max(t_us - step, 0) else @min(t_us + step, end);
        }
    }

    pub fn render(ctx: *sw.Context) !void {
        const gpu = ctx.gpu();
        if (!gpu.isReady()) return;
        const r = if (renderer) |*p| p else return;
        const t: u64 = @intFromFloat(t_us);

        const c: bootmap.canvas.Canvas = .{ .pixels = &pixels, .width = fb_w, .height = fb_h, .stride = fb_w };
        bootmap.canvas.drawPlan(c, &plan, style, t);
        toRgba();
        try r.updateTexture(texture, &rgba);

        const win = ctx.window();
        r.beginFrame(win.width, win.height, win.dpi_scale);
        const size = r.size();

        // The framebuffer under the bar, at the largest size that keeps
        // its aspect ratio.
        const avail_h = @max(size.h - bar_h, 1);
        const scale = @min(size.w / fb_w, avail_h / fb_h);
        const dw = fb_w * scale;
        const dh = fb_h * scale;
        try r.drawTexture(texture, .{ .x = (size.w - dw) / 2, .y = bar_h + (avail_h - dh) / 2, .w = dw, .h = dh }, null, gfx.Color.white);

        if (text) |*tr| {
            tr.setDpiScale(win.dpi_scale);
            const ink = gfx.Color.rgba8(240, 239, 236, 255);
            const muted = gfx.Color.rgba8(195, 194, 183, 255);
            const n = counts(t);
            var buf: [320]u8 = undefined;
            const status = std.fmt.bufPrint(&buf, "{d:.2} s / {d:.2} s   {d}/{d} done, {d} active   {s}x{d}   fill={s} color={s} palette={s} space={s} jitter={d} pattern={s}{s}", .{
                t_us / 1e6,
                @as(f64, @floatFromInt(plan.end_us)) / 1e6,
                n.done,
                n.total,
                n.active,
                if (backwards) "rewind " else "",
                speeds[speed_index],
                @tagName(style.fill),
                @tagName(style.color_by),
                bootmap.color.palettes[style.palette].name,
                @tagName(style.space),
                style.jitter,
                @tagName(style.pattern),
                if (paused) "   paused" else "",
            }) catch "";
            _ = try tr.draw(r, status, 10, 10, .{ .size = 15, .color = ink });

            // The legend: a swatch and a name for each stage, at the right.
            var x: f32 = size.w - 10;
            var k: usize = bootmap.plan.stage_order.len;
            while (k > 0) {
                k -= 1;
                const name = bootmap.plan.stage_order[k];
                const label_w = tr.measure(name, 13).w;
                x -= label_w;
                _ = try tr.draw(r, name, x, 11, .{ .size = 13, .color = muted });
                x -= 18;
                try r.fillRect(.{ .x = x, .y = 12, .w = 12, .h = 12 }, stageColor(k));
                x -= 16;
            }
        }

        if (show_help) if (text) |*tr| try drawHelp(r, tr, size.w);

        var view = try gpu.getCurrentTextureView();
        const encoder = try gpu.createCommandEncoder();
        const pass = try encoder.beginRenderPass(.{
            .color_attachments = &[_]sw.gpu_types.RenderPassColorAttachment{.{
                .view = &view,
                .load_op = .clear,
                .store_op = .store,
                .clear_value = .{ .r = 0, .g = 0, .b = 0, .a = 1 },
            }},
        });
        try r.flush(pass);
        pass.end();
        const cmd = try encoder.finish();
        gpu.submit(&[_]sw.gpu_types.CommandBuffer{cmd});
        view.release();
        gpu.present();
    }

    pub fn shutdown(ctx: *sw.Context) !void {
        _ = ctx;
        if (text) |*tr| tr.deinit();
        text = null;
        if (renderer) |*r| r.deinit();
        renderer = null;
    }
};

comptime {
    if (builtin.cpu.arch.isWasm()) @compileError("bootmap-replay is native only");
}
