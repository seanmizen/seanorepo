//! tinyinit: the init of the kernel-only test (vm/run.sh --kernel-only).
//!
//! It mounts /proc and /dev, copies /proc/bootmap to the second serial port
//! (/dev/ttyS1, a file on the host), waits so that the last frame can be
//! captured, and powers the machine off. A static binary with no libc.

const std = @import("std");
const linux = std.os.linux;

fn say(fd: i32, s: []const u8) void {
    _ = linux.write(fd, s.ptr, s.len);
}

pub fn main() void {
    _ = linux.mkdir("/proc", 0o755);
    _ = linux.mkdir("/dev", 0o755);
    _ = linux.mount("proc", "/proc", "proc", 0, 0);
    _ = linux.mount("devtmpfs", "/dev", "devtmpfs", 0, 0);

    const out_rc = linux.open("/dev/ttyS1", .{ .ACCMODE = .WRONLY, .NOCTTY = true }, 0);
    const out: i32 = if (linux.errno(out_rc) == .SUCCESS) @intCast(out_rc) else -1;

    const in_rc = linux.open("/proc/bootmap", .{ .ACCMODE = .RDONLY }, 0);
    if (linux.errno(in_rc) == .SUCCESS and out >= 0) {
        const in: i32 = @intCast(in_rc);
        var buf: [4096]u8 = undefined;
        while (true) {
            const n = linux.read(in, &buf, buf.len);
            if (linux.errno(n) != .SUCCESS or n == 0) break;
            say(out, buf[0..n]);
        }
        _ = linux.close(in);
    } else if (out >= 0) {
        say(out, "tinyinit: no /proc/bootmap\n");
    }
    if (out >= 0) say(out, "tinyinit: end\n");

    const t: linux.timespec = .{ .sec = 2, .nsec = 0 };
    _ = linux.nanosleep(&t, null);
    _ = linux.reboot(.MAGIC1, .MAGIC2, .POWER_OFF, null);
    while (true) _ = linux.nanosleep(&t, null);
}
