//! The preview tool, a native program: `zig build preview -- <command>`.
//! It runs the game with no window, and prints it or draws it.
//!
//!   ascii [key=value ...]          print the map in letters
//!   trace [key=value ...]          print the units every 10 s
//!   frame <out.ppm> [key=value ...] draw one frame (1280 x 1000) to an image.
//!                                  The CPU painter draws no text.
//!
//! The keys:
//!   style=supply_line|drone_war|blitz|fog|manoeuvre|frontier
//!   seed=N   t=SECONDS   plan=hold|push   mode=view|logistics|kill|intel
//!   at=X,Y,PX   (the map point at the centre, and the pixels a square)
//!   height=1    (the heightmap)   sight=X,Y   (the sightlines from a square)
const std = @import("std");
const map = @import("../core/map.zig");
const sim = @import("../core/sim.zig");
const rules = @import("../core/rules.zig");
const terrain = @import("../render/terrain.zig");
const minimap = @import("../render/minimap.zig");
const view = @import("../render/view.zig");
const style = @import("../style.zig");
const wm_mod = @import("../ui/wm.zig");
const scenario = @import("scenario.zig");

const W = 1280;
const H = 1000;

/// A painter that draws into an RGB buffer. It does not draw text.
const CpuPainter = struct {
    px: []u8,
    mini: *const [minimap.bytes]u8,

    fn blend(p: *CpuPainter, x: i32, y: i32, c: style.Color) void {
        if (x < 0 or y < 0 or x >= W or y >= H) return;
        const i: usize = (@as(usize, @intCast(y)) * W + @as(usize, @intCast(x))) * 3;
        const rgb = [3]f32{ c.r, c.g, c.b };
        for (0..3) |k| {
            const old = @as(f32, @floatFromInt(p.px[i + k])) / 255;
            p.px[i + k] = @intFromFloat(std.math.clamp(old + (rgb[k] - old) * c.a, 0, 1) * 255);
        }
    }

    pub fn fill(p: *CpuPainter, x: f32, y: f32, w: f32, h: f32, c: style.Color) !void {
        const x0: i32 = @intFromFloat(@round(std.math.clamp(x, -1, W + 1)));
        const x1: i32 = @intFromFloat(@round(std.math.clamp(x + w, -1, W + 1)));
        const y0: i32 = @intFromFloat(@round(std.math.clamp(y, -1, H + 1)));
        const y1: i32 = @intFromFloat(@round(std.math.clamp(y + h, -1, H + 1)));
        var yy = y0;
        while (yy < @max(y1, y0 + 1)) : (yy += 1) {
            var xx = x0;
            while (xx < @max(x1, x0 + 1)) : (xx += 1) p.blend(xx, yy, c);
        }
    }

    pub fn stroke(p: *CpuPainter, x: f32, y: f32, w: f32, h: f32, lw: f32, c: style.Color) !void {
        try p.fill(x, y, w, lw, c);
        try p.fill(x, y + h - lw, w, lw, c);
        try p.fill(x, y + lw, lw, h - 2 * lw, c);
        try p.fill(x + w - lw, y + lw, lw, h - 2 * lw, c);
    }

    pub fn line(p: *CpuPainter, ax: f32, ay: f32, bx: f32, by: f32, w: f32, c: style.Color) !void {
        const half = w / 2 + 0.5;
        if (@max(ax, bx) + half < 0 or @min(ax, bx) - half > W or @max(ay, by) + half < 0 or @min(ay, by) - half > H) return;
        const x0: i32 = @intFromFloat(@floor(std.math.clamp(@min(ax, bx) - half, 0, W)));
        const x1: i32 = @intFromFloat(@ceil(std.math.clamp(@max(ax, bx) + half, 0, W)));
        const y0: i32 = @intFromFloat(@floor(std.math.clamp(@min(ay, by) - half, 0, H)));
        const y1: i32 = @intFromFloat(@ceil(std.math.clamp(@max(ay, by) + half, 0, H)));
        const dx = bx - ax;
        const dy = by - ay;
        const l2 = @max(dx * dx + dy * dy, 0.0001);
        var y = y0;
        while (y <= y1) : (y += 1) {
            var x = x0;
            while (x <= x1) : (x += 1) {
                const fx = @as(f32, @floatFromInt(x)) + 0.5;
                const fy = @as(f32, @floatFromInt(y)) + 0.5;
                const t = std.math.clamp(((fx - ax) * dx + (fy - ay) * dy) / l2, 0, 1);
                const ex = ax + t * dx - fx;
                const ey = ay + t * dy - fy;
                const d = @sqrt(ex * ex + ey * ey);
                if (d >= half) continue;
                p.blend(x, y, c.alpha(std.math.clamp(half - d, 0, 1)));
            }
        }
    }

    pub fn tri(p: *CpuPainter, ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32, c: style.Color) !void {
        const x0: i32 = @intFromFloat(@floor(std.math.clamp(@min(ax, @min(bx, cx)), 0, W)));
        const x1: i32 = @intFromFloat(@ceil(std.math.clamp(@max(ax, @max(bx, cx)), 0, W)));
        const y0: i32 = @intFromFloat(@floor(std.math.clamp(@min(ay, @min(by, cy)), 0, H)));
        const y1: i32 = @intFromFloat(@ceil(std.math.clamp(@max(ay, @max(by, cy)), 0, H)));
        const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (@abs(area) < 0.001) return;
        var y = y0;
        while (y <= y1) : (y += 1) {
            var x = x0;
            while (x <= x1) : (x += 1) {
                const fx = @as(f32, @floatFromInt(x)) + 0.5;
                const fy = @as(f32, @floatFromInt(y)) + 0.5;
                const w0 = ((bx - fx) * (cy - fy) - (by - fy) * (cx - fx)) / area;
                const w1 = ((cx - fx) * (ay - fy) - (cy - fy) * (ax - fx)) / area;
                const w2 = 1 - w0 - w1;
                if (w0 >= 0 and w1 >= 0 and w2 >= 0) p.blend(x, y, c);
            }
        }
    }

    pub fn hatch(p: *CpuPainter, x: f32, y: f32, w: f32, h: f32, c: style.Color) !void {
        var yy: i32 = @intFromFloat(@round(std.math.clamp(y, 0, H)));
        while (yy < @as(i32, @intFromFloat(@round(std.math.clamp(y + h, 0, H))))) : (yy += 1) {
            var xx: i32 = @intFromFloat(@round(std.math.clamp(x, 0, W)));
            while (xx < @as(i32, @intFromFloat(@round(std.math.clamp(x + w, 0, W))))) : (xx += 1) {
                if (@mod(xx + yy, 6) < 1) p.blend(xx, yy, c);
            }
        }
    }

    pub fn image(p: *CpuPainter, x: f32, y: f32, w: f32, h: f32) !void {
        var yy: i32 = @intFromFloat(@max(0, y));
        while (yy < @as(i32, @intFromFloat(@min(H, y + h)))) : (yy += 1) {
            var xx: i32 = @intFromFloat(@max(0, x));
            while (xx < @as(i32, @intFromFloat(@min(W, x + w)))) : (xx += 1) {
                const u: usize = @intFromFloat(std.math.clamp((@as(f32, @floatFromInt(xx)) - x) / w * map.size, 0, map.size - 1));
                const v: usize = @intFromFloat(std.math.clamp((@as(f32, @floatFromInt(yy)) - y) / h * map.size, 0, map.size - 1));
                const i = (v * map.size + u) * 4;
                p.blend(xx, yy, style.Color.rgb(p.mini[i], p.mini[i + 1], p.mini[i + 2], 1));
            }
        }
    }

    pub fn text(p: *CpuPainter, s: []const u8, x: f32, y: f32, size: f32, c: style.Color) !void {
        _ = .{ p, s, x, y, size, c };
    }

    pub fn measure(p: *CpuPainter, s: []const u8, size: f32) f32 {
        _ = p;
        return @as(f32, @floatFromInt(s.len)) * size * 0.5;
    }
};

