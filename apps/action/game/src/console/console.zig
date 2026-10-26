// The console core: the cvars, the commands, the binds, the scripts, the
// saved config and the output. No GPU and no font code (view.zig draws
// it), so the native tests run it (tests.zig).
//
// This directory imports nothing from the action game. It needs std and
// sw_core (the keys of the binds), and view.zig also needs sw_gfx2d and
// sw_text. It can move to swindowzig (libs/) as one library.
//
// Start order in a game:
//   1. Console.init, then the cvars, the commands, the buttons
//      (buttons.zig) and setDefaultBinds.
//   2. loadConfig: the saved cvars and binds (local storage "config").
//   3. runAutoexec: the "autoexec" script, if it exists.
//   4. Each tick: processBinds before the game reads its buttons, and tick
//      (it saves the config a short time after a change).
const std = @import("std");
const core = @import("sw_core");
const parse = @import("parse.zig");
const cvar_mod = @import("cvar.zig");
const keys = @import("keys.zig");
const editor_mod = @import("editor.zig");

const Cvar = cvar_mod.Cvar;
const Def = cvar_mod.Def;
const Value = cvar_mod.Value;
const Allocator = std.mem.Allocator;

/// Who runs a command or sets a cvar. The checks of a set use it.
pub const Source = enum {
    /// The player: the console, a bind, a script.
    user,
    /// A value that the server sent. It can set only server cvars.
    server,
    /// The game code. It can set every cvar.
    game,
};

pub const Handler = *const fn (con: *Console, cmd: *const Command, args: *const parse.Args) void;

/// What the first argument of a command completes to.
pub const Complete = enum { none, cvar, name, key, script };

pub const Command = struct {
    name: []const u8,
    /// The arguments, for the help: "<cvar> <value>".
    args: []const u8 = "",
    description: []const u8,
    handler: Handler,
    complete: Complete = .none,
    /// Not in cmdlist, find or the completion. The "-" half of a button.
    hidden: bool = false,
    /// Runs only while cheats are on.
    cheat: bool = false,
    /// Data for the handler.
    ctx: ?*anyopaque = null,
    data: usize = 0,
};

/// Local key-value storage. The game gives sw_platform storage, the tests
/// give a map in memory.
pub const Store = struct {
    ctx: ?*anyopaque = null,
    /// The value of `key`, or null. The caller frees it with `alloc`.
    get: *const fn (ctx: ?*anyopaque, alloc: Allocator, key: []const u8) ?[]u8,
    set: *const fn (ctx: ?*anyopaque, key: []const u8, bytes: []const u8) void,
    delete: *const fn (ctx: ?*anyopaque, key: []const u8) void,
};

pub const LineKind = enum { normal, echo, err, dim };

/// The console text, newest last. A long line is cut into more lines.
pub const Output = struct {
    pub const max_lines = 256;
    pub const line_len = 200;
    pub const Line = struct { text: []const u8, kind: LineKind };

    bufs: [max_lines][line_len]u8 = undefined,
    lens: [max_lines]u8 = @splat(0),
    kinds: [max_lines]LineKind = @splat(.normal),
    total: usize = 0,

    pub fn push(self: *Output, kind: LineKind, text: []const u8) void {
        var it = std.mem.splitScalar(u8, text, '\n');
        while (it.next()) |l| {
            var rest = l;
            while (true) {
                var n = @min(rest.len, line_len);
                while (n < rest.len and n > 0 and (rest[n] & 0xC0) == 0x80) n -= 1;
                const k = self.total % max_lines;
                @memcpy(self.bufs[k][0..n], rest[0..n]);
                self.lens[k] = @intCast(n);
                self.kinds[k] = kind;
                self.total += 1;
                rest = rest[n..];
                if (rest.len == 0) break;
            }
        }
    }

    pub fn count(self: *const Output) usize {
        return @min(self.total, max_lines);
    }

    /// Line i, from 0 (the newest).
    pub fn get(self: *const Output, i: usize) Line {
        const k = (self.total - 1 - i) % max_lines;
        return .{ .text = self.bufs[k][0..self.lens[k]], .kind = self.kinds[k] };
    }

    pub fn clear(self: *Output) void {
        self.total = 0;
    }
};

pub const DefaultBind = struct { key: keys.Input, command: []const u8 };

pub const SetError = error{ BadValue, ReadOnly, ServerOwned, Cheat };

/// Scripts inside scripts stop at this depth (a script that runs itself).
pub const max_depth = 8;
pub const max_script_name = 32;
/// The storage key of the saved config.
pub const config_key = "config";
/// The storage key of the list of the script names.
const index_key = "scripts";
/// The ticks from the last change to the save of the config.
pub const save_delay_ticks = 60;

