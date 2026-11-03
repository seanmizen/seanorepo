// zig build test: the console core. The parser (with the cases that the
// server also runs), the cvar limits, the commands, the binds and the
// buttons, the scripts and the saved config, the completion, and the chat.
const std = @import("std");
const core = @import("sw_core");
const parse = @import("parse.zig");
const cvar_mod = @import("cvar.zig");
const console = @import("console.zig");
const buttons = @import("buttons.zig");
const complete = @import("complete.zig");
const line_mod = @import("line.zig");
const editor_mod = @import("editor.zig");
const prompt_mod = @import("prompt.zig");
const schema = @import("schema.zig");
const keys = @import("keys.zig");
const chat_mod = @import("chat.zig");

const testing = std.testing;
const Console = console.Console;

// ---- A store in memory ---------------------------------------------------

const MemStore = struct {
    map: std.StringHashMapUnmanaged([]u8) = .empty,
    alloc: std.mem.Allocator,

    fn deinit(self: *MemStore) void {
        var it = self.map.iterator();
        while (it.next()) |e| {
            self.alloc.free(e.key_ptr.*);
            self.alloc.free(e.value_ptr.*);
        }
        self.map.deinit(self.alloc);
    }

    fn store(self: *MemStore) console.Store {
        return .{ .ctx = self, .get = get, .set = set, .delete = delete };
    }

    fn get(ctx: ?*anyopaque, alloc: std.mem.Allocator, key: []const u8) ?[]u8 {
        const self: *MemStore = @ptrCast(@alignCast(ctx.?));
        const v = self.map.get(key) orelse return null;
        return alloc.dupe(u8, v) catch null;
    }

    fn set(ctx: ?*anyopaque, key: []const u8, bytes: []const u8) void {
        const self: *MemStore = @ptrCast(@alignCast(ctx.?));
        const v = self.alloc.dupe(u8, bytes) catch return;
        if (self.map.getPtr(key)) |old| {
            self.alloc.free(old.*);
            old.* = v;
            return;
        }
        const k = self.alloc.dupe(u8, key) catch return;
        self.map.put(self.alloc, k, v) catch {};
    }

    fn delete(ctx: ?*anyopaque, key: []const u8) void {
        const self: *MemStore = @ptrCast(@alignCast(ctx.?));
        if (self.map.fetchRemove(key)) |e| {
            self.alloc.free(e.key);
            self.alloc.free(e.value);
        }
    }
};

/// The newest output line.
fn last(con: *const Console) []const u8 {
    return if (con.out.count() > 0) con.out.get(0).text else "";
}

fn outHas(con: *const Console, needle: []const u8) bool {
    for (0..con.out.count()) |i| {
        if (std.mem.indexOf(u8, con.out.get(i).text, needle) != null) return true;
    }
    return false;
}

const fov_def: cvar_mod.Def = .{
    .name = "fov",
    .default = .{ .float = 74 },
    .min = 60,
    .max = 100,
    .flags = .{ .saved = true },
    .description = "The field of view.",
    .reader = "a test",
};

// ---- Parser ----------------------------------------------------------------

test "parse: the shared cases (parse_cases.json)" {
    const Case = struct { src: []const u8, commands: []const []const []const u8 };
    const File = struct { cases: []const Case };
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const file = try std.json.parseFromSliceLeaky(File, arena.allocator(), @embedFile("parse_cases.json"), .{ .ignore_unknown_fields = true });
    try testing.expect(file.cases.len >= 10);
    for (file.cases) |c| {
        var it = parse.Commands.init(c.src);
        var n: usize = 0;
        while (it.next()) |cmd| : (n += 1) {
            try testing.expect(n < c.commands.len);
            const args = parse.Args.parse(cmd.text);
            const want = c.commands[n];
            testing.expectEqual(want.len, args.count()) catch |e| {
                std.debug.print("case {s}: command {d}\n", .{ c.src, n });
                return e;
            };
            for (want, 0..) |tok, i| try testing.expectEqualStrings(tok, args.get(i));
        }
        try testing.expectEqual(c.commands.len, n);
    }
}

test "parse: line numbers and the rest of a command" {
    var it = parse.Commands.init("a\n// c\nb; c");
    try testing.expectEqual(@as(usize, 1), it.next().?.line);
    try testing.expectEqual(@as(usize, 3), it.next().?.line);
    try testing.expectEqual(@as(usize, 3), it.next().?.line);
    try testing.expect(it.next() == null);
    const args = parse.Args.parse("bind k echo \"a b\"  ");
    try testing.expectEqualStrings("echo \"a b\"", args.rest(2));
    try testing.expectEqualStrings("", args.rest(9));
}

// ---- Cvars -----------------------------------------------------------------

