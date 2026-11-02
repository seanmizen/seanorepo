//! bootmap-replay: play a recorded boot in a window.
//!
//!   zig build replay -- <trace.json> [--speed <x>]
//!
//! The treemap is drawn by the same canvas code as the loader and the
//! daemon, into a 1280x800 XRGB8888 buffer. This app copies the buffer to a
//! texture each frame and draws it, with a status line and a legend above.
//!
//! Keys: Space pause, R restart, Left and Right change the speed.

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

var t_us: f64 = 0;
var speed_index: usize = 3;
var paused = false;
var last_ns: u64 = 0;

pub fn main(init: std.process.Init) !void {
    const alloc = init.arena.allocator();
    const args = try init.minimal.args.toSlice(alloc);
    if (args.len < 2) {
        std.debug.print("usage: bootmap-replay <trace.json> [--speed <x>]\n", .{});
        std.process.exit(2);
    }
    var i: usize = 2;
    while (i + 1 < args.len) : (i += 2) {
        if (std.mem.eql(u8, args[i], "--speed")) {
            const want = try std.fmt.parseFloat(f64, args[i + 1]);
            for (speeds, 0..) |s, k| if (s <= want) {
                speed_index = k;
            };
        }
    }

    const bytes = try std.Io.Dir.cwd().readFileAlloc(init.io, args[1], alloc, .limited(64 << 20));
    const parsed = try bootmap.trace.parse(alloc, bytes);
    plan = try bootmap.plan.fromTrace(alloc, parsed.value);
    try plan.layout(.{ .w = fb_w, .h = fb_h });

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
        if (input.keyPressed(.R)) t_us = 0;
        if (input.keyPressed(.Left) and speed_index > 0) speed_index -= 1;
        if (input.keyPressed(.Right) and speed_index + 1 < speeds.len) speed_index += 1;

        const now = ctx.timeNs();
        const dt_ns = now -| last_ns;
        last_ns = now;
        if (!paused) {
            t_us += @as(f64, @floatFromInt(dt_ns)) / 1000.0 * speeds[speed_index];
            const end: f64 = @floatFromInt(plan.end_us);
            if (t_us > end) t_us = end;
        }
    }

    pub fn render(ctx: *sw.Context) !void {
        const gpu = ctx.gpu();
        if (!gpu.isReady()) return;
        const r = if (renderer) |*p| p else return;
        const t: u64 = @intFromFloat(t_us);

        const c: bootmap.canvas.Canvas = .{ .pixels = &pixels, .width = fb_w, .height = fb_h, .stride = fb_w };
        bootmap.canvas.drawPlan(c, &plan, t);
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
            var buf: [160]u8 = undefined;
            const status = std.fmt.bufPrint(&buf, "{d:.2} s / {d:.2} s   {d}/{d} done, {d} active   x{d}{s}", .{
                t_us / 1e6,
                @as(f64, @floatFromInt(plan.end_us)) / 1e6,
                n.done,
                n.total,
                n.active,
                speeds[speed_index],
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
