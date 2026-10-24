// Where: apps/action/game/src/floorplan.zig (zig build floorplan)
// When: while you build or change a map.
// Why: draws slices of a map, so you can see what is where, and audits the
// map: for decoration that a player can walk through, for lights inside a
// shadow caster, for surface materials that do not fit their look, for lift
// shafts and landings that catch a player, and for escape holes
// (escape.zig).
//
//   zig build floorplan -- <map> plan <y> <out.ppm>        top view, a slice at height y
//   zig build floorplan -- <map> section-z <z> <out.ppm>   side view (x, y), a slice at z
//   zig build floorplan -- <map> section-x <x> <out.ppm>   end view (z, y), a slice at x
//   zig build floorplan -- <map> audit                     reachable decoration without collision,
//                                                           lights inside a shadow caster, the
//                                                           surface materials, and the lift shafts
//                                                           and landings: exit code 1 if a
//                                                           material does not fit its look, or a
//                                                           lift shaft or landing is not clear
//   zig build floorplan -- <map> escape                    escape holes and trapped spawn points,
//                                                           exit code 1 if it finds one
//
// Every command stops with exit code 1 when the map has more boxes than
// map.max_boxes.
//
// <map> is arena or earls_court. The image is a binary PPM; on macOS,
// `sips -s format png in.ppm --out out.png` converts it.
//
// Colours: solid boxes grey (lighter = higher top), non-solid boxes pale,
// dynamic boxes (lifts, the train) blue, decoration red outline, escalators
// purple, buttons orange, lights yellow, spawns green. A grid line every
// 10 m, a darker one every 50 m.
const std = @import("std");
const map = @import("map.zig");
const escape = @import("escape.zig");
const player = @import("player.zig");
const vec = @import("vec.zig");
const V3 = vec.V3;
const v3 = vec.v3;

const px_per_m: f32 = 4;
const max_extent: f32 = 140;

