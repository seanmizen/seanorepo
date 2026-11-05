//! The preview tool, a native program: `zig build preview -- <command>`.
//!   ascii                      print the map: ground, ways and the squares
//!                              that red sees
//!   frame <out.ppm> <seconds> [plan] [mode]
//!                              run the game for <seconds>, then draw one
//!                              frame (1280 x 1000) with the CPU painter.
//!                              plan: none (default) or west (scenario.zig).
//!                              mode: view, logistics, kill or intel.
const std = @import("std");
const map = @import("map.zig");
const sim = @import("sim.zig");
const raster = @import("raster.zig");
const view = @import("view.zig");
const scenario = @import("scenario.zig");

const W = 1280;
const H = 1000;

/// A painter that draws into an RGB buffer. It does not draw text.
const CpuPainter = struct {
    px: []u8,
    terrain_img: []const u8,

    fn blend(p: *CpuPainter, x: i32, y: i32, c: view.Color) void {
        if (x < 0 or y < 0 or x >= W or y >= H) return;
        const i: usize = (@as(usize, @intCast(y)) * W + @as(usize, @intCast(x))) * 3;
        const rgb = [3]f32{ c.r, c.g, c.b };
        for (0..3) |k| {
            const old = @as(f32, @floatFromInt(p.px[i + k])) / 255;
            p.px[i + k] = @intFromFloat(std.math.clamp(old + (rgb[k] - old) * c.a, 0, 1) * 255);
        }
    }

    pub fn fill(p: *CpuPainter, x: f32, y: f32, w: f32, h: f32, c: view.Color) !void {
        var yy: i32 = @intFromFloat(@round(y));
        const y1: i32 = @intFromFloat(@round(y + h));
        const x0: i32 = @intFromFloat(@round(x));
        const x1: i32 = @intFromFloat(@round(x + w));
        while (yy < @max(y1, yy + 1) and yy < H) : (yy += 1) {
            var xx = x0;
            while (xx < @max(x1, x0 + 1)) : (xx += 1) p.blend(xx, yy, c);
            if (y1 <= yy) break;
        }
    }

    pub fn stroke(p: *CpuPainter, x: f32, y: f32, w: f32, h: f32, lw: f32, c: view.Color) !void {
        try p.fill(x, y, w, lw, c);
        try p.fill(x, y + h - lw, w, lw, c);
        try p.fill(x, y + lw, lw, h - 2 * lw, c);
        try p.fill(x + w - lw, y + lw, lw, h - 2 * lw, c);
    }

    pub fn terrain(p: *CpuPainter, x: f32, y: f32, w: f32, h: f32) !void {
        for (0..H) |sy| for (0..W) |sx| {
            const u = (@as(f32, @floatFromInt(sx)) + 0.5 - x) / w;
            const v = (@as(f32, @floatFromInt(sy)) + 0.5 - y) / h;
            if (u < 0 or v < 0 or u >= 1 or v >= 1) continue;
            const tx: usize = @intFromFloat(u * raster.width);
            const ty: usize = @intFromFloat(v * raster.height);
            const ti = (ty * raster.width + tx) * 4;
            const i = (sy * W + sx) * 3;
            @memcpy(p.px[i .. i + 3], p.terrain_img[ti .. ti + 3]);
        };
    }

    pub fn hatch(p: *CpuPainter, x: f32, y: f32, w: f32, h: f32, c: view.Color) !void {
        var yy: i32 = @intFromFloat(@round(y));
        while (yy < @as(i32, @intFromFloat(@round(y + h)))) : (yy += 1) {
            var xx: i32 = @intFromFloat(@round(x));
            while (xx < @as(i32, @intFromFloat(@round(x + w)))) : (xx += 1) {
                if (@mod(xx + yy, 6) < 1) p.blend(xx, yy, c);
            }
        }
    }

    pub fn text(p: *CpuPainter, s: []const u8, x: f32, y: f32, size: f32, c: view.Color) !void {
        _ = p;
        _ = s;
        _ = x;
        _ = y;
        _ = size;
        _ = c;
    }
};

