// zig build test: the session layer. The compare of a welcome with the
// last server and the client, the retry wait and its cap, and the state
// machine through a lost connection, a restart, a new build, a new
// protocol, a bye and the timeouts.
const std = @import("std");
const ident = @import("ident.zig");
const session = @import("session.zig");
const console = @import("../console/console.zig");

const testing = std.testing;
const Ident = ident.Ident;
const Session = session.Session;

const local: ident.Local = .{ .build = "abc", .protocol = 3 };

fn server(instance: []const u8, build: []const u8, protocol: u32) Ident {
    return .{ .instance = instance, .build = build, .protocol = protocol, .started = "2026-10-23T10:00:00.000Z" };
}

test "compare: each verdict" {
    const a = server("i1", "abc", 3);
    try testing.expectEqual(.first, ident.compare(local, null, a));
    try testing.expectEqual(.same_instance, ident.compare(local, a, server("i1", "abc", 3)));
    try testing.expectEqual(.restarted, ident.compare(local, a, server("i2", "abc", 3)));
    try testing.expectEqual(.new_build, ident.compare(local, a, server("i2", "def", 3)));
    try testing.expectEqual(.new_protocol, ident.compare(local, a, server("i2", "def", 4)));
    // The protocol counts first, also on the same instance.
    try testing.expectEqual(.new_protocol, ident.compare(local, null, server("i1", "abc", 2)));
}

test "compare: the build compares with the client, not with the last server" {
    // The first server is already newer than the page.
    try testing.expectEqual(.new_build, ident.compare(local, null, server("i1", "def", 3)));
    // A restart of that newer build is still a new build for this page.
    try testing.expectEqual(.new_build, ident.compare(local, server("i1", "def", 3), server("i2", "def", 3)));
    // The same instance stays the same instance.
    try testing.expectEqual(.same_instance, ident.compare(local, server("i1", "def", 3), server("i1", "def", 3)));
}

test "retry wait: doubles, with a cap" {
    try testing.expectEqual(@as(f32, 0), session.retryDelay(0));
    try testing.expectEqual(session.first_delay, session.retryDelay(1));
    try testing.expectEqual(session.first_delay * 2, session.retryDelay(2));
    try testing.expectEqual(session.first_delay * 4, session.retryDelay(3));
    try testing.expectEqual(session.max_delay, session.retryDelay(10));
    try testing.expectEqual(session.max_delay, session.retryDelay(std.math.maxInt(u32)));
    var n: u32 = 1;
    while (n < 40) : (n += 1) try testing.expect(session.retryDelay(n) <= session.max_delay);
}

/// Connect and join `id` from the start. Returns the verdict.
fn join(s: *Session, now: f32, id: Ident) !ident.Verdict {
    try testing.expectEqual(.none, s.step(now, .open));
    try testing.expectEqual(.handshake, s.state);
    return s.welcome(now, id).?;
}

test "session: join, lose, retry with a growing wait, join the same server" {
    var s = Session.init(local);
    try testing.expectEqual(.none, s.step(0, .idle));
    try testing.expectEqual(.connect, s.start(0));
    try testing.expectEqual(.none, s.step(0.1, .connecting));
    try testing.expectEqual(.first, try join(&s, 0.2, server("i1", "abc", 3)));
    try testing.expect(s.joined());
    try testing.expect(!s.update);

    // The socket closes: lost, the first retry after first_delay.
    try testing.expectEqual(.lost, s.step(5, .closed));
    try testing.expectEqual(.lost, s.state);
    try testing.expectEqual(session.first_delay, s.retryIn(5));
    try testing.expectEqual(.none, s.step(5.5, .closed));
    try testing.expectEqual(.connect, s.step(5 + session.first_delay, .closed));
    try testing.expectEqual(.connecting, s.state);

    // The server is still down: the wait doubles.
    var now: f32 = 6;
    try testing.expectEqual(.lost, s.step(now, .closed));
    try testing.expectEqual(session.first_delay * 2, s.retryIn(now));
    // The game does not freeze: each step returns at once, and the waits
    // stop at max_delay.
    var tries: u32 = 0;
    while (tries < 20) : (tries += 1) {
        now += s.retryIn(now);
        try testing.expectEqual(.connect, s.step(now, .closed));
        try testing.expectEqual(.lost, s.step(now, .closed));
        try testing.expect(s.retryIn(now) <= session.max_delay);
    }
    try testing.expectEqual(session.max_delay, s.retryIn(now));

    // The player asks for a try now.
    s.retryNow(now);
    try testing.expectEqual(.connect, s.step(now, .closed));
    try testing.expectEqual(.same_instance, try join(&s, now, server("i1", "abc", 3)));
    try testing.expectEqual(@as(u32, 0), s.attempt);

    // The next loss starts again at first_delay.
    try testing.expectEqual(.lost, s.step(now + 1, .closed));
    try testing.expectEqual(session.first_delay, s.retryIn(now + 1));
}

