// The completion: the commands, cvars, keys and scripts that match the
// token under the cursor. The suggestion list shows them, and Tab
// completes the token.
//
// Matches that start with the typed text come first, then the matches
// that only hold it (2 or more characters typed). Each group is sorted.
const std = @import("std");
const parse = @import("parse.zig");
const console = @import("console.zig");
const cvar_mod = @import("cvar.zig");
const keys = @import("keys.zig");
const line_mod = @import("line.zig");

pub const Kind = enum { command, cvar, key, script };

pub const Suggestion = struct {
    name: []const u8,
    kind: Kind,
    cvar: ?*const cvar_mod.Cvar = null,
    command: ?*const console.Command = null,
};

/// The token that the completion works on: the last token before the
/// cursor, or a new empty token after a space.
pub const Target = struct {
    /// Where the token starts in the line.
    start: usize,
    text: []const u8,
    /// The index of the token in its command: 0 is the command name.
    index: usize,
    /// Token 0 of the command, or "" when this is token 0.
    command: []const u8,
    /// The token is in quotes: no completion.
    quoted: bool = false,
};

pub fn target(line: []const u8) Target {
    const cs = parse.lastCommandStart(line);
    const cmd = line[cs..];
    const args = parse.Args.parse(cmd);
    const after_space = cmd.len == 0 or parse.isSpace(cmd[cmd.len - 1]);
    if (args.count() == 0 or after_space) {
        return .{ .start = line.len, .text = "", .index = args.count(), .command = args.get(0) };
    }
    const last = args.tokens[args.count() - 1];
    const index = args.count() - 1;
    return .{
        .start = cs + last.start,
        .text = last.text,
        .index = index,
        .command = if (index > 0) args.get(0) else "",
        .quoted = cmd[last.start] == '"',
    };
}

const Collector = struct {
    out: []Suggestion,
    n: usize = 0,
    total: usize = 0,
    typed: []const u8,
    /// 0: the names that start with the typed text. 1: the names that only
    /// hold it.
    pass: u1 = 0,

    fn offer(self: *Collector, s: Suggestion) void {
        const starts = std.ascii.startsWithIgnoreCase(s.name, self.typed);
        const ok = if (self.pass == 0) starts else (!starts and self.typed.len >= 2 and contains(s.name, self.typed));
        if (!ok) return;
        if (self.n < self.out.len) {
            self.out[self.n] = s;
            self.n += 1;
        }
        self.total += 1;
    }
};

fn contains(hay: []const u8, needle: []const u8) bool {
    if (needle.len > hay.len) return false;
    var i: usize = 0;
    while (i + needle.len <= hay.len) : (i += 1) {
        if (std.ascii.eqlIgnoreCase(hay[i..][0..needle.len], needle)) return true;
    }
    return false;
}

fn lessSuggestion(_: void, a: Suggestion, b: Suggestion) bool {
    return std.mem.lessThan(u8, a.name, b.name);
}

const What = packed struct { commands: bool = false, cvars: bool = false, keys: bool = false, scripts: bool = false };

/// What token `t` completes to.
fn what(con: *const console.Console, t: Target) What {
    if (t.quoted) return .{};
    if (t.index == 0) return .{ .commands = true, .cvars = true };
    if (con.findCommand(t.command)) |c| {
        return switch (c.complete) {
            .none => .{},
            .cvar => if (t.index == 1) .{ .cvars = true } else .{},
            .name => if (t.index == 1) .{ .commands = true, .cvars = true } else .{},
            // A key, then the command of the bind.
            .key => if (t.index == 1) .{ .keys = true } else if (t.index == 2) .{ .commands = true } else .{},
            .script => if (t.index == 1) .{ .scripts = true } else .{},
        };
    }
    return .{};
}

fn collect(con: *const console.Console, c: *Collector, w: What) void {
    if (w.commands) for (con.commands.items) |cmd| {
        if (!cmd.hidden) c.offer(.{ .name = cmd.name, .kind = .command, .command = cmd });
    };
    if (w.cvars) for (con.cvars.items) |cv| c.offer(.{ .name = cv.def.name, .kind = .cvar, .cvar = cv });
    if (w.keys) for (keys.all) |k| c.offer(.{ .name = keys.name(k), .kind = .key });
    if (w.scripts) for (con.scripts.items) |s| c.offer(.{ .name = s, .kind = .script });
}