test "cvar: limits, types and the text form" {
    const p1 = try cvar_mod.parseText(&fov_def, "200");
    try testing.expect(p1.clamped);
    try testing.expectEqual(@as(f64, 100), p1.value.float);
    const p2 = try cvar_mod.parseText(&fov_def, "59.5");
    try testing.expectEqual(@as(f64, 60), p2.value.float);
    try testing.expectError(error.BadValue, cvar_mod.parseText(&fov_def, "wide"));
    try testing.expectError(error.BadValue, cvar_mod.parseText(&fov_def, "nan"));
    try testing.expectError(error.BadValue, cvar_mod.parseText(&fov_def, "inf"));

    const int_def: cvar_mod.Def = .{ .name = "n", .default = .{ .int = 5 }, .min = 1, .max = 10, .description = "d", .reader = "r" };
    try testing.expectEqual(@as(i64, 1), (try cvar_mod.parseText(&int_def, "-4")).value.int);
    try testing.expectError(error.BadValue, cvar_mod.parseText(&int_def, "2.5"));

    const b: cvar_mod.Def = .{ .name = "b", .default = .{ .bool = false }, .description = "d", .reader = "r" };
    try testing.expect((try cvar_mod.parseText(&b, "On")).value.bool);
    try testing.expect(!(try cvar_mod.parseText(&b, "0")).value.bool);
    try testing.expectError(error.BadValue, cvar_mod.parseText(&b, "2"));

    const s: cvar_mod.Def = .{ .name = "s", .default = .{ .string = "" }, .description = "d", .reader = "r" };
    try testing.expectError(error.BadValue, cvar_mod.parseText(&s, "a\"b"));
    const long: [300]u8 = @splat('x');
    const p3 = try cvar_mod.parseText(&s, &long);
    try testing.expect(p3.clamped);
    try testing.expectEqual(cvar_mod.max_string, p3.value.string.len);

    var buf: [32]u8 = undefined;
    try testing.expectEqualStrings("0.3", cvar_mod.format(&buf, .{ .float = 0.1 + 0.2 }));
    try testing.expectEqualStrings("74", cvar_mod.format(&buf, .{ .float = 74 }));
    try testing.expectEqualStrings("-1", cvar_mod.format(&buf, .{ .float = -1 }));
    try testing.expectEqualStrings("0", cvar_mod.format(&buf, .{ .float = -0.00001 }));
    try testing.expectEqualStrings("1", cvar_mod.format(&buf, .{ .bool = true }));
}

test "cvar: definitions must be valid" {
    var bad = fov_def;
    bad.default = .{ .float = 120 };
    try testing.expect(!cvar_mod.validDef(&bad));
    bad = fov_def;
    bad.name = "Fov";
    try testing.expect(!cvar_mod.validDef(&bad));
    bad = fov_def;
    bad.reader = "";
    try testing.expect(!cvar_mod.validDef(&bad));
    try testing.expect(cvar_mod.validDef(&fov_def));
}

test "console: set, reset, toggle and the flags" {
    var ms: MemStore = .{ .alloc = testing.allocator };
    defer ms.deinit();
    var con = try Console.init(testing.allocator, ms.store());
    defer con.deinit();
    const fov = try con.addCvar(fov_def);
    const srv = try con.addCvar(.{ .name = "despawn", .default = .{ .float = -1 }, .min = -1, .flags = .{ .server = true }, .description = "d", .reader = "r" });
    const ro = try con.addCvar(.{ .name = "version", .default = .{ .string = "1" }, .flags = .{ .read_only = true }, .description = "d", .reader = "r" });
    const ch = try con.addCvar(.{ .name = "noclip", .default = .{ .bool = false }, .flags = .{ .cheat = true }, .description = "d", .reader = "r" });
    try testing.expectError(error.NameTaken, con.addCvar(fov_def));

    con.exec("set fov 90", .user);
    try testing.expectEqual(@as(f32, 90), fov.float());
    con.exec("fov 300", .user);
    try testing.expectEqual(@as(f32, 100), fov.float());
    try testing.expect(outHas(&con, "out of the limits"));
    con.exec("reset fov", .user);
    try testing.expect(fov.isDefault());

    // A client cannot change a server cvar. The server can.
    con.exec("set despawn 30", .user);
    try testing.expect(srv.isDefault());
    try testing.expect(outHas(&con, "server cvar"));
    con.setFromServer("despawn", "30");
    try testing.expectEqual(@as(f32, 30), srv.float());
    // The server cannot change a client cvar.
    con.setFromServer("fov", "61");
    try testing.expect(fov.isDefault());
    con.resetServerCvars();
    try testing.expect(srv.isDefault());

    con.exec("set version 2", .user);
    try testing.expectEqualStrings("1", ro.string());
    _ = try con.setText(ro, "2", .game);
    try testing.expectEqualStrings("2", ro.string());

    con.exec("toggle noclip", .user);
    try testing.expect(!ch.on());
    con.cheats = true;
    con.exec("toggle noclip", .user);
    try testing.expect(ch.on());

    con.exec("toggle fov 70 80 90", .user);
    try testing.expectEqual(@as(f32, 70), fov.float());
    con.exec("toggle fov 70 80 90", .user);
    try testing.expectEqual(@as(f32, 80), fov.float());
    con.exec("toggle fov 70 80 90; toggle fov 70 80 90", .user);
    try testing.expectEqual(@as(f32, 70), fov.float());

    con.exec("nosuchthing", .user);
    try testing.expect(outHas(&con, "unknown command or cvar \"nosuchthing\""));
}

test "console: help, find, cvarlist and cmdlist" {
    var ms: MemStore = .{ .alloc = testing.allocator };
    defer ms.deinit();
    var con = try Console.init(testing.allocator, ms.store());
    defer con.deinit();
    _ = try con.addCvar(fov_def);
    _ = try con.addCvar(.{ .name = "pw", .default = .{ .string = "" }, .flags = .{ .protected = true }, .description = "A password.", .reader = "r" });
    con.exec("set pw secret", .user);
    con.exec("find field", .user);
    try testing.expect(outHas(&con, "fov = 74 - The field of view."));
    con.exec("help fov", .user);
    try testing.expect(outHas(&con, "60 to 100, saved"));
    try testing.expect(outHas(&con, "Read by: a test"));
    con.exec("cvarlist", .user);
    try testing.expect(outHas(&con, "pw = (hidden)"));
    try testing.expect(!outHas(&con, "secret"));
    con.exec("cmdlist bind", .user);
    try testing.expect(outHas(&con, "bindlist"));
    con.exec("help", .user);
    try testing.expect(outHas(&con, "Tab completes"));
}