pub const Console = struct {
    alloc: Allocator,
    store: Store,
    cvars: std.ArrayList(*Cvar) = .empty,
    commands: std.ArrayList(*Command) = .empty,
    binds: [keys.count]?[]u8 = @splat(null),
    defaults: [keys.count]?[]const u8 = @splat(null),
    /// The bind of this key ran on its press: the release runs the "-"
    /// commands.
    held: [keys.count]bool = @splat(false),
    out: *Output,
    /// The script names, sorted (local storage "scripts").
    scripts: std.ArrayList([]u8) = .empty,
    editor: editor_mod.Editor = .{},
    /// The script that the editor shows, or "" when it is closed.
    edit_buf: [max_script_name]u8 = undefined,
    edit_len: usize = 0,
    /// Cheat cvars and commands work only while this is true. The game sets
    /// it.
    cheats: bool = false,
    /// The console panel is open: the binds do not run. Use setOpen.
    open: bool = false,
    /// Another text line (the chat, chat.zig) has the keys: the binds do
    /// not run. Use setTyping.
    typing: bool = false,
    /// Ticks since a saved cvar or a bind changed, or null when the saved
    /// config is current.
    dirty_ticks: ?u32 = null,
    depth: u8 = 0,
    /// The source of the command that runs now.
    source: Source = .user,
    /// The script and the line that run now, for the error messages.
    where_name: []const u8 = "",
    where_line: usize = 0,
    /// Called with each output line (for example to copy it to the log).
    on_print: ?*const fn (kind: LineKind, text: []const u8) void = null,

    pub fn init(alloc: Allocator, store: Store) !Console {
        const out = try alloc.create(Output);
        out.* = .{};
        var con: Console = .{ .alloc = alloc, .store = store, .out = out };
        for (builtins) |c| try con.addCommand(c);
        con.loadScriptIndex();
        return con;
    }

    pub fn deinit(self: *Console) void {
        for (self.cvars.items) |c| self.alloc.destroy(c);
        self.cvars.deinit(self.alloc);
        for (self.commands.items) |c| self.alloc.destroy(c);
        self.commands.deinit(self.alloc);
        for (&self.binds) |*b| if (b.*) |s| self.alloc.free(s);
        for (self.scripts.items) |s| self.alloc.free(s);
        self.scripts.deinit(self.alloc);
        self.editor.deinit(self.alloc);
        self.alloc.destroy(self.out);
    }

    // ---- Registration -------------------------------------------------------

    /// Add a cvar. The returned pointer stays valid: the game keeps it and
    /// reads the value each frame.
    pub fn addCvar(self: *Console, def: Def) !*Cvar {
        if (!cvar_mod.validDef(&def)) return error.BadDef;
        if (self.findCvar(def.name) != null or self.findCommand(def.name) != null) return error.NameTaken;
        const c = try self.alloc.create(Cvar);
        c.* = Cvar.init(def);
        try self.cvars.append(self.alloc, c);
        return c;
    }

    pub fn addCommand(self: *Console, cmd: Command) !void {
        if (!cvar_mod.validName(cmd.name)) return error.BadName;
        if (self.findCvar(cmd.name) != null or self.findCommand(cmd.name) != null) return error.NameTaken;
        const c = try self.alloc.create(Command);
        c.* = cmd;
        try self.commands.append(self.alloc, c);
    }

    pub fn findCvar(self: *const Console, name: []const u8) ?*Cvar {
        for (self.cvars.items) |c| if (std.ascii.eqlIgnoreCase(c.def.name, name)) return c;
        return null;
    }

    pub fn findCommand(self: *const Console, name: []const u8) ?*Command {
        for (self.commands.items) |c| if (std.ascii.eqlIgnoreCase(c.name, name)) return c;
        return null;
    }

    // ---- Output -------------------------------------------------------------

    pub fn print(self: *Console, comptime fmt: []const u8, args: anytype) void {
        self.printKind(.normal, fmt, args);
    }

    /// An error. In a script, the script name and the line come first.
    pub fn printErr(self: *Console, comptime fmt: []const u8, args: anytype) void {
        var buf: [1024]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, fmt, args) catch buf[0..];
        if (self.where_name.len > 0) {
            self.printKind(.err, "{s}:{d}: {s}", .{ self.where_name, self.where_line, msg });
        } else self.printKind(.err, "{s}", .{msg});
    }

    pub fn printKind(self: *Console, kind: LineKind, comptime fmt: []const u8, args: anytype) void {
        var buf: [1024]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, fmt, args) catch buf[0..];
        self.out.push(kind, msg);
        if (self.on_print) |f| f(kind, msg);
    }

    // ---- Running commands ---------------------------------------------------

    /// Run the commands in `text` (lines, ";", "//" comments).
    pub fn exec(self: *Console, text: []const u8, source: Source) void {
        self.execIn(text, source, "");
    }

    /// Run a line that the player typed: echo it, then run it.
    pub fn submit(self: *Console, text: []const u8) void {
        self.printKind(.echo, "> {s}", .{text});
        self.exec(text, .user);
    }

    fn execIn(self: *Console, text: []const u8, source: Source, name: []const u8) void {
        if (self.depth >= max_depth) {
            self.printErr("exec: more than {d} scripts run inside each other", .{max_depth});
            return;
        }
        self.depth += 1;
        const prev = .{ self.source, self.where_name, self.where_line };
        self.source = source;
        if (name.len > 0) self.where_name = name;
        defer {
            self.depth -= 1;
            self.source = prev[0];
            self.where_name = prev[1];
            self.where_line = prev[2];
        }
        var it = parse.Commands.init(text);
        while (it.next()) |c| {
            if (name.len > 0) self.where_line = c.line;
            self.runOne(c.text);
        }
    }

    fn runOne(self: *Console, text: []const u8) void {
        const args = parse.Args.parse(text);
        if (args.count() == 0) return;
        const name = args.get(0);
        if (self.findCommand(name)) |cmd| {
            if (cmd.cheat and !self.cheats and self.source != .game) {
                self.printErr("{s} is a cheat command, and cheats are off", .{cmd.name});
                return;
            }
            cmd.handler(self, cmd, &args);
            return;
        }
        if (self.findCvar(name)) |cv| {
            if (args.count() == 1) {
                self.describeShort(cv);
            } else self.userSet(cv, args.get(1));
            return;
        }
        self.printErr("unknown command or cvar \"{s}\". Type: find {s}", .{ name, name });
    }

    // ---- Cvars --------------------------------------------------------------

    fn allowed(self: *const Console, cv: *const Cvar, source: Source) SetError!void {
        const f = cv.def.flags;
        switch (source) {
            .game => {},
            .server => if (!f.server) return error.ReadOnly,
            .user => {
                if (f.server) return error.ServerOwned;
                if (f.read_only) return error.ReadOnly;
                if (f.cheat and !self.cheats) return error.Cheat;
            },
        }
    }

    /// Set a cvar from its text form. Returns true when the value was out
    /// of the limits and is now at a limit.
    pub fn setText(self: *Console, cv: *Cvar, text: []const u8, source: Source) SetError!bool {
        try self.allowed(cv, source);
        const p = cvar_mod.parseText(&cv.def, text) catch return error.BadValue;
        self.storeValue(cv, p.value);
        return p.clamped;
    }

    pub fn setValue(self: *Console, cv: *Cvar, v: Value, source: Source) SetError!bool {
        try self.allowed(cv, source);
        const p = cvar_mod.check(&cv.def, v) catch return error.BadValue;
        self.storeValue(cv, p.value);
        return p.clamped;
    }

    pub fn reset(self: *Console, cv: *Cvar, source: Source) SetError!void {
        try self.allowed(cv, source);
        self.storeValue(cv, cv.def.default);
    }

    fn storeValue(self: *Console, cv: *Cvar, v: Value) void {
        if (cvar_mod.eql(cv.current(), v)) return;
        cv.assign(v);
        if (cv.def.flags.saved) self.markDirty();
    }

    /// A set by a command: report a clamp or an error. In the console (not in
    /// a script), show the new value.
    fn userSet(self: *Console, cv: *Cvar, text: []const u8) void {
        const clamped = self.setText(cv, text, self.source) catch |e| return self.reportSetError(cv, e, text);
        var buf: [cvar_mod.max_string + 8]u8 = undefined;
        if (clamped) {
            self.print("{s} = {s} (\"{s}\" is out of the limits)", .{ cv.def.name, cv.text(&buf), text });
        } else if (self.where_name.len == 0 and self.depth <= 1) {
            self.print("{s} = {s}", .{ cv.def.name, cv.text(&buf) });
        }
    }

    fn reportSetError(self: *Console, cv: *const Cvar, e: SetError, text: []const u8) void {
        switch (e) {
            error.BadValue => self.printErr("{s}: \"{s}\" is not {s}", .{ cv.def.name, text, typeText(cv.def.kind()) }),
            error.ReadOnly => self.printErr("{s} is read only", .{cv.def.name}),
            error.ServerOwned => self.printErr("{s} is a server cvar: only the server changes it", .{cv.def.name}),
            error.Cheat => self.printErr("{s} is a cheat cvar, and cheats are off", .{cv.def.name}),
        }
    }

    /// Set a server cvar to a value that the server sent. A bad value or a
    /// name that is not a server cvar is ignored.
    pub fn setFromServer(self: *Console, name: []const u8, text: []const u8) void {
        const cv = self.findCvar(name) orelse return;
        _ = self.setText(cv, text, .server) catch {};
    }

    /// Put every server cvar back to its default (the game left the server).
    pub fn resetServerCvars(self: *Console) void {
        for (self.cvars.items) |cv| {
            if (cv.def.flags.server) cv.assign(cv.def.default);
        }
    }

    fn describeShort(self: *Console, cv: *const Cvar) void {
        var a: [cvar_mod.max_string + 8]u8 = undefined;
        var b: [cvar_mod.max_string + 8]u8 = undefined;
        self.print("{s} = {s} (default {s}) - {s}", .{ cv.def.name, cv.text(&a), defaultText(cv, &b), cv.def.description });
    }

    fn describeLong(self: *Console, cv: *const Cvar) void {
        var a: [cvar_mod.max_string + 8]u8 = undefined;
        var b: [cvar_mod.max_string + 8]u8 = undefined;
        self.print("{s} = {s} (default {s})", .{ cv.def.name, cv.text(&a), defaultText(cv, &b) });
        var r: [96]u8 = undefined;
        var f: [96]u8 = undefined;
        self.printKind(.dim, "  {s}{s}{s}", .{ typeName(cv.def.kind()), rangeText(&r, &cv.def), flagsText(&f, cv.def.flags) });
        self.print("  {s}", .{cv.def.description});
        self.printKind(.dim, "  Read by: {s}", .{cv.def.reader});
    }

    // ---- Binds --------------------------------------------------------------

    /// The binds of a new player. A key that the player did not change
    /// follows these, so a new default reaches the old saved configs.
    pub fn setDefaultBinds(self: *Console, list: []const DefaultBind) void {
        self.defaults = @splat(null);
        for (list) |d| self.defaults[@backingInt(d.key)] = d.command;
        for (keys.all) |k| self.setBindRaw(k, self.defaults[@backingInt(k)]);
    }

    pub fn bindOf(self: *const Console, k: keys.Input) ?[]const u8 {
        return self.binds[@backingInt(k)];
    }

    /// Bind a key. An empty command removes the bind.
    pub fn setBind(self: *Console, k: keys.Input, command: ?[]const u8) void {
        const c = if (command) |s| (if (std.mem.trim(u8, s, " \t").len == 0) null else s) else null;
        const old = self.binds[@backingInt(k)];
        if (old == null and c == null) return;
        if (old != null and c != null and std.mem.eql(u8, old.?, c.?)) return;
        self.setBindRaw(k, c);
        self.markDirty();
    }

    fn setBindRaw(self: *Console, k: keys.Input, command: ?[]const u8) void {
        const i = @backingInt(k);
        const copy: ?[]u8 = if (command) |s| self.alloc.dupe(u8, s) catch return else null;
        if (self.binds[i]) |old| self.alloc.free(old);
        self.binds[i] = copy;
    }

    /// The first key bound to exactly `command`, for the hints on the
    /// screen ("R TO RELOAD").
    pub fn keyFor(self: *const Console, command: []const u8) ?keys.Input {
        for (keys.all) |k| {
            if (self.binds[@backingInt(k)]) |b| if (std.ascii.eqlIgnoreCase(b, command)) return k;
        }
        return null;
    }

    /// Run the binds of the keys that went down and up in this tick. Nothing
    /// runs while the console or another text line has the keys.
    pub fn processBinds(self: *Console, in: *const core.InputSnapshot) void {
        if (self.hasKeys()) return;
        for (keys.all) |k| {
            // A bind can open the console or the chat.
            if (self.hasKeys()) return;
            if (!keys.pressed(k, in)) continue;
            const b = self.binds[@backingInt(k)] orelse continue;
            self.held[@backingInt(k)] = true;
            // A copy: the bind can change the binds.
            var buf: [256]u8 = undefined;
            const n = @min(b.len, buf.len);
            @memcpy(buf[0..n], b[0..n]);
            self.exec(buf[0..n], .user);
        }
        for (keys.all) |k| {
            if (keys.released(k, in)) self.releaseKey(k);
        }
    }

    fn releaseKey(self: *Console, k: keys.Input) void {
        const i = @backingInt(k);
        if (!self.held[i]) return;
        self.held[i] = false;
        const b = self.binds[i] orelse return;
        var copy: [256]u8 = undefined;
        const n = @min(b.len, copy.len);
        @memcpy(copy[0..n], b[0..n]);
        // The release runs "-x" for each "+x" command of the bind.
        var it = parse.Commands.init(copy[0..n]);
        while (it.next()) |c| {
            if (c.text.len < 2 or c.text[0] != '+') continue;
            var buf: [256]u8 = undefined;
            @memcpy(buf[0..c.text.len], c.text);
            buf[0] = '-';
            self.exec(buf[0..c.text.len], .user);
        }
    }

    /// Release every key that a bind holds (the console opened, the game
    /// lost focus).
    pub fn releaseAll(self: *Console) void {
        for (keys.all) |k| self.releaseKey(k);
    }

    pub fn setOpen(self: *Console, open: bool) void {
        if (open == self.open) return;
        if (open) self.releaseAll();
        self.open = open;
    }

    /// Another text line (the chat) takes the keys, or gives them back.
    /// The keys that a bind holds let go.
    pub fn setTyping(self: *Console, on: bool) void {
        if (on == self.typing) return;
        if (on) self.releaseAll();
        self.typing = on;
    }

    /// The console panel or another text line has the keys.
    pub fn hasKeys(self: *const Console) bool {
        return self.open or self.typing;
    }

    // ---- Scripts ------------------------------------------------------------

    pub fn validScriptName(name: []const u8) bool {
        if (name.len == 0 or name.len > max_script_name) return false;
        for (name) |c| {
            const ok = (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or c == '_' or c == '-';
            if (!ok) return false;
        }
        return true;
    }

    fn scriptKey(buf: *[64]u8, name: []const u8) []const u8 {
        return std.fmt.bufPrint(buf, "script-{s}", .{name}) catch unreachable;
    }

    /// The text of a script, or null. The caller frees it with `alloc`.
    pub fn readScript(self: *Console, name: []const u8) ?[]u8 {
        if (!validScriptName(name)) return null;
        var kb: [64]u8 = undefined;
        return self.store.get(self.store.ctx, self.alloc, scriptKey(&kb, name));
    }

    pub fn writeScript(self: *Console, name: []const u8, text: []const u8) void {
        if (!validScriptName(name)) return;
        var kb: [64]u8 = undefined;
        self.store.set(self.store.ctx, scriptKey(&kb, name), text);
        if (self.hasScript(name)) return;
        const copy = self.alloc.dupe(u8, name) catch return;
        self.scripts.append(self.alloc, copy) catch return self.alloc.free(copy);
        std.mem.sort([]u8, self.scripts.items, {}, lessName);
        self.saveScriptIndex();
    }

    pub fn deleteScript(self: *Console, name: []const u8) void {
        if (!validScriptName(name)) return;
        var kb: [64]u8 = undefined;
        self.store.delete(self.store.ctx, scriptKey(&kb, name));
        for (self.scripts.items, 0..) |s, i| {
            if (!std.mem.eql(u8, s, name)) continue;
            self.alloc.free(self.scripts.orderedRemove(i));
            break;
        }
        self.saveScriptIndex();
    }

    pub fn hasScript(self: *const Console, name: []const u8) bool {
        for (self.scripts.items) |s| if (std.mem.eql(u8, s, name)) return true;
        return false;
    }

    fn lessName(_: void, a: []u8, b: []u8) bool {
        return std.mem.lessThan(u8, a, b);
    }

    fn loadScriptIndex(self: *Console) void {
        const text = self.store.get(self.store.ctx, self.alloc, index_key) orelse return;
        defer self.alloc.free(text);
        var it = std.mem.tokenizeAny(u8, text, "\n\r ");
        while (it.next()) |name| {
            if (!validScriptName(name) or self.hasScript(name)) continue;
            const copy = self.alloc.dupe(u8, name) catch return;
            self.scripts.append(self.alloc, copy) catch return self.alloc.free(copy);
        }
        std.mem.sort([]u8, self.scripts.items, {}, lessName);
    }

    fn saveScriptIndex(self: *Console) void {
        var w: std.Io.Writer.Allocating = .init(self.alloc);
        defer w.deinit();
        for (self.scripts.items) |s| w.writer.print("{s}\n", .{s}) catch return;
        if (self.scripts.items.len == 0) {
            self.store.delete(self.store.ctx, index_key);
        } else self.store.set(self.store.ctx, index_key, w.written());
    }

    /// Run a script. Returns false when it does not exist.
    pub fn execScript(self: *Console, name: []const u8, source: Source) bool {
        const text = self.readScript(name) orelse return false;
        defer self.alloc.free(text);
        // The name is in the editor buffer or in a token: copy it, the
        // script can change both.
        var nb: [max_script_name]u8 = undefined;
        @memcpy(nb[0..name.len], name);
        self.execIn(text, source, nb[0..name.len]);
        return true;
    }

    /// Run the "autoexec" script, if it exists.
    pub fn runAutoexec(self: *Console) void {
        _ = self.execScript("autoexec", .user);
    }

    /// The name of the script in the editor, or null when it is closed.
    pub fn editing(self: *const Console) ?[]const u8 {
        return if (self.edit_len > 0) self.edit_buf[0..self.edit_len] else null;
    }

    /// Open the editor on a script (a new script is empty).
    pub fn startEdit(self: *Console, name: []const u8) void {
        const text = self.readScript(name);
        defer if (text) |t| self.alloc.free(t);
        self.editor.load(self.alloc, text orelse "");
        @memcpy(self.edit_buf[0..name.len], name);
        self.edit_len = name.len;
        self.setOpen(true);
    }

    /// Close the editor and save the script. An empty script is deleted.
    pub fn finishEdit(self: *Console) void {
        const name = self.editing() orelse return;
        var nb: [max_script_name]u8 = undefined;
        @memcpy(nb[0..name.len], name);
        const n = nb[0..name.len];
        self.edit_len = 0;
        const text = self.editor.bytes();
        if (std.mem.trim(u8, text, " \n").len == 0) {
            if (self.hasScript(n)) self.deleteScript(n);
            self.print("{s}: empty, so not saved", .{n});
        } else {
            self.writeScript(n, text);
            self.print("{s}: saved, {d} lines. Type: exec {s}", .{ n, self.editor.lineCount(), n });
        }
    }

    // ---- The saved config ---------------------------------------------------

    pub fn markDirty(self: *Console) void {
        self.dirty_ticks = 0;
    }

    /// Call once a tick. It saves the config `save_delay_ticks` after the
    /// last change, so a slider drag saves once.
    pub fn tick(self: *Console) void {
        const t = &(self.dirty_ticks orelse return);
        t.* += 1;
        if (t.* >= save_delay_ticks) self.saveConfig();
    }

    /// Run the saved config. Returns false when there is none (a new
    /// player, or a player of an older version).
    pub fn loadConfig(self: *Console) bool {
        const text = self.store.get(self.store.ctx, self.alloc, config_key) orelse return false;
        defer self.alloc.free(text);
        self.execIn(text, .user, config_key);
        self.dirty_ticks = null;
        return true;
    }

    /// Write the config: the saved cvars that are not at the default, and
    /// the binds that differ from the defaults. It is a script.
    pub fn saveConfig(self: *Console) void {
        self.dirty_ticks = null;
        var w: std.Io.Writer.Allocating = .init(self.alloc);
        defer w.deinit();
        self.writeConfig(&w.writer) catch return;
        self.store.set(self.store.ctx, config_key, w.written());
    }

    pub fn writeConfig(self: *const Console, w: *std.Io.Writer) !void {
        try w.writeAll("// The game writes this file: the saved cvars that are not at the default,\n");
        try w.writeAll("// and the binds that are not the default. Put your own commands in autoexec.\n");
        for (self.cvars.items) |cv| {
            if (!cv.def.flags.saved or cv.isDefault()) continue;
            var buf: [cvar_mod.max_string + 8]u8 = undefined;
            const t = cvar_mod.format(&buf, cv.current());
            if (parse.quotable(t)) try w.print("set {s} \"{s}\"\n", .{ cv.def.name, t });
        }
        for (keys.all) |k| {
            const i = @backingInt(k);
            const b = self.binds[i];
            const d = self.defaults[i];
            if (b == null and d == null) continue;
            if (b != null and d != null and std.mem.eql(u8, b.?, d.?)) continue;
            if (b) |s| {
                // A command with a double quote came from a bind with no
                // quotes, so it has no ";" outside quotes: write it bare.
                if (parse.quotable(s)) {
                    try w.print("bind {s} \"{s}\"\n", .{ keys.name(k), s });
                } else try w.print("bind {s} {s}\n", .{ keys.name(k), s });
            } else try w.print("unbind {s}\n", .{keys.name(k)});
        }
    }
};