const Canvas = struct {
    w: usize,
    h: usize,
    px: []u8,
    // World rectangle shown: u (horizontal) and v (vertical, up on screen).
    ua: f32,
    v0: f32,

    fn init(alloc: std.mem.Allocator, ua: f32, ub: f32, v0: f32, v1: f32) !Canvas {
        const w: usize = @intFromFloat(@ceil((ub - ua) * px_per_m));
        const h: usize = @intFromFloat(@ceil((v1 - v0) * px_per_m));
        const px = try alloc.alloc(u8, w * h * 3);
        @memset(px, 18);
        return .{ .w = w, .h = h, .px = px, .ua = ua, .v0 = v0 };
    }

    fn set(c: *Canvas, x: i64, y: i64, rgb: [3]u8) void {
        if (x < 0 or y < 0 or x >= c.w or y >= c.h) return;
        const i = (@as(usize, @intCast(y)) * c.w + @as(usize, @intCast(x))) * 3;
        c.px[i] = rgb[0];
        c.px[i + 1] = rgb[1];
        c.px[i + 2] = rgb[2];
    }

    fn toPx(c: *const Canvas, u: f32, v: f32) [2]i64 {
        const x: i64 = @intFromFloat(@floor((u - c.ua) * px_per_m));
        const y: i64 = @intFromFloat(@floor(@as(f32, @floatFromInt(c.h)) - (v - c.v0) * px_per_m));
        return .{ x, y };
    }

    fn fill(c: *Canvas, ua: f32, v0: f32, ub: f32, v1: f32, rgb: [3]u8) void {
        const a = c.toPx(ua, v1);
        const b = c.toPx(ub, v0);
        var y = a[1];
        while (y <= b[1]) : (y += 1) {
            var x = a[0];
            while (x <= b[0]) : (x += 1) c.set(x, y, rgb);
        }
    }

    fn outline(c: *Canvas, ua: f32, v0: f32, ub: f32, v1: f32, rgb: [3]u8) void {
        const a = c.toPx(ua, v1);
        const b = c.toPx(ub, v0);
        var x = a[0];
        while (x <= b[0]) : (x += 1) {
            c.set(x, a[1], rgb);
            c.set(x, b[1], rgb);
        }
        var y = a[1];
        while (y <= b[1]) : (y += 1) {
            c.set(a[0], y, rgb);
            c.set(b[0], y, rgb);
        }
    }

    fn dot(c: *Canvas, u: f32, v: f32, r: i64, rgb: [3]u8) void {
        const p = c.toPx(u, v);
        var dy: i64 = -r;
        while (dy <= r) : (dy += 1) {
            var dx: i64 = -r;
            while (dx <= r) : (dx += 1) if (dx * dx + dy * dy <= r * r) c.set(p[0] + dx, p[1] + dy, rgb);
        }
    }

    fn grid(c: *Canvas, ub: f32, v1: f32) void {
        var u = @ceil(c.ua / 10) * 10;
        while (u <= ub) : (u += 10) {
            const p = c.toPx(u, c.v0);
            const shade: u8 = if (@mod(u, 50) == 0) 70 else 38;
            var y: i64 = 0;
            while (y < c.h) : (y += 1) c.set(p[0], y, .{ shade, shade, shade + 10 });
        }
        var v = @ceil(c.v0 / 10) * 10;
        while (v <= v1) : (v += 10) {
            const p = c.toPx(c.ua, v);
            const shade: u8 = if (@mod(v, 50) == 0) 70 else 38;
            var x: i64 = 0;
            while (x < c.w) : (x += 1) c.set(x, p[1], .{ shade, shade, shade + 10 });
        }
    }

    fn write(c: *const Canvas, io: std.Io, path: []const u8) !void {
        const file = try std.Io.Dir.cwd().createFile(io, path, .{});
        defer file.close(io);
        var hdr_buf: [64]u8 = undefined;
        const hdr = try std.fmt.bufPrint(&hdr_buf, "P6\n{d} {d}\n255\n", .{ c.w, c.h });
        try file.writeStreamingAll(io, hdr);
        try file.writeStreamingAll(io, c.px);
    }
};

const Axis = enum { plan, section_z, section_x };