// ---- Binds and buttons -----------------------------------------------------

const Action = enum { forward, attack, use };

fn keyEvent(key: core.KeyCode, down: bool) core.Event {
    return core.Event.init(0, 0, 0, .{ .key = .{ .keycode = key, .scancode = 0, .down = down, .repeat = false, .mods = .{} } });
}

test "binds: + and - commands, rebinding, release on open" {
    var ms: MemStore = .{ .alloc = testing.allocator };
    defer ms.deinit();
    var con = try Console.init(testing.allocator, ms.store());
    defer con.deinit();
    var act: buttons.Buttons(Action) = .{};
    try act.register(&con, .init(.{ .forward = "move", .attack = "fire", .use = "use" }));
    con.setDefaultBinds(&.{ .{ .key = .w, .command = "+forward" }, .{ .key = .mouse1, .command = "+attack" } });

    var in = core.InputSnapshot.init();
    in.updateFromEvents(&.{keyEvent(.W, true)});
    con.processBinds(&in);
    try testing.expect(act.down(.forward) and act.pressed(.forward));
    act.endTick();
    in.updateFromEvents(&.{});
    con.processBinds(&in);
    try testing.expect(act.down(.forward) and !act.pressed(.forward));
    in.updateFromEvents(&.{keyEvent(.W, false)});
    con.processBinds(&in);
    try testing.expect(!act.down(.forward) and act.released(.forward));
    act.endTick();

    // A short click: down and up in one tick.
    in.updateFromEvents(&.{
        core.Event.init(0, 0, 0, .{ .pointer_button = .{ .button = .left, .down = true, .mods = .{} } }),
        core.Event.init(0, 0, 1, .{ .pointer_button = .{ .button = .left, .down = false, .mods = .{} } }),
    });
    con.processBinds(&in);
    try testing.expect(act.pressed(.attack) and act.released(.attack) and !act.down(.attack));
    act.endTick();

    // Rebind: F now moves forward, W does nothing.
    con.exec("unbind w; bind f +forward", .user);
    in.updateFromEvents(&.{keyEvent(.W, true)});
    con.processBinds(&in);
    try testing.expect(!act.down(.forward));
    in.updateFromEvents(&.{ keyEvent(.W, false), keyEvent(.F, true) });
    con.processBinds(&in);
    try testing.expect(act.down(.forward));
    // The console opens: the key lets go.
    con.setOpen(true);
    try testing.expect(!act.down(.forward));
    in.updateFromEvents(&.{keyEvent(.E, true)});
    con.exec("bind e +use", .user);
    con.processBinds(&in);
    try testing.expect(!act.down(.use));
    con.setOpen(false);
    // A bind of two buttons.
    con.exec("bind q \"+use; +forward\"", .user);
    in.updateFromEvents(&.{keyEvent(.Q, true)});
    con.processBinds(&in);
    try testing.expect(act.down(.use) and act.down(.forward));
    in.updateFromEvents(&.{keyEvent(.Q, false)});
    con.processBinds(&in);
    try testing.expect(!act.down(.use) and !act.down(.forward));

    try testing.expectEqual(keys.Input.mouse1, con.keyFor("+attack").?);
    con.exec("bind x", .user);
    try testing.expectEqualStrings("x is not bound", last(&con));
    con.exec("bind z \"echo hi\"; bind z", .user);
    try testing.expectEqualStrings("z = \"echo hi\"", last(&con));
    con.exec("bind nokey +use", .user);
    try testing.expect(outHas(&con, "no key \"nokey\""));
}

test "keys: the punctuation and navigation names give their key codes" {
    const cases = [_]struct { []const u8, keys.Input, core.KeyCode }{
        .{ "grave", .grave, .Grave },
        .{ "minus", .minus, .Minus },
        .{ "equal", .equal, .Equal },
        .{ "leftbracket", .leftbracket, .LeftBracket },
        .{ "rightbracket", .rightbracket, .RightBracket },
        .{ "backslash", .backslash, .Backslash },
        .{ "semicolon", .semicolon, .Semicolon },
        .{ "quote", .quote, .Quote },
        .{ "comma", .comma, .Comma },
        .{ "period", .period, .Period },
        .{ "slash", .slash, .Slash },
        .{ "delete", .delete, .Delete },
        .{ "home", .home, .Home },
        .{ "end", .end, .End },
        .{ "pageup", .pageup, .PageUp },
        .{ "pagedown", .pagedown, .PageDown },
        .{ "insert", .insert, .Insert },
    };
    for (cases) |c| {
        try testing.expectEqual(c[1], keys.fromName(c[0]).?);
        try testing.expectEqualStrings(c[0], keys.name(c[1]));
        // Each name appears in the key list of the error message.
        try testing.expect(std.mem.indexOf(u8, keys.help, c[0]) != null);
        var in = core.InputSnapshot.init();
        in.updateFromEvents(&.{keyEvent(c[2], true)});
        try testing.expect(keys.pressed(c[1], &in) and keys.down(c[1], &in));
        in.updateFromEvents(&.{keyEvent(c[2], false)});
        try testing.expect(keys.released(c[1], &in) and !keys.down(c[1], &in));
    }
    // A name match ignores case, and the aliases work.
    try testing.expectEqual(keys.Input.grave, keys.fromName("GRAVE").?);
    try testing.expectEqual(keys.Input.grave, keys.fromName("backquote").?);
    try testing.expectEqual(keys.Input.pageup, keys.fromName("pgup").?);
    try testing.expectEqual(keys.Input.pagedown, keys.fromName("pgdn").?);
    try testing.expectEqual(keys.Input.delete, keys.fromName("del").?);
    try testing.expectEqual(keys.Input.mwheelup, keys.fromName("MWheelUp").?);
    // Each name gives back its input.
    for (keys.all) |k| try testing.expectEqual(k, keys.fromName(keys.name(k)).?);
}

