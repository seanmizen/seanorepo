//! bootmapd: the userspace part of the picture (stage 3).
//!
//! 1. Read /proc/bootmap: the size of the screen, the stage rectangles, and
//!    the kernel boxes with their states (kernel/bootmap.c).
//! 2. Ask systemd (D-Bus on /run/systemd/private) for its units. The units
//!    with a job, or that are active already, are the systemd boxes. Each
//!    goes into the group of the first target in TARGET_ORDER that it is
//!    ordered Before= (vm/collect-trace.py has the same rule).
//! 3. Lay out the systemd stage with the shared Zig layout, inside the
//!    systemd stage rectangle that the kernel gives.
//! 4. Draw the whole picture into a DRM dumb buffer, then show it. So the
//!    screen changes from the kernel's picture to this one with no black
//!    frame (REQ-BOOTMAP-005 asks the same for the login screen).
//! 5. Every 50 ms, read the unit states again and draw the systemd boxes.
//!
//! When every box is full, the daemon stops polling and keeps the buffer
//! on the screen. It does not exit: the buffer goes when its file closes.
//!
//! Options: the bootmap.* keys of the kernel command line (style.zig).

const std = @import("std");
const linux = std.os.linux;
const bootmap = @import("bootmap");
const dbus = @import("dbus.zig");
const drm = @import("drm.zig");

const Plan = bootmap.plan.Plan;
const Rect = bootmap.plan.Rect;

const target_order = [_][]const u8{
    "local-fs-pre.target",   "local-fs.target",     "sysinit.target",
    "sockets.target",        "timers.target",       "paths.target",
    "basic.target",          "network-pre.target",  "network.target",
    "network-online.target", "cloud-config.target", "multi-user.target",
    "graphical.target",
};
const default_group = "multi-user.target";
const unit_suffixes = [_][]const u8{ ".service", ".socket", ".mount", ".swap", ".timer", ".path", ".automount" };

const systemd_path = "/org/freedesktop/systemd1";
const manager_iface = "org.freedesktop.systemd1.Manager";

var kmsg: i32 = -1;

/// Log to the kernel log: the daemon starts before journald, and the
/// kernel log shows on the serial console.
fn log(comptime fmt: []const u8, args: anytype) void {
    var buf: [512]u8 = undefined;
    // <4>: warning level, so it shows on the console at loglevel=5.
    const s = std.fmt.bufPrint(&buf, "<4>bootmapd: " ++ fmt ++ "\n", args) catch return;
    if (kmsg < 0) {
        const rc = linux.open("/dev/kmsg", .{ .ACCMODE = .WRONLY, .CLOEXEC = true }, 0);
        kmsg = if (linux.errno(rc) == .SUCCESS) @intCast(rc) else 2;
    }
    _ = linux.write(kmsg, s.ptr, s.len);
}

var skip_logged: u32 = 0;
fn logSkip(kind: u8, reply_serial: u32, member: []const u8) void {
    // The first messages, and every message that is not a signal.
    skip_logged += 1;
    if (kind != 4) log("skipped: kind {d}, reply to {d}, {s}", .{ kind, reply_serial, member });
}

fn logWait(seconds: u32, skipped: u32) void {
    log("waiting for systemd: {d} s, {d} other messages skipped", .{ seconds, skipped });
}

/// Connect to systemd, and try again until it answers.
fn connect(alloc: std.mem.Allocator) !dbus.Conn {
    var tries: usize = 0;
    while (true) : (tries += 1) {
        if (dbus.Conn.open(alloc, "/run/systemd/private")) |c| return c else |err| {
            if (tries > 200) return err;
            if (tries % 20 == 0) log("connect to systemd: {s}, try {d}", .{ @errorName(err), tries });
            sleepMs(50);
        }
    }
}

/// Early in the boot, systemd sometimes does not answer a call on a
/// connection, but it answers on a new one. So a call waits 5 s, and then
/// the daemon connects again, for up to 3 minutes.
const retry_limit_us: u64 = 180_000_000;

/// ListUnits, with a new connection when the old one fails or times out.
fn listUnitsRetry(alloc: std.mem.Allocator, conn: *dbus.Conn) ![]Unit {
    const start = nowUs();
    var tries: usize = 0;
    while (true) : (tries += 1) {
        if (listUnits(alloc, conn)) |u| return u else |err| {
            if (nowUs() - start > retry_limit_us) return err;
            log("ListUnits: {s} after try {d}, connect again", .{ @errorName(err), tries });
            conn.close();
            conn.* = try connect(alloc);
        }
    }
}

/// groupOf with the same retry rule.
fn groupOfRetry(alloc: std.mem.Allocator, conn: *dbus.Conn, unit_path: []const u8) []const u8 {
    const start = nowUs();
    while (true) {
        if (groupOf(alloc, conn, unit_path)) |g| return g else |err| {
            if (nowUs() - start > retry_limit_us) return default_group;
            log("Get Before: {s}, connect again", .{@errorName(err)});
            conn.close();
            conn.* = connect(alloc) catch return default_group;
        }
    }
}

fn nowUs() u64 {
    var ts: linux.timespec = undefined;
    _ = linux.clock_gettime(.MONOTONIC, &ts);
    return @as(u64, @intCast(ts.sec)) * 1_000_000 + @as(u64, @intCast(ts.nsec)) / 1000;
}

fn sleepMs(ms: u64) void {
    const t: linux.timespec = .{ .sec = @intCast(ms / 1000), .nsec = @intCast((ms % 1000) * 1_000_000) };
    _ = linux.nanosleep(&t, null);
}