/// The suggestions for `line` (the text before the cursor). It fills `out`
/// and returns the number of matches, which can be more than `out.len`.
/// After a cvar name and a space, the one suggestion is that cvar (its
/// value and description).
pub fn suggest(con: *const console.Console, line: []const u8, out: []Suggestion) usize {
    const t = target(line);
    if (t.index == 1 and t.text.len == 0 and !t.quoted) {
        if (con.findCvar(t.command)) |cv| {
            if (out.len > 0) out[0] = .{ .name = cv.def.name, .kind = .cvar, .cvar = cv };
            return 1;
        }
    }
    if (t.index == 0 and t.text.len == 0) return 0;
    const w = what(con, t);
    var c: Collector = .{ .out = out, .typed = t.text };
    collect(con, &c, w);
    std.mem.sort(Suggestion, out[0..c.n], {}, lessSuggestion);
    const first = c.n;
    c.pass = 1;
    collect(con, &c, w);
    std.mem.sort(Suggestion, out[first..c.n], {}, lessSuggestion);
    return c.total;
}

/// The Tab state: a second Tab on the same matches goes to the next one.
pub const Cycle = struct {
    active: bool = false,
    /// The line before the cursor when the cycle started.
    line: [line_mod.max_len]u8 = undefined,
    len: usize = 0,
    next: usize = 0,
};

/// Tab: complete the token before the cursor of `edit`.
/// - One match: the full name and a space.
/// - More matches with a longer common start: that start.
/// - Else: the first match, and each next Tab the next match.
pub fn tab(con: *const console.Console, edit: *line_mod.LineEdit, cycle: *Cycle) void {
    tabFrom(con, edit, cycle, 0);
}

/// Tab on the text of `edit` after byte `from`: the bytes before it are
/// not part of the command. The chat completes the text after its "/".
pub fn tabFrom(con: *const console.Console, edit: *line_mod.LineEdit, cycle: *Cycle, from: usize) void {
    if (edit.cursor < from) return;
    var buf: [64]Suggestion = undefined;
    if (cycle.active) {
        const before = cycle.line[0..cycle.len];
        const t = target(before);
        const n = matchesForTab(con, before, &buf);
        if (n == 0) return;
        edit.replaceBack(from + t.start, buf[cycle.next % n].name);
        cycle.next = (cycle.next + 1) % n;
        return;
    }
    const before = edit.text()[from..edit.cursor];
    const t = target(before);
    if (t.quoted) return;
    const n = matchesForTab(con, before, &buf);
    if (n == 0) return;
    if (n == 1) {
        var name: [80]u8 = undefined;
        const s = std.fmt.bufPrint(&name, "{s} ", .{buf[0].name}) catch buf[0].name;
        edit.replaceBack(from + t.start, s);
        return;
    }
    var common = buf[0].name.len;
    for (buf[1..n]) |s| {
        var k: usize = 0;
        while (k < common and k < s.name.len and std.ascii.toLower(s.name[k]) == std.ascii.toLower(buf[0].name[k])) k += 1;
        common = k;
    }
    if (common > t.text.len) {
        edit.replaceBack(from + t.start, buf[0].name[0..common]);
        return;
    }
    cycle.active = true;
    cycle.len = before.len;
    @memcpy(cycle.line[0..before.len], before);
    edit.replaceBack(from + t.start, buf[0].name);
    cycle.next = 1 % n;
}

/// The matches that Tab uses: the names that start with the typed text,
/// or the one name that holds it.
fn matchesForTab(con: *const console.Console, before: []const u8, buf: []Suggestion) usize {
    const t = target(before);
    if (t.index == 0 and t.text.len == 0) return 0;
    const w = what(con, t);
    var c: Collector = .{ .out = buf, .typed = t.text };
    collect(con, &c, w);
    std.mem.sort(Suggestion, buf[0..c.n], {}, lessSuggestion);
    if (c.n > 0) return c.n;
    c.pass = 1;
    collect(con, &c, w);
    return if (c.n == 1) 1 else 0;
}
