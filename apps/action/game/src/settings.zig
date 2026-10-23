// The settings panel: a view over five saved cvars (head bob, volumes,
// field of view and mouse sensitivity). The panel and the console change
// the same values. The console saves them (local storage "config").
// The panel opens from the main menu and from the pause screen.
//
// Controls of the panel: click or drag a slider, or Up and Down to select a
// row and Left and Right to change it. Esc or BACK closes it.
const std = @import("std");
const core = @import("sw_core");
const gfx = @import("sw_gfx2d");
const sw_text = @import("sw_text");
const platform = @import("sw_platform");
const console = @import("console/root.zig");

pub var head_bob: *console.Cvar = undefined;
pub var volume: *console.Cvar = undefined;
pub var sfx_volume: *console.Cvar = undefined;
pub var fov: *console.Cvar = undefined;
pub var sensitivity: *console.Cvar = undefined;
pub var open = false;

var con: *console.Console = undefined;

const defs = [_]console.Def{
    .{
        .name = "head_bob",
        .default = .{ .float = 1 },
        .min = 0,
        .max = 2,
        .flags = .{ .saved = true },
        .description = "The head bob amount: 0 is off, 1 the default. It follows the speed on the ground.",
        .reader = "main.zig playerView",
    },
    .{
        .name = "volume",
        .default = .{ .float = 1 },
        .min = 0,
        .max = 1,
        .flags = .{ .saved = true },
        .description = "The master volume, 0 to 1. It scales every sound.",
        .reader = "main.zig tick (audio.setMasterVolume)",
    },
    .{
        .name = "sfx_volume",
        .default = .{ .float = 1 },
        .min = 0,
        .max = 1,
        .flags = .{ .saved = true },
        .description = "The effects volume, 0 to 1: the guns, the hits, the grenades and the buttons. The trains follow the master volume only.",
        .reader = "main.zig sound",
    },
    .{
        .name = "fov",
        .default = .{ .float = 74 },
        .min = 60,
        .max = 100,
        .flags = .{ .saved = true },
        .description = "The vertical field of view at the hip, in degrees. The sights make it narrower.",
        .reader = "main.zig gameRender (the camera)",
    },
    .{
        .name = "sensitivity",
        .default = .{ .float = 1 },
        .min = 0.2,
        .max = 3,
        .flags = .{ .saved = true },
        .description = "The mouse sensitivity, a multiplier.",
        .reader = "main.zig gameplayTick (the mouse look)",
    },
};

const Unit = enum { percent, degrees, times };
const Item = struct { label: []const u8, step: f32, unit: Unit };
/// The rows of the panel, in the order of `defs`.
const items = [_]Item{
    .{ .label = "HEAD BOB", .step = 0.1, .unit = .percent },
    .{ .label = "MASTER VOLUME", .step = 0.05, .unit = .percent },
    .{ .label = "EFFECTS VOLUME", .step = 0.05, .unit = .percent },
    .{ .label = "FIELD OF VIEW", .step = 1, .unit = .degrees },
    .{ .label = "MOUSE SENSITIVITY", .step = 0.05, .unit = .times },
};
var cvars: [items.len]*console.Cvar = undefined;

var selected: usize = 0;
var dragging: ?usize = null;

/// Add the cvars of the panel to the console.
pub fn register(c: *console.Console) !void {
    con = c;
    for (defs, 0..) |d, i| cvars[i] = try c.addCvar(d);
    head_bob = cvars[0];
    volume = cvars[1];
    sfx_volume = cvars[2];
    fov = cvars[3];
    sensitivity = cvars[4];
}

fn value(i: usize) f32 {
    return cvars[i].float();
}

fn set(i: usize, x: f32) void {
    const it = items[i];
    const d = &cvars[i].def;
    const lo: f32 = @floatCast(d.min.?);
    // Snap to the step, so the values stay round. The cvar clamps.
    const snapped = lo + @round((x - lo) / it.step) * it.step;
    _ = con.setValue(cvars[i], .{ .float = snapped }, .user) catch {};
}

/// Carry over the values of the old panel (local storage "settings",
/// "bob=1.00 master=1.00 sfx=1.00 fov=74 sens=1.00") one time, then delete
/// the old key. A missing or bad value keeps the default.
pub fn migrate(c: *console.Console, alloc: std.mem.Allocator) void {
    const text = (platform.storageGet(alloc, "settings") catch null) orelse return;
    defer alloc.free(text);
    const old = [_][]const u8{ "bob", "master", "sfx", "fov", "sens" };
    var pairs = std.mem.tokenizeAny(u8, text, " \n");
    while (pairs.next()) |pair| {
        const eq = std.mem.indexOfScalar(u8, pair, '=') orelse continue;
        const x = std.fmt.parseFloat(f64, pair[eq + 1 ..]) catch continue;
        for (old, 0..) |name, i| {
            if (std.mem.eql(u8, pair[0..eq], name)) _ = c.setValue(cvars[i], .{ .float = x }, .game) catch {};
        }
    }
    // Save the values now: the old key goes next.
    c.saveConfig();
    platform.storageDelete("settings") catch {};
}

pub fn show() void {
    open = true;
    dragging = null;
}

fn close() void {
    open = false;
    dragging = null;
}

const row_h: f32 = 54;
const pw: f32 = 600;

const Layout = struct { panel: gfx.Rect, tracks: [items.len]gfx.Rect, back: gfx.Rect };