fn readFile(alloc: std.mem.Allocator, path: [*:0]const u8) ![]u8 {
    const rc = linux.open(path, .{ .ACCMODE = .RDONLY, .CLOEXEC = true }, 0);
    if (linux.errno(rc) != .SUCCESS) return error.Open;
    const fd: i32 = @intCast(rc);
    defer _ = linux.close(fd);
    var out: std.ArrayList(u8) = .empty;
    var buf: [65536]u8 = undefined;
    while (true) {
        const n = linux.read(fd, &buf, buf.len);
        if (linux.errno(n) != .SUCCESS) return error.Read;
        if (n == 0) break;
        try out.appendSlice(alloc, buf[0..n]);
    }
    return out.items;
}

/// One line of /proc/bootmap.
const KNode = struct { depth: u8, stage: u8, rect: Rect, state: u8, start_us: u64, end_us: u64, ic: i32, expected_us: u64, name: []const u8 };

/// /proc/bootmap, version 2: names_hash and nic identify the kernel build
/// (the EFI variable of initcall times is for this build only).
const ProcMap = struct { width: i32, height: i32, names_hash: u32, nic: u32, nodes: []KNode };

fn parseProcMap(alloc: std.mem.Allocator, text: []const u8) !ProcMap {
    var lines = std.mem.splitScalar(u8, text, '\n');
    var head = std.mem.tokenizeScalar(u8, lines.next() orelse return error.Empty, ' ');
    if (!std.mem.eql(u8, head.next() orelse "", "bootmap")) return error.BadHeader;
    if (!std.mem.eql(u8, head.next() orelse "", "2")) return error.BadVersion;
    const w = try std.fmt.parseInt(i32, head.next() orelse return error.BadHeader, 10);
    const h = try std.fmt.parseInt(i32, head.next() orelse return error.BadHeader, 10);
    _ = head.next(); // the node count
    const names_hash = try std.fmt.parseInt(u32, head.next() orelse return error.BadHeader, 16);
    const nic = try std.fmt.parseInt(u32, head.next() orelse return error.BadHeader, 10);
    var nodes: std.ArrayList(KNode) = .empty;
    while (lines.next()) |line| {
        var t = std.mem.tokenizeScalar(u8, line, ' ');
        var f: [12][]const u8 = undefined;
        var n: usize = 0;
        while (n < 12) : (n += 1) f[n] = t.next() orelse break;
        if (n < 12) continue;
        const name = t.rest();
        try nodes.append(alloc, .{
            .depth = try std.fmt.parseInt(u8, f[1], 10),
            .stage = try std.fmt.parseInt(u8, f[2], 10),
            .rect = .{
                .x = try std.fmt.parseInt(i32, f[3], 10),
                .y = try std.fmt.parseInt(i32, f[4], 10),
                .w = try std.fmt.parseInt(i32, f[5], 10),
                .h = try std.fmt.parseInt(i32, f[6], 10),
            },
            .state = try std.fmt.parseInt(u8, f[7], 10),
            .start_us = try std.fmt.parseInt(u64, f[8], 10),
            .end_us = try std.fmt.parseInt(u64, f[9], 10),
            .ic = try std.fmt.parseInt(i32, f[10], 10),
            .expected_us = try std.fmt.parseInt(u64, f[11], 10),
            .name = try alloc.dupe(u8, name),
        });
    }
    return .{ .width = w, .height = h, .names_hash = names_hash, .nic = nic, .nodes = nodes.items };
}

fn styleFromCmdline(alloc: std.mem.Allocator) bootmap.style.Style {
    var st: bootmap.style.Style = .{};
    const cmd = readFile(alloc, "/proc/cmdline") catch return st;
    var it = std.mem.tokenizeAny(u8, cmd, " \n");
    while (it.next()) |tok| {
        if (!std.mem.startsWith(u8, tok, "bootmap.")) continue;
        // stages and daemon are for the kernel and the units.
        st.set(tok) catch {};
    }
    return st;
}

const Unit = struct { name: []const u8, active: []const u8, job: u32, path: []const u8 };

fn listUnits(alloc: std.mem.Allocator, conn: *dbus.Conn) ![]Unit {
    var r = try conn.call(systemd_path, manager_iface, "ListUnits", &.{});
    var out: std.ArrayList(Unit) = .empty;
    const end = try r.array(8);
    while (r.pos < end) {
        r.alignTo(8);
        const name = try r.string();
        _ = try r.string(); // description
        _ = try r.string(); // load state
        const active = try r.string();
        _ = try r.string(); // sub state
        _ = try r.string(); // following
        const path = try r.string();
        const job = try r.u32_();
        _ = try r.string(); // job type
        _ = try r.string(); // job path
        try out.append(alloc, .{ .name = try alloc.dupe(u8, name), .active = try alloc.dupe(u8, active), .job = job, .path = try alloc.dupe(u8, path) });
    }
    return out.items;
}

fn groupOf(alloc: std.mem.Allocator, conn: *dbus.Conn, unit_path: []const u8) ![]const u8 {
    var r = try conn.call(unit_path, "org.freedesktop.DBus.Properties", "Get", &.{ "org.freedesktop.systemd1.Unit", "Before" });
    const sig = try r.signature();
    if (!std.mem.eql(u8, sig, "as")) return default_group;
    const end = try r.array(4);
    var best: usize = target_order.len;
    while (r.pos < end) {
        const t = try r.string();
        for (target_order, 0..) |name, i| if (i < best and std.mem.eql(u8, name, t)) {
            best = i;
        };
    }
    _ = alloc;
    return if (best < target_order.len) target_order[best] else default_group;
}

fn isBoxUnit(u: Unit) bool {
    var ok = false;
    for (unit_suffixes) |s| ok = ok or std.mem.endsWith(u8, u.name, s);
    if (!ok) return false;
    return u.job != 0 or eql(u.active, "active") or eql(u.active, "activating") or eql(u.active, "reloading") or eql(u.active, "failed");
}

fn eql(a: []const u8, b: []const u8) bool {
    return std.mem.eql(u8, a, b);
}

const never: u64 = std.math.maxInt(u64);