// ---- Text helpers --------------------------------------------------------

fn typeName(t: cvar_mod.Type) []const u8 {
    return switch (t) {
        .bool => "bool (1 or 0)",
        .int => "int",
        .float => "float",
        .string => "string",
    };
}

fn typeText(t: cvar_mod.Type) []const u8 {
    return switch (t) {
        .bool => "1 or 0",
        .int => "a whole number",
        .float => "a number",
        .string => "a text with no double quote",
    };
}

fn defaultText(cv: *const Cvar, buf: []u8) []const u8 {
    if (cv.def.flags.protected) return "empty";
    const t = cvar_mod.format(buf, cv.def.default);
    return if (t.len == 0) "empty" else t;
}

fn rangeText(buf: []u8, def: *const Def) []const u8 {
    var a: [32]u8 = undefined;
    var b: [32]u8 = undefined;
    if (def.min != null and def.max != null) {
        return std.fmt.bufPrint(buf, ", {s} to {s}", .{ cvar_mod.format(&a, .{ .float = def.min.? }), cvar_mod.format(&b, .{ .float = def.max.? }) }) catch "";
    }
    if (def.min) |m| return std.fmt.bufPrint(buf, ", at least {s}", .{cvar_mod.format(&a, .{ .float = m })}) catch "";
    if (def.max) |m| return std.fmt.bufPrint(buf, ", at most {s}", .{cvar_mod.format(&a, .{ .float = m })}) catch "";
    return "";
}