/// Draw one slice. For a plan: u = x, v = -z (north up), cut at y.
/// For section-z: u = x, v = y, cut at z. For section-x: u = z, v = y, cut at x.
fn slice(alloc: std.mem.Allocator, io: std.Io, axis: Axis, at: f32, path: []const u8) !void {
    // The bounds of the solid geometry, clamped to the area of interest.
    var mn = v3(1e9, 1e9, 1e9);
    var mx = v3(-1e9, -1e9, -1e9);
    for (map.boxes[0..map.box_count]) |b| {
        if (b.dynamic) continue;
        mn = @min(mn, b.min);
        mx = @max(mx, b.max);
    }
    mn = @max(mn, vec.s(-max_extent));
    mx = @min(mx, vec.s(max_extent));
    const pad: f32 = 4;
    var c = switch (axis) {
        .plan => try Canvas.init(alloc, mn[0] - pad, mx[0] + pad, -mx[2] - pad, -mn[2] + pad),
        .section_z => try Canvas.init(alloc, mn[0] - pad, mx[0] + pad, mn[1] - pad, mx[1] + pad),
        .section_x => try Canvas.init(alloc, mn[2] - pad, mx[2] + pad, mn[1] - pad, mx[1] + pad),
    };
    const ub = c.ua + @as(f32, @floatFromInt(c.w)) / px_per_m;
    const v1 = c.v0 + @as(f32, @floatFromInt(c.h)) / px_per_m;
    c.grid(ub, v1);

    const Rect = struct { ua: f32, v0: f32, ub: f32, v1: f32 };
    const cut = struct {
        fn f(ax: Axis, a: f32, lo: V3, hi: V3) ?Rect {
            switch (ax) {
                .plan => {
                    if (a < lo[1] or a >= hi[1]) return null;
                    return .{ .ua = lo[0], .v0 = -hi[2], .ub = hi[0], .v1 = -lo[2] };
                },
                .section_z => {
                    if (a < lo[2] or a >= hi[2]) return null;
                    return .{ .ua = lo[0], .v0 = lo[1], .ub = hi[0], .v1 = hi[1] };
                },
                .section_x => {
                    if (a < lo[0] or a >= hi[0]) return null;
                    return .{ .ua = lo[2], .v0 = lo[1], .ub = hi[2], .v1 = hi[1] };
                },
            }
        }
    }.f;

    // Boxes, lowest first.
    for (map.boxes[0..map.box_count]) |b| {
        const r = cut(axis, at, b.min, b.max) orelse continue;
        const t = std.math.clamp((b.max[1] + 20) / 40, 0, 1);
        const g: u8 = @intFromFloat(70 + 120 * t);
        const rgb: [3]u8 = if (b.dynamic) .{ 60, 110, 220 } else if (!b.solid) .{ 200, 200, 170 } else .{ g, g, g };
        c.fill(r.ua, r.v0, r.ub, r.v1, rgb);
        c.outline(r.ua, r.v0, r.ub, r.v1, .{ 25, 25, 25 });
    }
    for (map.decor.items) |d| {
        const bb = map.decorBounds(d);
        const r = cut(axis, at, bb[0], bb[1]) orelse continue;
        c.outline(r.ua, r.v0, r.ub, r.v1, .{ 220, 60, 50 });
    }
    for (map.escalators[0..map.escalator_count]) |e| {
        const r = cut(axis, at, e.min, e.max) orelse continue;
        c.outline(r.ua, r.v0, r.ub, r.v1, .{ 190, 90, 230 });
    }
    for (map.buttons[0..map.button_count]) |*b| {
        const bb = map.buttonBounds(b);
        const p = (bb[0] + bb[1]) * vec.s(0.5);
        switch (axis) {
            .plan => c.dot(p[0], -p[2], 2, .{ 255, 150, 30 }),
            .section_z => c.dot(p[0], p[1], 2, .{ 255, 150, 30 }),
            .section_x => c.dot(p[2], p[1], 2, .{ 255, 150, 30 }),
        }
    }
    for (map.lights[0..map.light_count]) |l| {
        switch (axis) {
            .plan => c.dot(l.pos[0], -l.pos[2], 3, .{ 250, 230, 60 }),
            .section_z => c.dot(l.pos[0], l.pos[1], 3, .{ 250, 230, 60 }),
            .section_x => c.dot(l.pos[2], l.pos[1], 3, .{ 250, 230, 60 }),
        }
    }
    for (map.spawns[0..map.spawn_count]) |s| {
        switch (axis) {
            .plan => c.dot(s.pos[0], -s.pos[2], 3, .{ 60, 230, 90 }),
            .section_z => c.dot(s.pos[0], s.pos[1], 3, .{ 60, 230, 90 }),
            .section_x => c.dot(s.pos[2], s.pos[1], 3, .{ 60, 230, 90 }),
        }
    }
    try c.write(io, path);
}

/// True when thin decoration lies on a solid face (a poster, a band of
/// tiles, a roundel on a wall): a solid box touches its thin side and spans
/// it.
fn flush(bb: [2]V3) bool {
    const size = bb[1] - bb[0];
    inline for (0..3) |ax| {
        if (size[ax] < 0.15) {
            var lo = bb[0];
            var hi = bb[1];
            lo[ax] -= 0.12;
            hi[ax] += 0.12;
            for (map.boxes[0..map.box_count]) |b| {
                if (!b.solid) continue;
                var spans = true;
                inline for (0..3) |o| {
                    if (o != ax and (b.min[o] > bb[0][o] + 0.01 or b.max[o] < bb[1][o] - 0.01)) spans = false;
                }
                if (spans and b.min[ax] < hi[ax] and b.max[ax] > lo[ax]) return true;
            }
        }
    }
    return false;
}

