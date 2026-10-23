// The action game's side of the console framework (console/): the game
// actions and their default binds, the server cvars (server_cvars.json),
// rcon, the chat, and the messages of the server that change the console
// or the chat. settings.zig adds the cvars of the settings panel,
// sounds.zig the cvars of the bullet sounds, and body.zig own_body. The
// session (session/) adds the command "version". This file adds "reload".
//
// The console key is the backtick key. swindowzig has no key code for it:
// the web backend sends every key that it does not know as Unknown, and
// src/boot.ts stops every unknown key except the backtick key. So Unknown
// is the backtick key here (main.zig tick).
//
// The chat: Y (messagemode) opens it to all players, T (messagemode2) to
// the team. The "/" key opens it with "/" typed: a command line. "/" has
// no key code either, so it cannot have a bind. src/boot.ts sends the "/"
// key as the text "/" while no text input is on (slashTyped).
const std = @import("std");
const builtin = @import("builtin");
const core = @import("sw_core");
const gfx = @import("sw_gfx2d");
const sw_text = @import("sw_text");
const platform = @import("sw_platform");
const console = @import("console/root.zig");
const net = @import("net.zig");
const settings = @import("settings.zig");
const body = @import("body.zig");
const session = @import("session/root.zig");
const sounds = @import("sounds.zig");

// src/boot.ts gives it: location.reload().
extern fn jsReload() void;

/// The game actions. Each one is a button: "+forward" and "-forward".
pub const Action = enum {
    forward,
    back,
    moveleft,
    moveright,
    jump,
    attack,
    aim,
    reload,
    grenade,
    use,
    leanleft,
    leanright,
    slot1,
    slot2,
    slot3,
    slot4,
    weaponmenu,
    scores,
    pause,
    menu,
};

const action_help = std.enums.EnumArray(Action, []const u8).init(.{
    .forward = "Move forward.",
    .back = "Move back.",
    .moveleft = "Move to the left.",
    .moveright = "Move to the right.",
    .jump = "Jump.",
    .attack = "Fire, swing the knife, or throw the grenade in the hand.",
    .aim = "Aim down the sights while held.",
    .reload = "Reload.",
    .grenade = "Throw a grenade at once, from any slot.",
    .use = "Use: press the button under the crosshair (the lifts, the panel of the NPC shooter).",
    .leanleft = "Lean to the left while held.",
    .leanright = "Lean to the right while held.",
    .slot1 = "Take the primary weapon.",
    .slot2 = "Take the secondary weapon.",
    .slot3 = "Take the knife.",
    .slot4 = "Take a grenade. A click throws it.",
    .weaponmenu = "Open or close the weapon menu.",
    .scores = "Show the scores while held.",
    .pause = "Free the mouse (the pause screen). On Esc the browser frees it in any case.",
    .menu = "Go to the main menu, from the pause screen.",
});

/// The controls of the game before the binds existed.
pub const default_binds = [_]console.DefaultBind{
    .{ .key = .w, .command = "+forward" },
    .{ .key = .s, .command = "+back" },
    .{ .key = .a, .command = "+moveleft" },
    .{ .key = .d, .command = "+moveright" },
    .{ .key = .space, .command = "+jump" },
    .{ .key = .mouse1, .command = "+attack" },
    .{ .key = .mouse2, .command = "+aim" },
    .{ .key = .r, .command = "+reload" },
    .{ .key = .g, .command = "+grenade" },
    .{ .key = .f, .command = "+use" },
    .{ .key = .q, .command = "+leanleft" },
    .{ .key = .e, .command = "+leanright" },
    .{ .key = .@"1", .command = "+slot1" },
    .{ .key = .@"2", .command = "+slot2" },
    .{ .key = .@"3", .command = "+slot3" },
    .{ .key = .@"4", .command = "+slot4" },
    .{ .key = .b, .command = "+weaponmenu" },
    .{ .key = .tab, .command = "+scores" },
    .{ .key = .escape, .command = "+pause" },
    .{ .key = .m, .command = "+menu" },
    .{ .key = .y, .command = "messagemode" },
    .{ .key = .t, .command = "messagemode2" },
};

pub var con: console.Console = undefined;
pub var act: console.Buttons(Action) = .{};
pub var view: console.View = .{};
pub var chat: console.Chat = .{};
pub var chat_view: console.ChatView = .{};
var defs_arena: std.heap.ArenaAllocator = undefined;
var client: *net.Client = undefined;
var rcon_password: *console.Cvar = undefined;

const store: console.Store = .{ .get = storeGet, .set = storeSet, .delete = storeDelete };

fn storeGet(_: ?*anyopaque, alloc: std.mem.Allocator, key: []const u8) ?[]u8 {
    return platform.storageGet(alloc, key) catch null;
}

fn storeSet(_: ?*anyopaque, key: []const u8, bytes: []const u8) void {
    platform.storageSet(key, bytes) catch {};
}

fn storeDelete(_: ?*anyopaque, key: []const u8) void {
    platform.storageDelete(key) catch {};
}

/// The errors of the console also go to the browser console, so an error
/// in a script or in the saved config shows there too.
fn logLine(kind: console.LineKind, text: []const u8) void {
    if (kind == .err) std.log.warn("console: {s}", .{text});
}

