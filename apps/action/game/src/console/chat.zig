// The chat: the message log, the fade, and the chat input line. The game
// gives it a send function (send_fn) and the messages of the server (add).
// The chat adds the cvar chat_fade_seconds and the commands messagemode,
// messagemode2, say and say_team. A bind opens the input line, for
// example "bind y messagemode".
//
// The input line is a Prompt (prompt.zig) with its own history. A line
// that starts with "/" runs as a console command, with the suggestions and
// the Tab completion of the console. The output of the command shows in
// the chat, and all of it is in the console. Other lines go to send_fn.
// The chat shows a message only when the server sends it back, so the
// sender sees the same text as the other players.
//
// While the input line is open, the binds do not run (Console.setTyping).
// The game must start text input, give the chat the input events of each
// tick (update), and keep the keys from the game.
//
// This file imports nothing from a game. It needs std and sw_core.
// chat_view.zig draws the chat.
const std = @import("std");
const core = @import("sw_core");
const console_mod = @import("console.zig");
const cvar_mod = @import("cvar.zig");
const parse = @import("parse.zig");
const prompt_mod = @import("prompt.zig");
const line_mod = @import("line.zig");
const complete = @import("complete.zig");

const Console = console_mod.Console;

/// Who gets a message.
pub const Channel = enum { all, team };

/// The source of a line of the log.
pub const Kind = enum {
    /// A message to all players.
    all,
    /// A message to the team of the sender.
    team,
    /// A line of the server: a join, a leave, a match start or end, an error.
    server,
    /// A line of this game only: the output of a "/" command.
    local,
    /// An error of this game only, for example "no server".
    err,
};

pub const max_name = 32;
pub const max_text = line_mod.max_len;
/// A "/" command shows at most this many lines of its output in the chat.
pub const max_output_lines = 8;
/// A line fades out in the last second of chat_fade_seconds.
pub const fade_out_seconds: f32 = 1;

pub const Message = struct {
    kind: Kind = .all,
    name_buf: [max_name]u8 = undefined,
    name_len: usize = 0,
    text_buf: [max_text]u8 = undefined,
    text_len: usize = 0,
    /// The colour of the name, or null for the colour of the kind.
    rgb: ?[3]u8 = null,
    /// Seconds since the line came.
    age: f32 = 0,

    pub fn name(self: *const Message) []const u8 {
        return self.name_buf[0..self.name_len];
    }

    pub fn text(self: *const Message) []const u8 {
        return self.text_buf[0..self.text_len];
    }
};

/// A new line for the log. Text that is too long is cut on a code point
/// boundary.
pub const Line = struct {
    kind: Kind = .all,
    name: []const u8 = "",
    text: []const u8,
    rgb: ?[3]u8 = null,
};

/// The lines of the chat, newest last.
pub const Log = struct {
    pub const size = 64;
    items: [size]Message = undefined,
    total: usize = 0,

    pub fn push(self: *Log, l: Line) void {
        const m = &self.items[self.total % size];
        m.* = .{ .kind = l.kind, .rgb = l.rgb };
        m.name_len = line_mod.cut(l.name, max_name);
        @memcpy(m.name_buf[0..m.name_len], l.name[0..m.name_len]);
        m.text_len = line_mod.cut(l.text, max_text);
        @memcpy(m.text_buf[0..m.text_len], l.text[0..m.text_len]);
        self.total += 1;
    }

    pub fn count(self: *const Log) usize {
        return @min(self.total, size);
    }

    /// Line i, from 0 (the newest).
    pub fn get(self: *const Log, i: usize) *const Message {
        return &self.items[(self.total - 1 - i) % size];
    }

    pub fn tick(self: *Log, dt: f32) void {
        for (self.items[0..self.count()]) |*m| m.age = @min(m.age + dt, 1e6);
    }
};

/// Send a chat message. Returns null when it went, or the error for the
/// player ("no server").
pub const SendFn = *const fn (ctx: ?*anyopaque, channel: Channel, text: []const u8) ?[]const u8;