fn flagsText(buf: []u8, f: cvar_mod.Flags) []const u8 {
    var n: usize = 0;
    const names = [_]struct { bool, []const u8 }{
        .{ f.saved, ", saved" },
        .{ f.server, ", server" },
        .{ f.cheat, ", cheat" },
        .{ f.read_only, ", read only" },
        .{ f.protected, ", protected" },
    };
    for (names) |x| {
        if (!x[0]) continue;
        @memcpy(buf[n..][0..x[1].len], x[1]);
        n += x[1].len;
    }
    return buf[0..n];
}

fn containsIgnoreCase(hay: []const u8, needle: []const u8) bool {
    if (needle.len == 0) return true;
    if (needle.len > hay.len) return false;
    var i: usize = 0;
    while (i + needle.len <= hay.len) : (i += 1) {
        if (std.ascii.eqlIgnoreCase(hay[i..][0..needle.len], needle)) return true;
    }
    return false;
}

fn lessCvar(_: void, a: *Cvar, b: *Cvar) bool {
    return std.mem.lessThan(u8, a.def.name, b.def.name);
}

fn lessCommand(_: void, a: *Command, b: *Command) bool {
    return std.mem.lessThan(u8, a.name, b.name);
}

fn usage(con: *Console, cmd: *const Command) void {
    con.printErr("usage: {s} {s}", .{ cmd.name, cmd.args });
}

