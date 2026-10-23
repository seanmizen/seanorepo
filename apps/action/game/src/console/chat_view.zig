// Draw the chat (chat.zig) with sw_gfx2d and sw_text: the recent lines,
// newest at the bottom, and the input line under them while it is open. A
// "/" command line also shows the suggestion list of the console.
//
// While the input line is closed, a line shows until it fades
// (Chat.alpha). While it is open, the recent lines show, faded or not.
const std = @import("std");
const gfx = @import("sw_gfx2d");
const sw_text = @import("sw_text");
const console = @import("console.zig");
const chat_mod = @import("chat.zig");
const view = @import("view.zig");
const complete = @import("complete.zig");

pub const ChatView = struct {
    theme: view.Theme = .{ .size = 16 },
    /// The most log lines that show while the input line is closed.
    lines_closed: usize = 6,
    /// The most log lines that show while the input line is open.
    lines_open: usize = 12,
    frames: u32 = 0,

    /// Draw the chat in the column from `x`, `w` wide. The input line is at
    /// the bottom, and the log goes up from it, no higher than `top`.
    pub fn draw(self: *ChatView, chat: *const chat_mod.Chat, con: *const console.Console, r: *gfx.Renderer, t: *sw_text.TextRenderer, x: f32, top: f32, bottom: f32, w: f32) !void {
        self.frames +%= 1;
        const th = self.theme;
        const lh = t.lineHeight(th.size);
        var y = bottom;
        if (chat.channel) |ch| {
            y -= lh + 8;
            try r.fillRect(.{ .x = x - 8, .y = y - 4, .w = w + 16, .h = lh + 8 }, th.panel);
            const label = if (chat.isCommand()) "CONSOLE: " else switch (ch) {
                .all => "SAY: ",
                .team => "SAY TEAM: ",
            };
            const caret = (self.frames / 30) % 2 == 0;
            try view.drawPrompt(r, t, &chat.prompt, label, x, y, w, th, caret);
            if (chat.scroll > 0) {
                var buf: [48]u8 = undefined;
                const s = std.fmt.bufPrint(&buf, "{d} lines down - Shift+Down", .{chat.scroll}) catch "";
                const sw = t.measure(s, th.size - 3).w;
                _ = try t.draw(r, s, x + w - sw, y - lh - 2, .{ .size = th.size - 3, .color = th.dim });
            }
            if (chat.isCommand()) {
                var list: [view.max_suggestions]complete.Suggestion = undefined;
                const total = chat.suggestions(con, &list);
                try view.drawSuggestions(r, t, con, list[0..@min(total, list.len)], total, x, y + lh + 10, @max(w, 640), th);
            }
            y -= 6;
        }
        const open = chat.isOpen();
        const max_lines = if (open) self.lines_open else self.lines_closed;
        var i: usize = if (open) chat.scroll else 0;
        var shown: usize = 0;
        while (shown < max_lines and i < chat.log.count()) : (i += 1) {
            const m = chat.log.get(i);
            const a = chat.alpha(m);
            // The older lines are older still: they faded too.
            if (a <= 0) break;
            var pb: [chat_mod.max_name + 16]u8 = undefined;
            const prefix = prefixText(&pb, m);
            const pw = t.measure(prefix, th.size).w;
            const room = @max(40, w - pw);
            const size = try t.measureWrapped(m.text(), th.size, room);
            const hh = @max(lh, size.h);
            if (y - hh - 4 < top) break;
            y -= hh + 4;
            try r.fillRect(.{ .x = x - 6, .y = y - 2, .w = pw + size.w + 12, .h = hh + 4 }, fade(th.panel, a));
            if (prefix.len > 0) _ = try t.draw(r, prefix, x, y, .{ .size = th.size, .color = fade(nameColor(th, m), a) });
            _ = try t.drawWrapped(r, m.text(), x + pw, y, room, .{ .size = th.size, .color = fade(textColor(th, m.kind), a) });
            shown += 1;
        }
    }
};

/// "Name: " for a message to all, "(TEAM) Name: " for a team message, and
/// nothing for the other lines.
fn prefixText(buf: []u8, m: *const chat_mod.Message) []const u8 {
    return switch (m.kind) {
        .all => std.fmt.bufPrint(buf, "{s}: ", .{m.name()}) catch "",
        .team => std.fmt.bufPrint(buf, "(TEAM) {s}: ", .{m.name()}) catch "",
        .server, .local, .err => "",
    };
}

const team_color = gfx.Color.rgba8(120, 200, 255, 255);
const server_color = gfx.Color.rgba8(255, 214, 120, 255);

fn nameColor(th: view.Theme, m: *const chat_mod.Message) gfx.Color {
    if (m.rgb) |c| return gfx.Color.rgba8(c[0], c[1], c[2], 255);
    return if (m.kind == .team) team_color else th.accent;
}

fn textColor(th: view.Theme, k: chat_mod.Kind) gfx.Color {
    return switch (k) {
        .all => th.text,
        .team => team_color,
        .server => server_color,
        .local => th.dim,
        .err => th.err,
    };
}

fn fade(c: gfx.Color, a: f32) gfx.Color {
    var out = c;
    out.a *= a;
    return out;
}