fn wheelEvent(dy: f32, mode: core.event.WheelMode) core.Event {
    return core.Event.init(0, 0, 0, .{ .wheel = .{ .dx = 0, .dy = dy, .mode = mode, .mods = .{} } });
}

test "binds: mwheelup and mwheeldown press and release in one tick" {
    var ms: MemStore = .{ .alloc = testing.allocator };
    defer ms.deinit();
    var con = try Console.init(testing.allocator, ms.store());
    defer con.deinit();
    var act: buttons.Buttons(Action) = .{};
    try act.register(&con, .init(.{ .forward = "move", .attack = "fire", .use = "use" }));
    con.exec("bind mwheelup +attack; bind mwheeldown +use", .user);

    // dy > 0 scrolls up. A browser notch in pixels is lines in the
    // snapshot too.
    var in = core.InputSnapshot.init();
    in.updateFromEvents(&.{wheelEvent(1, .line)});
    con.processBinds(&in);
    try testing.expect(act.pressed(.attack) and act.released(.attack) and !act.down(.attack));
    try testing.expect(!act.pressed(.use));
    act.endTick();

    in.updateFromEvents(&.{wheelEvent(-100, .pixel)});
    con.processBinds(&in);
    try testing.expect(act.pressed(.use) and act.released(.use) and !act.down(.use));
    try testing.expect(!act.pressed(.attack));
    act.endTick();

    // No wheel: no bind runs.
    in.updateFromEvents(&.{});
    con.processBinds(&in);
    try testing.expect(!act.pressed(.attack) and !act.pressed(.use));

    // A bind that is not a button runs one time for each tick of the turn.
    con.exec("bind mwheeldown \"echo down\"", .user);
    in.updateFromEvents(&.{wheelEvent(-1, .page)});
    con.processBinds(&in);
    try testing.expectEqualStrings("down", last(&con));
    try testing.expectEqual(keys.Input.mwheelup, con.keyFor("+attack").?);
}

test "binds: grave toggleconsole opens the console" {
    var ms: MemStore = .{ .alloc = testing.allocator };
    defer ms.deinit();
    var con = try Console.init(testing.allocator, ms.store());
    defer con.deinit();
    con.setDefaultBinds(&.{.{ .key = .grave, .command = "toggleconsole" }});
    try testing.expectEqual(keys.Input.grave, con.keyFor("toggleconsole").?);

    // The Unknown key does nothing.
    var in = core.InputSnapshot.init();
    in.updateFromEvents(&.{keyEvent(.Unknown, true)});
    con.processBinds(&in);
    try testing.expect(!con.open);

    in.updateFromEvents(&.{ keyEvent(.Unknown, false), keyEvent(.Grave, true) });
    con.processBinds(&in);
    try testing.expect(con.open);
    // The binds stop while the console is open.
    in.updateFromEvents(&.{keyEvent(.Grave, false)});
    in.updateFromEvents(&.{keyEvent(.Grave, true)});
    con.processBinds(&in);
    try testing.expect(con.open);
    con.setOpen(false);
    // Rebind: another key opens it.
    con.exec("unbind grave; bind home toggleconsole", .user);
    in.updateFromEvents(&.{ keyEvent(.Grave, false), keyEvent(.Grave, true) });
    con.processBinds(&in);
    try testing.expect(!con.open);
    in.updateFromEvents(&.{keyEvent(.Home, true)});
    con.processBinds(&in);
    try testing.expect(con.open);
}

// ---- Scripts and the saved config ------------------------------------------

test "scripts: exec, comments, errors with lines, depth limit, autoexec" {
    var ms: MemStore = .{ .alloc = testing.allocator };
    defer ms.deinit();
    var con = try Console.init(testing.allocator, ms.store());
    defer con.deinit();
    const fov = try con.addCvar(fov_def);

    con.writeScript("setup", "// a comment\nset fov 80 // and another\n\nbogus\necho done");
    con.exec("exec setup", .user);
    try testing.expectEqual(@as(f32, 80), fov.float());
    try testing.expect(outHas(&con, "setup:4: unknown command or cvar \"bogus\""));
    try testing.expectEqualStrings("done", last(&con));
    con.exec("exec nothere", .user);
    try testing.expect(outHas(&con, "no script \"nothere\""));

    // A script that runs itself stops.
    con.writeScript("loop", "exec loop");
    con.exec("exec loop", .user);
    try testing.expect(outHas(&con, "inside each other"));

    con.writeScript("autoexec", "set fov 66");
    con.runAutoexec();
    try testing.expectEqual(@as(f32, 66), fov.float());

    // The index survives a new console.
    var con2 = try Console.init(testing.allocator, ms.store());
    defer con2.deinit();
    try testing.expect(con2.hasScript("autoexec") and con2.hasScript("setup") and con2.hasScript("loop"));
    con2.exec("scriptdel loop", .user);
    try testing.expect(!con2.hasScript("loop"));
    try testing.expect(con2.readScript("loop") == null);
}