/// List decoration that a standing player could walk into: it overlaps the
/// body space (0.3 m to 1.9 m) over a solid floor, and no solid box covers
/// it.
fn audit() usize {
    var count: usize = 0;
    for (map.decor.items, 0..) |d, di| {
        const bb = map.decorBounds(d);
        if (flush(bb)) continue;
        var hit = false;
        for (map.boxes[0..map.box_count]) |f| {
            if (!f.solid or f.dynamic) continue;
            // A floor is a top a player can stand on: at least 0.5 m each way.
            if (f.max[0] - f.min[0] < 0.5 or f.max[2] - f.min[2] < 0.5) continue;
            // Roofs are out of reach: the highest walkable floor is the street, 4.8 m.
            if (f.max[1] > 6.0) continue;
            const top = f.max[1];
            // The decoration must be over this floor, in the body space.
            if (bb[1][0] <= f.min[0] or bb[0][0] >= f.max[0] or bb[1][2] <= f.min[2] or bb[0][2] >= f.max[2]) continue;
            if (bb[1][1] <= top + 0.3 or bb[0][1] >= top + 1.9) continue;
            // Free head room over the floor where the decoration is: the
            // player can stand there.
            const cx = std.math.clamp((bb[0][0] + bb[1][0]) / 2, f.min[0], f.max[0]);
            const cz = std.math.clamp((bb[0][2] + bb[1][2]) / 2, f.min[2], f.max[2]);
            if (map.overlaps(v3(cx - 0.05, top + 0.05, cz - 0.05), v3(cx + 0.05, top + 1.8, cz + 0.05))) continue;
            hit = true;
            break;
        }
        if (hit) {
            count += 1;
            std.debug.print("decor {d}: ({d:.1} {d:.1} {d:.1}) .. ({d:.1} {d:.1} {d:.1}) mat {s}\n", .{
                di, bb[0][0], bb[0][1], bb[0][2], bb[1][0], bb[1][1], bb[1][2], @tagName(d.mat),
            });
        }
    }
    std.debug.print("{d} reachable decoration elements without collision\n", .{count});
    return count;
}

/// List map lights inside a shadow caster: a visible static box or a
/// decoration, not emissive (render.zig drawLightShadows). Such a light is
/// in its own shadow and lights nothing.
fn auditLights() usize {
    var count: usize = 0;
    for (map.lights[0..map.light_count], 0..) |l, li| {
        const p = l.pos;
        var inside: ?[]const u8 = null;
        for (map.boxes[0..map.box_count]) |b| {
            if (!b.visible or b.dynamic or b.mat == .emissive) continue;
            if (@reduce(.And, p > b.min) and @reduce(.And, p < b.max)) inside = "box";
        }
        for (map.decor.items) |d| {
            if (d.mat != .emissive and map.insideDecor(d, p, 0)) inside = "decoration";
        }
        if (inside) |what| {
            count += 1;
            std.debug.print("light {d}: ({d:.1} {d:.1} {d:.1}) is inside a {s}\n", .{ li, p[0], p[1], p[2], what });
        }
    }
    std.debug.print("{d} lights inside a shadow caster\n", .{count});
    return count;
}