const Args = struct {
    style: rules.Style = .supply_line,
    seed: u32 = 1,
    t: u32 = 0,
    plan: scenario.Plan = .hold,
    mode: view.Mode = .view,
    at: ?[3]f32 = null,
    height: bool = false,
    sight: ?[2]i32 = null,
};

fn parse(args: []const []const u8) !Args {
    var a: Args = .{};
    for (args) |arg| {
        const eq = std.mem.indexOfScalar(u8, arg, '=') orelse continue;
        const k = arg[0..eq];
        const v = arg[eq + 1 ..];
        if (std.mem.eql(u8, k, "style")) a.style = std.meta.stringToEnum(rules.Style, v) orelse return error.BadStyle;
        if (std.mem.eql(u8, k, "seed")) a.seed = try std.fmt.parseInt(u32, v, 10);
        if (std.mem.eql(u8, k, "t")) a.t = try std.fmt.parseInt(u32, v, 10);
        if (std.mem.eql(u8, k, "plan")) a.plan = std.meta.stringToEnum(scenario.Plan, v) orelse return error.BadPlan;
        if (std.mem.eql(u8, k, "mode")) a.mode = std.meta.stringToEnum(view.Mode, v) orelse return error.BadMode;
        if (std.mem.eql(u8, k, "height")) a.height = true;
        if (std.mem.eql(u8, k, "at")) {
            var it = std.mem.splitScalar(u8, v, ',');
            var xyz: [3]f32 = .{ 64, 64, 8 };
            for (&xyz) |*q| q.* = try std.fmt.parseFloat(f32, it.next() orelse break);
            a.at = xyz;
        }
        if (std.mem.eql(u8, k, "sight")) {
            var it = std.mem.splitScalar(u8, v, ',');
            a.sight = .{ try std.fmt.parseInt(i32, it.next() orelse "0", 10), try std.fmt.parseInt(i32, it.next() orelse "0", 10) };
        }
    }
    return a;
}

