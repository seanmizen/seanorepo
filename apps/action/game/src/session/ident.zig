// Who a server is, and what a new welcome means for the client.
//
// A server has an instance id (new at each start of the process), a build
// version (the same for each start of one build) and a protocol version
// (the version of its messages). The client has a build version and a
// protocol version too. compare gives the verdict for a welcome:
//
//   the protocol differs        new_protocol   do not join, reload to play
//   no server before            first          join (new_build if the
//                                              build differs)
//   the same instance           same_instance  join again
//   a new instance, same build  restarted      join again
//   a new build                 new_build      join again, offer a reload
//
// The build compares with the build of the client, not with the last
// server. So a client that joins a newer server the first time also gets
// new_build.
//
// This file imports nothing from a game. It needs std.
const std = @import("std");

/// The longest text that the session keeps for an id, a build or a time.
pub const max_text = 64;

/// The identity of a server: the fields of the welcome message and of
/// GET /api/version. The slices belong to the caller.
pub const Ident = struct {
    instance: []const u8,
    build: []const u8,
    protocol: u32,
    /// The start time of the server, as the server writes it.
    started: []const u8,
};

/// The versions of this client.
pub const Local = struct {
    build: []const u8,
    protocol: u32,
};

pub const Verdict = enum {
    /// The first server of this session, of the same build.
    first,
    /// The same server process as before: the connection broke.
    same_instance,
    /// A new start of the same build.
    restarted,
    /// A build that is not the build of the client, with the same protocol.
    new_build,
    /// The server has a different protocol. The client must not join.
    new_protocol,
};

pub fn compare(local: Local, last: ?Ident, now: Ident) Verdict {
    if (now.protocol != local.protocol) return .new_protocol;
    const same_build = std.mem.eql(u8, now.build, local.build);
    const prev = last orelse return if (same_build) .first else .new_build;
    if (std.mem.eql(u8, now.instance, prev.instance)) return .same_instance;
    return if (same_build) .restarted else .new_build;
}

/// A short text that the session keeps. A longer text is cut.
pub const Text = struct {
    buf: [max_text]u8 = undefined,
    len: usize = 0,

    pub fn init(s: []const u8) Text {
        var t: Text = .{};
        t.len = @min(s.len, max_text);
        @memcpy(t.buf[0..t.len], s[0..t.len]);
        return t;
    }

    pub fn get(self: *const Text) []const u8 {
        return self.buf[0..self.len];
    }
};

/// A copy of an Ident that lives as long as the session.
pub const Kept = struct {
    instance: Text,
    build: Text,
    protocol: u32,
    started: Text,

    pub fn init(id: Ident) Kept {
        return .{
            .instance = .init(id.instance),
            .build = .init(id.build),
            .protocol = id.protocol,
            .started = .init(id.started),
        };
    }

    pub fn ident(self: *const Kept) Ident {
        return .{
            .instance = self.instance.get(),
            .build = self.build.get(),
            .protocol = self.protocol,
            .started = self.started.get(),
        };
    }
};