pub fn main(init: std.process.Init) !void {
    const alloc = init.arena.allocator();
    const io = init.io;
    const args = try init.minimal.args.toSlice(alloc);
    if (args.len < 2) {
        std.debug.print("usage: preview ascii | trace <seconds> [plan] | frame <out.ppm> <seconds> [none|west] [view|logistics|kill|intel]\n", .{});
        return;
    }
    const s = try alloc.create(sim.Sim);
    s.init();

    if (std.mem.eql(u8, args[1], "ascii")) {
        printAscii(s);
        return;
    }
    if (std.mem.eql(u8, args[1], "trace") and args.len >= 3) {
        const secs = try std.fmt.parseInt(u32, args[2], 10);
        const pl = std.meta.stringToEnum(scenario.Plan, if (args.len > 3) args[3] else "none") orelse return error.BadPlan;
        var t: u32 = 0;
        while (t < secs) : (t += 10) {
            scenario.run(s, pl, 10);
            trace(s);
        }
        return;
    }
    if (!std.mem.eql(u8, args[1], "frame") or args.len < 4) return error.BadArguments;
    const seconds = try std.fmt.parseInt(u32, args[3], 10);
    const plan = std.meta.stringToEnum(scenario.Plan, if (args.len > 4) args[4] else "none") orelse return error.BadPlan;
    const mode = std.meta.stringToEnum(view.Mode, if (args.len > 5) args[5] else "view") orelse return error.BadMode;
    scenario.run(s, plan, seconds);
    std.debug.print("t={d}s trucks lost {d}, supply delivered {d:.0}, shells {d}, outcome {s}\n", .{ seconds, s.stats.trucks_lost, s.stats.supply_delivered, s.stats.shells, @tagName(s.outcome) });

    const base = try alloc.alloc(u8, raster.bytes);
    const img = try alloc.alloc(u8, raster.bytes);
    raster.base(&s.m, base);
    raster.compose(&s.m, base, img);
    const px = try alloc.alloc(u8, W * H * 3);
    @memset(px, 0);
    var painter: CpuPainter = .{ .px = px, .terrain_img = img };
    const cam = view.Camera.fit(W, H);
    try view.draw(&painter, s, cam, .{ .mode = mode, .hover = null }, W, H);

    const file = try std.Io.Dir.cwd().createFile(io, args[2], .{});
    defer file.close(io);
    var hdr_buf: [64]u8 = undefined;
    try file.writeStreamingAll(io, try std.fmt.bufPrint(&hdr_buf, "P6\n{d} {d}\n255\n", .{ W, H }));
    try file.writeStreamingAll(io, px);
}

fn trace(s: *const sim.Sim) void {
    std.debug.print("t={d} supply {d:.0} mat {d:.0} lost {d} delivered {d:.0} red posture {any} {s}\n", .{ s.tick / sim.tick_hz, s.supply, s.materials, s.stats.trucks_lost, s.stats.supply_delivered, s.posture[1], @tagName(s.outcome) });
    for (s.units, 0..) |u, i| {
        if (!u.alive) continue;
        std.debug.print("  {d:>2} {s:<4} {s:<8} ({d:>5.1},{d:>5.1}) str {d:>3.0} sup {d:>3.0} {s} {s}{s} client {d}\n", .{ i, @tagName(u.side), @tagName(u.kind), u.x, u.y, u.strength, u.supply, @tagName(u.task), if (u.engaged) "ENG " else "", if (s.seen[u.cell()]) "SEEN" else "", u.client });
    }
}

fn printAscii(s: *const sim.Sim) void {
    std.debug.print("legend: # road  = track  ~ water  T wood  H town  . grass   lower case / x: seen by red\n", .{});
    for (0..map.size) |y| {
        var line: [map.size * 2 + 1]u8 = undefined;
        for (0..map.size) |x| {
            const c = map.idx(@intCast(x), @intCast(y));
            var ch: u8 = switch (s.m.way[c]) {
                .road => '#',
                .track => '=',
                .none => switch (s.m.ground[c]) {
                    .water => '~',
                    .wood => 'T',
                    .town => 'H',
                    .grass => '.',
                },
            };
            if (s.seen[c]) ch = switch (ch) {
                '.' => 'x',
                'T' => 't',
                'H' => 'h',
                '#' => '+',
                '=' => '-',
                else => ch,
            };
            line[x * 2] = ch;
            line[x * 2 + 1] = ' ';
        }
        line[map.size * 2] = 0;
        std.debug.print("{d:0>2} {s}  h={d:.0}\n", .{ y, line[0 .. map.size * 2], s.m.cellHeight(map.idx(20, @intCast(y))) });
    }
}