pub fn main(init: std.process.Init) !void {
    const alloc = init.arena.allocator();
    const io = init.io;
    const argv = try init.minimal.args.toSlice(alloc);
    if (argv.len < 2) {
        std.debug.print("usage: preview ascii|trace [key=value...] | frame <out.ppm> [key=value...]\n", .{});
        return;
    }
    const cmd = argv[1];
    const a = try parse(argv[2..]);
    const s = try alloc.create(sim.Sim);
    s.init(a.seed, a.style);

    if (std.mem.eql(u8, cmd, "ascii")) return printAscii(s);
    if (std.mem.eql(u8, cmd, "trace")) {
        var t: u32 = 0;
        while (t < @max(a.t, 10)) : (t += 10) {
            scenario.run(s, a.plan, 10);
            trace(s);
        }
        return;
    }
    if (!std.mem.eql(u8, cmd, "frame") or argv.len < 3) return error.BadArguments;
    scenario.run(s, a.plan, a.t);
    std.debug.print("{s} t={d}s: trucks lost {d}, supply delivered {d:.0}, shells {d}, outcome {s}\n", .{ s.rules.name, a.t, s.stats.trucks_lost, s.stats.supply_delivered, s.stats.shells, @tagName(s.outcome) });

    var shapes = try terrain.build(alloc, &s.m);
    var ways: terrain.Ways = .{};
    try ways.update(alloc, &s.m);
    const mini = try alloc.create([minimap.bytes]u8);
    minimap.build(&s.m, mini);
    _ = &shapes;
    const px = try alloc.alloc(u8, W * H * 3);
    @memset(px, 0);
    var painter: CpuPainter = .{ .px = px, .mini = mini };
    var cam = view.Camera.fit(W, H);
    if (a.at) |at| cam = view.Camera.at(at[0], at[1], at[2], W, H);
    var wm = wm_mod.Wm.init();
    wm.area = .{ .x = 0, .y = view.top_bar, .w = W, .h = H - view.top_bar - view.bottom_bar };
    const sight = try alloc.create([map.cells]bool);
    sight.* = @splat(false);
    var ui: view.Ui = .{ .mode = a.mode, .heightmap = a.height };
    if (a.sight) |sp| {
        s.m.viewshed(@as(f32, @floatFromInt(sp[0])) + 0.5, @as(f32, @floatFromInt(sp[1])) + 0.5, 2, view.sight_range, sight);
        ui.sight = map.idx(sp[0], sp[1]);
    }
    try view.draw(&painter, .{ .s = s, .shapes = &shapes, .ways = &ways, .cam = cam, .ui = ui, .wm = &wm, .w = W, .h = H, .sight = sight });

    const file = try std.Io.Dir.cwd().createFile(io, argv[2], .{});
    defer file.close(io);
    var hdr_buf: [64]u8 = undefined;
    try file.writeStreamingAll(io, try std.fmt.bufPrint(&hdr_buf, "P6\n{d} {d}\n255\n", .{ W, H }));
    try file.writeStreamingAll(io, px);
}