const durations_dir = "/var/lib/bootmap";
const durations_path = "/var/lib/bootmap/durations";

/// The unit times of the last boot: "<microseconds> <unit>" per line.
fn loadDurations(alloc: std.mem.Allocator) !std.StringHashMapUnmanaged(u64) {
    var m: std.StringHashMapUnmanaged(u64) = .empty;
    const text = readFile(alloc, durations_path) catch return m;
    var lines = std.mem.splitScalar(u8, text, '\n');
    while (lines.next()) |line| {
        const sp = std.mem.indexOfScalar(u8, line, ' ') orelse continue;
        const us = std.fmt.parseInt(u64, line[0..sp], 10) catch continue;
        try m.put(alloc, try alloc.dupe(u8, line[sp + 1 ..]), us);
    }
    return m;
}

fn saveDurations(alloc: std.mem.Allocator, m: *const std.StringHashMapUnmanaged(u64)) void {
    var out: std.ArrayList(u8) = .empty;
    var it = m.iterator();
    while (it.next()) |e| {
        var buf: [32]u8 = undefined;
        out.appendSlice(alloc, std.fmt.bufPrint(&buf, "{d} ", .{e.value_ptr.*}) catch continue) catch return;
        out.appendSlice(alloc, e.key_ptr.*) catch return;
        out.append(alloc, '\n') catch return;
    }
    _ = linux.mkdir("/var/lib", 0o755);
    _ = linux.mkdir(durations_dir, 0o755);
    const tmp = durations_path ++ ".tmp";
    const rc = linux.open(tmp, .{ .ACCMODE = .WRONLY, .CREAT = true, .TRUNC = true, .CLOEXEC = true }, 0o644);
    if (linux.errno(rc) != .SUCCESS) {
        log("cannot write {s}", .{durations_path});
        return;
    }
    const fd: i32 = @intCast(rc);
    _ = linux.write(fd, out.items.ptr, out.items.len);
    _ = linux.close(fd);
    _ = linux.rename(tmp, durations_path);
    log("saved {d} unit times to {s}", .{ m.count(), durations_path });
}

const times_var = "/sys/firmware/efi/efivars/BootmapTimes-4b2a8f1e-6d3c-4b7a-9e2f-1c5d8a7b3e90";
const times_magic: u32 = 0x31544d42; // "BMT1", as in kernel/bootmap.c

/// Write the initcall times of this boot to the EFI variable that the
/// kernel reads in the next boot (bm_read_times in kernel/bootmap.c).
fn saveKernelTimes(alloc: std.mem.Allocator, pm: ProcMap) void {
    if (pm.nic == 0) return;
    const data = alloc.alloc(u32, 4 + pm.nic) catch return;
    @memset(data, 0);
    data[0] = 0x7; // NON_VOLATILE | BOOTSERVICE_ACCESS | RUNTIME_ACCESS
    data[1] = times_magic;
    data[2] = pm.names_hash;
    data[3] = pm.nic;
    var n: usize = 0;
    for (pm.nodes) |kn| {
        if (kn.depth != 3 or kn.ic < 0 or kn.ic >= pm.nic or kn.state != 2) continue;
        data[4 + @as(usize, @intCast(kn.ic))] = @intCast(@min(kn.end_us -| kn.start_us, std.math.maxInt(u32)));
        n += 1;
    }
    // efivarfs makes an existing variable immutable. Clear the flag first.
    const FS_IOC_GETFLAGS: u32 = 0x80086601;
    const FS_IOC_SETFLAGS: u32 = 0x40086602;
    const FS_IMMUTABLE_FL: c_long = 0x10;
    const old = linux.open(times_var, .{ .ACCMODE = .RDONLY, .CLOEXEC = true }, 0);
    if (linux.errno(old) == .SUCCESS) {
        const fd: i32 = @intCast(old);
        var flags: c_long = 0;
        if (linux.errno(linux.ioctl(fd, FS_IOC_GETFLAGS, @intFromPtr(&flags))) == .SUCCESS) {
            flags &= ~FS_IMMUTABLE_FL;
            _ = linux.ioctl(fd, FS_IOC_SETFLAGS, @intFromPtr(&flags));
        }
        _ = linux.close(fd);
    }
    const rc = linux.open(times_var, .{ .ACCMODE = .WRONLY, .CREAT = true, .CLOEXEC = true }, 0o644);
    if (linux.errno(rc) != .SUCCESS) {
        log("cannot open {s}: {s}", .{ times_var, @tagName(linux.errno(rc)) });
        return;
    }
    const fd: i32 = @intCast(rc);
    defer _ = linux.close(fd);
    // efivarfs takes the attributes and the data in one write.
    const bytes = std.mem.sliceAsBytes(data);
    const w = linux.write(fd, bytes.ptr, bytes.len);
    if (linux.errno(w) != .SUCCESS) {
        log("cannot write the initcall times: {s}", .{@tagName(linux.errno(w))});
        return;
    }
    log("saved {d} initcall times to the EFI variable", .{n});
}

/// Tell the kernel that the daemon has the screen: it stops drawing.
fn handoff() void {
    const rc = linux.open("/proc/bootmap", .{ .ACCMODE = .WRONLY, .CLOEXEC = true }, 0);
    if (linux.errno(rc) != .SUCCESS) return;
    const fd: i32 = @intCast(rc);
    _ = linux.write(fd, "handoff", 7);
    _ = linux.close(fd);
}

/// A kernel-area node of /proc/bootmap as a plan node, with its title
/// strip and group place, so canvas draws it as the replay does.
const KArea = struct { nodes: []bootmap.plan.Node, gidx: []u16 };