pub const Chat = struct {
    log: Log = .{},
    prompt: prompt_mod.Prompt = .{},
    /// The channel of the open input line, or null when it is closed.
    channel: ?Channel = null,
    /// The log lines above the newest that the player scrolled back.
    scroll: usize = 0,
    /// chat_fade_seconds (register).
    fade: ?*const cvar_mod.Cvar = null,
    /// The longest message in bytes: a cvar (the server sends it), or null
    /// for max_text.
    limit: ?*const cvar_mod.Cvar = null,
    send_fn: ?SendFn = null,
    send_ctx: ?*anyopaque = null,

    /// Add the cvar and the commands. The chat must stay at this address.
    pub fn register(self: *Chat, con: *Console) !void {
        self.fade = try con.addCvar(.{
            .name = "chat_fade_seconds",
            .default = .{ .float = 10 },
            .min = 1,
            .max = 120,
            .flags = .{ .saved = true },
            .description = "Seconds that a chat line shows. It fades out in its last second. While the chat input is open, the recent lines show.",
            .reader = "console/chat.zig Chat.alpha",
        });
        const cmds = [_]console_mod.Command{
            .{ .name = "messagemode", .args = "[text]", .description = "Open the chat input: a message to all players. The line starts with the text: messagemode / starts a command.", .handler = cmdMessagemode, .ctx = self, .data = 0 },
            .{ .name = "messagemode2", .args = "[text]", .description = "Open the chat input: a message to your team.", .handler = cmdMessagemode, .ctx = self, .data = 1 },
            .{ .name = "say", .args = "<text>", .description = "Send a chat message to all players.", .handler = cmdSay, .ctx = self, .data = 0 },
            .{ .name = "say_team", .args = "<text>", .description = "Send a chat message to your team.", .handler = cmdSay, .ctx = self, .data = 1 },
        };
        for (cmds) |c| try con.addCommand(c);
    }

    pub fn isOpen(self: *const Chat) bool {
        return self.channel != null;
    }

    /// The input line is a console command: it starts with "/".
    pub fn isCommand(self: *const Chat) bool {
        const t = self.prompt.edit.text();
        return t.len > 0 and t[0] == '/';
    }

    /// The suggestions of the console for a "/" line (complete.suggest).
    /// A chat line has none.
    pub fn suggestions(self: *const Chat, con: *const Console, out: []complete.Suggestion) usize {
        // The cursor can be before the "/".
        if (!self.isCommand() or self.prompt.edit.cursor == 0) return 0;
        return complete.suggest(con, self.prompt.edit.text()[1..self.prompt.edit.cursor], out);
    }

    /// The longest message in bytes.
    pub fn maxLen(self: *const Chat) usize {
        const c = self.limit orelse return max_text;
        return @intCast(std.math.clamp(c.int(), 1, max_text));
    }

    /// Open the input line with `text` in it. The console panel closes, and
    /// the keys that a bind holds let go.
    pub fn open(self: *Chat, con: *Console, channel: Channel, text: []const u8) void {
        con.setOpen(false);
        self.channel = channel;
        self.scroll = 0;
        self.prompt.edit.limit = line_mod.max_len;
        self.prompt.edit.set(text);
        self.prompt.cycle.active = false;
        self.prompt.history.stopBrowsing();
        con.setTyping(true);
    }

    pub fn close(self: *Chat, con: *Console) void {
        self.channel = null;
        self.scroll = 0;
        self.prompt.edit.clear();
        self.prompt.cycle.active = false;
        con.setTyping(false);
    }

    /// The input events of one tick, in order, while the input line is
    /// open. Enter sends the line, Esc closes it. Shift+Up and Shift+Down
    /// scroll the log.
    pub fn update(self: *Chat, con: *Console, events: []const core.Event) void {
        for (events) |*ev| {
            const ch = self.channel orelse return;
            if (prompt_mod.keyDown(ev.*)) |k| if (k.mods.shift and (k.key == .Up or k.key == .Down)) {
                if (k.key == .Up) {
                    self.scroll = @min(self.scroll + 3, self.log.count() -| 1);
                } else self.scroll -|= 3;
                continue;
            };
            // A "/" line completes as a command, and it can be as long as a
            // console line.
            const cmd = self.isCommand();
            self.prompt.complete_from = @intFromBool(cmd);
            self.prompt.edit.limit = if (cmd) line_mod.max_len else self.maxLen();
            switch (self.prompt.feed(if (cmd) con else null, ev)) {
                .submit => {
                    // A copy: the command can open the chat again.
                    var buf: [line_mod.max_len]u8 = undefined;
                    const s = self.prompt.submitted();
                    @memcpy(buf[0..s.len], s);
                    self.close(con);
                    self.submit(con, ch, buf[0..s.len]);
                },
                .cancel => self.close(con),
                .none => {},
            }
        }
    }

    /// A line of the input: a "/" line runs as a console command, other
    /// text goes to the channel.
    pub fn submit(self: *Chat, con: *Console, channel: Channel, line: []const u8) void {
        const text = std.mem.trim(u8, line, " ");
        if (text.len == 0) return;
        if (text[0] == '/') return self.runCommand(con, text[1..]);
        if (self.send(channel, text)) |err| self.add(.{ .kind = .err, .text = err });
    }

    /// Send a message. Returns null when it went, or the error.
    pub fn send(self: *Chat, channel: Channel, text: []const u8) ?[]const u8 {
        const f = self.send_fn orelse return "chat: no server";
        return f(self.send_ctx, channel, text);
    }

    /// Run a console command, and copy its output to the log: at most
    /// max_output_lines lines.
    fn runCommand(self: *Chat, con: *Console, cmd: []const u8) void {
        if (std.mem.trim(u8, cmd, " ").len == 0) return;
        const before = con.out.total;
        con.submit(cmd);
        const new = @min(con.out.total -| before, con.out.count());
        // The oldest new line first.
        var i = new;
        var shown: usize = 0;
        while (i > 0) : (i -= 1) {
            if (shown + 1 == max_output_lines and i > 1) {
                var buf: [64]u8 = undefined;
                const more = std.fmt.bufPrint(&buf, "+{d} more lines in the console", .{i}) catch "";
                self.add(.{ .kind = .local, .text = more });
                break;
            }
            const l = con.out.get(i - 1);
            self.add(.{ .kind = if (l.kind == .err) .err else .local, .text = l.text });
            shown += 1;
        }
    }

    /// Add a line to the log: a message of the server, or a local line.
    pub fn add(self: *Chat, l: Line) void {
        self.log.push(l);
        // A player who scrolled back keeps the same lines on the screen.
        if (self.scroll > 0) self.scroll = @min(self.scroll + 1, self.log.count() -| 1);
    }

    /// Call once a tick: the lines get older.
    pub fn tick(self: *Chat, dt: f32) void {
        self.log.tick(dt);
    }

    /// How much line `m` shows, 0 to 1. While the input line is open: 1.
    /// Else 1, and it fades out to 0 in the last second of
    /// chat_fade_seconds.
    pub fn alpha(self: *const Chat, m: *const Message) f32 {
        if (self.isOpen()) return 1;
        const life = if (self.fade) |c| c.float() else 10;
        return std.math.clamp((life - m.age) / fade_out_seconds, 0, 1);
    }
};

fn chatOf(cmd: *const console_mod.Command) *Chat {
    return @ptrCast(@alignCast(cmd.ctx.?));
}

fn channelOf(cmd: *const console_mod.Command) Channel {
    return if (cmd.data == 1) .team else .all;
}

/// One argument: its text with no quotes. More: the rest of the command.
fn argText(args: *const parse.Args) []const u8 {
    return if (args.count() == 2) args.get(1) else args.rest(1);
}

fn cmdMessagemode(con: *Console, cmd: *const console_mod.Command, args: *const parse.Args) void {
    chatOf(cmd).open(con, channelOf(cmd), argText(args));
}

fn cmdSay(con: *Console, cmd: *const console_mod.Command, args: *const parse.Args) void {
    if (args.count() < 2) return con.printErr("usage: {s} {s}", .{ cmd.name, cmd.args });
    if (chatOf(cmd).send(channelOf(cmd), argText(args))) |err| con.printErr("{s}", .{err});
}