fn trace(s: *const sim.Sim) void {
    var blue: u32 = 0;
    var red: u32 = 0;
    var engaged: u32 = 0;
    var blue_str: f32 = 0;
    var red_str: f32 = 0;
    var blue_y: f32 = 0;
    var red_y: f32 = 0;
    for (s.units) |u| {
        if (!u.alive or u.kind != .infantry) continue;
        if (u.engaged) engaged += 1;
        if (u.side == .blue) {
            blue += 1;
            blue_str += u.strength;
            blue_y += u.y;
        } else {
            red += 1;
            red_str += u.strength;
            red_y += u.y;
        }
    }
    var shots: u32 = 0;
    for (s.shots) |sh| if (sh.tick + 10 * sim.tick_hz > s.tick and sh.tick > 0) {
        shots += 1;
    };
    std.debug.print("t={d:>4} blue {d:>2} sq str {d:>5.0} y {d:>5.1} | red {d:>2} sq str {d:>5.0} y {d:>5.1} | engaged {d:>2} shots/10s {d:>3} | supply {d:>4.0} lost {d} deliv {d:>5.0} shells {d} towns {d}/{d} wave {d} {s}\n", .{
        s.tick / sim.tick_hz, blue, blue_str, if (blue > 0) blue_y / @as(f32, @floatFromInt(blue)) else 0, red, red_str, if (red > 0) red_y / @as(f32, @floatFromInt(red)) else 0, engaged, shots, s.supply, s.stats.trucks_lost, s.stats.supply_delivered, s.stats.shells, s.towns_held[0], s.towns_held[1], s.wave, @tagName(s.outcome),
    });
}

fn printAscii(s: *const sim.Sim) void {
    std.debug.print("legend: # road  = track  ~ water  T wood  H town  . grass  x seen by red  B blue  R red  D depot  A objective\n", .{});
    for (0..map.size) |y| {
        var line: [map.size]u8 = undefined;
        for (0..map.size) |x| {
            const c = map.idx(@intCast(x), @intCast(y));
            var ch: u8 = switch (s.m.way[c]) {
                .road => '#',
                .track => '=',
                .none => switch (s.m.ground[c]) {
                    .water => '~',
                    .wood => 'T',
                    .town => 'H',
                    .grass => if (s.seen[c]) 'x' else '.',
                },
            };
            if (s.setup.isObjective(c)) ch = 'A';
            if (c == s.setup.depot) ch = 'D';
            for (s.units) |u| if (u.alive and u.kind == .infantry and u.cell() == c) {
                ch = if (u.side == .blue) 'B' else 'R';
            };
            line[x] = ch;
        }
        std.debug.print("{d:0>3} {s}\n", .{ y, &line });
    }
}
