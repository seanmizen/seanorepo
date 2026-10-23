// Config variables (cvars): a name, a type, a default, a description, the
// code that reads it, flags, and a min and a max for the numbers.
//
// The text form of a value is the same on the client and the server
// (apps/action/server/console.ts): a bool is 1 or 0, an int has no
// decimal point, a float has at most 4 decimals.
const std = @import("std");
const parse = @import("parse.zig");

pub const Type = enum { bool, int, float, string };

pub const Value = union(Type) {
    bool: bool,
    int: i64,
    float: f64,
    string: []const u8,
};

pub const Flags = packed struct(u8) {
    /// Kept in local storage (the saved config) when it is not the default.
    saved: bool = false,
    /// The server owns it. A client gets the value from the server and
    /// cannot change it.
    server: bool = false,
    /// Changes only while cheats are on (`Console.cheats`, debug builds).
    cheat: bool = false,
    /// Only the game code changes it, never a command.
    read_only: bool = false,
    /// The value never shows in a list and never goes to a client (a
    /// password).
    protected: bool = false,
    _pad: u3 = 0,
};

/// The definition of a cvar. The type is the type of the default.
pub const Def = struct {
    /// Lower case: a to z, 0 to 9 and "_".
    name: []const u8,
    default: Value,
    /// The limits of an int or a float. A set clamps to them.
    min: ?f64 = null,
    max: ?f64 = null,
    flags: Flags = .{},
    description: []const u8,
    /// The code that reads the value, for example "main.zig playerView".
    reader: []const u8,

    pub fn kind(self: *const Def) Type {
        return std.meta.activeTag(self.default);
    }
};

/// The longest string value, in bytes.
pub const max_string = 200;

pub const Cvar = struct {
    def: Def,
    /// The value. For a string, `str` holds the bytes.
    value: Value,
    str_buf: [max_string]u8 = undefined,
    str_len: usize = 0,

    pub fn init(def: Def) Cvar {
        var c: Cvar = .{ .def = def, .value = def.default };
        c.assign(def.default);
        return c;
    }

    /// Store a value that passed `parseText` or `check`.
    pub fn assign(self: *Cvar, v: Value) void {
        switch (v) {
            .string => |s| {
                const n = @min(s.len, max_string);
                // The source can be this buffer (a reset copies the default).
                std.mem.copyForwards(u8, self.str_buf[0..n], s[0..n]);
                self.str_len = n;
                self.value = .{ .string = "" };
            },
            else => self.value = v,
        }
    }

    pub fn current(self: *const Cvar) Value {
        return switch (self.value) {
            .string => .{ .string = self.str_buf[0..self.str_len] },
            else => self.value,
        };
    }

    pub fn float(self: *const Cvar) f32 {
        return switch (self.value) {
            .float => |f| @floatCast(f),
            .int => |i| @floatFromInt(i),
            .bool => |b| if (b) 1 else 0,
            .string => 0,
        };
    }

    pub fn int(self: *const Cvar) i64 {
        return switch (self.value) {
            .int => |i| i,
            .float => |f| @intFromFloat(std.math.clamp(@round(f), -9e18, 9e18)),
            .bool => |b| @intFromBool(b),
            .string => 0,
        };
    }

    pub fn on(self: *const Cvar) bool {
        return switch (self.value) {
            .bool => |b| b,
            .int => |i| i != 0,
            .float => |f| f != 0,
            .string => self.str_len > 0,
        };
    }

    pub fn string(self: *const Cvar) []const u8 {
        return self.str_buf[0..self.str_len];
    }

    pub fn isDefault(self: *const Cvar) bool {
        return eql(self.current(), self.def.default);
    }

    /// The text form of the value. A protected value shows as "(hidden)".
    pub fn text(self: *const Cvar, buf: []u8) []const u8 {
        if (self.def.flags.protected) return if (self.str_len == 0) "" else "(hidden)";
        return format(buf, self.current());
    }
};

pub fn eql(a: Value, b: Value) bool {
    if (std.meta.activeTag(a) != std.meta.activeTag(b)) return false;
    return switch (a) {
        .bool => |x| x == b.bool,
        .int => |x| x == b.int,
        .float => |x| x == b.float,
        .string => |x| std.mem.eql(u8, x, b.string),
    };
}