fn needCvar(con: *Console, cmd: *const Command, name: []const u8) ?*Cvar {
    return con.findCvar(name) orelse {
        con.printErr("{s}: no cvar \"{s}\". Type: find {s}", .{ cmd.name, name, name });
        return null;
    };
}

fn needKey(con: *Console, cmd: *const Command, name: []const u8) ?keys.Input {
    return keys.fromName(name) orelse {
        con.printErr("{s}: no key \"{s}\". The keys: {s}", .{ cmd.name, name, keys.help });
        return null;
    };
}

fn needScriptName(con: *Console, cmd: *const Command, name: []const u8) ?[]const u8 {
    if (Console.validScriptName(name)) return name;
    con.printErr("{s}: \"{s}\" is not a script name: 1 to {d} of a to z, 0 to 9, \"_\" and \"-\"", .{ cmd.name, name, max_script_name });
    return null;
}

// ---- Built-in commands ---------------------------------------------------

const builtins = [_]Command{
    .{ .name = "help", .args = "[name]", .description = "Show how the console works, or show one command or cvar.", .handler = cmdHelp, .complete = .name },
    .{ .name = "find", .args = "<text>", .description = "Search the names and the descriptions of the commands and the cvars.", .handler = cmdFind },
    .{ .name = "cvarlist", .args = "[text]", .description = "List the cvars, or the cvars with the text in the name.", .handler = cmdCvarlist },
    .{ .name = "cmdlist", .args = "[text]", .description = "List the commands, or the commands with the text in the name.", .handler = cmdCmdlist },
    .{ .name = "set", .args = "<cvar> <value>", .description = "Set a cvar. A number out of the limits goes to the limit.", .handler = cmdSet, .complete = .cvar },
    .{ .name = "reset", .args = "<cvar>", .description = "Put a cvar back to its default.", .handler = cmdReset, .complete = .cvar },
    .{ .name = "toggle", .args = "<cvar> [values...]", .description = "Change a 1 or 0 cvar to the other value, or go to the next value in the list.", .handler = cmdToggle, .complete = .cvar },
    .{ .name = "bind", .args = "<key> [command]", .description = "Show the bind of a key, or bind a command to it. A command that starts with + also runs its - command when the key comes up.", .handler = cmdBind, .complete = .key },
    .{ .name = "unbind", .args = "<key>", .description = "Remove the bind of a key.", .handler = cmdUnbind, .complete = .key },
    .{ .name = "bindlist", .description = "List the binds.", .handler = cmdBindlist },
    .{ .name = "resetbinds", .description = "Put every bind back to the default.", .handler = cmdResetbinds },
    .{ .name = "exec", .args = "<script>", .description = "Run a script: one command a line, // starts a comment.", .handler = cmdExec, .complete = .script },
    .{ .name = "edit", .args = "<script>", .description = "Open a script in the editor (a new name makes a new script). Esc saves it and closes the editor.", .handler = cmdEdit, .complete = .script },
    .{ .name = "scriptlist", .description = "List the scripts.", .handler = cmdScriptlist },
    .{ .name = "scriptdel", .args = "<script>", .description = "Delete a script.", .handler = cmdScriptdel, .complete = .script },
    .{ .name = "echo", .args = "<text>", .description = "Show the text in the console.", .handler = cmdEcho },
    .{ .name = "clear", .description = "Clear the console text.", .handler = cmdClear },
    .{ .name = "toggleconsole", .description = "Open or close the console.", .handler = cmdToggleconsole },
};