fn layout(w: f32, h: f32) Layout {
    const ph = 76 + row_h * @as(f32, @floatFromInt(items.len)) + 76;
    const x = w / 2 - pw / 2;
    const y = h / 2 - ph / 2;
    var l: Layout = .{ .panel = .{ .x = x, .y = y, .w = pw, .h = ph }, .tracks = undefined, .back = undefined };
    for (0..items.len) |i| {
        const ry = y + 76 + row_h * @as(f32, @floatFromInt(i));
        l.tracks[i] = .{ .x = x + 260, .y = ry + 14, .w = 220, .h = 6 };
    }
    l.back = .{ .x = w / 2 - 100, .y = y + ph - 62, .w = 200, .h = 44 };
    return l;
}

fn inside(r: gfx.Rect, x: f32, y: f32) bool {
    return x >= r.x and x <= r.x + r.w and y >= r.y and y <= r.y + r.h;
}

fn range(i: usize) struct { lo: f32, hi: f32 } {
    const d = &cvars[i].def;
    return .{ .lo = @floatCast(d.min.?), .hi = @floatCast(d.max.?) };
}

/// The input of one tick while the panel is open. `w` and `h` are the
/// logical size of the canvas, the space of the mouse position.
pub fn update(in: *const core.InputSnapshot, w: f32, h: f32) void {
    const l = layout(w, h);
    if (in.keyPressed(.Escape)) return close();
    if (in.keyPressed(.Up)) selected = (selected + items.len - 1) % items.len;
    if (in.keyPressed(.Down)) selected = (selected + 1) % items.len;
    if (in.keyPressed(.Left)) set(selected, value(selected) - items[selected].step);
    if (in.keyPressed(.Right)) set(selected, value(selected) + items[selected].step);

    const mx = in.mouse.x;
    const my = in.mouse.y;
    if (in.buttonPressed(.left)) {
        if (inside(l.back, mx, my)) return close();
        for (l.tracks, 0..) |t, i| {
            // The full row height takes the click, not only the thin track.
            const hit: gfx.Rect = .{ .x = t.x - 10, .y = t.y - 22, .w = t.w + 20, .h = row_h - 4 };
            if (inside(hit, mx, my)) {
                dragging = i;
                selected = i;
            }
        }
    }
    if (dragging) |i| {
        const t = l.tracks[i];
        const rg = range(i);
        set(i, rg.lo + std.math.clamp((mx - t.x) / t.w, 0, 1) * (rg.hi - rg.lo));
    }
    // A short click can press and release inside one tick.
    if (!in.buttonDown(.left)) dragging = null;
}

fn valueText(buf: []u8, i: usize) []const u8 {
    const x = value(i);
    return switch (items[i].unit) {
        .percent => if (x == 0) "OFF" else std.fmt.bufPrint(buf, "{d:.0}%", .{x * 100}) catch "",
        .degrees => std.fmt.bufPrint(buf, "{d:.0} deg", .{x}) catch "",
        .times => std.fmt.bufPrint(buf, "{d:.2}x", .{x}) catch "",
    };
}

/// Draw the panel over a dark screen.
pub fn draw(r: *gfx.Renderer, text: *sw_text.TextRenderer, mouse_x: f32, mouse_y: f32, w: f32, h: f32) !void {
    const white = gfx.Color.rgba8(245, 240, 232, 255);
    const dim = gfx.Color.rgba8(245, 240, 232, 150);
    const accent = gfx.Color.rgba8(255, 166, 77, 255);
    const l = layout(w, h);
    try r.fillRect(.{ .x = 0, .y = 0, .w = w, .h = h }, gfx.Color.rgba8(5, 6, 10, 150));
    try r.fillRect(l.panel, gfx.Color.rgba8(10, 12, 18, 225));
    try r.fillRect(.{ .x = l.panel.x, .y = l.panel.y, .w = pw, .h = 3 }, accent);
    const title = "SETTINGS";
    _ = try text.draw(r, title, w / 2 - text.measure(title, 26).w / 2, l.panel.y + 20, .{ .size = 26, .color = white });

    var buf: [32]u8 = undefined;
    for (items, 0..) |it, i| {
        const t = l.tracks[i];
        const ry = t.y - 14;
        if (i == selected) try r.fillRect(.{ .x = l.panel.x + 8, .y = ry - 6, .w = pw - 16, .h = row_h - 6 }, gfx.Color.rgba8(255, 166, 77, 30));
        _ = try text.draw(r, it.label, l.panel.x + 28, ry + 2, .{ .size = 16, .color = if (i == selected) accent else white });
        const rg = range(i);
        const k = (value(i) - rg.lo) / (rg.hi - rg.lo);
        try r.fillRect(t, gfx.Color.rgba8(255, 255, 255, 40));
        try r.fillRect(.{ .x = t.x, .y = t.y, .w = t.w * k, .h = t.h }, accent);
        try r.fillRect(.{ .x = t.x + t.w * k - 5, .y = t.y - 7, .w = 10, .h = 20 }, white);
        const vt = valueText(&buf, i);
        _ = try text.draw(r, vt, l.panel.x + pw - 28 - text.measure(vt, 16).w, ry + 2, .{ .size = 16, .color = white });
    }
    const hover = inside(l.back, mouse_x, mouse_y);
    try r.fillRect(l.back, if (hover) gfx.Color.rgba8(255, 166, 77, 230) else gfx.Color.rgba8(255, 255, 255, 30));
    const bt = "BACK";
    _ = try text.draw(r, bt, w / 2 - text.measure(bt, 18).w / 2, l.back.y + 11, .{ .size = 18, .color = if (hover) gfx.Color.rgba8(20, 14, 8, 255) else white });
    const hint = "drag a slider, or the arrow keys  -  ESC to close  -  the console has the same values";
    _ = try text.draw(r, hint, w / 2 - text.measure(hint, 13).w / 2, l.panel.y + l.panel.h + 12, .{ .size = 13, .color = dim });
}