fn kernelArea(alloc: std.mem.Allocator, pm: ProcMap, st: bootmap.style.Style) !KArea {
    const n = pm.nodes.len;
    const nodes = try alloc.alloc(bootmap.plan.Node, n);
    const gidx = try alloc.alloc(u16, n);
    const kids = try alloc.alloc(u32, n);
    @memset(kids, 0);
    var last: [4]usize = @splat(0);
    var groups_in_stage: u16 = 0;
    for (pm.nodes, 0..) |kn, i| {
        const d = @min(kn.depth, 3);
        last[d] = i;
        if (d > 0) kids[last[d - 1]] += 1;
        if (d == 1) groups_in_stage = 0;
        gidx[i] = if (d == 2) blk: {
            groups_in_stage += 1;
            break :blk groups_in_stage - 1;
        } else if (d == 3) gidx[last[2]] else 0;
    }
    const hh = st.headerH();
    for (pm.nodes, 0..) |kn, i| {
        var nd: bootmap.plan.Node = .{ .name = kn.name, .depth = kn.depth, .parent = 0, .stage = kn.stage, .rect = kn.rect, .first_us = 0, .expected_us = kn.expected_us };
        const titled = kn.depth == 1 or (kn.depth == 2 and kids[i] > 1);
        const inner = kn.rect.inset(@as(i32, st.pads[@min(kn.depth, 2)]));
        if (titled and hh > 0 and inner.h > hh) nd.header = .{ .x = inner.x, .y = inner.y, .w = inner.w, .h = hh };
        nodes[i] = nd;
    }
    return .{ .nodes = nodes, .gidx = gidx };
}

fn drawKernelArea(canvas: bootmap.canvas.Canvas, ka: *const KArea, pm: ProcMap, st: bootmap.style.Style, t: u64) void {
    const pal = bootmap.color.palettes[@min(st.palette, bootmap.color.palettes.len - 1)];
    for (pm.nodes, 0..) |kn, i| {
        if (kn.depth != 3) continue;
        var nd = ka.nodes[i];
        nd.color = bootmap.canvas.leafColor(nd, ka.gidx[i], pal, st, t, t, 1);
        const state: bootmap.plan.State = if (nd.start_us == never) .pending else if (t < nd.end_us) .active else .done;
        bootmap.canvas.drawLeaf(canvas, nd, state, st, t);
    }
    if (st.labels == .none) return;
    for (ka.nodes) |nd| if (nd.depth == 1 or nd.depth == 2) bootmap.canvas.drawHeader(canvas, nd, st, t);
}

/// The unit times and groups of the last boot, from durations_path.
/// Version 2 lines: "<microseconds> <group> <unit>". Version 1 lines
/// ("<microseconds> <unit>") give a time and no group.
const Last = struct { us: u64, group: ?[]const u8 };

fn loadLast(alloc: std.mem.Allocator) !std.StringArrayHashMapUnmanaged(Last) {
    var m: std.StringArrayHashMapUnmanaged(Last) = .empty;
    const text = readFile(alloc, durations_path) catch return m;
    var lines = std.mem.splitScalar(u8, text, '\n');
    while (lines.next()) |line| {
        var t = std.mem.tokenizeScalar(u8, line, ' ');
        const a = t.next() orelse continue;
        const b = t.next() orelse continue;
        const c = t.next();
        const us = std.fmt.parseInt(u64, a, 10) catch continue;
        if (c) |unit| {
            try m.put(alloc, try alloc.dupe(u8, unit), .{ .us = us, .group = try alloc.dupe(u8, b) });
        } else {
            try m.put(alloc, try alloc.dupe(u8, b), .{ .us = us, .group = null });
        }
    }
    return m;
}

fn saveLast(alloc: std.mem.Allocator, m: *const std.StringArrayHashMapUnmanaged(Last)) void {
    var out: std.ArrayList(u8) = .empty;
    var it = m.iterator();
    while (it.next()) |e| {
        var buf: [32]u8 = undefined;
        out.appendSlice(alloc, std.fmt.bufPrint(&buf, "{d} ", .{e.value_ptr.us}) catch continue) catch return;
        out.appendSlice(alloc, e.value_ptr.group orelse default_group) catch return;
        out.append(alloc, ' ') catch return;
        out.appendSlice(alloc, e.key_ptr.*) catch return;
        out.append(alloc, '\n') catch return;
    }
    _ = linux.mkdir("/var/lib", 0o755);
    _ = linux.mkdir(durations_dir, 0o755);
    const tmp = durations_path ++ ".tmp";
    const rc = linux.open(tmp, .{ .ACCMODE = .WRONLY, .CREAT = true, .TRUNC = true, .CLOEXEC = true }, 0o644);
    if (linux.errno(rc) != .SUCCESS) {
        log("cannot write {s}", .{durations_path});
        return;
    }
    const fd: i32 = @intCast(rc);
    _ = linux.write(fd, out.items.ptr, out.items.len);
    _ = linux.close(fd);
    _ = linux.rename(tmp, durations_path);
    log("saved {d} unit times to {s}", .{ m.count(), durations_path });
}

/// The D-Bus object path of a unit: systemd's bus_label_escape. A letter or
/// a digit stays (a digit only after the first place). Each other byte is
/// "_" and two lowercase hex digits.
fn unitPath(alloc: std.mem.Allocator, name: []const u8) ![]const u8 {
    var out: std.ArrayList(u8) = .empty;
    try out.appendSlice(alloc, "/org/freedesktop/systemd1/unit/");
    for (name, 0..) |c, i| {
        if (std.ascii.isAlphabetic(c) or (i > 0 and std.ascii.isDigit(c))) {
            try out.append(alloc, c);
        } else {
            var b: [3]u8 = undefined;
            try out.appendSlice(alloc, std.fmt.bufPrint(&b, "_{x:0>2}", .{c}) catch unreachable);
        }
    }
    return out.items;
}

/// The systemd part of the picture.
const Systemd = struct {
    plan: Plan,
    leaf_of: std.StringHashMapUnmanaged(u32) = .empty,
    path_of: std.StringHashMapUnmanaged(u32) = .empty,
    measured: []bool,
};

