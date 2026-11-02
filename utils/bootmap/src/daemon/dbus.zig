//! A minimal D-Bus client for systemd's private socket
//! (/run/systemd/private). It needs no library, so bootmapd is one static
//! binary that can also run from an initramfs.
//!
//! It does only what bootmapd needs: method calls with string arguments,
//! and replies that it reads with Reader. Little-endian only. The wire
//! format is the D-Bus specification, "Message Protocol".

const std = @import("std");
const linux = std.os.linux;

pub const Error = error{ Connect, Auth, Io, Protocol, CallFailed };

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
        // A read waits at most 3 s, so a lost reply is an error, not a hang.
        const tv: linux.timeval = .{ .sec = 3, .usec = 0 };
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
        while (true) {
            const m = try c.readMessage();
            // 2 = method return, 3 = error, 4 = signal (skipped).
            if (m.reply_serial != c.serial) continue;
            if (m.kind == 3) return error.CallFailed;
            if (m.kind == 2) return m.body;
        }
    }

    const Message = struct { kind: u8, reply_serial: u32, body: Reader };

    fn readMessage(c: *Conn) Error!Message {
        c.rx.clearRetainingCapacity();
        try c.readN(16);
        const h = c.rx.items[0..16];
        if (h[0] != 'l') return error.Protocol;
        const body_len = std.mem.readInt(u32, h[4..8], .little);
        const fields_len = std.mem.readInt(u32, h[12..16], .little);
        const body_start = alignUp(16 + fields_len, 8);
        try c.readN(body_start + body_len - 16);
        const data = c.rx.items;
        var r: Reader = .{ .data = data[0 .. 16 + fields_len], .pos = 16 };
        var reply_serial: u32 = 0;
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
                's', 'o' => _ = try r.string(),
                'g' => _ = try r.signature(),
                else => return error.Protocol,
            }
        }
        return .{ .kind = data[1], .reply_serial = reply_serial, .body = .{ .data = data[0 .. body_start + body_len], .pos = body_start } };
    }

    fn readN(c: *Conn, n: usize) Error!void {
        const start = c.rx.items.len;
        c.rx.resize(c.alloc, start + n) catch return error.Io;
        var got: usize = 0;
        while (got < n) {
            const rc = linux.read(c.fd, c.rx.items[start + got ..].ptr, n - got);
            if (linux.errno(rc) != .SUCCESS or rc == 0) return error.Io;
            got += rc;
        }
    }
};

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
