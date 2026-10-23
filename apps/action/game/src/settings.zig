// The player settings: head bob, volumes, field of view and mouse
// sensitivity. The values apply at once and stay in local storage (the key
// "settings"). The panel opens from the main menu and from the pause screen.
//
// Controls of the panel: click or drag a slider, or Up and Down to select a
// row and Left and Right to change it. Esc or BACK closes it.
const std = @import("std");
const core = @import("sw_core");
const gfx = @import("sw_gfx2d");
const sw_text = @import("sw_text");
const platform = @import("sw_platform");

pub const Values = struct {
    /// The head bob amount. 0 turns it off, 1 is the default.
    bob: f32 = 1,
    /// The master volume, 0 to 1. It scales every sound.
    master: f32 = 1,
    /// The sound effects volume, 0 to 1: the guns, the hits, the grenades
    /// and the buttons. The trains follow the master volume only.
    sfx: f32 = 1,
    /// The vertical field of view in degrees, at the hip. Aiming down the
    /// sights makes it narrower.
    fov: f32 = 74,
    /// The mouse sensitivity, a multiplier.
    sens: f32 = 1,
};

pub var v: Values = .{};
pub var open = false;

const Unit = enum { percent, degrees, times };
const Item = struct { label: []const u8, field: []const u8, min: f32, max: f32, step: f32, unit: Unit };
const items = [_]Item{
    .{ .label = "HEAD BOB", .field = "bob", .min = 0, .max = 2, .step = 0.1, .unit = .percent },
    .{ .label = "MASTER VOLUME", .field = "master", .min = 0, .max = 1, .step = 0.05, .unit = .percent },
    .{ .label = "EFFECTS VOLUME", .field = "sfx", .min = 0, .max = 1, .step = 0.05, .unit = .percent },
    .{ .label = "FIELD OF VIEW", .field = "fov", .min = 60, .max = 100, .step = 1, .unit = .degrees },
    .{ .label = "MOUSE SENSITIVITY", .field = "sens", .min = 0.2, .max = 3, .step = 0.05, .unit = .times },
};

var selected: usize = 0;
var dragging: ?usize = null;
var dirty = false;

fn value(i: usize) *f32 {
    inline for (items, 0..) |it, k| {
        if (k == i) return &@field(v, it.field);
    }
    unreachable;
}

fn set(i: usize, x: f32) void {
    const it = items[i];
    // Snap to the step, so the values stay round.
    const snapped = it.min + @round((x - it.min) / it.step) * it.step;
    const nv = std.math.clamp(snapped, it.min, it.max);
    if (value(i).* != nv) {
        value(i).* = nv;
        dirty = true;
    }
}

/// Read the settings from local storage. A missing or bad value keeps its
/// default.
pub fn load(alloc: std.mem.Allocator) void {
    const text = (platform.storageGet(alloc, "settings") catch null) orelse return;
    defer alloc.free(text);
    // "bob=1.00 master=1.00 ...": one name=value pair for each setting.
    var pairs = std.mem.tokenizeAny(u8, text, " \n");
    while (pairs.next()) |pair| {
        const eq = std.mem.indexOfScalar(u8, pair, '=') orelse continue;
        const x = std.fmt.parseFloat(f32, pair[eq + 1 ..]) catch continue;
        if (!std.math.isFinite(x)) continue;
        inline for (items, 0..) |it, i| {
            if (std.mem.eql(u8, pair[0..eq], it.field)) set(i, x);
        }
    }
    dirty = false;
}

fn save() void {
    dirty = false;
    var buf: [160]u8 = undefined;
    const s = std.fmt.bufPrint(&buf, "bob={d:.2} master={d:.2} sfx={d:.2} fov={d:.0} sens={d:.2}", .{
        v.bob, v.master, v.sfx, v.fov, v.sens,
    }) catch return;
    platform.storageSet("settings", s) catch {};
}

pub fn show() void {
    open = true;
    dragging = null;
}

fn close() void {
    open = false;
    dragging = null;
    if (dirty) save();
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

/// The input of one tick while the panel is open. `w` and `h` are the
/// logical size of the canvas, the space of the mouse position.
pub fn update(in: *const core.InputSnapshot, w: f32, h: f32) void {
    const l = layout(w, h);
    if (in.keyPressed(.Escape)) return close();
    if (in.keyPressed(.Up)) selected = (selected + items.len - 1) % items.len;
    if (in.keyPressed(.Down)) selected = (selected + 1) % items.len;
    if (in.keyPressed(.Left)) set(selected, value(selected).* - items[selected].step);
    if (in.keyPressed(.Right)) set(selected, value(selected).* + items[selected].step);

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
        const it = items[i];
        set(i, it.min + std.math.clamp((mx - t.x) / t.w, 0, 1) * (it.max - it.min));
    }
    // A short click can press and release inside one tick.
    if (!in.buttonDown(.left)) dragging = null;
    // Save when a drag ends, not on each tick of it.
    if (dirty and dragging == null) save();
}

fn valueText(buf: []u8, i: usize) []const u8 {
    const x = value(i).*;
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
        const k = (value(i).* - it.min) / (it.max - it.min);
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
    const hint = "drag a slider, or the arrow keys  -  ESC to close";
    _ = try text.draw(r, hint, w / 2 - text.measure(hint, 13).w / 2, l.panel.y + l.panel.h + 12, .{ .size = 13, .color = dim });
}