fn buildSystemd(alloc: std.mem.Allocator, boxes: []bootmap.trace.Box, area: Rect, st: bootmap.style.Style) !Systemd {
    var plan = try bootmap.plan.fromTrace(alloc, .{ .version = 1, .end_us = 0, .boxes = boxes }, st.other);
    try plan.layout(area, .{ 0, st.pads[1], st.pads[2] }, st.headerH(), st.order);
    var sd: Systemd = .{ .plan = plan, .measured = try alloc.alloc(bool, plan.nodes.len) };
    @memset(sd.measured, false);
    for (sd.plan.nodes, 0..) |*nd, i| {
        if (nd.depth != 3) continue;
        nd.expected_us = nd.end_us - nd.start_us;
        nd.start_us = never;
        nd.end_us = never;
        try sd.leaf_of.put(alloc, nd.name, @intCast(i));
        try sd.path_of.put(alloc, try unitPath(alloc, nd.name), @intCast(i));
    }
    for (sd.plan.nodes) |*nd| if (nd.depth < 3) {
        nd.first_us = never;
    };
    return sd;
}

fn markStart(sd: *Systemd, i: u32, now: u64) void {
    const nd = &sd.plan.nodes[i];
    if (nd.start_us != never) return;
    nd.start_us = now;
    sd.measured[i] = true;
    var p = nd.parent;
    while (true) {
        sd.plan.nodes[p].first_us = @min(sd.plan.nodes[p].first_us, now);
        if (p == 0) break;
        p = sd.plan.nodes[p].parent;
    }
}

fn markEnd(sd: *Systemd, i: u32, now: u64, failed: bool) void {
    const nd = &sd.plan.nodes[i];
    if (nd.start_us == never) {
        // It ended with no start seen: it did not run while we watched.
        markStart(sd, i, now);
        sd.measured[i] = false;
    }
    if (nd.end_us != never) return;
    nd.end_us = @max(now, nd.start_us);
    nd.failed = failed;
}

/// A JobRemoved or PropertiesChanged signal of systemd.
fn onSignal(sd: *Systemd, m: dbus.Conn.Message, now: u64, boot_done: *bool) void {
    var r = m.body;
    if (eql(m.member, "JobRemoved")) {
        _ = r.u32_() catch return;
        _ = r.string() catch return;
        const unit = r.string() catch return;
        const result = r.string() catch return;
        const i = sd.leaf_of.get(unit) orelse return;
        const failed = eql(result, "failed") or eql(result, "timeout") or eql(result, "dependency");
        markEnd(sd, i, now, failed);
    } else if (eql(m.member, "StartupFinished")) {
        boot_done.* = true;
    } else if (eql(m.member, "PropertiesChanged")) {
        const i = sd.path_of.get(m.path) orelse return;
        const iface = r.string() catch return;
        if (!eql(iface, "org.freedesktop.systemd1.Unit")) return;
        const end = r.array(8) catch return;
        while (r.pos < end) {
            r.alignTo(8);
            const key = r.string() catch return;
            const sig = r.signature() catch return;
            if (eql(key, "ActiveState") and eql(sig, "s")) {
                const v = r.string() catch return;
                if (eql(v, "activating") or eql(v, "reloading")) markStart(sd, i, now);
                if (eql(v, "failed")) markEnd(sd, i, now, true);
                if (eql(v, "active") and sd.plan.nodes[i].start_us != never) markEnd(sd, i, now, false);
            } else {
                var j: usize = 0;
                r.skip(sig, &j) catch return;
            }
        }
    }
}

/// A ListUnits reply: catch up on the units that changed while no signal
/// told us (before the daemon started, or before it had a connection).
fn reconcile(sd: *Systemd, units: []const Unit, now: u64) void {
    for (units) |u| {
        const i = sd.leaf_of.get(u.name) orelse continue;
        const nd = &sd.plan.nodes[i];
        const working = u.job != 0 or eql(u.active, "activating") or eql(u.active, "reloading");
        if (working) {
            markStart(sd, i, now);
        } else if (nd.end_us == never and (eql(u.active, "active") or eql(u.active, "failed") or eql(u.active, "inactive"))) {
            if (nd.start_us != never or !eql(u.active, "inactive")) markEnd(sd, i, now, eql(u.active, "failed"));
        }
    }
}

fn boxesFromUnits(alloc: std.mem.Allocator, units: []const Unit, last: *const std.StringArrayHashMapUnmanaged(Last), groups: *const std.StringHashMapUnmanaged([]const u8)) ![]bootmap.trace.Box {
    var boxes: std.ArrayList(bootmap.trace.Box) = .empty;
    for (units) |u| {
        if (!isBoxUnit(u)) continue;
        const l = last.get(u.name);
        const path = try alloc.alloc([]const u8, 3);
        path[0] = "systemd";
        path[1] = groups.get(u.name) orelse (if (l) |x| (x.group orelse default_group) else default_group);
        path[2] = u.name;
        const key: u64 = u.job;
        try boxes.append(alloc, .{ .path = path, .start_us = key, .end_us = key + (if (l) |x| x.us else 0) });
    }
    return boxes.items;
}

fn boxesFromLast(alloc: std.mem.Allocator, last: *const std.StringArrayHashMapUnmanaged(Last)) !?[]bootmap.trace.Box {
    var boxes: std.ArrayList(bootmap.trace.Box) = .empty;
    var it = last.iterator();
    var k: u64 = 0;
    while (it.next()) |e| : (k += 1) {
        const g = e.value_ptr.group orelse return null; // version 1: no groups
        const path = try alloc.alloc([]const u8, 3);
        path[0] = "systemd";
        path[1] = g;
        path[2] = e.key_ptr.*;
        // The file keeps the order of the last boot.
        try boxes.append(alloc, .{ .path = path, .start_us = k, .end_us = k + e.value_ptr.us });
    }
    if (boxes.items.len == 0) return null;
    return boxes.items;
}

