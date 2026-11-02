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
    const s = std.fmt.bufPrint(&buf, "bootmapd: " ++ fmt ++ "\n", args) catch return;
    if (kmsg < 0) {
        const rc = linux.open("/dev/kmsg", .{ .ACCMODE = .WRONLY, .CLOEXEC = true }, 0);
        kmsg = if (linux.errno(rc) == .SUCCESS) @intCast(rc) else 2;
    }
    _ = linux.write(kmsg, s.ptr, s.len);
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

/// ListUnits, with a new connection when the old one fails or times out.
fn listUnitsRetry(alloc: std.mem.Allocator, conn: *dbus.Conn) ![]Unit {
    var tries: usize = 0;
    while (true) : (tries += 1) {
        if (listUnits(alloc, conn)) |u| return u else |err| {
            if (tries > 10) return err;
            log("ListUnits: {s}, connect again", .{@errorName(err)});
            conn.close();
            conn.* = try connect(alloc);
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
const KNode = struct { depth: u8, stage: u8, rect: Rect, state: u8, name: []const u8 };

const ProcMap = struct { width: i32, height: i32, nodes: []KNode };

fn parseProcMap(alloc: std.mem.Allocator, text: []const u8) !ProcMap {
    var lines = std.mem.splitScalar(u8, text, '\n');
    var head = std.mem.tokenizeScalar(u8, lines.next() orelse return error.Empty, ' ');
    if (!std.mem.eql(u8, head.next() orelse "", "bootmap")) return error.BadHeader;
    _ = head.next();
    const w = try std.fmt.parseInt(i32, head.next() orelse return error.BadHeader, 10);
    const h = try std.fmt.parseInt(i32, head.next() orelse return error.BadHeader, 10);
    var nodes: std.ArrayList(KNode) = .empty;
    while (lines.next()) |line| {
        var t = std.mem.tokenizeScalar(u8, line, ' ');
        var f: [10][]const u8 = undefined;
        var n: usize = 0;
        while (n < 10) : (n += 1) f[n] = t.next() orelse break;
        if (n < 10) continue;
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
            .name = try alloc.dupe(u8, name),
        });
    }
    return .{ .width = w, .height = h, .nodes = nodes.items };
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
    var r = conn.call(unit_path, "org.freedesktop.DBus.Properties", "Get", &.{ "org.freedesktop.systemd1.Unit", "Before" }) catch return default_group;
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

pub fn main(init: std.process.Init) !void {
    const alloc = init.arena.allocator();
    const st = styleFromCmdline(alloc);

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

    // systemd's private socket exists from the start of PID 1.
    log("connect to systemd", .{});
    var conn = try connect(alloc);
    log("connected", .{});

    // The boxes: the units with a job or that are active. A job number
    // stands in for the start time, so the plan is in boot order.
    const units = try listUnitsRetry(alloc, &conn);
    log("{d} units", .{units.len});
    var boxes: std.ArrayList(bootmap.trace.Box) = .empty;
    for (units) |u| {
        if (!isBoxUnit(u)) continue;
        const g = try groupOf(alloc, &conn, u.path);
        const path = try alloc.alloc([]const u8, 3);
        path[0] = "systemd";
        path[1] = g;
        path[2] = u.name;
        const order_key: u64 = if (u.job != 0) u.job else 0;
        try boxes.append(alloc, .{ .path = path, .start_us = order_key, .end_us = order_key });
    }
    var plan = try bootmap.plan.fromTrace(alloc, .{ .version = 1, .end_us = 0, .boxes = boxes.items }, st.other);
    // The stage gets all of the area: pad 0 at the root.
    try plan.layout(area, .{ 0, st.pads[1], st.pads[2] }, st.headerH(), st.order);

    // Live state: every leaf starts pending.
    var leaf_of: std.StringHashMapUnmanaged(u32) = .empty;
    for (plan.nodes, 0..) |*nd, i| {
        if (nd.depth != 3) continue;
        nd.start_us = never;
        nd.end_us = never;
        nd.expected_us = 0;
        try leaf_of.put(alloc, nd.name, @intCast(i));
    }
    for (plan.nodes) |*nd| if (nd.depth < 3) {
        nd.first_us = never;
    };
    log("{d} systemd boxes in {d} x {d}", .{ leaf_of.count(), area.w, area.h });

    log("open the DRM output", .{});
    var out = drm.Output.open("/dev/dri/card0") catch |err| {
        log("no DRM output: {s}", .{@errorName(err)});
        return err;
    };
    if (out.width != pm.width or out.height != pm.height)
        log("the output is {d} x {d}, the kernel picture is {d} x {d}", .{ out.width, out.height, pm.width, pm.height });
    const canvas: bootmap.canvas.Canvas = .{ .pixels = out.pixels, .width = @intCast(out.width), .height = @intCast(out.height), .stride = @intCast(out.stride) };
    canvas.clear(bootmap.palette.surface);

    // The kernel's part of the picture, as the kernel left it.
    const t0 = nowUs();
    for (pm.nodes) |kn| {
        if (kn.depth != 3) continue;
        const nd: bootmap.plan.Node = .{ .name = kn.name, .depth = 3, .parent = 0, .stage = kn.stage, .rect = kn.rect };
        const state: bootmap.plan.State = switch (kn.state) {
            0 => .pending,
            1 => .active,
            3 => .failed,
            else => .done,
        };
        bootmap.canvas.drawLeaf(canvas, nd, state, st, t0);
    }

    var all_full_since: ?u64 = null;
    while (true) {
        const now = nowUs();
        const us = listUnitsRetry(alloc, &conn) catch |err| {
            log("ListUnits failed: {s}", .{@errorName(err)});
            break;
        };
        for (us) |u| {
            const i = leaf_of.get(u.name) orelse continue;
            const nd = &plan.nodes[i];
            const working = u.job != 0 or eql(u.active, "activating") or eql(u.active, "reloading");
            const failed = eql(u.active, "failed");
            if (nd.start_us == never and (working or failed or eql(u.active, "active") or eql(u.active, "inactive"))) {
                // It started (or it ended between two polls).
                if (working or nd.end_us == never) nd.start_us = now;
            }
            if (nd.start_us != never and nd.end_us == never and !working) {
                if (failed or eql(u.active, "active") or eql(u.active, "inactive")) {
                    nd.end_us = now;
                    nd.failed = failed;
                }
            }
        }
        // The areas appear with their first box.
        for (plan.nodes) |*nd| if (nd.depth == 3 and nd.start_us != never) {
            var p = nd.parent;
            while (true) {
                plan.nodes[p].first_us = @min(plan.nodes[p].first_us, nd.start_us);
                if (p == 0) break;
                p = plan.nodes[p].parent;
            }
        };

        bootmap.canvas.drawPlan(canvas, &plan, st, now);
        out.present() catch |err| log("present failed: {s}", .{@errorName(err)});

        var full = true;
        for (plan.nodes) |nd| {
            if (nd.depth != 3) continue;
            if (nd.end_us == never or now < nd.end_us + @as(u64, st.fill_ms) * 1000) full = false;
        }
        if (full) {
            all_full_since = all_full_since orelse now;
            if (now - all_full_since.? > 1_000_000) break;
        } else all_full_since = null;
        sleepMs(50);
    }
    log("every box is full", .{});
    // Keep the buffer on the screen until systemd stops this service.
    while (true) sleepMs(60_000);
}
