// The weapon menu: B opens it in play and on the pause screen. The player
// picks the primary weapon (slot 1) and the secondary weapon (slot 2). A
// row for each class, a button for each model of the class. The right side
// shows the model under the mouse (main.zig draws it in 3D through a
// window in the panel), its calibre and build, and its stats. The stat
// bars (gun_compare.zig) compare it with the gun in the same slot: green
// where it is better, red where it is worse.
//
// The mouse is free while the menu is open. The weapon menu key (B, the
// weaponmenu action) or DONE closes it and goes back to play, Esc closes it
// to the pause screen.
const std = @import("std");
const core = @import("sw_core");
const gfx = @import("sw_gfx2d");
const sw_text = @import("sw_text");
const weapon = @import("weapon.zig");
const guns = @import("guns.zig");
const gun_compare = @import("gun_compare.zig");

pub var open = false;
/// The model under the mouse, or null.
pub var hover: ?u8 = null;
/// The model that the player clicked last. The preview shows it when the
/// mouse is on no button.
var shown: ?u8 = null;

pub const Result = enum { none, changed, close_play, close_pause };

const pw: f32 = 860;
const ph: f32 = 560;
const row_h: f32 = 38;
const btn_w: f32 = 44;
const btn_h: f32 = 30;

/// The class rows: the primaries, then the secondaries.
const rows = [_]weapon.Class{ .rifle, .carbine, .bullpup, .smg, .shotgun, .sawn_off, .pistol, .revolver };

pub fn show() void {
    open = true;
    hover = null;
    shown = null;
}

pub fn close() void {
    open = false;
    hover = null;
}

fn panelRect(w: f32, h: f32) gfx.Rect {
    return .{ .x = @round(w / 2 - pw / 2), .y = @round(h / 2 - ph / 2), .w = pw, .h = ph };
}

/// The window in the panel where main.zig draws the 3D model.
pub fn previewRect(w: f32, h: f32) gfx.Rect {
    const p = panelRect(w, h);
    return .{ .x = p.x + 500, .y = p.y + 66, .w = 332, .h = 150 };
}

fn doneRect(w: f32, h: f32) gfx.Rect {
    const p = panelRect(w, h);
    return .{ .x = p.x + pw - 178, .y = p.y + ph - 62, .w = 150, .h = 44 };
}

fn rowY(p: gfx.Rect, i: usize) f32 {
    // A header above the primaries, and one above the secondaries.
    const extra: f32 = if (i >= 6) 2 * 26 + 10 else 26;
    return p.y + 76 + extra + row_h * @as(f32, @floatFromInt(i));
}

/// The button of each model: its rectangle, or null for the knife.
fn button(w: f32, h: f32, model: usize) ?gfx.Rect {
    const m = weapon.models[model];
    const ri = std.mem.indexOfScalar(weapon.Class, &rows, m.class) orelse return null;
    const p = panelRect(w, h);
    const k: f32 = @floatFromInt(m.number - 1);
    return .{ .x = p.x + 172 + k * (btn_w + 6), .y = rowY(p, ri), .w = btn_w, .h = btn_h };
}

fn inside(r: gfx.Rect, x: f32, y: f32) bool {
    return x >= r.x and x <= r.x + r.w and y >= r.y and y <= r.y + r.h;
}

/// The model for the preview and the stats.
pub fn previewModel(choice: weapon.Choice) u8 {
    return hover orelse shown orelse choice.primary;
}

/// The input of one tick while the menu is open. `w` and `h` are the
/// logical size of the canvas. A click on a model puts it in its slot.
/// `toggle` is true in the tick that the weapon menu key goes down.
pub fn update(in: *const core.InputSnapshot, w: f32, h: f32, choice: *weapon.Choice, toggle: bool) Result {
    if (in.keyPressed(.Escape)) {
        close();
        return .close_pause;
    }
    if (toggle) {
        close();
        return .close_play;
    }
    const mx = in.mouse.x;
    const my = in.mouse.y;
    hover = null;
    for (0..weapon.models.len) |i| {
        const r = button(w, h, i) orelse continue;
        if (inside(r, mx, my)) hover = @intCast(i);
    }
    if (!in.buttonPressed(.left)) return .none;
    if (inside(doneRect(w, h), mx, my)) {
        close();
        return .close_play;
    }
    const pick = hover orelse return .none;
    shown = pick;
    switch (weapon.stats(weapon.models[pick].class).slot) {
        .primary => choice.primary = pick,
        .secondary => choice.secondary = pick,
        else => return .none,
    }
    return .changed;
}

