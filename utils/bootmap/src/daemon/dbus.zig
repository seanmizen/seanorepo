//! A minimal D-Bus client for systemd's private socket
//! (/run/systemd/private). It needs no library, so bootmapd is one static
//! binary that can also run from an initramfs.
//!
//! It does only what bootmapd needs: method calls with string arguments,
//! and replies that it reads with Reader. Little-endian only. The wire
//! format is the D-Bus specification, "Message Protocol".

const std = @import("std");
const linux = std.os.linux;

pub const Error = error{ Connect, Auth, Io, Protocol, CallFailed, Timeout, Closed };

/// How long call() waits for its reply, in seconds.
pub var call_timeout_s: u32 = 60;
/// Called each 5 s while call() waits: (seconds, messages skipped).
pub var on_wait: ?*const fn (u32, u32) void = null;
/// Called for each message that is not the reply: (kind, reply serial,
/// member). For diagnosis.
pub var on_skip: ?*const fn (u8, u32, []const u8) void = null;

pub const Conn = struct {
    fd: i32,
    serial: u32 = 0,
    alloc: std.mem.Allocator,
    rx: std.ArrayList(u8) = .empty,

    pub fn open(alloc: std.mem.Allocator, path: []const u8) Error!Conn {
        const rc = linux.socket(linux.AF.UNIX, linux.SOCK.STREAM | linux.SOCK.CLOEXEC, 0);
        if (linux.errno(rc) != .SUCCESS) return error.Connect;
        const fd: i32 = @intCast(rc);
        var addr: linux.sockaddr.un = .{ .family = linux.AF.UNIX, .path = @splat(0) };
        if (path.len >= addr.path.len) return error.Connect;
        @memcpy(addr.path[0..path.len], path);
        if (linux.errno(linux.connect(fd, @ptrCast(&addr), @sizeOf(linux.sockaddr.un))) != .SUCCESS) {
            _ = linux.close(fd);
            return error.Connect;
        }
        // A read waits at most 1 s. call() waits for a reply up to its own
        // limit, so a slow systemd is not a lost reply.
        const tv: linux.timeval = .{ .sec = 1, .usec = 0 };
        _ = linux.setsockopt(fd, linux.SOL.SOCKET, linux.SO.RCVTIMEO, std.mem.asBytes(&tv), @sizeOf(linux.timeval));
        var c: Conn = .{ .fd = fd, .alloc = alloc };
        try c.auth();
        return c;
    }

    pub fn close(c: *Conn) void {
        _ = linux.close(c.fd);
        c.rx.deinit(c.alloc);
    }

    /// SASL EXTERNAL with our uid, as hex digits of its decimal string.
    fn auth(c: *Conn) Error!void {
        var uid_buf: [16]u8 = undefined;
        const uid = std.fmt.bufPrint(&uid_buf, "{d}", .{linux.getuid()}) catch unreachable;
        var line: [64]u8 = undefined;
        var n: usize = 0;
        const head = "\x00AUTH EXTERNAL ";
        @memcpy(line[0..head.len], head);
        n = head.len;
        for (uid) |ch| {
            _ = std.fmt.bufPrint(line[n..][0..2], "{x:0>2}", .{ch}) catch unreachable;
            n += 2;
        }
        @memcpy(line[n..][0..2], "\r\n");
        n += 2;
        try c.send(line[0..n]);
        var reply: [256]u8 = undefined;
        const got = try c.recvLine(&reply);
        if (!std.mem.startsWith(u8, got, "OK ")) return error.Auth;
        try c.send("BEGIN\r\n");
    }

    fn send(c: *Conn, bytes: []const u8) Error!void {
        var off: usize = 0;
        while (off < bytes.len) {
            const rc = linux.write(c.fd, bytes[off..].ptr, bytes.len - off);
            if (linux.errno(rc) != .SUCCESS) return error.Io;
            off += rc;
        }
    }

    fn recvLine(c: *Conn, buf: []u8) Error![]const u8 {
        var n: usize = 0;
        while (n < buf.len) {
            const rc = linux.read(c.fd, buf[n..].ptr, 1);
            if (linux.errno(rc) != .SUCCESS or rc == 0) return error.Io;
            n += 1;
            if (n >= 2 and buf[n - 2] == '\r' and buf[n - 1] == '\n') return buf[0 .. n - 2];
        }
        return error.Protocol;
    }

    /// Call a method. `args` are string arguments (signature "s" each).
    /// Return the reply body, valid until the next call.
    pub fn call(c: *Conn, path: []const u8, iface: []const u8, member: []const u8, args: []const []const u8) Error!Reader {
        c.serial += 1;
        var msg: std.ArrayList(u8) = .empty;
        defer msg.deinit(c.alloc);
        buildCall(c.alloc, &msg, c.serial, path, iface, member, args) catch return error.Io;
        try c.send(msg.items);
        var waited: u32 = 0;
        var skipped: u32 = 0;
        while (true) {
            const m = c.readMessage() catch |err| switch (err) {
                error.Timeout => {
                    waited += 1;
                    if (waited % 5 == 0) if (on_wait) |f| f(waited, skipped);
                    if (waited >= call_timeout_s) return error.Timeout;
                    continue;
                },
                else => return err,
            };
            // 2 = method return, 3 = error, 4 = signal (skipped).
            if (m.reply_serial != c.serial) {
                skipped += 1;
                if (on_skip) |f| f(m.kind, m.reply_serial, m.member);
                continue;
            }
            if (m.kind == 3) return error.CallFailed;
            if (m.kind == 2) return m.body;
        }
    }

    pub const Message = struct {
        kind: u8,
        reply_serial: u32,
        member: []const u8 = "",
        interface: []const u8 = "",
        path: []const u8 = "",
        body: Reader,
    };

    /// Send a call and return its serial. The reply comes later: see next().
    pub fn sendCall(c: *Conn, path: []const u8, iface: []const u8, member: []const u8, args: []const []const u8) Error!u32 {
        c.serial += 1;
        var msg: std.ArrayList(u8) = .empty;
        defer msg.deinit(c.alloc);
        buildCall(c.alloc, &msg, c.serial, path, iface, member, args) catch return error.Io;
        try c.send(msg.items);
        return c.serial;
    }

    /// The next message if one comes within timeout_ms, else null. A
    /// message is valid until the next read on this connection.
    pub fn next(c: *Conn, timeout_ms: i32) Error!?Message {
        var pfd = [1]linux.pollfd{.{ .fd = c.fd, .events = linux.POLL.IN, .revents = 0 }};
        const rc = linux.poll(&pfd, 1, timeout_ms);
        if (linux.errno(rc) != .SUCCESS or rc == 0) return null;
        if (pfd[0].revents & (linux.POLL.HUP | linux.POLL.ERR) != 0 and pfd[0].revents & linux.POLL.IN == 0) return error.Closed;
        return try c.readMessage();
    }

    fn readMessage(c: *Conn) Error!Message {
        c.rx.clearRetainingCapacity();
        // A timeout before the first byte: no message yet. After the first
        // byte, the rest of the message is on its way.
        try c.readFirst();
        try c.readN(15);
        const h = c.rx.items[0..16];
        if (h[0] != 'l') return error.Protocol;
        const body_len = std.mem.readInt(u32, h[4..8], .little);
        const fields_len = std.mem.readInt(u32, h[12..16], .little);
        const body_start = alignUp(16 + fields_len, 8);
        try c.readN(body_start + body_len - 16);
        const data = c.rx.items;
        var r: Reader = .{ .data = data[0 .. 16 + fields_len], .pos = 16 };
        var reply_serial: u32 = 0;
        var member: []const u8 = "";
        var interface: []const u8 = "";
        var path: []const u8 = "";
        while (r.pos < r.data.len) {
            r.alignTo(8);
            if (r.pos >= r.data.len) break;
            const code = try r.byte();
            const sig = try r.signature();
            if (sig.len != 1) return error.Protocol;
            switch (sig[0]) {
                'u' => {
                    const v = try r.u32_();
                    if (code == 5) reply_serial = v;
                },
                's', 'o' => {
                    const v = try r.string();
                    if (code == 1) path = v;
                    if (code == 2) interface = v;
                    if (code == 3) member = v;
                },
                'g' => _ = try r.signature(),
                else => return error.Protocol,
            }
        }
        return .{ .kind = data[1], .reply_serial = reply_serial, .member = member, .interface = interface, .path = path, .body = .{ .data = data[0 .. body_start + body_len], .pos = body_start } };
    }

    fn readFirst(c: *Conn) Error!void {
        c.rx.resize(c.alloc, 1) catch return error.Io;
        const rc = linux.read(c.fd, c.rx.items.ptr, 1);
        switch (linux.errno(rc)) {
            .SUCCESS => if (rc == 0) return error.Closed,
            .AGAIN, .INTR => return error.Timeout,
            else => return error.Io,
        }
    }

    fn readN(c: *Conn, n: usize) Error!void {
        const start = c.rx.items.len;
        c.rx.resize(c.alloc, start + n) catch return error.Io;
        var got: usize = 0;
        var waits: u32 = 0;
        while (got < n) {
            const rc = linux.read(c.fd, c.rx.items[start + got ..].ptr, n - got);
            switch (linux.errno(rc)) {
                .SUCCESS => if (rc == 0) return error.Closed,
                .AGAIN, .INTR => {
                    waits += 1;
                    if (waits > 30) return error.Timeout;
                    continue;
                },
                else => return error.Io,
            }
            got += rc;
        }
    }
};

