// The connection to an online server, as a state machine. The game owns
// the socket. Each tick it gives the session the socket state (step), and
// it gives the session the welcome and the bye messages. The session says
// when to open the socket and what each welcome means (ident.zig).
//
//   offline       no online mode
//   connecting    the socket opens (the first try or a retry)
//   handshake     the socket is open: wait for the welcome
//   joined        the welcome was good: the game sent its join message
//   lost          the socket closed: wait, then try again
//   incompatible  the server has a different protocol: no more tries.
//                 The player must reload the page.
//
// The wait after a lost connection doubles at each failed try, from
// first_delay to max_delay. A good welcome sets it back to first_delay.
// A socket that does not open in connect_timeout, or a server that gives
// no welcome in handshake_timeout, counts as a lost connection.
//
// The console command "version" (register) prints the versions of the
// client and of the server, the instance id and the state.
//
// This file imports nothing from a game. It needs std and the console
// framework (console/).
const std = @import("std");
const ident_mod = @import("ident.zig");
const console_mod = @import("../console/console.zig");
const parse = @import("../console/parse.zig");

const Ident = ident_mod.Ident;
const Kept = ident_mod.Kept;
const Local = ident_mod.Local;
const Verdict = ident_mod.Verdict;
const Console = console_mod.Console;

/// The wait before the first retry, in seconds.
pub const first_delay: f32 = 1;
/// The longest wait between two tries, in seconds.
pub const max_delay: f32 = 10;
/// A socket that is not open after this many seconds counts as lost.
pub const connect_timeout: f32 = 10;
/// A server that gives no welcome this many seconds after the open counts
/// as lost.
pub const handshake_timeout: f32 = 5;

/// The wait before try number `attempt` + 1, after `attempt` failed tries.
pub fn retryDelay(attempt: u32) f32 {
    if (attempt == 0) return 0;
    const doublings: u5 = @intCast(@min(attempt - 1, 16));
    const d = first_delay * @as(f32, @floatFromInt(@as(u32, 1) << doublings));
    return @min(max_delay, d);
}

pub const State = enum { offline, connecting, handshake, joined, lost, incompatible };

/// The state of the socket of the game.
pub const Socket = enum { idle, connecting, open, closed };

/// What the game must do after a step.
pub const Step = enum {
    none,
    /// Open the socket: a first try or a retry.
    connect,
    /// The socket closed. Show it. The session tries again later.
    lost,
    /// The socket did not open, or the server gave no welcome, in time.
    /// Close the socket. The session tries again later.
    timed_out,
};