test "session: a restart with a bye, then a new build, then a new protocol" {
    var s = Session.init(local);
    _ = s.start(0);
    try testing.expectEqual(.first, try join(&s, 0, server("i1", "abc", 3)));

    // A planned stop: the bye comes before the close.
    s.bye("The server stops for a restart or an update.");
    try testing.expectEqual(.lost, s.step(1, .closed));
    try testing.expectEqualStrings("The server stops for a restart or an update.", s.reason.get());
    try testing.expectEqual(.connect, s.step(3, .closed));
    try testing.expectEqual(.restarted, try join(&s, 3, server("i2", "abc", 3)));
    // A join clears the reason.
    try testing.expectEqual(@as(usize, 0), s.reason.len);
    try testing.expect(!s.update);

    // A new build with the same protocol: join, and offer a reload.
    try testing.expectEqual(.lost, s.step(4, .closed));
    try testing.expectEqual(.connect, s.step(6, .closed));
    try testing.expectEqual(.new_build, try join(&s, 6, server("i3", "def", 3)));
    try testing.expect(s.joined());
    try testing.expect(s.update);
    try testing.expectEqualStrings("i3", s.server.?.instance.get());

    // A new protocol: no join, and no more tries.
    try testing.expectEqual(.lost, s.step(7, .closed));
    try testing.expectEqual(.connect, s.step(9, .closed));
    try testing.expectEqual(.new_protocol, try join(&s, 9, server("i4", "ghi", 4)));
    try testing.expectEqual(.incompatible, s.state);
    try testing.expect(!s.joined());
    try testing.expectEqual(.none, s.step(100, .closed));
    try testing.expectEqual(.none, s.step(1000, .closed));
    try testing.expectEqual(.incompatible, s.state);

    // The menu, then the online mode again: the update flag stays.
    s.stop(1001);
    try testing.expectEqual(.offline, s.state);
    try testing.expect(s.update);
}

test "session: timeouts, and a welcome that is not due" {
    var s = Session.init(local);
    _ = s.start(0);
    // The socket does not open.
    try testing.expectEqual(.none, s.step(session.connect_timeout, .connecting));
    try testing.expectEqual(.timed_out, s.step(session.connect_timeout + 0.1, .connecting));
    try testing.expectEqual(.lost, s.state);
    try testing.expectEqual(.connect, s.step(100, .idle));

    // The socket opens, but no welcome comes.
    try testing.expectEqual(.none, s.step(100, .open));
    try testing.expectEqual(.none, s.step(100 + session.handshake_timeout, .open));
    try testing.expectEqual(.timed_out, s.step(100.1 + session.handshake_timeout, .open));
    try testing.expectEqual(.lost, s.state);

    // A welcome while lost or joined is not due.
    try testing.expectEqual(null, s.welcome(110, server("i1", "abc", 3)));
    try testing.expectEqual(.connect, s.step(200, .idle));
    // The open and the welcome in the same tick: the welcome comes first.
    try testing.expectEqual(.first, s.welcome(200, server("i1", "abc", 3)).?);
    try testing.expectEqual(.none, s.step(200, .open));
    try testing.expect(s.joined());
    try testing.expectEqual(null, s.welcome(201, server("i1", "abc", 3)));
}

test "session: a long text is cut, and the copy outlives the message" {
    var buf: [100]u8 = @splat('x');
    var s = Session.init(local);
    _ = s.start(0);
    _ = try join(&s, 0, .{ .instance = &buf, .build = "abc", .protocol = 3, .started = "t" });
    buf[0] = 'y';
    try testing.expectEqual(ident.max_text, s.server.?.instance.get().len);
    try testing.expectEqual(@as(u8, 'x'), s.server.?.instance.get()[0]);
    var long: [300]u8 = @splat('r');
    s.bye(&long);
    try testing.expectEqual(s.reason.buf.len, s.reason.get().len);
}

test "the version command prints the client, the server and the state" {
    var ms: NoStore = .{};
    var con = try console.Console.init(testing.allocator, ms.store());
    defer con.deinit();
    var s = Session.init(local);
    try s.register(&con);
    con.exec("version", .user);
    try testing.expect(hasLine(&con, "game:   build abc, protocol 3"));
    try testing.expect(hasLine(&con, "server: none yet. The server shows after a join."));
    try testing.expect(hasLine(&con, "connection: offline"));

    _ = s.start(0);
    _ = try join(&s, 0, server("0123456789abcdef", "def", 3));
    con.exec("version", .user);
    try testing.expect(hasLine(&con, "server: build def, protocol 3"));
    try testing.expect(hasLine(&con, "        instance 0123456789abcdef, started 2026-10-23T10:00:00.000Z"));
    try testing.expect(hasLine(&con, "connection: joined (a new build is live)"));
    try testing.expect(hasLine(&con, "A new version is live. Reload the page to update."));

    s.bye("bye now");
    _ = s.step(1, .closed);
    con.exec("version", .user);
    try testing.expect(hasLine(&con, "connection: lost, the next try in 1 s (try 2)"));
    try testing.expect(hasLine(&con, "the server said: bye now"));
}

fn hasLine(con: *const console.Console, text: []const u8) bool {
    var i: usize = 0;
    while (i < con.out.count()) : (i += 1) {
        if (std.mem.eql(u8, con.out.get(i).text, text)) return true;
    }
    return false;
}

/// A store that keeps nothing: the command test saves no config.
const NoStore = struct {
    fn store(self: *NoStore) console.Store {
        return .{ .ctx = self, .get = get, .set = set, .delete = delete };
    }
    fn get(_: ?*anyopaque, _: std.mem.Allocator, _: []const u8) ?[]u8 {
        return null;
    }
    fn set(_: ?*anyopaque, _: []const u8, _: []const u8) void {}
    fn delete(_: ?*anyopaque, _: []const u8) void {}
};
