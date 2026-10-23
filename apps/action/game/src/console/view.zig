// The console panel: the output, the input line, the suggestion list and
// the script editor. It reads the keys of a tick (update) and draws with
// sw_gfx2d and sw_text (draw).
//
// The game opens the panel with its console key (Console.setOpen). While
// the panel is open, the game must start text input, give the panel the
// keys, and keep the keys from the game. The toggle character typed in the
// panel closes it, and so does Esc.
//
// drawPrompt and drawSuggestions also suit a chat line.
const std = @import("std");
const core = @import("sw_core");
const gfx = @import("sw_gfx2d");
const sw_text = @import("sw_text");
const console = @import("console.zig");
const cvar_mod = @import("cvar.zig");
const complete = @import("complete.zig");
const prompt_mod = @import("prompt.zig");
const line_mod = @import("line.zig");
const keys = @import("keys.zig");

pub const Theme = struct {
    panel: gfx.Color = gfx.Color.rgba8(8, 10, 16, 230),
    text: gfx.Color = gfx.Color.rgba8(236, 232, 224, 255),
    dim: gfx.Color = gfx.Color.rgba8(236, 232, 224, 140),
    accent: gfx.Color = gfx.Color.rgba8(255, 166, 77, 255),
    err: gfx.Color = gfx.Color.rgba8(240, 96, 84, 255),
    size: f32 = 15,
};

/// The suggestion list shows at most this many rows.
pub const max_suggestions = 8;