fn cmdHelp(con: *Console, _: *const Command, args: *const parse.Args) void {
    if (args.count() < 2) {
        con.print("The console runs commands and sets cvars (config variables).", .{});
        con.print("  find <text>  search the names and the descriptions", .{});
        con.print("  cmdlist, cvarlist, bindlist, scriptlist  list them", .{});
        con.print("  help <name>  show one command or cvar", .{});
        con.print("  <cvar>  show the value.  <cvar> <value>  set it", .{});
        con.print("  edit autoexec  write the script that runs at start", .{});
        con.printKind(.dim, "Tab completes. Up and Down go through the history. Shift+Up and Shift+Down scroll. Esc closes.", .{});
        return;
    }
    const name = args.get(1);
    if (con.findCommand(name)) |c| {
        con.print("{s} {s}", .{ c.name, c.args });
        con.print("  {s}", .{c.description});
        return;
    }
    if (con.findCvar(name)) |cv| return con.describeLong(cv);
    con.printErr("help: no command or cvar \"{s}\". Type: find {s}", .{ name, name });
}

fn cmdFind(con: *Console, cmd: *const Command, args: *const parse.Args) void {
    const text = args.get(1);
    if (text.len == 0) return usage(con, cmd);
    var n: usize = 0;
    for (con.commands.items) |c| {
        if (c.hidden or !(containsIgnoreCase(c.name, text) or containsIgnoreCase(c.description, text))) continue;
        con.print("{s} {s} - {s}", .{ c.name, c.args, c.description });
        n += 1;
    }
    for (con.cvars.items) |cv| {
        if (!(containsIgnoreCase(cv.def.name, text) or containsIgnoreCase(cv.def.description, text))) continue;
        var buf: [cvar_mod.max_string + 8]u8 = undefined;
        con.print("{s} = {s} - {s}", .{ cv.def.name, cv.text(&buf), cv.def.description });
        n += 1;
    }
    con.printKind(.dim, "{d} found", .{n});
}