/// Make the console: the actions, the cvars, the commands and the binds,
/// then the saved config and the autoexec script.
pub fn init(alloc: std.mem.Allocator, net_client: *net.Client, sess: *session.Session) !void {
    client = net_client;
    con = try console.Console.init(alloc, store);
    // Cheat cvars and commands: debug builds only (OPTIMIZE=Debug build.sh).
    con.cheats = builtin.mode == .debug;
    con.on_print = logLine;
    try act.register(&con, action_help);
    try settings.register(&con);
    try sounds.register(&con);
    try body.register(&con);
    defs_arena = .init(alloc);
    try console.schema.addJsonCvars(&con, defs_arena.allocator(), @embedFile("server_cvars.json"), .{ .server = true });
    try chat.register(&con);
    chat.send_fn = sendChat;
    chat.limit = con.findCvar("chat_max_length");
    rcon_password = try con.addCvar(.{
        .name = "rcon_password",
        .default = .{ .string = "" },
        .flags = .{ .protected = true },
        .description = "The password that rcon sends: the admin_password of the server. It is not saved.",
        .reader = "game_console.zig cmdRcon",
    });
    try con.addCommand(.{
        .name = "rcon",
        .args = "<command>",
        .description = "Run a command on the deathmatch server, for example: rcon set match_seconds 600. Set rcon_password first.",
        .handler = cmdRcon,
        .complete = .name,
    });
    try sess.register(&con);
    try con.addCommand(.{
        .name = "reload",
        .description = "Reload the page: the browser gets the newest version of the game.",
        .handler = cmdReload,
    });
    con.setDefaultBinds(&default_binds);
    // A player of an older version has no saved config: the settings
    // panel values carry over one time.
    if (!con.loadConfig()) settings.migrate(&con, alloc);
    con.runAutoexec();
    con.printKind(.dim, "Type help, or find <text>. Tab completes.", .{});
}

fn cmdRcon(c: *console.Console, cmd: *const console.Command, args: *const console.Args) void {
    if (args.count() < 2) return c.printErr("usage: {s} {s}", .{ cmd.name, cmd.args });
    if (client.state() != .open) return c.printErr("rcon: no server. Rcon works in deathmatch", .{});
    if (rcon_password.string().len == 0) return c.printErr("rcon: set rcon_password first", .{});
    client.send("{{\"t\":\"rcon\",\"pw\":{f},\"cmd\":{f}}}", .{
        std.json.fmt(rcon_password.string(), .{}), std.json.fmt(args.rest(1), .{}),
    });
}

fn cmdReload(_: *console.Console, _: *const console.Command, _: *const console.Args) void {
    reloadPage();
}

/// Reload the page, for a new version of the game.
pub fn reloadPage() void {
    jsReload();
}

/// A line of this game about the server, in the chat: the colour of the
/// server lines. For example "The server restarted."
pub fn notice(text: []const u8) void {
    chat.add(.{ .kind = .server, .name = "", .text = text, .rgb = null });
}

/// The server cvars from a "cvars" message: [name, value] pairs.
pub fn onServerCvars(list: []const [2][]const u8) void {
    for (list) |p| con.setFromServer(p[0], p[1]);
}

/// A line from the server (the answer to rcon).
pub fn onServerPrint(text: []const u8) void {
    con.print("server: {s}", .{text});
}

/// The game left the server: the server cvars go back to their defaults.
pub fn leftServer() void {
    con.resetServerCvars();
}

/// The key of an action for a hint on the screen ("R", "LEFT CLICK"), or
/// "-" when no key has it.
pub fn keyLabel(buf: *[24]u8, a: Action) []const u8 {
    var cb: [24]u8 = undefined;
    const command = std.fmt.bufPrint(&cb, "+{s}", .{@tagName(a)}) catch return "-";
    return commandKeyLabel(buf, command);
}

/// The key of a command for a hint on the screen, or "-".
pub fn commandKeyLabel(buf: *[24]u8, command: []const u8) []const u8 {
    const k = con.keyFor(command) orelse return "-";
    return switch (k) {
        .mouse1 => "LEFT CLICK",
        .mouse2 => "RIGHT CLICK",
        .mouse3 => "MIDDLE CLICK",
        else => std.ascii.upperString(buf, console.keys.name(k)),
    };
}

// ---- The chat --------------------------------------------------------------

/// Send a chat message to the deathmatch server (server/index.ts onChat).
fn sendChat(_: ?*anyopaque, channel: console.chat.Channel, text: []const u8) ?[]const u8 {
    if (client.state() != .open) return "chat: no server. Chat works in deathmatch. A line that starts with / runs a command";
    client.send("{{\"t\":\"chat\",\"ch\":\"{s}\",\"text\":{f}}}", .{ @tagName(channel), std.json.fmt(text, .{}) });
    return null;
}

/// A chat message from the server: a player message ("all" or "team"),
/// or a server line ("server": a join, a leave, a match start or end).
/// `rgb` is the colour of the sender.
pub fn onChat(ch: []const u8, name: []const u8, text: []const u8, rgb: [3]u8) void {
    const kind: console.chat.Kind = if (std.mem.eql(u8, ch, "team"))
        .team
    else if (std.mem.eql(u8, ch, "all"))
        .all
    else
        .server;
    chat.add(.{ .kind = kind, .name = name, .text = text, .rgb = if (kind == .server) null else rgb });
}

/// True when the events of a tick hold the "/" key: src/boot.ts sends it
/// as the text "/" while no text input is on. While the console or the
/// chat is open, "/" is typed text.
pub fn slashTyped(events: []const core.Event) bool {
    for (events) |*ev| {
        if (console.prompt.typedText(ev)) |t| if (std.mem.eql(u8, t, "/")) return true;
    }
    return false;
}

/// Draw the chat: the left column, above the minimap (main.zig
/// drawMinimap), below the match clock.
pub fn drawChat(r: *gfx.Renderer, t: *sw_text.TextRenderer, w: f32, h: f32) !void {
    try chat_view.draw(&chat, &con, r, t, 20, 84, h - 290, @min(560, w - 40));
}