pub const View = struct {
    prompt: prompt_mod.Prompt = .{},
    theme: Theme = .{},
    /// The character that closes the panel (the console key).
    toggle_char: u8 = '`',
    /// The part of the screen height that the panel covers.
    height: f32 = 0.5,
    /// The output lines above the newest that the player scrolled back.
    scroll: usize = 0,
    ticks: u32 = 0,

    /// The input events of one tick, in order, while the panel is open.
    pub fn update(self: *View, con: *console.Console, events: []const core.Event) void {
        if (!con.open) return;
        self.ticks +%= 1;
        for (events) |*ev| {
            if (!con.open) return;
            if (prompt_mod.typedText(ev)) |t| {
                // The console key types the toggle character: close. It never
                // goes into the line.
                if (std.mem.indexOfScalar(u8, t, self.toggle_char) != null) {
                    if (con.editing() != null) con.finishEdit();
                    con.setOpen(false);
                    return;
                }
            }
            if (con.editing() != null) {
                self.feedEditor(con, ev);
                continue;
            }
            if (prompt_mod.keyDown(ev.*)) |k| if (k.mods.shift and (k.key == .Up or k.key == .Down)) {
                if (k.key == .Up) {
                    self.scroll = @min(self.scroll + 3, con.out.count() -| 1);
                } else self.scroll -|= 3;
                continue;
            };
            switch (self.prompt.feed(con, ev)) {
                .submit => {
                    self.scroll = 0;
                    con.submit(self.prompt.submitted());
                },
                .cancel => con.setOpen(false),
                .none => {},
            }
        }
    }

    fn feedEditor(_: *View, con: *console.Console, ev: *const core.Event) void {
        const e = &con.editor;
        if (prompt_mod.typedText(ev)) |t| return e.insert(con.alloc, t);
        const k = prompt_mod.keyDown(ev.*) orelse return;
        switch (k.key) {
            .Escape => con.finishEdit(),
            .Enter => e.insert(con.alloc, "\n"),
            .Backspace => e.backspace(),
            .Left => e.left(),
            .Right => e.right(),
            .Up => e.up(),
            .Down => e.down(),
            else => {},
        }
    }

    pub fn draw(self: *View, con: *console.Console, r: *gfx.Renderer, t: *sw_text.TextRenderer, w: f32, h: f32) !void {
        if (!con.open) return;
        const th = self.theme;
        const lh = t.lineHeight(th.size);
        const ph = @round(h * self.height);
        try r.fillRect(.{ .x = 0, .y = 0, .w = w, .h = ph }, th.panel);
        try r.fillRect(.{ .x = 0, .y = ph, .w = w, .h = 2 }, th.accent);
        const pad: f32 = 14;
        if (con.editing()) |name| return self.drawEditor(con, name, r, t, ph, pad);

        const py = ph - lh - 8;
        const caret = (self.ticks / 40) % 2 == 0;
        try drawPrompt(r, t, &self.prompt, "> ", pad, py, w - 2 * pad, th, caret);

        // The output, newest at the bottom, wrapped to the panel width.
        var y = py - 6;
        const max_w = w - 2 * pad;
        var i = self.scroll;
        while (i < con.out.count() and y > 4) : (i += 1) {
            const l = con.out.get(i);
            const size = try t.measureWrapped(l.text, th.size, max_w);
            const hh = @max(lh, size.h);
            y -= hh;
            if (y < 0) break;
            const col = switch (l.kind) {
                .normal => th.text,
                .echo => th.accent,
                .err => th.err,
                .dim => th.dim,
            };
            _ = try t.drawWrapped(r, l.text, pad, y, max_w, .{ .size = th.size, .color = col });
        }
        if (self.scroll > 0) {
            var buf: [48]u8 = undefined;
            const s = std.fmt.bufPrint(&buf, "{d} lines down - Shift+Down", .{self.scroll}) catch "";
            const m = t.measure(s, th.size - 2);
            _ = try t.draw(r, s, w - pad - m.w, py, .{ .size = th.size - 2, .color = th.dim });
        }

        var list: [max_suggestions]complete.Suggestion = undefined;
        const total = self.prompt.suggestions(con, &list);
        try drawSuggestions(r, t, con, list[0..@min(total, list.len)], total, pad, ph + 6, w - 2 * pad, th);
    }

    fn drawEditor(self: *View, con: *console.Console, name: []const u8, r: *gfx.Renderer, t: *sw_text.TextRenderer, ph: f32, pad: f32) !void {
        const th = self.theme;
        const lh = t.lineHeight(th.size);
        var buf: [96]u8 = undefined;
        const title = std.fmt.bufPrint(&buf, "EDIT {s}  -  one command a line, // for a comment  -  Esc saves and closes", .{name}) catch "";
        _ = try t.draw(r, title, pad, 8, .{ .size = th.size, .color = th.accent });
        const e = &con.editor;
        const pos = e.position();
        const rows: usize = @intFromFloat(@max(1, @floor((ph - 16 - lh - 8) / lh)));
        // Keep the cursor line on the screen.
        var top = e.top;
        if (pos.line < top) top = pos.line;
        if (pos.line >= top + rows) top = pos.line + 1 - rows;
        e.top = top;
        var it = std.mem.splitScalar(u8, e.bytes(), '\n');
        var ln: usize = 0;
        const x0 = pad + 34;
        while (it.next()) |l| : (ln += 1) {
            if (ln < top) continue;
            if (ln >= top + rows) break;
            const y = 8 + lh + 6 + lh * @as(f32, @floatFromInt(ln - top));
            var nb: [16]u8 = undefined;
            _ = try t.draw(r, std.fmt.bufPrint(&nb, "{d}", .{ln + 1}) catch "", pad, y, .{ .size = th.size, .color = th.dim });
            _ = try t.draw(r, l, x0, y, .{ .size = th.size, .color = th.text });
            if (ln == pos.line and (self.ticks / 40) % 2 == 0) {
                const cx = x0 + t.measure(l[0..@min(pos.col, l.len)], th.size).w;
                try r.fillRect(.{ .x = cx, .y = y + 1, .w = 2, .h = lh - 2 }, th.accent);
            }
        }
    }
};