pub const Session = struct {
    local: Local,
    state: State = .offline,
    /// The time of the last change of state, in seconds.
    since: f32 = 0,
    /// The time of the last step.
    now: f32 = 0,
    /// Failed tries since the last join.
    attempt: u32 = 0,
    retry_at: f32 = 0,
    /// The server of the last welcome.
    server: ?Kept = null,
    /// The verdict of the last welcome.
    verdict: ?Verdict = null,
    /// The session saw a server of another build: the page must reload
    /// to update. It stays true until the page reloads.
    update: bool = false,
    /// The reason of the last bye, until the next join. Empty: no bye.
    reason: Reason = .{},

    pub const Reason = struct {
        buf: [120]u8 = undefined,
        len: usize = 0,

        pub fn get(self: *const Reason) []const u8 {
            return self.buf[0..self.len];
        }
    };

    pub fn init(local: Local) Session {
        return .{ .local = local };
    }

    /// Start to connect: an online mode starts.
    pub fn start(self: *Session, now: f32) Step {
        self.attempt = 0;
        self.reason.len = 0;
        self.set(.connecting, now);
        return .connect;
    }

    /// The online mode ends. The server and the update flag stay.
    pub fn stop(self: *Session, now: f32) void {
        self.set(.offline, now);
    }

    pub fn joined(self: *const Session) bool {
        return self.state == .joined;
    }

    /// Call each tick, after the messages of the tick.
    pub fn step(self: *Session, now: f32, sock: Socket) Step {
        self.now = now;
        const gone = sock == .closed or sock == .idle;
        switch (self.state) {
            .offline, .incompatible => return .none,
            .connecting => {
                if (sock == .open) {
                    self.set(.handshake, now);
                } else if (gone) {
                    self.lose(now);
                    return .lost;
                } else if (now - self.since > connect_timeout) {
                    self.lose(now);
                    return .timed_out;
                }
            },
            .handshake => {
                if (gone) {
                    self.lose(now);
                    return .lost;
                }
                if (now - self.since > handshake_timeout) {
                    self.lose(now);
                    return .timed_out;
                }
            },
            .joined => if (gone) {
                self.lose(now);
                return .lost;
            },
            .lost => if (now >= self.retry_at) {
                self.set(.connecting, now);
                return .connect;
            },
        }
        return .none;
    }

    /// A welcome from the server. The result is null when no welcome was
    /// due. For new_protocol the game must close the socket and must not
    /// join. For the other verdicts the game sends its join message, and
    /// the state of the match comes from the server.
    pub fn welcome(self: *Session, now: f32, id: Ident) ?Verdict {
        if (self.state != .connecting and self.state != .handshake) return null;
        const last: ?Ident = if (self.server) |*k| k.ident() else null;
        const v = ident_mod.compare(self.local, last, id);
        self.server = Kept.init(id);
        self.verdict = v;
        if (v == .new_protocol) {
            self.update = true;
            self.set(.incompatible, now);
            return v;
        }
        if (v == .new_build) self.update = true;
        self.attempt = 0;
        self.reason.len = 0;
        self.set(.joined, now);
        return v;
    }

    /// A bye from the server: it closes the connection next.
    pub fn bye(self: *Session, reason: []const u8) void {
        self.reason.len = @min(reason.len, self.reason.buf.len);
        @memcpy(self.reason.buf[0..self.reason.len], reason[0..self.reason.len]);
    }

    /// Try again at once (the player asked).
    pub fn retryNow(self: *Session, now: f32) void {
        if (self.state == .lost) self.retry_at = now;
    }

    /// The seconds to the next try, while the state is lost.
    pub fn retryIn(self: *const Session, now: f32) f32 {
        return @max(0, self.retry_at - now);
    }

    fn lose(self: *Session, now: f32) void {
        self.attempt +|= 1;
        self.retry_at = now + retryDelay(self.attempt);
        self.set(.lost, now);
    }

    fn set(self: *Session, s: State, now: f32) void {
        self.state = s;
        self.since = now;
        self.now = now;
    }

    // ---- The console -------------------------------------------------------

    /// Add the command "version". The session must stay at this address.
    pub fn register(self: *Session, con: *Console) !void {
        try con.addCommand(.{
            .name = "version",
            .description = "Show the build and the protocol of the game and of the server, the instance id of the server and the connection.",
            .handler = cmdVersion,
            .ctx = self,
        });
    }

    /// Print the versions and the state to the console.
    pub fn printTo(self: *const Session, con: *Console) void {
        con.print("game:   build {s}, protocol {d}", .{ self.local.build, self.local.protocol });
        if (self.server) |*k| {
            con.print("server: build {s}, protocol {d}", .{ k.build.get(), k.protocol });
            con.print("        instance {s}, started {s}", .{ k.instance.get(), k.started.get() });
        } else con.print("server: none yet. The server shows after a join.", .{});
        switch (self.state) {
            .offline => con.print("connection: offline", .{}),
            .connecting, .handshake => con.print("connection: connecting", .{}),
            .joined => con.print("connection: joined ({s})", .{verdictText(self.verdict orelse .first)}),
            .lost => con.print("connection: lost, the next try in {d:.0} s (try {d})", .{ @ceil(self.retryIn(self.now)), self.attempt + 1 }),
            .incompatible => con.printErr("connection: the server has a new protocol. Reload the page to play.", .{}),
        }
        if (self.reason.len > 0) con.print("the server said: {s}", .{self.reason.get()});
        if (self.update and self.state != .incompatible) con.print("A new version is live. Reload the page to update.", .{});
    }
};

/// A short text for a verdict.
pub fn verdictText(v: Verdict) []const u8 {
    return switch (v) {
        .first => "the same build",
        .same_instance => "the same server",
        .restarted => "the server restarted",
        .new_build => "a new build is live",
        .new_protocol => "a new protocol",
    };
}

fn cmdVersion(con: *Console, cmd: *const console_mod.Command, _: *const parse.Args) void {
    const self: *const Session = @ptrCast(@alignCast(cmd.ctx.?));
    self.printTo(con);
}
