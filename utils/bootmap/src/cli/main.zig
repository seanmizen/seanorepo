//! bootmap: headless tools for a recorded boot.
//!
//!   bootmap snapshot <trace.json> <out.png> [--at <pct>] [--size <W>x<H>]
//!       Draw the treemap at <pct> % of the boot (default 100) to a PNG.
//!   bootmap plan <trace.json> [--size <W>x<H>]
//!       Print the plan text that kernel/layout.c reads (layout parity).
//!   bootmap rects <trace.json> [--size <W>x<H>]
//!       Print the rectangle of each node, in pre-order.
//!   bootmap stats <trace.json>
//!       Print the boxes for each stage and group, and the boot time.

const std = @import("std");
const bootmap = @import("bootmap");

const usage =
    \\usage:
    \\  bootmap snapshot <trace.json> <out.png> [--at <pct>] [--size <W>x<H>]
    \\  bootmap plan <trace.json> [--size <W>x<H>]
    \\  bootmap rects <trace.json> [--size <W>x<H>]
    \\  bootmap stats <trace.json>
    \\
;

const Options = struct {
    width: i32 = 1280,
    height: i32 = 800,
    at_pct: u64 = 100,
};

pub fn main(init: std.process.Init) !void {
    const alloc = init.arena.allocator();
    const io = init.io;
    const args = try init.minimal.args.toSlice(alloc);

    var out_buf: [64 * 1024]u8 = undefined;
    var stdout = std.Io.File.stdout().writer(io, &out_buf);
    const out = &stdout.interface;
    defer out.flush() catch {};

    if (args.len < 3) return fail(out, usage);
    const cmd = args[1];
    const trace_path = args[2];

    var opts: Options = .{};
    var positional: std.ArrayList([]const u8) = .empty;
    var i: usize = 3;
    while (i < args.len) : (i += 1) {
        const a = args[i];
        if (std.mem.eql(u8, a, "--at") and i + 1 < args.len) {
            i += 1;
            opts.at_pct = try std.fmt.parseInt(u64, args[i], 10);
        } else if (std.mem.eql(u8, a, "--size") and i + 1 < args.len) {
            i += 1;
            const x = std.mem.indexOfScalar(u8, args[i], 'x') orelse return fail(out, "bootmap: --size needs <W>x<H>\n");
            opts.width = try std.fmt.parseInt(i32, args[i][0..x], 10);
            opts.height = try std.fmt.parseInt(i32, args[i][x + 1 ..], 10);
        } else {
            try positional.append(alloc, a);
        }
    }
    if (opts.width < 16 or opts.height < 16 or opts.width > bootmap.treemap.max_side or opts.height > bootmap.treemap.max_side)
        return fail(out, "bootmap: the size must be 16 to 8192 on each side\n");

    const bytes = try std.Io.Dir.cwd().readFileAlloc(io, trace_path, alloc, .limited(64 << 20));
    const parsed = try bootmap.trace.parse(alloc, bytes);
    var plan = try bootmap.plan.fromTrace(alloc, parsed.value);
    try plan.layout(.{ .w = opts.width, .h = opts.height });

    if (std.mem.eql(u8, cmd, "plan")) {
        try plan.writeText(out, opts.width, opts.height);
    } else if (std.mem.eql(u8, cmd, "rects")) {
        try plan.writeRects(out);
    } else if (std.mem.eql(u8, cmd, "stats")) {
        try stats(out, &plan);
    } else if (std.mem.eql(u8, cmd, "snapshot")) {
        if (positional.items.len != 1) return fail(out, usage);
        const px = try alloc.alloc(u32, @intCast(opts.width * opts.height));
        const c: bootmap.canvas.Canvas = .{ .pixels = px, .width = opts.width, .height = opts.height, .stride = opts.width };
        c.clear(bootmap.palette.surface);
        const t = plan.end_us * @min(opts.at_pct, 100) / 100;
        bootmap.canvas.drawPlan(c, &plan, t);
        const file = try std.Io.Dir.cwd().createFile(io, positional.items[0], .{});
        defer file.close(io);
        var fbuf: [64 * 1024]u8 = undefined;
        var fw = file.writer(io, &fbuf);
        try bootmap.png.write(&fw.interface, px, @intCast(opts.width), @intCast(opts.height), @intCast(opts.width));
        try fw.interface.flush();
        try out.print("bootmap: wrote {s} at t={d} us ({d} %)\n", .{ positional.items[0], t, opts.at_pct });
    } else {
        return fail(out, usage);
    }
}

fn stats(out: *std.Io.Writer, plan: *const bootmap.plan.Plan) !void {
    try out.print("boot: {d} ms, {d} leaves\n", .{ plan.end_us / 1000, plan.leafCount() });
    for (plan.nodes) |nd| {
        if (nd.depth == 0 or nd.depth == 3) continue;
        var leaves: usize = 0;
        var span_end: u64 = 0;
        countLeaves(plan, nd, &leaves, &span_end);
        const indent: []const u8 = if (nd.depth == 1) "" else "  ";
        try out.print("{s}{s}: {d} boxes, weight {d}, {d}..{d} ms\n", .{
            indent, nd.name, leaves, nd.weight, nd.first_us / 1000, span_end / 1000,
        });
    }
}

fn countLeaves(plan: *const bootmap.plan.Plan, nd: bootmap.plan.Node, n: *usize, end: *u64) void {
    if (nd.depth == 3) {
        n.* += 1;
        end.* = @max(end.*, nd.end_us);
        return;
    }
    for (nd.children) |c| countLeaves(plan, plan.nodes[c], n, end);
}

fn fail(out: *std.Io.Writer, msg: []const u8) !void {
    try out.writeAll(msg);
    try out.flush();
    std.process.exit(2);
}