/// Draw an input line: the label, the text and a caret.
pub fn drawPrompt(r: *gfx.Renderer, t: *sw_text.TextRenderer, p: *const prompt_mod.Prompt, label: []const u8, x: f32, y: f32, w: f32, th: Theme, caret: bool) !void {
    const lh = t.lineHeight(th.size);
    _ = try t.draw(r, label, x, y, .{ .size = th.size, .color = th.accent });
    const x0 = x + t.measure(label, th.size).w;
    const text = p.edit.text();
    // A long line scrolls: the caret stays in the box.
    const before = t.measure(text[0..p.edit.cursor], th.size).w;
    const room = w - (x0 - x) - 8;
    var shift: f32 = 0;
    var start: usize = 0;
    if (before > room) {
        while (start < p.edit.cursor and before - shift > room) {
            const next = line_mod.nextStart(text, start);
            shift += t.measure(text[start..next], th.size).w;
            start = next;
        }
    }
    _ = try t.draw(r, text[start..], x0, y, .{ .size = th.size, .color = th.text });
    if (caret) try r.fillRect(.{ .x = x0 + before - shift, .y = y + 1, .w = 2, .h = lh - 2 }, th.accent);
}

/// Draw the suggestion list: the name, the current value of a cvar, and
/// the description. `total` is the number of matches (more than the rows
/// shows "+N more").
pub fn drawSuggestions(r: *gfx.Renderer, t: *sw_text.TextRenderer, con: *const console.Console, list: []const complete.Suggestion, total: usize, x: f32, y: f32, w: f32, th: Theme) !void {
    if (list.len == 0) return;
    const lh = t.lineHeight(th.size);
    const more = total > list.len;
    const rows: f32 = @floatFromInt(list.len + @intFromBool(more));
    try r.fillRect(.{ .x = x - 6, .y = y, .w = w + 12, .h = rows * lh + 10 }, th.panel);
    const name_w: f32 = 190;
    const value_w: f32 = 120;
    for (list, 0..) |s, i| {
        const ry = y + 5 + lh * @as(f32, @floatFromInt(i));
        _ = try t.draw(r, s.name, x, ry, .{ .size = th.size, .color = th.accent });
        var vb: [cvar_mod.max_string + 8]u8 = undefined;
        var desc: []const u8 = "";
        var value: []const u8 = "";
        switch (s.kind) {
            .cvar => if (s.cvar) |cv| {
                value = cv.text(&vb);
                desc = cv.def.description;
            },
            .command => if (s.command) |c| {
                value = c.args;
                desc = c.description;
            },
            .key => {
                value = "key";
                desc = if (keys.fromName(s.name)) |k| (con.bindOf(k) orelse "not bound") else "";
            },
            .script => value = "script",
        }
        try drawClipped(t, r, value, x + name_w, ry, value_w - 10, th.size, th.text);
        try drawClipped(t, r, desc, x + name_w + value_w, ry, w - name_w - value_w, th.size, th.dim);
    }
    if (more) {
        var buf: [32]u8 = undefined;
        const s = std.fmt.bufPrint(&buf, "+{d} more", .{total - list.len}) catch "";
        _ = try t.draw(r, s, x, y + 5 + lh * @as(f32, @floatFromInt(list.len)), .{ .size = th.size, .color = th.dim });
    }
}

/// Draw text cut to `max_w`, with "..." at the cut.
fn drawClipped(t: *sw_text.TextRenderer, r: *gfx.Renderer, s: []const u8, x: f32, y: f32, max_w: f32, size: f32, col: gfx.Color) !void {
    if (max_w <= 0) return;
    if (t.measure(s, size).w <= max_w) {
        _ = try t.draw(r, s, x, y, .{ .size = size, .color = col });
        return;
    }
    const dots = "...";
    const room = max_w - t.measure(dots, size).w;
    // Add code points while they fit (one measure each, no kerning).
    var n: usize = 0;
    var used: f32 = 0;
    while (n < s.len) {
        const next = line_mod.nextStart(s, n);
        const cw = t.measure(s[n..next], size).w;
        if (used + cw > room) break;
        used += cw;
        n = next;
    }
    var buf: [256]u8 = undefined;
    const k = @min(n, buf.len - dots.len);
    @memcpy(buf[0..k], s[0..k]);
    @memcpy(buf[k..][0..dots.len], dots);
    _ = try t.draw(r, buf[0 .. k + dots.len], x, y, .{ .size = size, .color = col });
}