test "scripts: the editor saves on finish" {
    var ms: MemStore = .{ .alloc = testing.allocator };
    defer ms.deinit();
    var con = try Console.init(testing.allocator, ms.store());
    defer con.deinit();
    con.exec("edit Notes", .user);
    try testing.expectEqualStrings("notes", con.editing().?);
    try testing.expect(con.open);
    con.editor.insert(testing.allocator, "echo one\necho two");
    con.editor.up();
    con.editor.insert(testing.allocator, "!");
    con.finishEdit();
    try testing.expect(con.editing() == null);
    const text = con.readScript("notes").?;
    defer testing.allocator.free(text);
    try testing.expectEqualStrings("echo one!\necho two", text);
    // An empty script is deleted.
    con.startEdit("notes");
    while (con.editor.bytes().len > 0) {
        con.editor.right();
        con.editor.backspace();
    }
    con.finishEdit();
    try testing.expect(!con.hasScript("notes"));
}

test "config: saves only the changes, loads them back, new defaults reach old configs" {
    var ms: MemStore = .{ .alloc = testing.allocator };
    defer ms.deinit();
    {
        var con = try Console.init(testing.allocator, ms.store());
        defer con.deinit();
        _ = try con.addCvar(fov_def);
        con.setDefaultBinds(&.{ .{ .key = .w, .command = "+forward" }, .{ .key = .f, .command = "+use" } });
        try testing.expect(!con.loadConfig());
        con.exec("set fov 90; bind w +back; unbind f; bind k \"echo a; echo b\"; bind j echo \"x\"", .user);
        try testing.expect(con.dirty_ticks != null);
        for (0..console.save_delay_ticks) |_| con.tick();
        try testing.expect(con.dirty_ticks == null);
    }
    const saved = ms.map.get(console.config_key).?;
    try testing.expect(std.mem.indexOf(u8, saved, "set fov \"90\"") != null);
    try testing.expect(std.mem.indexOf(u8, saved, "unbind f") != null);
    try testing.expect(std.mem.indexOf(u8, saved, "bind j echo \"x\"") != null);
    {
        var con = try Console.init(testing.allocator, ms.store());
        defer con.deinit();
        const fov = try con.addCvar(fov_def);
        // A new default bind (g) reaches the old config.
        con.setDefaultBinds(&.{ .{ .key = .w, .command = "+forward" }, .{ .key = .f, .command = "+use" }, .{ .key = .g, .command = "+grenade" } });
        try testing.expect(con.loadConfig());
        try testing.expect(con.dirty_ticks == null);
        try testing.expectEqual(@as(f32, 90), fov.float());
        try testing.expectEqualStrings("+back", con.bindOf(.w).?);
        try testing.expect(con.bindOf(.f) == null);
        try testing.expectEqualStrings("+grenade", con.bindOf(.g).?);
        try testing.expectEqualStrings("echo a; echo b", con.bindOf(.k).?);
        try testing.expectEqualStrings("echo \"x\"", con.bindOf(.j).?);
        con.exec("resetbinds", .user);
        try testing.expectEqualStrings("+use", con.bindOf(.f).?);
    }
}

// ---- Completion ------------------------------------------------------------

test "complete: suggestions and Tab" {
    var ms: MemStore = .{ .alloc = testing.allocator };
    defer ms.deinit();
    var con = try Console.init(testing.allocator, ms.store());
    defer con.deinit();
    _ = try con.addCvar(fov_def);
    _ = try con.addCvar(.{ .name = "volume", .default = .{ .float = 1 }, .description = "d", .reader = "r" });
    _ = try con.addCvar(.{ .name = "sfx_volume", .default = .{ .float = 1 }, .description = "d", .reader = "r" });
    con.writeScript("autoexec", "echo hi");

    var list: [16]complete.Suggestion = undefined;
    // Prefix matches first, then the names that hold the text.
    var n = complete.suggest(&con, "vol", &list);
    try testing.expectEqual(@as(usize, 2), n);
    try testing.expectEqualStrings("volume", list[0].name);
    try testing.expectEqualStrings("sfx_volume", list[1].name);
    // After "set ": cvars only.
    n = complete.suggest(&con, "set f", &list);
    try testing.expectEqual(@as(usize, 1), n);
    try testing.expectEqualStrings("fov", list[0].name);
    // A cvar name and a space: that cvar.
    n = complete.suggest(&con, "fov ", &list);
    try testing.expectEqual(@as(usize, 1), n);
    try testing.expect(list[0].cvar != null);
    // Keys after bind, then commands.
    n = complete.suggest(&con, "bind mou", &list);
    try testing.expectEqual(@as(usize, 5), n);
    n = complete.suggest(&con, "bind w togglec", &list);
    try testing.expectEqualStrings("toggleconsole", list[0].name);
    n = complete.suggest(&con, "exec au", &list);
    try testing.expectEqualStrings("autoexec", list[0].name);
    // The command after a ";".
    n = complete.suggest(&con, "echo a; cvarl", &list);
    try testing.expectEqualStrings("cvarlist", list[0].name);

    var edit: line_mod.LineEdit = .{};
    var cycle: complete.Cycle = .{};
    edit.set("cvarl");
    complete.tab(&con, &edit, &cycle);
    try testing.expectEqualStrings("cvarlist ", edit.text());
    // A common start, then each match in turn.
    edit.set("toggle");
    complete.tab(&con, &edit, &cycle);
    try testing.expectEqualStrings("toggle", edit.text()[0..6]);
    cycle = .{};
    edit.set("set fo");
    complete.tab(&con, &edit, &cycle);
    try testing.expectEqualStrings("set fov ", edit.text());
    cycle = .{};
    edit.set("e");
    complete.tab(&con, &edit, &cycle);
    try testing.expectEqualStrings("e", edit.text()[0..1]);
    const first = try testing.allocator.dupe(u8, edit.text());
    defer testing.allocator.free(first);
    complete.tab(&con, &edit, &cycle);
    try testing.expect(!std.mem.eql(u8, first, edit.text()));
    // A Tab in the middle keeps the text after the cursor.
    cycle = .{};
    edit.set("cvarl; echo x");
    edit.cursor = 5;
    complete.tab(&con, &edit, &cycle);
    try testing.expectEqualStrings("cvarlist ; echo x", edit.text());
}

