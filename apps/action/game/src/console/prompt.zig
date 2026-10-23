// A text prompt: the input line, its history and the Tab completion. The
// console panel uses one. The chat (chat.zig) uses another one, with the
// same completion for a line that starts with "/" (complete_from).
//
// It reads the input events of a tick in their order (not the input
// snapshot), so a fast "ab", Enter, "cd", Enter in one frame gives two
// lines, and a held key repeats with the key repeat of the system.
//
// Keys: the typed text goes in at the cursor. Backspace, Left and Right
// edit. Up and Down go through the history (not with Shift: view.zig
// scrolls with Shift+Up and Shift+Down). Tab completes. Enter sends, Esc
// cancels.
const std = @import("std");
const core = @import("sw_core");
const console = @import("console.zig");
const line_mod = @import("line.zig");
const complete = @import("complete.zig");

pub const Event = enum { none, submit, cancel };

/// The key of a key-down event (a system repeat is a key-down too), or
/// null for any other event.
pub fn keyDown(ev: core.Event) ?struct { key: core.KeyCode, mods: core.Modifiers } {
    return switch (ev.payload) {
        .key => |k| if (k.down) .{ .key = k.keycode, .mods = k.mods } else null,
        else => null,
    };
}

/// The committed text of a text event, or null.
pub fn typedText(ev: *const core.Event) ?[]const u8 {
    return switch (ev.payload) {
        .text_input => |*t| t.utf8[0..t.len],
        else => null,
    };
}

pub const Prompt = struct {
    edit: line_mod.LineEdit = .{},
    history: line_mod.History = .{},
    cycle: complete.Cycle = .{},
    sent: [line_mod.max_len]u8 = undefined,
    sent_len: usize = 0,
    /// The completion and the suggestions read the line after this byte.
    /// The chat sets 1 for a line that starts with "/".
    complete_from: usize = 0,

    /// The line of the last `.submit`. It stays until the next submit.
    pub fn submitted(self: *const Prompt) []const u8 {
        return self.sent[0..self.sent_len];
    }

    /// One input event. `con` gives the Tab completion, or null for no
    /// completion.
    pub fn feed(self: *Prompt, con: ?*const console.Console, ev: *const core.Event) Event {
        if (typedText(ev)) |t| {
            self.edit.insert(t);
            self.changed();
            return .none;
        }
        const k = keyDown(ev.*) orelse return .none;
        switch (k.key) {
            .Escape => {
                self.cycle.active = false;
                return .cancel;
            },
            .Enter => {
                const t = self.edit.text();
                @memcpy(self.sent[0..t.len], t);
                self.sent_len = t.len;
                self.history.push(t);
                self.edit.clear();
                self.cycle.active = false;
                return .submit;
            },
            .Tab => if (!k.mods.shift) {
                if (con) |c| complete.tabFrom(c, &self.edit, &self.cycle, self.complete_from);
            },
            .Backspace => {
                self.edit.backspace();
                self.changed();
            },
            .Left => {
                self.edit.left();
                self.changed();
            },
            .Right => {
                self.edit.right();
                self.changed();
            },
            .Up => if (!k.mods.shift) {
                self.history.up(&self.edit);
                self.cycle.active = false;
            },
            .Down => if (!k.mods.shift) {
                self.history.down(&self.edit);
                self.cycle.active = false;
            },
            else => {},
        }
        return .none;
    }

    /// The player changed the line: a Tab starts a new completion, and Up
    /// starts again from the newest line.
    fn changed(self: *Prompt) void {
        self.cycle.active = false;
        self.history.stopBrowsing();
    }

    /// The suggestions for the text before the cursor (complete.suggest),
    /// from `complete_from`.
    pub fn suggestions(self: *const Prompt, con: *const console.Console, out: []complete.Suggestion) usize {
        if (self.edit.cursor < self.complete_from) return 0;
        return complete.suggest(con, self.edit.text()[self.complete_from..self.edit.cursor], out);
    }
};