/// The text form of a value.
pub fn format(buf: []u8, v: Value) []const u8 {
    return switch (v) {
        .bool => |b| if (b) "1" else "0",
        .int => |i| std.fmt.bufPrint(buf, "{d}", .{i}) catch "",
        .float => |f| formatFloat(buf, f),
        .string => |s| s,
    };
}

fn formatFloat(buf: []u8, f: f64) []const u8 {
    // Round to 4 decimals, then drop the zeros at the end: 0.30000000000000004
    // shows as 0.3 and 74.0 as 74.
    const r = @round(f * 10000) / 10000;
    if (r == 0) return "0";
    var s: []const u8 = std.fmt.bufPrint(buf, "{d:.4}", .{r}) catch return "";
    if (std.mem.indexOfScalar(u8, s, '.') != null) {
        s = std.mem.trimEnd(u8, s, "0");
        s = std.mem.trimEnd(u8, s, ".");
    }
    return s;
}

pub const ParseError = error{BadValue};

pub const Parsed = struct {
    value: Value,
    /// The value was out of the limits and is now at a limit (or a string
    /// was too long and is now shorter).
    clamped: bool = false,
};

/// Read `text` as a value of the type of `def`, in its limits.
pub fn parseText(def: *const Def, text: []const u8) ParseError!Parsed {
    return switch (def.kind()) {
        .bool => .{ .value = .{ .bool = try parseBool(text) } },
        .int => {
            const i = std.fmt.parseInt(i64, text, 10) catch return error.BadValue;
            return check(def, .{ .int = i });
        },
        .float => {
            const f = std.fmt.parseFloat(f64, text) catch return error.BadValue;
            return check(def, .{ .float = f });
        },
        .string => check(def, .{ .string = text }),
    };
}

/// Check a value against the type and the limits of `def`. A number out of
/// the limits is clamped.
pub fn check(def: *const Def, v: Value) ParseError!Parsed {
    if (std.meta.activeTag(v) != def.kind()) return error.BadValue;
    switch (v) {
        .bool => return .{ .value = v },
        .int => |i| {
            var x = i;
            if (def.min) |m| x = @max(x, @as(i64, @intFromFloat(@ceil(m))));
            if (def.max) |m| x = @min(x, @as(i64, @intFromFloat(@floor(m))));
            return .{ .value = .{ .int = x }, .clamped = x != i };
        },
        .float => |f| {
            if (!std.math.isFinite(f)) return error.BadValue;
            var x = f;
            if (def.min) |m| x = @max(x, m);
            if (def.max) |m| x = @min(x, m);
            return .{ .value = .{ .float = x }, .clamped = x != f };
        },
        .string => |s| {
            for (s) |c| {
                if (c < 0x20 or c == 0x7f or c == '"') return error.BadValue;
            }
            // Cut a long string on a code point boundary.
            var n = @min(s.len, max_string);
            while (n < s.len and n > 0 and (s[n] & 0xC0) == 0x80) n -= 1;
            return .{ .value = .{ .string = s[0..n] }, .clamped = n != s.len };
        },
    }
}

pub fn parseBool(text: []const u8) ParseError!bool {
    const yes = [_][]const u8{ "1", "true", "on", "yes" };
    const no = [_][]const u8{ "0", "false", "off", "no" };
    for (yes) |w| if (std.ascii.eqlIgnoreCase(text, w)) return true;
    for (no) |w| if (std.ascii.eqlIgnoreCase(text, w)) return false;
    return error.BadValue;
}

/// True when `name` is a good cvar or command name: 1 to 48 bytes of a to
/// z, 0 to 9 and "_". A command can also start with "+" or "-".
pub fn validName(name: []const u8) bool {
    if (name.len == 0 or name.len > 48) return false;
    for (name, 0..) |c, i| {
        const ok = (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or c == '_' or
            (i == 0 and (c == '+' or c == '-'));
        if (!ok) return false;
    }
    return true;
}

/// True when the default of `def` is of its type and in its limits.
pub fn validDef(def: *const Def) bool {
    if (!validName(def.name) or def.name[0] == '+' or def.name[0] == '-') return false;
    if (def.min != null and def.max != null and def.min.? > def.max.?) return false;
    const p = check(def, def.default) catch return false;
    if (p.clamped) return false;
    if (def.flags.protected and def.kind() != .string) return false;
    return def.description.len > 0 and def.reader.len > 0;
}