test "prompt: events in order, history, editing keys" {
    var ms: MemStore = .{ .alloc = testing.allocator };
    defer ms.deinit();
    var con = try Console.init(testing.allocator, ms.store());
    defer con.deinit();
    var p: prompt_mod.Prompt = .{};
    const text = struct {
        fn f(t: []const u8) core.Event {
            return core.Event.init(0, 0, 0, core.event.textInputPayload(t));
        }
    }.f;
    // Two lines in one tick: each Enter sends the text before it.
    const tick = [_]core.Event{ text("echo one"), keyEvent(.Enter, true), keyEvent(.Enter, false), text("echo two"), keyEvent(.Enter, true) };
    var sent: [2][]const u8 = undefined;
    var n: usize = 0;
    for (&tick) |*ev| {
        if (p.feed(&con, ev) == .submit) {
            sent[n] = try testing.allocator.dupe(u8, p.submitted());
            n += 1;
        }
    }
    defer for (sent[0..n]) |s| testing.allocator.free(s);
    try testing.expectEqual(@as(usize, 2), n);
    try testing.expectEqualStrings("echo one", sent[0]);
    try testing.expectEqualStrings("echo two", sent[1]);

    // Up and Down, and the draft comes back.
    _ = p.feed(&con, &text("draft"));
    _ = p.feed(&con, &keyEvent(.Up, true));
    try testing.expectEqualStrings("echo two", p.edit.text());
    _ = p.feed(&con, &keyEvent(.Up, true));
    try testing.expectEqualStrings("echo one", p.edit.text());
    _ = p.feed(&con, &keyEvent(.Down, true));
    _ = p.feed(&con, &keyEvent(.Down, true));
    try testing.expectEqualStrings("draft", p.edit.text());
    // A held key: the system repeat sends more key-down events.
    _ = p.feed(&con, &keyEvent(.Backspace, true));
    _ = p.feed(&con, &keyEvent(.Backspace, true));
    try testing.expectEqualStrings("dra", p.edit.text());
    _ = p.feed(&con, &keyEvent(.Left, true));
    _ = p.feed(&con, &text("X"));
    try testing.expectEqualStrings("drXa", p.edit.text());
    // Tab completes.
    p.edit.set("cvarl");
    _ = p.feed(&con, &keyEvent(.Tab, true));
    try testing.expectEqualStrings("cvarlist ", p.edit.text());
    try testing.expectEqual(prompt_mod.Event.cancel, p.feed(&con, &keyEvent(.Escape, true)));
}

test "line: UTF-8 stays whole" {
    var e: line_mod.LineEdit = .{};
    e.insert("a\u{e9}b");
    e.left();
    e.left();
    try testing.expectEqual(@as(usize, 1), e.cursor);
    e.right();
    e.backspace();
    try testing.expectEqualStrings("ab", e.text());
    e.insert("x\x01y\n");
    try testing.expectEqualStrings("axyb", e.text());
}

// ---- The server cvar file --------------------------------------------------

test "schema: bad definitions" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    try testing.expectError(error.BadDefault, schema.parseDefs(a, "{\"cvars\":[{\"name\":\"x\",\"type\":\"int\",\"default\":1.5,\"description\":\"d\",\"reader\":\"r\"}]}", .{}));
    try testing.expectError(error.BadFlag, schema.parseDefs(a, "{\"cvars\":[{\"name\":\"x\",\"type\":\"int\",\"default\":1,\"flags\":[\"loud\"],\"description\":\"d\",\"reader\":\"r\"}]}", .{}));
    try testing.expectError(error.BadDef, schema.parseDefs(a, "{\"cvars\":[{\"name\":\"x\",\"type\":\"int\",\"default\":20,\"max\":10,\"description\":\"d\",\"reader\":\"r\"}]}", .{}));
    try testing.expectError(error.BadJson, schema.parseDefs(a, "{", .{}));
}

