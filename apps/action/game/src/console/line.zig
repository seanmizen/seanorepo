// The input line of the console (and of the chat later): the text, the
// cursor, and the history of the lines that the player sent. No input
// and no drawing here (prompt.zig and view.zig).
const std = @import("std");

pub const max_len = 240;

pub const LineEdit = struct {
    buf: [max_len]u8 = undefined,
    len: usize = 0,
    /// A byte offset, always at the start of a code point.
    cursor: usize = 0,

    pub fn text(self: *const LineEdit) []const u8 {
        return self.buf[0..self.len];
    }

    pub fn set(self: *LineEdit, s: []const u8) void {
        const n = cut(s, max_len);
        @memcpy(self.buf[0..n], s[0..n]);
        self.len = n;
        self.cursor = n;
    }

    pub fn clear(self: *LineEdit) void {
        self.len = 0;
        self.cursor = 0;
    }

    /// Insert text at the cursor. Control characters are dropped. Text that
    /// does not fit is dropped on a code point boundary.
    pub fn insert(self: *LineEdit, s: []const u8) void {
        var clean: [max_len]u8 = undefined;
        var n: usize = 0;
        for (s) |c| {
            if (c < 0x20 or c == 0x7f) continue;
            if (n == clean.len) break;
            clean[n] = c;
            n += 1;
        }
        n = cut(clean[0..n], max_len - self.len);
        if (n == 0) return;
        std.mem.copyBackwards(u8, self.buf[self.cursor + n .. self.len + n], self.buf[self.cursor..self.len]);
        @memcpy(self.buf[self.cursor..][0..n], clean[0..n]);
        self.len += n;
        self.cursor += n;
    }

    /// Replace the bytes from `start` to the cursor with `s`. The cursor goes
    /// to the end of `s`. The Tab completion uses it.
    pub fn replaceBack(self: *LineEdit, start: usize, s: []const u8) void {
        const tail_len = self.len - self.cursor;
        var tail: [max_len]u8 = undefined;
        @memcpy(tail[0..tail_len], self.buf[self.cursor..self.len]);
        self.len = start;
        self.cursor = start;
        self.insert(s);
        const n = cut(tail[0..tail_len], max_len - self.len);
        @memcpy(self.buf[self.len..][0..n], tail[0..n]);
        self.len += n;
    }

    pub fn backspace(self: *LineEdit) void {
        if (self.cursor == 0) return;
        const p = prevStart(self.text(), self.cursor);
        std.mem.copyForwards(u8, self.buf[p .. self.len - (self.cursor - p)], self.buf[self.cursor..self.len]);
        self.len -= self.cursor - p;
        self.cursor = p;
    }

    pub fn left(self: *LineEdit) void {
        if (self.cursor > 0) self.cursor = prevStart(self.text(), self.cursor);
    }

    pub fn right(self: *LineEdit) void {
        if (self.cursor < self.len) self.cursor = nextStart(self.text(), self.cursor);
    }

    pub fn home(self: *LineEdit) void {
        self.cursor = 0;
    }

    pub fn end(self: *LineEdit) void {
        self.cursor = self.len;
    }
};

/// The start of the code point before `i`.
pub fn prevStart(s: []const u8, i: usize) usize {
    var p = i - 1;
    while (p > 0 and (s[p] & 0xC0) == 0x80) p -= 1;
    return p;
}

/// The start of the code point after the one at `i`.
pub fn nextStart(s: []const u8, i: usize) usize {
    var p = i + 1;
    while (p < s.len and (s[p] & 0xC0) == 0x80) p += 1;
    return p;
}

/// The length of the longest start of `s` that is at most `max` bytes and
/// ends on a code point boundary.
pub fn cut(s: []const u8, max: usize) usize {
    if (s.len <= max) return s.len;
    var n = max;
    while (n > 0 and (s[n] & 0xC0) == 0x80) n -= 1;
    return n;
}

/// The lines that the player sent, newest last. Up goes back, Down goes
/// forward. The line that the player typed before Up comes back after the
/// newest line.
pub const History = struct {
    pub const size = 64;
    lines: [size][max_len]u8 = undefined,
    lens: [size]usize = @splat(0),
    /// The number of lines, at most `size`.
    n: usize = 0,
    /// The oldest line.
    first: usize = 0,
    /// The line that Up and Down show: 0 is the newest, n is the line that
    /// the player was typing.
    pos: usize = 0,
    /// True while Up and Down show a line of the history.
    browsing: bool = false,
    draft: LineEdit = .{},

    pub fn get(self: *const History, i_from_newest: usize) []const u8 {
        const k = (self.first + self.n - 1 - i_from_newest) % size;
        return self.lines[k][0..self.lens[k]];
    }

    /// Add a sent line. An empty line and a copy of the newest line are not
    /// added. The browse position goes back to the draft.
    pub fn push(self: *History, s: []const u8) void {
        self.pos = 0;
        self.browsing = false;
        if (s.len == 0) return;
        if (self.n > 0 and std.mem.eql(u8, self.get(0), s)) return;
        const k = (self.first + self.n) % size;
        const n = cut(s, max_len);
        @memcpy(self.lines[k][0..n], s[0..n]);
        self.lens[k] = n;
        if (self.n < size) self.n += 1 else self.first = (self.first + 1) % size;
    }

    /// Up: put the next older line in `edit`.
    pub fn up(self: *History, edit: *LineEdit) void {
        if (self.n == 0) return;
        if (!self.browsing) {
            self.draft = edit.*;
            self.browsing = true;
            self.pos = 0;
        } else if (self.pos + 1 < self.n) {
            self.pos += 1;
        }
        edit.set(self.get(self.pos));
    }

    /// Down: put the next newer line in `edit`, then the draft.
    pub fn down(self: *History, edit: *LineEdit) void {
        if (!self.browsing) return;
        if (self.pos == 0) {
            self.browsing = false;
            edit.* = self.draft;
            return;
        }
        self.pos -= 1;
        edit.set(self.get(self.pos));
    }

    /// The player changed the line: the next Up starts again from the newest.
    pub fn stopBrowsing(self: *History) void {
        self.browsing = false;
    }
};
