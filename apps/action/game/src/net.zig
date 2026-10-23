// The deathmatch client: a WebSocket (backends/wasm/net.ts) with JSON text
// messages. The protocol is in apps/action/server/src/index.ts.
const std = @import("std");

extern "net" fn netOpen(ptr: [*]const u8, len: u32) i32;
extern "net" fn netState(h: i32) i32;
extern "net" fn netSend(h: i32, ptr: [*]const u8, len: u32) i32;
extern "net" fn netRecv(h: i32, ptr: [*]u8, cap: u32) i32;
extern "net" fn netClose(h: i32) i32;

pub const State = enum { idle, connecting, open, closed };

pub const PlayerMsg = struct {
    id: u32,
    name: []const u8 = "",
    x: f32 = 0,
    y: f32 = 0,
    z: f32 = 0,
    yaw: f32 = 0,
    pitch: f32 = 0,
    /// The lean: -1 left, 0 upright, 1 right.
    lean: f32 = 0,
    hp: i32 = 100,
    k: u32 = 0,
    d: u32 = 0,
    alive: bool = true,
    /// The held weapon: its class (weapon.Class) and its model.
    w: u32 = 0,
    m: u32 = 0,
};

/// One server message. `t` names the kind; the other fields are optional.
pub const Msg = struct {
    t: []const u8,
    id: ?u32 = null,
    phase: ?[]const u8 = null,
    left: ?f32 = null,
    players: ?[]PlayerMsg = null,
    x: ?f32 = null,
    y: ?f32 = null,
    z: ?f32 = null,
    yaw: ?f32 = null,
    o: ?[3]f32 = null,
    e: ?[3]f32 = null,
    from: ?u32 = null,
    dmg: ?i32 = null,
    hp: ?i32 = null,
    killer: ?u32 = null,
    victim: ?u32 = null,
    head: ?bool = null,
    kname: ?[]const u8 = null,
    vname: ?[]const u8 = null,
    // A lift call: lift i to level l.
    i: ?u32 = null,
    l: ?u32 = null,
    // The lifts in a snapshot: [y, door, level, phase] each.
    lifts: ?[][4]f32 = null,
    // The deep train clock, seconds into its cycle.
    tt: ?f32 = null,
    // A grenade throw (t "nade"): the velocity. `o` is the start point and
    // `id` the thrower.
    v: ?[3]f32 = null,
    // A shot (t "shot"): the class of the weapon.
    w: ?u32 = null,
    // The weapons of a life (t "spawn" and "loadout"): the primary and the
    // secondary, as [class, model].
    p: ?[2]u32 = null,
    s: ?[2]u32 = null,
    // A ping (t "ping"): its number. poll answers it.
    n: ?u32 = null,
    // The pings of the players (t "pings"): [id, ms, stale] each. ms is -1
    // before the first value. stale is 1 after 10 s with no answer.
    ms: ?[][3]i32 = null,
};

pub const Client = struct {
    handle: i32 = 0,
    buf: [64 * 1024]u8 = undefined,
    arena: std.heap.ArenaAllocator,

    pub fn init() Client {
        return .{ .arena = std.heap.ArenaAllocator.init(std.heap.wasm_allocator) };
    }

    pub fn connect(self: *Client) void {
        if (self.handle != 0) _ = netClose(self.handle);
        const path = "/api/ws";
        self.handle = netOpen(path.ptr, path.len);
    }

    pub fn close(self: *Client) void {
        if (self.handle != 0) _ = netClose(self.handle);
        self.handle = 0;
    }

    pub fn state(self: *const Client) State {
        if (self.handle == 0) return .idle;
        return switch (netState(self.handle)) {
            0 => .connecting,
            1 => .open,
            else => .closed,
        };
    }

    pub fn send(self: *Client, comptime fmt: []const u8, args: anytype) void {
        if (self.handle == 0) return;
        var out: [512]u8 = undefined;
        const text = std.fmt.bufPrint(&out, fmt, args) catch return;
        _ = netSend(self.handle, text.ptr, @intCast(text.len));
    }

    /// Free the messages of the last poll. Call once per frame, before poll.
    pub fn beginFrame(self: *Client) void {
        _ = self.arena.reset(.retain_capacity);
    }

    /// The next message, or null. The message lives until beginFrame.
    pub fn poll(self: *Client) ?Msg {
        if (self.handle == 0) return null;
        while (true) {
            const n = netRecv(self.handle, &self.buf, self.buf.len);
            if (n == 0) return null;
            if (n < 0) continue;
            const text = self.buf[0..@intCast(n)];
            const parsed = std.json.parseFromSliceLeaky(Msg, self.arena.allocator(), text, .{
                .ignore_unknown_fields = true,
                .allocate = .alloc_always,
            }) catch continue;
            // A ping from the server (server/ping.ts): answer at once.
            if (std.mem.eql(u8, parsed.t, "ping")) {
                if (parsed.n) |seq| self.send("{{\"t\":\"pong\",\"n\":{d}}}", .{seq});
                continue;
            }
            return parsed;
        }
    }
};