/// Run systemctl and return what it prints. systemctl talks to systemd
/// reliably. The daemon's own D-Bus client often gets no answer to a call
/// (a second connection from one process; see README), so it only listens
/// for signals, and systemctl answers the questions.
fn systemctl(alloc: std.mem.Allocator, args: []const []const u8) ![]u8 {
    return run(alloc, "/usr/bin/systemctl", args);
}

/// Run a program, and return what it prints on stdout (at most 20 s).
fn run(alloc: std.mem.Allocator, path: [:0]const u8, args: []const []const u8) ![]u8 {
    var argv: std.ArrayList(?[*:0]const u8) = .empty;
    try argv.append(alloc, path.ptr);
    for (args) |a| try argv.append(alloc, try alloc.dupeSentinel(u8, a, 0));
    try argv.append(alloc, null);
    const envp = [_:null]?[*:0]const u8{ "PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL=C", "SYSTEMD_PAGER=", "SYSTEMD_COLORS=0" };

    var fds: [2]i32 = undefined;
    if (linux.errno(linux.pipe2(&fds, .{ .CLOEXEC = true })) != .SUCCESS) return error.Pipe;
    const pid_rc = linux.fork();
    if (linux.errno(pid_rc) != .SUCCESS) return error.Fork;
    if (pid_rc == 0) {
        _ = linux.dup2(fds[1], 1);
        const null_rc = linux.open("/dev/null", .{ .ACCMODE = .RDWR }, 0);
        if (linux.errno(null_rc) == .SUCCESS) {
            _ = linux.dup2(@intCast(null_rc), 0);
            _ = linux.dup2(@intCast(null_rc), 2);
        }
        _ = linux.execve(path.ptr, @ptrCast(argv.items.ptr), &envp);
        linux.exit(127);
    }
    _ = linux.close(fds[1]);
    defer _ = linux.close(fds[0]);
    var out: std.ArrayList(u8) = .empty;
    var buf: [65536]u8 = undefined;
    const deadline = nowUs() + 20_000_000;
    while (nowUs() < deadline) {
        var pfd = [1]linux.pollfd{.{ .fd = fds[0], .events = linux.POLL.IN, .revents = 0 }};
        if (linux.poll(&pfd, 1, 1000) == 0) continue;
        const n = linux.read(fds[0], &buf, buf.len);
        if (linux.errno(n) != .SUCCESS or n == 0) break;
        try out.appendSlice(alloc, buf[0..n]);
    }
    var status: i32 = 0;
    _ = linux.wait4(@intCast(pid_rc), &status, 0, null);
    return out.items;
}

/// The units, their active state and their job: systemctl list-units and
/// list-jobs.
fn unitsBySystemctl(alloc: std.mem.Allocator) ![]Unit {
    const jobs_text = try systemctl(alloc, &.{ "list-jobs", "--no-legend", "--full", "--no-pager" });
    var jobs: std.StringHashMapUnmanaged(u32) = .empty;
    var jl = std.mem.splitScalar(u8, jobs_text, '\n');
    while (jl.next()) |line| {
        var t = std.mem.tokenizeAny(u8, line, " \t");
        const id = std.fmt.parseInt(u32, t.next() orelse continue, 10) catch continue;
        try jobs.put(alloc, t.next() orelse continue, id);
    }
    const text = try systemctl(alloc, &.{ "list-units", "--all", "--plain", "--no-legend", "--full", "--no-pager" });
    var out: std.ArrayList(Unit) = .empty;
    var lines = std.mem.splitScalar(u8, text, '\n');
    while (lines.next()) |line| {
        var t = std.mem.tokenizeAny(u8, line, " \t");
        const name = t.next() orelse continue;
        _ = t.next() orelse continue; // load state
        const active = t.next() orelse continue;
        try out.append(alloc, .{ .name = try alloc.dupe(u8, name), .active = try alloc.dupe(u8, active), .job = jobs.get(name) orelse 0, .path = "" });
    }
    if (out.items.len == 0) return error.NoUnits;
    return out.items;
}

/// The group of each unit: the first target in target_order that it is
/// ordered Before= (systemctl show).
fn groupsBySystemctl(alloc: std.mem.Allocator, names: []const []const u8) !std.StringHashMapUnmanaged([]const u8) {
    var m: std.StringHashMapUnmanaged([]const u8) = .empty;
    if (names.len == 0) return m;
    var args: std.ArrayList([]const u8) = .empty;
    try args.appendSlice(alloc, &.{ "show", "--no-pager", "-p", "Id", "-p", "Before" });
    try args.appendSlice(alloc, names);
    const text = try systemctl(alloc, args.items);
    var blocks = std.mem.splitSequence(u8, text, "\n\n");
    while (blocks.next()) |block| {
        var id: ?[]const u8 = null;
        var group: []const u8 = default_group;
        var lines = std.mem.splitScalar(u8, block, '\n');
        while (lines.next()) |line| {
            if (std.mem.startsWith(u8, line, "Id=")) id = line[3..];
            if (std.mem.startsWith(u8, line, "Before=")) {
                var best: usize = target_order.len;
                var t = std.mem.tokenizeScalar(u8, line[7..], ' ');
                while (t.next()) |tg| for (target_order, 0..) |name, i| if (i < best and eql(name, tg)) {
                    best = i;
                };
                if (best < target_order.len) group = target_order[best];
            }
        }
        if (id) |i| try m.put(alloc, try alloc.dupe(u8, i), group);
    }
    return m;
}

