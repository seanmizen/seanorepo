// The script editor: the text of one script and a cursor. `edit <name>` in
// the console opens it. No input and no drawing here (view.zig).
const std = @import("std");
const line = @import("line.zig");

pub const max_len = 16 * 1024;

pub const Editor = struct {
    text: std.ArrayList(u8) = .empty,
    /// A byte offset, always at the start of a code point.
    cursor: usize = 0,
    /// The column that Up and Down keep, in bytes.
    want_col: ?usize = null,
    /// The first line on the screen.
    top: usize = 0,

    pub fn deinit(self: *Editor, alloc: std.mem.Allocator) void {
        self.text.deinit(alloc);
    }

    pub fn load(self: *Editor, alloc: std.mem.Allocator, s: []const u8) void {
        self.text.clearRetainingCapacity();
        self.cursor = 0;
        self.want_col = null;
        self.top = 0;
        self.insert(alloc, s);
        self.cursor = 0;
    }

    pub fn bytes(self: *const Editor) []const u8 {
        return self.text.items;
    }

    /// Insert text at the cursor. "\r" and the other control characters
    /// are dropped, a tab becomes a space. Text past `max_len` is dropped.
    pub fn insert(self: *Editor, alloc: std.mem.Allocator, s: []const u8) void {
        for (s) |c0| {
            const c = if (c0 == '\t') ' ' else c0;
            if ((c < 0x20 and c != '\n') or c == 0x7f) continue;
            if (self.text.items.len >= max_len) break;
            self.text.insert(alloc, self.cursor, c) catch return;
            self.cursor += 1;
        }
        // A cut code point at the end of `s` leaves bad bytes: the drawing
        // shows them as U+FFFD.
        self.want_col = null;
    }

    pub fn backspace(self: *Editor) void {
        if (self.cursor == 0) return;
        const p = line.prevStart(self.text.items, self.cursor);
        self.text.replaceRangeAssumeCapacity(p, self.cursor - p, &.{});
        self.cursor = p;
        self.want_col = null;
    }

    pub fn left(self: *Editor) void {
        if (self.cursor > 0) self.cursor = line.prevStart(self.text.items, self.cursor);
        self.want_col = null;
    }

    pub fn right(self: *Editor) void {
        if (self.cursor < self.text.items.len) self.cursor = line.nextStart(self.text.items, self.cursor);
        self.want_col = null;
    }

    pub fn up(self: *Editor) void {
        const ls = lineStart(self.text.items, self.cursor);
        if (ls == 0) return;
        const col = self.want_col orelse self.cursor - ls;
        const prev = lineStart(self.text.items, ls - 1);
        self.cursor = atColumn(self.text.items, prev, col);
        self.want_col = col;
    }

    pub fn down(self: *Editor) void {
        const ls = lineStart(self.text.items, self.cursor);
        const le = std.mem.indexOfScalarPos(u8, self.text.items, self.cursor, '\n') orelse return;
        const col = self.want_col orelse self.cursor - ls;
        self.cursor = atColumn(self.text.items, le + 1, col);
        self.want_col = col;
    }

    /// The line and the column (in bytes) of the cursor, from 0.
    pub fn position(self: *const Editor) struct { line: usize, col: usize } {
        const before = self.text.items[0..self.cursor];
        const ls = lineStart(self.text.items, self.cursor);
        return .{ .line = std.mem.count(u8, before, "\n"), .col = self.cursor - ls };
    }

    pub fn lineCount(self: *const Editor) usize {
        return std.mem.count(u8, self.text.items, "\n") + 1;
    }
};

fn lineStart(s: []const u8, i: usize) usize {
    const nl = std.mem.lastIndexOfScalar(u8, s[0..i], '\n') orelse return 0;
    return nl + 1;
}

/// The offset of column `col` in the line that starts at `start`, or the
/// end of that line when it is shorter. Never inside a code point.
fn atColumn(s: []const u8, start: usize, col: usize) usize {
    const le = std.mem.indexOfScalarPos(u8, s, start, '\n') orelse s.len;
    var p = @min(start + col, le);
    while (p > start and p < s.len and (s[p] & 0xC0) == 0x80) p -= 1;
    return p;
}