fn alignOf(c: u8) usize {
    return switch (c) {
        'y', 'g', 'v' => 1,
        'n', 'q' => 2,
        'x', 't', 'd', '(', '{' => 8,
        else => 4,
    };
}

/// The index after the complete type that starts at sig[i].
fn typeEnd(sig: []const u8, i: usize) Error!usize {
    if (i >= sig.len) return error.Protocol;
    return switch (sig[i]) {
        'a' => typeEnd(sig, i + 1),
        '(', '{' => blk: {
            var j = i + 1;
            while (j < sig.len and sig[j] != ')' and sig[j] != '}') j = try typeEnd(sig, j);
            break :blk j + 1;
        },
        else => i + 1,
    };
}

fn alignUp(v: usize, a: usize) usize {
    return (v + a - 1) / a * a;
}

fn pad(alloc: std.mem.Allocator, m: *std.ArrayList(u8), a: usize) !void {
    while (m.items.len % a != 0) try m.append(alloc, 0);
}

fn putU32(alloc: std.mem.Allocator, m: *std.ArrayList(u8), v: u32) !void {
    try pad(alloc, m, 4);
    var b: [4]u8 = undefined;
    std.mem.writeInt(u32, &b, v, .little);
    try m.appendSlice(alloc, &b);
}

fn putString(alloc: std.mem.Allocator, m: *std.ArrayList(u8), s: []const u8) !void {
    try putU32(alloc, m, @intCast(s.len));
    try m.appendSlice(alloc, s);
    try m.append(alloc, 0);
}