/// bootmapd --test-dbus: call ListUnits five times and print the times.
/// For diagnosis: it does not touch the screen.
fn testDbus(alloc: std.mem.Allocator) !void {
    dbus.on_skip = &logSkipAll;
    var k: usize = 0;
    while (k < 5) : (k += 1) {
        const t0 = nowUs();
        var c = dbus.Conn.open(alloc, "/run/systemd/private") catch |err| {
            std.debug.print("connect: {s}\n", .{@errorName(err)});
            continue;
        };
        const t1 = nowUs();
        if (c.call(systemd_path, manager_iface, "ListUnits", &.{})) |body| {
            const units = try parseListUnits(alloc, body);
            std.debug.print("try {d}: connect {d} ms, ListUnits {d} ms, {d} units\n", .{ k, (t1 - t0) / 1000, (nowUs() - t1) / 1000, units.len });
        } else |err| std.debug.print("try {d}: connect {d} ms, ListUnits {s} after {d} ms\n", .{ k, (t1 - t0) / 1000, @errorName(err), (nowUs() - t1) / 1000 });
        c.close();
    }
}

fn logSkipAll(kind: u8, reply_serial: u32, member: []const u8) void {
    std.debug.print("  skipped: kind {d}, reply to {d}, {s}\n", .{ kind, reply_serial, member });
}

pub fn main(init: std.process.Init) !void {
    const alloc = init.arena.allocator();
    const args = try init.minimal.args.toSlice(alloc);
    if (args.len > 1 and eql(args[1], "--test-dbus")) {
        dbus.call_timeout_s = 10;
        return testDbus(alloc);
    }
    const st = styleFromCmdline(alloc);
    const t_start = nowUs();

    const proc_text = readFile(alloc, "/proc/bootmap") catch {
        log("no /proc/bootmap: this kernel has no bootmap. Exit.", .{});
        return;
    };
    const pm = try parseProcMap(alloc, proc_text);
    var systemd_rect: ?Rect = null;
    for (pm.nodes) |n| if (n.depth == 1 and n.stage == 4) {
        systemd_rect = n.rect;
    };
    const area = systemd_rect orelse {
        log("the systemd stage has weight 0 (bootmap.stages). Exit.", .{});
        return;
    };

    // 1. The picture first: the kernel's part, and the systemd plan of the
    //    last boot when there is one. As DRM master, this buffer also covers
    //    any console text from the initrd.
    var out = drm.Output.open("/dev/dri/card0") catch |err| {
        log("no DRM output: {s}", .{@errorName(err)});
        return err;
    };
    if (out.width != pm.width or out.height != pm.height)
        log("the output is {d} x {d}, the kernel picture is {d} x {d}", .{ out.width, out.height, pm.width, pm.height });
    const canvas: bootmap.canvas.Canvas = .{ .pixels = out.pixels, .width = @intCast(out.width), .height = @intCast(out.height), .stride = @intCast(out.stride) };
    canvas.clear(bootmap.palette.surface);

    const ka = try kernelArea(alloc, pm, st);
    const pal = bootmap.color.palettes[@min(st.palette, bootmap.color.palettes.len - 1)];
    for (pm.nodes, 0..) |kn, i| {
        const nd = &ka.nodes[i];
        if (kn.depth == 1 and kn.stage < bootmap.plan.kernel_stage and kn.rect.w > 0) {
            canvas.fill(kn.rect.x, kn.rect.y, kn.rect.w, kn.rect.h, pal.stops[kn.stage % pal.stops.len]);
            continue;
        }
        if (kn.depth != 3) continue;
        nd.start_us = if (kn.state == 0) never else kn.start_us;
        nd.end_us = if (kn.state == 1) t_start else kn.end_us;
    }
    var initrd_leaf: ?usize = null;
    for (pm.nodes, 0..) |kn, i| if (kn.depth == 3 and kn.stage == 3) {
        initrd_leaf = i;
    };
    drawKernelArea(canvas, &ka, pm, st, t_start);

    var last = try loadLast(alloc);
    log("{d} unit times from the last boot", .{last.count()});
    var sd: ?Systemd = null;
    if (try boxesFromLast(alloc, &last)) |boxes| sd = try buildSystemd(alloc, boxes, area, st);
    if (sd) |*s| bootmap.canvas.drawPlan(canvas, &s.plan, st, t_start);
    handoff();
    out.present() catch |err| log("present failed: {s}", .{@errorName(err)});
    log("on the screen after {d} ms, {d} systemd boxes from the last boot", .{ (nowUs() - t_start) / 1000, if (sd) |s| s.leaf_of.count() else 0 });

    // 2. systemd. Signals come on our own connection: systemd sends every
    //    signal to every client of its private socket. The unit list comes
    //    from systemctl, now and once more after the startup finishes.
    var sig = try connect(alloc);
    {
        const now = nowUs();
        if (unitsBySystemctl(alloc)) |units| {
            if (sd == null) {
                var names: std.ArrayList([]const u8) = .empty;
                for (units) |u| if (isBoxUnit(u)) try names.append(alloc, u.name);
                const groups = groupsBySystemctl(alloc, names.items) catch std.StringHashMapUnmanaged([]const u8).empty;
                sd = try buildSystemd(alloc, try boxesFromUnits(alloc, units, &last, &groups), area, st);
            }
            reconcile(&sd.?, units, now);
            log("systemctl: {d} units, after {d} ms", .{ units.len, (nowUs() - t_start) / 1000 });
        } else |err| log("systemctl list-units: {s}", .{@errorName(err)});
    }
    var boot_done = false;
    var final_list = false;
    var all_full_since: ?u64 = null;
    var last_poll: u64 = 0;

    while (true) {
        const now = nowUs();
        // Each second, systemctl: the unit states, and whether the startup
        // is finished. Signals are not reliable here (some boots get none),
        // so this is the truth, and signals only add finer times.
        if (now - last_poll > 1_000_000 and !final_list) {
            last_poll = now;
            if (unitsBySystemctl(alloc)) |units| {
                if (sd) |*sx| reconcile(sx, units, nowUs());
            } else |_| {}
            if (boot_done) {
                final_list = true;
            } else if (systemctl(alloc, &.{"is-system-running"})) |state| {
                const st_s = std.mem.trim(u8, state, " \n");
                if (!eql(st_s, "initializing") and !eql(st_s, "starting") and st_s.len > 0) {
                    boot_done = true;
                    log("systemd: {s}, after {d} ms", .{ st_s, (nowUs() - t_start) / 1000 });
                }
            } else |_| {}
        }
        while (sig.next(0) catch null) |m| {
            if (m.kind != 4) continue;
            const was_done = boot_done;
            if (sd) |*s| onSignal(s, m, now, &boot_done) else if (eql(m.member, "StartupFinished")) {
                boot_done = true;
            }
            if (boot_done and !was_done) {
                log("systemd: startup finished, after {d} ms", .{(now - t_start) / 1000});
            }
        }

        if (sd) |*s| bootmap.canvas.drawPlan(canvas, &s.plan, st, now);
        if (initrd_leaf) |il| {
            var nd = ka.nodes[il];
            nd.color = bootmap.canvas.leafColor(nd, ka.gidx[il], pal, st, now, now, 1);
            bootmap.canvas.drawLeaf(canvas, nd, if (now < nd.end_us) .active else .done, st, now);
        }
        out.present() catch {};

        // Done: systemd says the startup finished, a ListUnits after that
        // caught the last units, and every box that ran is full.
        var full = final_list;
        if (sd) |s| for (s.plan.nodes) |nd| {
            if (nd.depth != 3 or nd.start_us == never) continue;
            if (nd.end_us == never or now < nd.end_us + @as(u64, st.fill_ms) * 1000) full = false;
        };
        if (now - t_start > 300_000_000) {
            log("five minutes, and the boot is not finished. Stop.", .{});
            full = true;
        }
        if (full) {
            all_full_since = all_full_since orelse now;
            if (now - all_full_since.? > 1_000_000) break;
        } else all_full_since = null;
        _ = sig.next(33) catch null; // the frame time, or the next signal
    }
    log("every box is full", .{});

    // 3. Keep this boot's times, with the groups (systemd answers calls by
    //    now), for the next boot.
    if (sd) |*s| {
        var names: std.ArrayList([]const u8) = .empty;
        for (s.plan.nodes) |nd| if (nd.depth == 3) names.append(alloc, nd.name) catch {};
        const groups = groupsBySystemctl(alloc, names.items) catch std.StringHashMapUnmanaged([]const u8).empty;
        // Every unit of the plan: a measured unit with this boot's time, the
        // others with the time of an earlier boot (or 0), so the plan keeps
        // the units that were done before the daemon started.
        for (s.plan.nodes, 0..) |nd, i| {
            if (nd.depth != 3) continue;
            const old = last.get(nd.name);
            const group = groups.get(nd.name) orelse (if (old) |o| (o.group orelse default_group) else default_group);
            const us = if (s.measured[i] and nd.end_us != never) nd.end_us - nd.start_us else if (old) |o| o.us else 0;
            last.put(alloc, nd.name, .{ .us = us, .group = group }) catch {};
        }
        saveLast(alloc, &last);
    }
    saveKernelTimes(alloc, pm);

    // 4. The login screen: hold the full picture for a moment, then give the
    //    screen back. The text console comes back with its login prompt.
    sleepMs(2000);
    if (linux.errno(linux.access("/sys/class/graphics/fbcon", linux.F_OK)) == .SUCCESS) {
        log("give the screen to the console", .{});
        _ = linux.close(out.fd); // the console takes the screen
        loadGpu(alloc);
        return;
    }
    // No text console (the QEMU kernel): keep the picture on the screen.
    log("no text console: the picture stays", .{});
    while (true) sleepMs(60_000);
}