/// The surface materials (map.Surface, the impact sound): the boxes and
/// the decoration of each material, and each surface whose material does
/// not fit its look (map.surfaceFits). The compiler finds a box or a
/// decoration with no material: the field has no default.
fn auditSurfaces() usize {
    const n = @typeInfo(map.Surface).@"enum".field_names.len;
    var boxes: [n]usize = @splat(0);
    var decor: [n]usize = @splat(0);
    var bad: usize = 0;
    for (map.boxes[0..map.box_count], 0..) |b, i| {
        boxes[@backingInt(b.surface)] += 1;
        if (!map.surfaceFits(b.mat, b.surface)) {
            bad += 1;
            std.debug.print("box {d}: ({d:.1} {d:.1} {d:.1}) .. ({d:.1} {d:.1} {d:.1}) look {s}, surface {s} does not fit\n", .{
                i, b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2], @tagName(b.mat), @tagName(b.surface),
            });
        }
    }
    for (map.decor.items, 0..) |d, i| {
        decor[@backingInt(d.surface)] += 1;
        if (!map.surfaceFits(d.mat, d.surface)) {
            bad += 1;
            const bb = map.decorBounds(d);
            std.debug.print("decor {d}: ({d:.1} {d:.1} {d:.1}) .. ({d:.1} {d:.1} {d:.1}) look {s}, surface {s} does not fit\n", .{
                i, bb[0][0], bb[0][1], bb[0][2], bb[1][0], bb[1][1], bb[1][2], @tagName(d.mat), @tagName(d.surface),
            });
        }
    }
    std.debug.print("surface      boxes  decoration\n", .{});
    for (std.enums.values(map.Surface)) |s| {
        const k = @backingInt(s);
        std.debug.print("{s:<12} {d:>5}  {d:>10}\n", .{ @tagName(s), boxes[k], decor[k] });
    }
    std.debug.print("{d} surfaces with a material that does not fit the look\n", .{bad});
    return bad;
}

/// The lift shafts and the landings (map.zig Lift). Returns the number of
/// faults.
/// - The shaft is the space that the inside of the cab sweeps over its full
///   travel. In plan it is the cab floor. In height it goes from the lowest
///   cab floor to the highest cab floor, plus the cab height or the player
///   height (the larger). No static solid box and no ramp may be in it. A
///   slab across a shaft catches a rider on the way down: the step up
///   (player.zig) puts the feet on the slab, and the cab goes on without
///   the player.
/// - At each landing, the cab is at the level and the doors are open. A
///   player stands at points across the doorway, from the middle of the cab
///   to 1 m past the doors. Each point must have a floor at the level (the
///   landing, or the cab floor 2 cm above it), and the body must fit.
fn auditLifts() usize {
    var bad: usize = 0;
    const r = player.radius;
    for (map.lifts[0..map.lift_count], 0..) |*l, li| {
        const fb = map.boxes[l.floor_box];
        const cb = map.boxes[l.ceil_box];
        const lo = @min(l.levels[0], l.levels[1]);
        const hi = @max(l.levels[0], l.levels[1]) + @max(map.cab_height + (cb.max[1] - cb.min[1]), player.height);
        const smin = v3(fb.min[0], lo, fb.min[2]);
        const smax = v3(fb.max[0], hi, fb.max[2]);
        var in_shaft: usize = 0;
        for (map.boxes[0..map.box_count], 0..) |b, bi| {
            if (!b.solid or b.dynamic) continue;
            if (@reduce(.Or, b.max <= smin) or @reduce(.Or, b.min >= smax)) continue;
            in_shaft += 1;
            std.debug.print("lift {d}: box {d} ({d:.2} {d:.2} {d:.2}) .. ({d:.2} {d:.2} {d:.2}) is in the shaft\n", .{
                li, bi, b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2],
            });
        }
        for (map.ramps[0..map.ramp_count], 0..) |rp, ri| {
            if (rp.x1 <= smin[0] or rp.x0 >= smax[0] or rp.z1 <= smin[2] or rp.z0 >= smax[2]) continue;
            if (@max(rp.y0, rp.y1) <= smin[1] or rp.bottom >= smax[1]) continue;
            in_shaft += 1;
            std.debug.print("lift {d}: ramp {d} is in the shaft\n", .{ li, ri });
        }

        // The landings: the doors are on one face of the cab (door_on_x: an
        // X face, so they slide along Z). The cab is on one side of them.
        const a: usize = if (l.door_on_x) 2 else 0;
        const b: usize = if (l.door_on_x) 0 else 2;
        var gaps: usize = 0;
        for (0..2) |lv| {
            map.syncLift(li, l.levels[lv], 1, lv, @backingInt(map.Phase.open));
            // Arrays: a vector takes no index that is known only at run time.
            const d0_min: [3]f32 = l.door_closed[lv][0][0];
            const d0_max: [3]f32 = l.door_closed[lv][0][1];
            const d1_max: [3]f32 = l.door_closed[lv][1][1];
            const f_min: [3]f32 = fb.min;
            const f_max: [3]f32 = fb.max;
            const mid_a = (d0_min[a] + d1_max[a]) / 2;
            const face_b = (d0_min[b] + d0_max[b]) / 2;
            const cab_b = (f_min[b] + f_max[b]) / 2;
            const out: f32 = if (cab_b > face_b) -1 else 1;
            for ([_]f32{ -0.4, -0.2, 0, 0.2, 0.4 }) |da| {
                var t: f32 = 0;
                const end = @abs(face_b - cab_b) + 1.0;
                while (t <= end) : (t += 0.05) {
                    var pa = [3]f32{ 0, l.levels[lv], 0 };
                    pa[a] = mid_a + da;
                    pa[b] = cab_b + out * t;
                    const p: V3 = pa;
                    const top = map.floorTop(p - v3(r, 0.1, r), p + v3(r, 0.1, r));
                    const ok = if (top) |y| y >= l.levels[lv] - 0.05 and y <= l.levels[lv] + 0.005 and
                        !map.overlaps(v3(p[0] - r, y, p[2] - r), v3(p[0] + r, y + player.height, p[2] + r)) else false;
                    if (!ok) {
                        gaps += 1;
                        std.debug.print("lift {d} level {d}: no floor, or no room, at ({d:.2} {d:.2} {d:.2})\n", .{ li, lv, p[0], p[1], p[2] });
                        break;
                    }
                }
            }
        }
        std.debug.print("lift {d}: {d} shapes in the shaft ({d:.2} .. {d:.2}), {d} bad lines across the landings\n", .{ li, in_shaft, lo, hi, gaps });
        bad += in_shaft + gaps;
    }
    return bad;
}