/// Fill `outer` but not `hole` (inside it), with four rectangles.
fn fillAround(r: *gfx.Renderer, outer: gfx.Rect, hole: gfx.Rect, c: gfx.Color) !void {
    try r.fillRect(.{ .x = outer.x, .y = outer.y, .w = outer.w, .h = hole.y - outer.y }, c);
    try r.fillRect(.{ .x = outer.x, .y = hole.y + hole.h, .w = outer.w, .h = outer.y + outer.h - hole.y - hole.h }, c);
    try r.fillRect(.{ .x = outer.x, .y = hole.y, .w = hole.x - outer.x, .h = hole.h }, c);
    try r.fillRect(.{ .x = hole.x + hole.w, .y = hole.y, .w = outer.x + outer.w - hole.x - hole.w, .h = hole.h }, c);
}

/// The gun of the player in the slot of `model`: the gun to compare with.
pub fn currentFor(choice: weapon.Choice, model: u8) u8 {
    return if (weapon.gunStats(model).slot == .secondary) choice.secondary else choice.primary;
}

/// Draw the menu over a dark screen. `note` is a line about when the pick
/// applies (main.zig).
/// `key` names the weapon menu key for the hint.
pub fn draw(r: *gfx.Renderer, text: *sw_text.TextRenderer, mx: f32, my: f32, w: f32, h: f32, choice: weapon.Choice, note: []const u8, key: []const u8) !void {
    const white = gfx.Color.rgba8(245, 240, 232, 255);
    const dim = gfx.Color.rgba8(245, 240, 232, 150);
    const accent = gfx.Color.rgba8(255, 166, 77, 255);
    const ink = gfx.Color.rgba8(20, 14, 8, 255);
    const p = panelRect(w, h);
    const pv = previewRect(w, h);
    const T = struct {
        fn put(r2: *gfx.Renderer, t: *sw_text.TextRenderer, s: []const u8, x: f32, y: f32, size: f32, c: gfx.Color) !void {
            _ = try t.draw(r2, s, x, y, .{ .size = size, .color = c });
        }
    };

    try fillAround(r, .{ .x = 0, .y = 0, .w = w, .h = h }, p, gfx.Color.rgba8(5, 6, 10, 150));
    try fillAround(r, p, pv, gfx.Color.rgba8(10, 12, 18, 225));
    try r.fillRect(.{ .x = p.x, .y = p.y, .w = pw, .h = 3 }, accent);
    try r.strokeRect(pv, 1, gfx.Color.rgba8(255, 255, 255, 50));
    try T.put(r, text, "WEAPONS", p.x + 28, p.y + 20, 26, white);
    try T.put(r, text, "click a weapon to take it", p.x + 172, p.y + 30, 13, dim);

    // The class rows.
    try T.put(r, text, "PRIMARY  (1)", p.x + 28, rowY(p, 0) - 24, 12, dim);
    try T.put(r, text, "SECONDARY  (2)", p.x + 28, rowY(p, 6) - 24, 12, dim);
    var buf: [32]u8 = undefined;
    for (rows, 0..) |c, i| {
        const y = rowY(p, i);
        try T.put(r, text, weapon.stats(c).label, p.x + 28, y + 6, 16, white);
    }
    for (weapon.models, 0..) |m, i| {
        const b = button(w, h, i) orelse continue;
        const picked = i == choice.primary or i == choice.secondary;
        const over = inside(b, mx, my);
        const fill = if (picked) gfx.Color.rgba8(255, 166, 77, 230) else if (over) gfx.Color.rgba8(255, 255, 255, 70) else gfx.Color.rgba8(255, 255, 255, 22);
        try r.fillRect(b, fill);
        const n = std.fmt.bufPrint(&buf, "{d}", .{m.number}) catch "";
        try T.put(r, text, n, b.x + b.w / 2 - text.measure(n, 16).w / 2, b.y + 6, 16, if (picked) ink else white);
    }

    // The model under the mouse: its name, its calibre and build, and the
    // stats against the gun in its slot.
    const sel = previewModel(choice);
    const st = weapon.gunStats(sel);
    const b = guns.builds[sel];
    const x = pv.x;
    var y = pv.y + pv.h + 12;
    try T.put(r, text, weapon.label(&buf, sel), x, y, 22, accent);
    var line: [96]u8 = undefined;
    y += 28;
    const cal = std.fmt.bufPrint(&line, "{s}, {d:.0} m/s, {s}", .{ st.calibre, st.velocity, if (st.supersonic()) "supersonic" else "subsonic" }) catch "";
    try T.put(r, text, cal, x, y, 13, white);
    y += 18;
    const weight = switch (b.weight) {
        .light => "light",
        .medium => "medium weight",
        .heavy => "heavy",
    };
    // A handgun never has a stock.
    const stock = if (st.slot == .secondary) "" else if (b.stock) "stock, " else "no stock, ";
    const l0 = std.fmt.bufPrint(&line, "{d:.0} cm barrel, {s}{s}{s}", .{
        b.barrel, stock, weight, if (b.bullpup) ", bullpup" else "",
    }) catch "";
    try T.put(r, text, l0, x, y, 12, dim);
    y += 20;
    const cur = currentFor(choice, sel);
    if (cur != sel) {
        var lc: [32]u8 = undefined;
        const vs = std.fmt.bufPrint(&line, "against your {s}:", .{weapon.label(&lc, cur)}) catch "";
        try T.put(r, text, vs, x, y, 12, dim);
        const gw = text.measure(vs, 12).w + 8;
        try T.put(r, text, "better", x + gw, y, 12, gun_compare.better);
        try T.put(r, text, "worse", x + gw + text.measure("better", 12).w + 8, y, 12, gun_compare.worse);
    } else {
        try T.put(r, text, "your gun in this slot", x, y, 12, dim);
    }
    y += 18;
    y += try gun_compare.draw(r, text, x, y, pv.w, sel, cur);
    y += 4;
    const pel = if (st.pellets > 1) std.fmt.bufPrint(&buf, " x{d}", .{st.pellets}) catch "" else "";
    const l1 = std.fmt.bufPrint(&line, "BODY {d:.0}{s}  HEAD {d:.0}{s}  MAG {d} + {d}", .{ st.body, pel, st.head, pel, st.mag, st.reserve }) catch "";
    try T.put(r, text, l1, x, y, 13, white);

    // The loadout, the note, and DONE.
    var la: [32]u8 = undefined;
    var lb: [32]u8 = undefined;
    const pick = std.fmt.bufPrint(&line, "1  {s}     2  {s}     3  KNIFE     4  GRENADE", .{ weapon.label(&la, choice.primary), weapon.label(&lb, choice.secondary) }) catch "";
    try T.put(r, text, pick, p.x + 28, p.y + ph - 62, 15, white);
    try T.put(r, text, note, p.x + 28, p.y + ph - 36, 13, dim);
    const d = doneRect(w, h);
    const over = inside(d, mx, my);
    try r.fillRect(d, if (over) gfx.Color.rgba8(255, 166, 77, 230) else gfx.Color.rgba8(255, 255, 255, 30));
    try T.put(r, text, "DONE", d.x + d.w / 2 - text.measure("DONE", 18).w / 2, d.y + 11, 18, if (over) ink else white);
    var hb: [64]u8 = undefined;
    const hint = std.fmt.bufPrint(&hb, "{s} or DONE to play  -  ESC to pause", .{key}) catch "";
    try T.put(r, text, hint, w / 2 - text.measure(hint, 13).w / 2, p.y + ph + 12, 13, dim);
}