fn cmdCvarlist(con: *Console, _: *const Command, args: *const parse.Args) void {
    const filter = args.get(1);
    const list = con.alloc.dupe(*Cvar, con.cvars.items) catch return;
    defer con.alloc.free(list);
    std.mem.sort(*Cvar, list, {}, lessCvar);
    var n: usize = 0;
    for (list) |cv| {
        if (!containsIgnoreCase(cv.def.name, filter)) continue;
        var buf: [cvar_mod.max_string + 8]u8 = undefined;
        var f: [96]u8 = undefined;
        const flags = flagsText(&f, cv.def.flags);
        con.print("{s} = {s}{s}{s}{s} - {s}", .{
            cv.def.name,                      cv.text(&buf),
            if (flags.len > 0) "  [" else "", if (flags.len > 0) flags[2..] else "",
            if (flags.len > 0) "]" else "",   cv.def.description,
        });
        n += 1;
    }
    con.printKind(.dim, "{d} cvars", .{n});
}

fn cmdCmdlist(con: *Console, _: *const Command, args: *const parse.Args) void {
    const filter = args.get(1);
    const list = con.alloc.dupe(*Command, con.commands.items) catch return;
    defer con.alloc.free(list);
    std.mem.sort(*Command, list, {}, lessCommand);
    var n: usize = 0;
    for (list) |c| {
        if (c.hidden or !containsIgnoreCase(c.name, filter)) continue;
        con.print("{s} {s} - {s}", .{ c.name, c.args, c.description });
        n += 1;
    }
    con.printKind(.dim, "{d} commands", .{n});
}

fn cmdSet(con: *Console, cmd: *const Command, args: *const parse.Args) void {
    if (args.count() < 3) return usage(con, cmd);
    const cv = needCvar(con, cmd, args.get(1)) orelse return;
    con.userSet(cv, args.get(2));
}

fn cmdReset(con: *Console, cmd: *const Command, args: *const parse.Args) void {
    if (args.count() < 2) return usage(con, cmd);
    const cv = needCvar(con, cmd, args.get(1)) orelse return;
    con.reset(cv, con.source) catch |e| return con.reportSetError(cv, e, "");
    var buf: [cvar_mod.max_string + 8]u8 = undefined;
    if (con.where_name.len == 0) con.print("{s} = {s}", .{ cv.def.name, cv.text(&buf) });
}

