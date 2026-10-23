// Cvar definitions from JSON. The server cvars are defined one time, in a
// JSON file that the game embeds and the server reads (one source of
// truth). The file:
//
//   { "cvars": [ { "name": "match_seconds", "type": "int", "default": 300,
//                  "min": 10, "max": 3600, "flags": [],
//                  "description": "...", "reader": "..." } ] }
//
// type: "bool", "int", "float" or "string". flags: "saved", "server",
// "cheat", "read_only", "protected". min and max are optional. Other keys
// (for example "$comment") are ignored.
const std = @import("std");
const cvar_mod = @import("cvar.zig");
const console = @import("console.zig");

const Raw = struct {
    name: []const u8,
    type: []const u8,
    default: std.json.Value,
    min: ?f64 = null,
    max: ?f64 = null,
    flags: []const []const u8 = &.{},
    description: []const u8,
    reader: []const u8,
};

const File = struct { cvars: []const Raw };

pub const Error = error{ BadJson, BadType, BadDefault, BadFlag, BadDef } || std.mem.Allocator.Error;

/// Read the definitions. Each definition also gets the flags in `add`. The
/// strings live in `arena`.
pub fn parseDefs(arena: std.mem.Allocator, json: []const u8, add: cvar_mod.Flags) Error![]cvar_mod.Def {
    const file = std.json.parseFromSliceLeaky(File, arena, json, .{
        .ignore_unknown_fields = true,
        .allocate = .alloc_always,
    }) catch return error.BadJson;
    const defs = try arena.alloc(cvar_mod.Def, file.cvars.len);
    for (file.cvars, defs) |raw, *d| {
        var flags = add;
        for (raw.flags) |f| {
            if (std.mem.eql(u8, f, "saved")) {
                flags.saved = true;
            } else if (std.mem.eql(u8, f, "server")) {
                flags.server = true;
            } else if (std.mem.eql(u8, f, "cheat")) {
                flags.cheat = true;
            } else if (std.mem.eql(u8, f, "read_only")) {
                flags.read_only = true;
            } else if (std.mem.eql(u8, f, "protected")) {
                flags.protected = true;
            } else return error.BadFlag;
        }
        d.* = .{
            .name = raw.name,
            .default = try defaultOf(raw.type, raw.default),
            .min = raw.min,
            .max = raw.max,
            .flags = flags,
            .description = raw.description,
            .reader = raw.reader,
        };
        if (!cvar_mod.validDef(d)) return error.BadDef;
    }
    return defs;
}

fn defaultOf(t: []const u8, v: std.json.Value) Error!cvar_mod.Value {
    if (std.mem.eql(u8, t, "bool")) {
        return switch (v) {
            .bool => |b| .{ .bool = b },
            else => error.BadDefault,
        };
    }
    if (std.mem.eql(u8, t, "int")) {
        return switch (v) {
            .integer => |i| .{ .int = i },
            else => error.BadDefault,
        };
    }
    if (std.mem.eql(u8, t, "float")) {
        return switch (v) {
            .integer => |i| .{ .float = @floatFromInt(i) },
            .float => |f| .{ .float = f },
            else => error.BadDefault,
        };
    }
    if (std.mem.eql(u8, t, "string")) {
        return switch (v) {
            .string => |s| .{ .string = s },
            else => error.BadDefault,
        };
    }
    return error.BadType;
}

/// Add the cvars of a JSON file to the console.
pub fn addJsonCvars(con: *console.Console, arena: std.mem.Allocator, json: []const u8, add: cvar_mod.Flags) !void {
    for (try parseDefs(arena, json, add)) |d| _ = try con.addCvar(d);
}
