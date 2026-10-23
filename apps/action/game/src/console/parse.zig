// The command line grammar of the console. The server has the same grammar
// (apps/action/server/console.ts), and parse_cases.json holds the cases
// that both test.
//
// - A script is lines. A line ends at "\n". A "\r" before it is dropped.
// - ";" ends a command. "//" starts a comment to the end of the line.
// - A token ends at a space, a tab or a double quote. A token in double
//   quotes can hold spaces, ";" and "//". There is no escape character, so
//   a token cannot hold a double quote. A quote with no end runs to the
//   end of the line.
const std = @import("std");

/// The tokens of one command after this many are dropped. `Args.rest`
/// still has their text.
pub const max_tokens = 32;

/// One command of a script: its text (with no space at the ends) and the
/// number of its line, from 1.
pub const Command = struct { text: []const u8, line: usize };

/// The commands of a script, in order. Empty commands are skipped.
pub const Commands = struct {
    src: []const u8,
    pos: usize = 0,
    line: usize = 1,

    pub fn init(src: []const u8) Commands {
        return .{ .src = src };
    }

    pub fn next(self: *Commands) ?Command {
        while (self.pos < self.src.len) {
            const start = self.pos;
            const line = self.line;
            var end = self.src.len;
            var next_pos = self.src.len;
            var quoted = false;
            var i = start;
            while (i < self.src.len) : (i += 1) {
                const c = self.src[i];
                if (c == '\n') {
                    end = i;
                    next_pos = i + 1;
                    self.line += 1;
                    break;
                }
                if (c == '"') {
                    quoted = !quoted;
                    continue;
                }
                if (quoted) continue;
                if (c == ';') {
                    end = i;
                    next_pos = i + 1;
                    break;
                }
                if (c == '/' and i + 1 < self.src.len and self.src[i + 1] == '/') {
                    end = i;
                    const nl = std.mem.indexOfScalarPos(u8, self.src, i, '\n');
                    if (nl) |n| {
                        next_pos = n + 1;
                        self.line += 1;
                    }
                    break;
                }
            }
            self.pos = next_pos;
            const text = std.mem.trim(u8, self.src[start..end], " \t\r");
            if (text.len > 0) return .{ .text = text, .line = line };
        }
        return null;
    }
};

/// A token: its text (with no quotes), and where it starts and ends in the
/// command (with the quotes).
pub const Token = struct { text: []const u8, start: usize, end: usize };

/// The tokens of one command. Token 0 is the command name.
pub const Args = struct {
    cmd: []const u8 = "",
    tokens: [max_tokens]Token = undefined,
    n: usize = 0,

    pub fn parse(cmd: []const u8) Args {
        var a: Args = .{ .cmd = cmd };
        var i: usize = 0;
        while (i < cmd.len and a.n < max_tokens) {
            const c = cmd[i];
            if (isSpace(c)) {
                i += 1;
                continue;
            }
            if (c == '"') {
                const s = i + 1;
                const e = std.mem.indexOfScalarPos(u8, cmd, s, '"') orelse cmd.len;
                a.tokens[a.n] = .{ .text = cmd[s..e], .start = i, .end = @min(e + 1, cmd.len) };
                i = e + 1;
            } else {
                var e = i;
                while (e < cmd.len and !isSpace(cmd[e]) and cmd[e] != '"') e += 1;
                a.tokens[a.n] = .{ .text = cmd[i..e], .start = i, .end = e };
                i = e;
            }
            a.n += 1;
        }
        return a;
    }

    /// The number of tokens, with the command name.
    pub fn count(self: *const Args) usize {
        return self.n;
    }

    /// Token i, or "" past the last token.
    pub fn get(self: *const Args, i: usize) []const u8 {
        return if (i < self.n) self.tokens[i].text else "";
    }

    /// The text of the command from token i to the end, with its quotes.
    /// "" past the last token.
    pub fn rest(self: *const Args, i: usize) []const u8 {
        if (i >= self.n) return "";
        return std.mem.trimEnd(u8, self.cmd[self.tokens[i].start..], " \t\r");
    }
};

pub fn isSpace(c: u8) bool {
    return c == ' ' or c == '\t' or c == '\r';
}

/// Where the command at the end of `line` starts: after the last ";" that
/// is not in quotes. The completion reads the command under the cursor.
pub fn lastCommandStart(line: []const u8) usize {
    var quoted = false;
    var start: usize = 0;
    for (line, 0..) |c, i| {
        if (c == '"') quoted = !quoted;
        if (!quoted and c == ';') start = i + 1;
    }
    return start;
}

/// True when `text` can go in a script as one token: in quotes, it must
/// hold no double quote, no new line and no control character.
pub fn quotable(text: []const u8) bool {
    for (text) |c| {
        if (c == '"' or c < 0x20 or c == 0x7f) return false;
    }
    return true;
}