fn cmdToggle(con: *Console, cmd: *const Command, args: *const parse.Args) void {
    if (args.count() < 2) return usage(con, cmd);
    const cv = needCvar(con, cmd, args.get(1)) orelse return;
    if (args.count() == 2) {
        const next: []const u8 = switch (cv.def.kind()) {
            .string => return con.printErr("toggle: {s} is a string: give the values (toggle {s} a b)", .{ cv.def.name, cv.def.name }),
            else => if (cv.on()) "0" else "1",
        };
        return con.userSet(cv, next);
    }
    // The value after the current one in the list, or the first one.
    var buf: [cvar_mod.max_string + 8]u8 = undefined;
    const now = cv.text(&buf);
    var pick: usize = 2;
    for (2..args.count()) |i| {
        const p = cvar_mod.parseText(&cv.def, args.get(i)) catch continue;
        var b2: [cvar_mod.max_string + 8]u8 = undefined;
        if (std.mem.eql(u8, cvar_mod.format(&b2, p.value), now)) {
            pick = if (i + 1 < args.count()) i + 1 else 2;
            break;
        }
    }
    con.userSet(cv, args.get(pick));
}

fn cmdBind(con: *Console, cmd: *const Command, args: *const parse.Args) void {
    if (args.count() < 2) return usage(con, cmd);
    const k = needKey(con, cmd, args.get(1)) orelse return;
    if (args.count() == 2) {
        if (con.bindOf(k)) |b| {
            con.print("{s} = \"{s}\"", .{ keys.name(k), b });
        } else con.print("{s} is not bound", .{keys.name(k)});
        return;
    }
    // One argument: its text with no quotes. More: the rest of the line.
    const command = if (args.count() == 3) args.get(2) else args.rest(2);
    con.setBind(k, command);
}

fn cmdUnbind(con: *Console, cmd: *const Command, args: *const parse.Args) void {
    if (args.count() < 2) return usage(con, cmd);
    const k = needKey(con, cmd, args.get(1)) orelse return;
    con.setBind(k, null);
}

fn cmdBindlist(con: *Console, _: *const Command, _: *const parse.Args) void {
    var n: usize = 0;
    for (keys.all) |k| {
        const b = con.bindOf(k) orelse continue;
        con.print("{s} = \"{s}\"", .{ keys.name(k), b });
        n += 1;
    }
    con.printKind(.dim, "{d} binds", .{n});
}

fn cmdResetbinds(con: *Console, _: *const Command, _: *const parse.Args) void {
    for (keys.all) |k| con.setBind(k, con.defaults[@backingInt(k)]);
    con.print("every bind is the default again", .{});
}

fn cmdExec(con: *Console, cmd: *const Command, args: *const parse.Args) void {
    if (args.count() < 2) return usage(con, cmd);
    var lower: [max_script_name + 1]u8 = undefined;
    const raw = args.get(1);
    if (raw.len > max_script_name) return con.printErr("exec: no script \"{s}\"", .{raw});
    const name = needScriptName(con, cmd, std.ascii.lowerString(&lower, raw)) orelse return;
    if (!con.execScript(name, con.source)) con.printErr("exec: no script \"{s}\". Type: scriptlist", .{name});
}

fn cmdEdit(con: *Console, cmd: *const Command, args: *const parse.Args) void {
    if (args.count() < 2) return usage(con, cmd);
    var lower: [max_script_name + 1]u8 = undefined;
    const raw = args.get(1);
    if (raw.len > max_script_name) return con.printErr("edit: the name is longer than {d}", .{max_script_name});
    const name = needScriptName(con, cmd, std.ascii.lowerString(&lower, raw)) orelse return;
    con.startEdit(name);
}

fn cmdScriptlist(con: *Console, _: *const Command, _: *const parse.Args) void {
    for (con.scripts.items) |s| con.print("{s}", .{s});
    con.printKind(.dim, "{d} scripts. Type: edit <name>", .{con.scripts.items.len});
}

fn cmdScriptdel(con: *Console, cmd: *const Command, args: *const parse.Args) void {
    if (args.count() < 2) return usage(con, cmd);
    const name = needScriptName(con, cmd, args.get(1)) orelse return;
    if (!con.hasScript(name)) return con.printErr("scriptdel: no script \"{s}\"", .{name});
    var nb: [max_script_name]u8 = undefined;
    @memcpy(nb[0..name.len], name);
    con.deleteScript(nb[0..name.len]);
    con.print("{s}: deleted", .{nb[0..name.len]});
}

fn cmdEcho(con: *Console, _: *const Command, args: *const parse.Args) void {
    var buf: [1024]u8 = undefined;
    var n: usize = 0;
    for (1..args.count()) |i| {
        const t = args.get(i);
        if (n + t.len + 1 > buf.len) break;
        if (i > 1) {
            buf[n] = ' ';
            n += 1;
        }
        @memcpy(buf[n..][0..t.len], t);
        n += t.len;
    }
    con.print("{s}", .{buf[0..n]});
}

fn cmdClear(con: *Console, _: *const Command, _: *const parse.Args) void {
    con.out.clear();
}

fn cmdToggleconsole(con: *Console, _: *const Command, _: *const parse.Args) void {
    con.setOpen(!con.open);
}