pub fn main(init: std.process.Init) !void {
    const alloc = init.arena.allocator();
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len < 3) {
        std.debug.print("usage: floorplan <arena|earls_court> <plan|section-z|section-x> <at> <out.ppm>\n       floorplan <map> audit\n       floorplan <map> escape\n", .{});
        return;
    }
    map.init(alloc);
    const id = std.meta.stringToEnum(map.Id, args[1]) orelse return error.UnknownMap;
    map.load(id);
    std.debug.print("{s}: {d} of {d} boxes, {d} decoration, {d} lights, {d} lifts\n", .{ args[1], map.box_count, map.max_boxes, map.decor.items.len, map.light_count, map.lift_count });
    // A map with more boxes than map.max_boxes is not the map that the
    // maps/ file describes: every command stops.
    if (map.dropped > 0) {
        std.debug.print("error: {d} boxes more than max_boxes ({d}). They are not in the map\n", .{ map.dropped, map.max_boxes });
        std.process.exit(1);
    }
    if (std.mem.eql(u8, args[2], "audit")) {
        _ = audit();
        _ = auditLights();
        const surfaces = auditSurfaces();
        // Last: it moves the lifts to each level.
        const lifts = auditLifts();
        if (surfaces > 0 or lifts > 0) std.process.exit(1);
        return;
    }
    if (std.mem.eql(u8, args[2], "escape")) {
        if (try escape.run(std.heap.page_allocator) > 0) std.process.exit(1);
        return;
    }
    if (args.len < 5) return error.MissingArguments;
    const axis: Axis = if (std.mem.eql(u8, args[2], "plan")) .plan else if (std.mem.eql(u8, args[2], "section-z")) .section_z else .section_x;
    const at = try std.fmt.parseFloat(f32, args[3]);
    try slice(alloc, init.io, axis, at, args[4]);
}