fn putSig(alloc: std.mem.Allocator, m: *std.ArrayList(u8), s: []const u8) !void {
    try m.append(alloc, @intCast(s.len));
    try m.appendSlice(alloc, s);
    try m.append(alloc, 0);
}

/// One header field: (code, variant of type t).
fn field(alloc: std.mem.Allocator, m: *std.ArrayList(u8), code: u8, t: u8, v: []const u8) !void {
    try pad(alloc, m, 8);
    try m.append(alloc, code);
    try putSig(alloc, m, &.{t});
    if (t == 'g') try putSig(alloc, m, v) else try putString(alloc, m, v);
}

fn buildCall(alloc: std.mem.Allocator, m: *std.ArrayList(u8), serial: u32, path: []const u8, iface: []const u8, member: []const u8, args: []const []const u8) !void {
    var body: std.ArrayList(u8) = .empty;
    defer body.deinit(alloc);
    var sig_buf: [16]u8 = undefined;
    for (args, 0..) |a, i| {
        try putString(alloc, &body, a);
        sig_buf[i] = 's';
    }
    try m.appendSlice(alloc, &.{ 'l', 1, 0, 1 });
    try putU32(alloc, m, @intCast(body.items.len));
    try putU32(alloc, m, serial);
    try putU32(alloc, m, 0); // the length of the fields array, set below
    const fields_start = m.items.len;
    try field(alloc, m, 1, 'o', path);
    try field(alloc, m, 2, 's', iface);
    try field(alloc, m, 3, 's', member);
    try field(alloc, m, 6, 's', "org.freedesktop.systemd1");
    if (args.len > 0) try field(alloc, m, 8, 'g', sig_buf[0..args.len]);
    std.mem.writeInt(u32, m.items[12..16], @intCast(m.items.len - fields_start), .little);
    try pad(alloc, m, 8);
    try m.appendSlice(alloc, body.items);
}