test "editor: lines and columns" {
    var e: editor_mod.Editor = .{};
    defer e.deinit(testing.allocator);
    e.load(testing.allocator, "abc\nd\nefgh");
    e.right();
    e.right();
    e.down();
    try testing.expectEqual(@as(usize, 1), e.position().line);
    try testing.expectEqual(@as(usize, 1), e.position().col);
    e.down();
    // The column comes back on a long line.
    try testing.expectEqual(@as(usize, 2), e.position().col);
    try testing.expectEqual(@as(usize, 3), e.lineCount());
}

// ---- The chat ----------------------------------------------------------------

/// The messages that the chat sent, for the tests.
const Outbox = struct {
    channels: [8]chat_mod.Channel = undefined,
    texts: [8][chat_mod.max_text]u8 = undefined,
    lens: [8]usize = @splat(0),
    n: usize = 0,
    /// The error that send returns, or null.
    fail: ?[]const u8 = null,

    fn send(ctx: ?*anyopaque, ch: chat_mod.Channel, msg: []const u8) ?[]const u8 {
        const self: *Outbox = @ptrCast(@alignCast(ctx.?));
        if (self.fail) |f| return f;
        self.channels[self.n] = ch;
        @memcpy(self.texts[self.n][0..msg.len], msg);
        self.lens[self.n] = msg.len;
        self.n += 1;
        return null;
    }

    fn text(self: *const Outbox, i: usize) []const u8 {
        return self.texts[i][0..self.lens[i]];
    }
};

fn textEvent(t: []const u8) core.Event {
    return core.Event.init(0, 0, 0, core.event.textInputPayload(t));
}

/// True when a line of the chat log holds `needle`.
fn logHas(c: *const chat_mod.Chat, needle: []const u8) bool {
    for (0..c.log.count()) |i| {
        if (std.mem.indexOf(u8, c.log.get(i).text(), needle) != null) return true;
    }
    return false;
}

/// A console with a chat that sends to `box`. The chat is on the heap: it
/// must stay at its address.
fn newChat(con: *Console, box: *Outbox) !*chat_mod.Chat {
    const c = try testing.allocator.create(chat_mod.Chat);
    c.* = .{};
    try c.register(con);
    c.send_fn = Outbox.send;
    c.send_ctx = box;
    return c;
}

test "chat: binds open it, the keys stop, Enter sends, Esc closes" {
    var ms: MemStore = .{ .alloc = testing.allocator };
    defer ms.deinit();
    var con = try Console.init(testing.allocator, ms.store());
    defer con.deinit();
    var act: buttons.Buttons(Action) = .{};
    try act.register(&con, .init(.{ .forward = "move", .attack = "fire", .use = "use" }));
    var box: Outbox = .{};
    const c = try newChat(&con, &box);
    defer testing.allocator.destroy(c);
    con.setDefaultBinds(&.{ .{ .key = .w, .command = "+forward" }, .{ .key = .y, .command = "messagemode" }, .{ .key = .t, .command = "messagemode2" } });

    // W moves. Y opens the chat: W lets go, and the binds stop.
    var in = core.InputSnapshot.init();
    in.updateFromEvents(&.{keyEvent(.W, true)});
    con.processBinds(&in);
    try testing.expect(act.down(.forward));
    in.updateFromEvents(&.{keyEvent(.Y, true)});
    con.processBinds(&in);
    try testing.expect(c.isOpen() and c.channel.? == .all);
    try testing.expect(con.typing and !act.down(.forward));
    in.updateFromEvents(&.{ keyEvent(.Y, false), keyEvent(.W, true) });
    con.processBinds(&in);
    try testing.expect(!act.down(.forward));

    // The typed text, then Enter: the message goes, and the chat closes.
    c.update(&con, &.{ textEvent("gg "), textEvent("all"), keyEvent(.Enter, true) });
    try testing.expect(!c.isOpen() and !con.typing);
    try testing.expectEqual(@as(usize, 1), box.n);
    try testing.expectEqual(chat_mod.Channel.all, box.channels[0]);
    try testing.expectEqualStrings("gg all", box.text(0));
    // The console grammar does not apply to a chat line.
    c.open(&con, .all, "");
    c.update(&con, &.{ textEvent("a; b // c"), keyEvent(.Enter, true) });
    try testing.expectEqualStrings("a; b // c", box.text(1));

    // T: the team channel. Esc closes with no message. A line of spaces
    // sends nothing.
    in.updateFromEvents(&.{keyEvent(.T, true)});
    con.processBinds(&in);
    try testing.expect(c.channel.? == .team);
    c.update(&con, &.{ textEvent("x"), keyEvent(.Escape, true) });
    try testing.expect(!c.isOpen());
    c.open(&con, .team, "");
    c.update(&con, &.{ textEvent("   "), keyEvent(.Enter, true) });
    try testing.expectEqual(@as(usize, 2), box.n);
    c.open(&con, .team, "");
    c.update(&con, &.{ textEvent("push B"), keyEvent(.Enter, true) });
    try testing.expectEqual(chat_mod.Channel.team, box.channels[2]);

    // say and say_team in the console. An error of send shows.
    con.exec("say \"hello there\"; say_team two words", .user);
    try testing.expectEqualStrings("hello there", box.text(3));
    try testing.expectEqual(chat_mod.Channel.team, box.channels[4]);
    try testing.expectEqualStrings("two words", box.text(4));
    box.fail = "chat: no server";
    con.exec("say hi", .user);
    try testing.expect(outHas(&con, "chat: no server"));
    c.open(&con, .all, "");
    c.update(&con, &.{ textEvent("hi"), keyEvent(.Enter, true) });
    try testing.expectEqual(chat_mod.Kind.err, c.log.get(0).kind);

    // A command in the console opens the chat: the panel closes.
    con.setOpen(true);
    con.exec("messagemode2", .user);
    try testing.expect(!con.open and c.channel.? == .team);
    c.close(&con);
}