/// bootmap.gpu=i915[,...]: the GPU driver modules that hw/install.sh holds
/// back on the bootmap kernel (a modprobe.d install rule waits for
/// /run/bootmap-gpu). Load them now, after the picture: a GPU driver takes
/// the screen from simpledrm.
fn loadGpu(alloc: std.mem.Allocator) void {
    const cmd = readFile(alloc, "/proc/cmdline") catch return;
    var it = std.mem.tokenizeAny(u8, cmd, " \n");
    while (it.next()) |tok| {
        if (!std.mem.startsWith(u8, tok, "bootmap.gpu=")) continue;
        const rc = linux.open("/run/bootmap-gpu", .{ .ACCMODE = .WRONLY, .CREAT = true, .CLOEXEC = true }, 0o644);
        if (linux.errno(rc) == .SUCCESS) _ = linux.close(@intCast(rc));
        var mods = std.mem.tokenizeScalar(u8, tok["bootmap.gpu=".len..], ',');
        while (mods.next()) |m| {
            _ = run(alloc, "/sbin/modprobe", &.{m}) catch |err| {
                log("modprobe {s}: {s}", .{ m, @errorName(err) });
                continue;
            };
            log("loaded the GPU driver {s}", .{m});
        }
    }
}

fn parseListUnits(alloc: std.mem.Allocator, body: dbus.Reader) ![]Unit {
    var r = body;
    var out: std.ArrayList(Unit) = .empty;
    const end = try r.array(8);
    while (r.pos < end) {
        r.alignTo(8);
        const name = try r.string();
        _ = try r.string();
        _ = try r.string();
        const active = try r.string();
        _ = try r.string();
        _ = try r.string();
        const path = try r.string();
        const job = try r.u32_();
        _ = try r.string();
        _ = try r.string();
        try out.append(alloc, .{ .name = try alloc.dupe(u8, name), .active = try alloc.dupe(u8, active), .job = job, .path = try alloc.dupe(u8, path) });
    }
    return out.items;
}