/// Reads values from a message. Positions are from the message start, so
/// the alignment rules of the specification hold.
pub const Reader = struct {
    data: []const u8,
    pos: usize,

    pub fn alignTo(r: *Reader, a: usize) void {
        r.pos = alignUp(r.pos, a);
    }

    pub fn byte(r: *Reader) Error!u8 {
        if (r.pos >= r.data.len) return error.Protocol;
        r.pos += 1;
        return r.data[r.pos - 1];
    }

    pub fn u32_(r: *Reader) Error!u32 {
        r.alignTo(4);
        if (r.pos + 4 > r.data.len) return error.Protocol;
        const v = std.mem.readInt(u32, r.data[r.pos..][0..4], .little);
        r.pos += 4;
        return v;
    }

    pub fn string(r: *Reader) Error![]const u8 {
        const n = try r.u32_();
        if (r.pos + n + 1 > r.data.len) return error.Protocol;
        const s = r.data[r.pos .. r.pos + n];
        r.pos += n + 1;
        return s;
    }

    pub fn signature(r: *Reader) Error![]const u8 {
        const n = try r.byte();
        if (r.pos + n + 1 > r.data.len) return error.Protocol;
        const s = r.data[r.pos .. r.pos + n];
        r.pos += n + 1;
        return s;
    }

    /// Skip one value of the complete type at sig[i.*..], and move i past
    /// that type. For values the daemon does not read.
    pub fn skip(r: *Reader, sig: []const u8, i: *usize) Error!void {
        if (i.* >= sig.len) return error.Protocol;
        const c = sig[i.*];
        i.* += 1;
        switch (c) {
            'y' => r.pos += 1,
            'n', 'q' => {
                r.alignTo(2);
                r.pos += 2;
            },
            'b', 'i', 'u', 'h' => {
                r.alignTo(4);
                r.pos += 4;
            },
            'x', 't', 'd' => {
                r.alignTo(8);
                r.pos += 8;
            },
            's', 'o' => _ = try r.string(),
            'g' => _ = try r.signature(),
            'v' => {
                const vs = try r.signature();
                var j: usize = 0;
                try r.skip(vs, &j);
            },
            'a' => {
                const n = try r.u32_();
                r.alignTo(alignOf(sig[i.*]));
                r.pos += n;
                i.* = try typeEnd(sig, i.*);
            },
            '(' => {
                r.alignTo(8);
                while (i.* < sig.len and sig[i.*] != ')') try r.skip(sig, i);
                i.* += 1;
            },
            '{' => {
                r.alignTo(8);
                try r.skip(sig, i);
                try r.skip(sig, i);
                i.* += 1;
            },
            else => return error.Protocol,
        }
        if (r.pos > r.data.len) return error.Protocol;
    }

    /// Start an array: return the position where it ends.
    pub fn array(r: *Reader, elem_align: usize) Error!usize {
        const n = try r.u32_();
        r.alignTo(elem_align);
        return r.pos + n;
    }
};

test "a call message has the layout of the specification" {
    var m: std.ArrayList(u8) = .empty;
    defer m.deinit(std.testing.allocator);
    try buildCall(std.testing.allocator, &m, 7, "/o", "i.f", "M", &.{"x"});
    try std.testing.expectEqual(@as(u8, 'l'), m.items[0]);
    try std.testing.expectEqual(@as(u32, 7), std.mem.readInt(u32, m.items[8..12], .little));
    const fields_len = std.mem.readInt(u32, m.items[12..16], .little);
    const body_start = alignUp(16 + fields_len, 8);
    // The body is one string "x": length 1, "x", 0.
    try std.testing.expectEqual(@as(u32, 6), std.mem.readInt(u32, m.items[4..8], .little));
    try std.testing.expectEqualSlices(u8, &.{ 1, 0, 0, 0, 'x', 0 }, m.items[body_start..]);
}

test "skip a dictionary of variants" {
    // a{sv} with one entry: "k" -> variant u 7.
    var b: [64]u8 = @splat(0);
    var n: usize = 0;
    std.mem.writeInt(u32, b[0..4], 16, .little); // array length (from the entry start)
    n = 8; // align to 8 for the entry
    std.mem.writeInt(u32, b[n..][0..4], 1, .little);
    b[n + 4] = 'k';
    b[n + 5] = 0;
    b[n + 6] = 1;
    b[n + 7] = 'u';
    b[n + 8] = 0;
    std.mem.writeInt(u32, b[n + 12 ..][0..4], 7, .little);
    var r: Reader = .{ .data = &b, .pos = 0 };
    var i: usize = 0;
    try r.skip("a{sv}", &i);
    try std.testing.expectEqual(@as(usize, 5), i);
    try std.testing.expectEqual(@as(usize, 24), r.pos);
}