test "chat: a / line runs a command, with the console completion" {
    var ms: MemStore = .{ .alloc = testing.allocator };
    defer ms.deinit();
    var con = try Console.init(testing.allocator, ms.store());
    defer con.deinit();
    const fov = try con.addCvar(fov_def);
    var box: Outbox = .{};
    const c = try newChat(&con, &box);
    defer testing.allocator.destroy(c);

    // The "/" key: the line starts with "/".
    c.open(&con, .all, "/");
    try testing.expect(c.isCommand());
    c.update(&con, &.{textEvent("fo")});
    var list: [8]complete.Suggestion = undefined;
    try testing.expectEqual(@as(usize, 1), c.suggestions(&con, &list));
    try testing.expectEqualStrings("fov", list[0].name);
    c.update(&con, &.{keyEvent(.Tab, true)});
    try testing.expectEqualStrings("/fov ", c.prompt.edit.text());
    c.update(&con, &.{ textEvent("90"), keyEvent(.Enter, true) });
    try testing.expectEqual(@as(f32, 90), fov.float());
    try testing.expectEqual(@as(usize, 0), box.n);
    // The command and its output show in the chat.
    try testing.expect(logHas(c, "> fov 90"));
    try testing.expect(logHas(c, "fov = 90"));
    // An error shows as an error.
    c.open(&con, .all, "/");
    c.update(&con, &.{ textEvent("nosuch"), keyEvent(.Enter, true) });
    try testing.expectEqual(chat_mod.Kind.err, c.log.get(0).kind);
    // A long output: the first lines, then the count of the rest.
    c.open(&con, .all, "/");
    c.update(&con, &.{ textEvent("cmdlist"), keyEvent(.Enter, true) });
    try testing.expect(std.mem.startsWith(u8, c.log.get(0).text(), "+"));
    try testing.expect(logHas(c, "more lines in the console"));
    // A command can open the chat again.
    c.open(&con, .all, "/");
    c.update(&con, &.{ textEvent("messagemode2 /"), keyEvent(.Enter, true) });
    try testing.expect(c.channel.? == .team and c.isCommand());
    // A chat line that does not start with "/" has no completion.
    c.prompt.edit.clear();
    c.update(&con, &.{ textEvent("fo"), keyEvent(.Tab, true) });
    try testing.expectEqualStrings("fo", c.prompt.edit.text());
    try testing.expectEqual(@as(usize, 0), c.suggestions(&con, &list));
    c.close(&con);
    // The chat has its own history.
    c.open(&con, .all, "");
    c.update(&con, &.{keyEvent(.Up, true)});
    try testing.expectEqualStrings("/messagemode2 /", c.prompt.edit.text());
    c.close(&con);
}

test "chat: the length limit, the fade, the log" {
    var ms: MemStore = .{ .alloc = testing.allocator };
    defer ms.deinit();
    var con = try Console.init(testing.allocator, ms.store());
    defer con.deinit();
    var box: Outbox = .{};
    const c = try newChat(&con, &box);
    defer testing.allocator.destroy(c);
    c.limit = try con.addCvar(.{ .name = "chat_max_length", .default = .{ .int = 5 }, .min = 1, .max = 240, .flags = .{ .server = true }, .description = "d", .reader = "r" });

    // A chat line stops at the limit. A command line can be longer.
    c.open(&con, .all, "");
    c.update(&con, &.{textEvent("abcdefgh")});
    try testing.expectEqualStrings("abcde", c.prompt.edit.text());
    c.close(&con);
    c.open(&con, .all, "/");
    c.update(&con, &.{textEvent("echo long")});
    try testing.expectEqualStrings("/echo long", c.prompt.edit.text());
    c.close(&con);

    // A line shows for chat_fade_seconds and fades out in the last second.
    con.exec("chat_fade_seconds 4", .user);
    try testing.expect(con.findCvar("chat_fade_seconds").?.def.flags.saved);
    c.add(.{ .kind = .server, .text = "Ghost42 joined" });
    const m = c.log.get(0);
    try testing.expectEqual(@as(f32, 1), c.alpha(m));
    for (0..35) |_| c.tick(0.1);
    try testing.expectApproxEqAbs(@as(f32, 0.5), c.alpha(m), 0.01);
    for (0..10) |_| c.tick(0.1);
    try testing.expectEqual(@as(f32, 0), c.alpha(m));
    // While the input is open, the old lines show.
    c.open(&con, .all, "");
    try testing.expectEqual(@as(f32, 1), c.alpha(m));
    c.close(&con);

    // The log keeps the newest lines, and cuts a long name.
    for (0..chat_mod.Log.size + 3) |i| {
        var buf: [16]u8 = undefined;
        c.add(.{ .name = "a name that is much longer than thirty-two bytes", .text = std.fmt.bufPrint(&buf, "line {d}", .{i}) catch "" });
    }
    try testing.expectEqual(chat_mod.Log.size, c.log.count());
    try testing.expectEqualStrings("line 66", c.log.get(0).text());
    try testing.expectEqualStrings("line 3", c.log.get(chat_mod.Log.size - 1).text());
    try testing.expectEqual(chat_mod.max_name, c.log.get(0).name().len);
}
