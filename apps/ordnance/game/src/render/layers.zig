//! The layers of the frame under the windows: the map, the overlays, the
//! units and the effects. view.zig calls them in that order.
//!
//! Sizes: a thing of the ground (a hedge, a road, a dot of a wood) has a
//! size in squares, so it grows and shrinks with the zoom, with a floor of
//! about 1 pixel. A marker (a unit icon, a label) has a size in pixels.
const std = @import("std");
const map = @import("../core/map.zig");
const sim = @import("../core/sim.zig");
const artillery = @import("../core/artillery.zig");
const terrain = @import("terrain.zig");
const icons = @import("icons.zig");
const style = @import("../style.zig");
const view = @import("view.zig");

const Color = style.Color;
const blue = style.blue;
const red = style.red;
const amber = style.amber;
const ink = style.ink;
const Camera = view.Camera;
const Frame = view.Frame;

pub const truck_c = Color.rgb(150, 250, 255, 1);
pub const engineer_c = Color.rgb(190, 255, 220, 1);
const grid = Color.rgb(50, 75, 85, 1);
const contour_c = Color.rgb(40, 112, 120, 0.55);
const index_c = Color.rgb(60, 150, 160, 0.8);
const bank_c = Color.rgb(60, 125, 200, 0.85);
const water_c = Color.rgb(45, 95, 170, 0.9);
const wood_c = Color.rgb(40, 125, 62, 0.95);
const wood_big_c = Color.rgb(70, 160, 85, 1);
const hedge_c = Color.rgb(64, 150, 80, 0.75);
const building_c = Color.rgb(120, 104, 78, 0.9);
const road_c = Color.rgb(240, 150, 50, 1);
const track_c = Color.rgb(205, 135, 56, 1);
const net_c = Color.rgb(150, 200, 210, 0.7);

/// The part of the map on the screen, in squares, with a margin.
pub const Bounds = struct {
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    pub fn of(cam: Camera, w: f32, h: f32) Bounds {
        const a = cam.toMap(0, 0);
        const b = cam.toMap(w, h);
        return .{ .x0 = a[0] - 0.5, .y0 = a[1] - 0.5, .x1 = b[0] + 0.5, .y1 = b[1] + 0.5 };
    }
    pub fn seg(b: Bounds, s: terrain.Seg) bool {
        return @max(s.a[0], s.b[0]) >= b.x0 and @min(s.a[0], s.b[0]) <= b.x1 and @max(s.a[1], s.b[1]) >= b.y0 and @min(s.a[1], s.b[1]) <= b.y1;
    }
    pub fn pt(b: Bounds, x: f32, y: f32) bool {
        return x >= b.x0 and x <= b.x1 and y >= b.y0 and y <= b.y1;
    }
    /// The range of squares on the screen, clamped to the map.
    pub fn cells(b: Bounds) [4]i32 {
        return .{
            @intFromFloat(std.math.clamp(@floor(b.x0), 0, map.size - 1)),
            @intFromFloat(std.math.clamp(@floor(b.y0), 0, map.size - 1)),
            @intFromFloat(std.math.clamp(@floor(b.x1), 0, map.size - 1)),
            @intFromFloat(std.math.clamp(@floor(b.y1), 0, map.size - 1)),
        };
    }
    /// The range of chunks on the screen.
    pub fn chunks(b: Bounds) [4]usize {
        const c = b.cells();
        return .{ @intCast(@divFloor(c[0], terrain.chunk)), @intCast(@divFloor(c[1], terrain.chunk)), @intCast(@divFloor(c[2], terrain.chunk)), @intCast(@divFloor(c[3], terrain.chunk)) };
    }
};

/// A size in squares as pixels, with a floor.
fn px(cam: Camera, squares: f32, floor: f32) f32 {
    return @max(floor, squares * cam.s);
}

fn cellRect(p: anytype, cam: Camera, c: u16, inset: f32, col: Color, filled: bool, lw: f32) !void {
    const x = cam.x(@floatFromInt(map.cellX(c))) + inset;
    const y = cam.y(@floatFromInt(map.cellY(c))) + inset;
    const w = cam.s - 2 * inset;
    if (filled) try p.fill(x, y, w, w, col) else try p.stroke(x, y, w, w, lw, col);
}

fn segLine(p: anytype, cam: Camera, s: terrain.Seg, w: f32, c: Color) !void {
    try p.line(cam.x(s.a[0]), cam.y(s.a[1]), cam.x(s.b[0]), cam.y(s.b[1]), w, c);
}

fn dot(p: anytype, cam: Camera, x: f32, y: f32, size: f32, c: Color) !void {
    try p.fill(cam.x(x) - size / 2, cam.y(y) - size / 2, size, size, c);
}

/// The colour of a height in the heightmap view: low is dark teal, high is
/// amber.
pub fn heightColor(h: f32) Color {
    const t = std.math.clamp((h - 20) / (190 - 20), 0, 1);
    const lo = [3]f32{ 0.05, 0.22, 0.28 };
    const mid = [3]f32{ 0.20, 0.42, 0.30 };
    const hi = [3]f32{ 0.85, 0.55, 0.20 };
    var c: [3]f32 = undefined;
    for (0..3) |i| c[i] = if (t < 0.5) lo[i] + (mid[i] - lo[i]) * t * 2 else mid[i] + (hi[i] - mid[i]) * (t - 0.5) * 2;
    return .{ .r = c[0], .g = c[1], .b = c[2], .a = 0.55 };
}

// ------------------------------------------------------------ the map

pub fn drawMap(p: anytype, f: Frame, b: Bounds) !void {
    const s = f.s;
    const cam = f.cam;
    const sh = f.shapes;
    const r = b.cells();
    if (f.ui.heightmap) {
        var y = r[1];
        while (y <= r[3]) : (y += 1) {
            var x = r[0];
            while (x <= r[2]) : (x += 1) {
                const c = map.idx(x, y);
                try cellRect(p, cam, c, 0, heightColor(s.m.cellHeight(c)), true, 0);
            }
        }
    }
    // A far view draws fewer dots and only the index contours.
    const close = cam.s >= 10;
    const rank_max = std.math.clamp(cam.s / 30, 0.12, 1);
    const ch = b.chunks();
    var cy = ch[1];
    while (cy <= ch[3]) : (cy += 1) {
        var cx = ch[0];
        while (cx <= ch[2]) : (cx += 1) {
            const k = cy * terrain.chunks + cx;
            for (sh.water.of(k)) |d| if (d.rank < rank_max) try dot(p, cam, d.x, d.y, px(cam, 0.05, 1), water_c);
            for (sh.banks.of(k)) |sg| try segLine(p, cam, sg, px(cam, 0.04, 1), bank_c);
            if (close) {
                for (sh.contours.of(k)) |sg| if (b.seg(sg)) try segLine(p, cam, sg, 1, contour_c);
                for (sh.index.of(k)) |sg| if (b.seg(sg)) try segLine(p, cam, sg, 1.4, index_c);
            } else {
                for (sh.index_far.of(k)) |sg| try segLine(p, cam, sg, 1, index_c);
            }
            for (sh.wood.of(k)) |d| if (d.rank < rank_max) {
                if (d.big) try dot(p, cam, d.x, d.y, px(cam, 0.1, 1.5), wood_big_c) else try dot(p, cam, d.x, d.y, px(cam, 0.06, 1), wood_c);
            };
            for (sh.buildings.of(k)) |bl| try p.fill(cam.x(bl[0]), cam.y(bl[1]), @max(1, bl[2] * cam.s), @max(1, bl[3] * cam.s), building_c);
        }
    }

    // The hedges: only in a close view.
    if (cam.s >= 6) {
        var hd: [10]terrain.Dot = undefined;
        const steps: usize = if (cam.s < 16) 5 else 10;
        var y = r[1];
        while (y <= r[3]) : (y += 1) {
            var x = r[0];
            while (x <= r[2]) : (x += 1) {
                const c = map.idx(x, y);
                const fx: f32 = @floatFromInt(x);
                const fy: f32 = @floatFromInt(y);
                if (s.m.hedge_e[c]) {
                    const k = terrain.hedgeDots(fx + 1, fy, true, hd[0..steps]);
                    for (hd[0..k]) |d| try dot(p, cam, d.x, d.y, if (d.big) px(cam, 0.09, 1.5) else px(cam, 0.055, 1), hedge_c);
                }
                if (s.m.hedge_s[c]) {
                    const k = terrain.hedgeDots(fx, fy + 1, false, hd[0..steps]);
                    for (hd[0..k]) |d| try dot(p, cam, d.x, d.y, if (d.big) px(cam, 0.09, 1.5) else px(cam, 0.055, 1), hedge_c);
                }
            }
        }
    }

    // The ways: a road is 0.08 of a square wide (about 20 m), a track is a
    // dashed line.
    const road_w = px(cam, 0.08, 1.5);
    for (f.ways.track.items) |sg| if (b.seg(sg)) try dashed(p, cam, sg, px(cam, 0.05, 1), track_c);
    for (f.ways.road.items) |sg| if (b.seg(sg)) try segLine(p, cam, sg, road_w, road_c);

    // The drone nets: a mesh over the way square.
    if (s.rules.drones) {
        var y = r[1];
        while (y <= r[3]) : (y += 1) {
            var x = r[0];
            while (x <= r[2]) : (x += 1) {
                const c = map.idx(x, y);
                if (!s.m.net[c]) continue;
                const x0 = cam.x(@floatFromInt(x));
                const y0 = cam.y(@floatFromInt(y));
                for (0..5) |i| {
                    const t = @as(f32, @floatFromInt(i)) / 4 * cam.s;
                    try p.line(x0 + t, y0, x0, y0 + t, 1, net_c);
                    try p.line(x0 + cam.s, y0 + t, x0 + t, y0 + cam.s, 1, net_c);
                }
            }
        }
    }
}

/// A dashed line: 0.12 of a square on, 0.08 off.
fn dashed(p: anytype, cam: Camera, sg: terrain.Seg, w: f32, c: Color) !void {
    const dx = sg.b[0] - sg.a[0];
    const dy = sg.b[1] - sg.a[1];
    const len = @sqrt(dx * dx + dy * dy);
    if (len == 0) return;
    if (cam.s < 8) return segLine(p, cam, sg, w, c.alpha(0.7));
    // The phase comes from the map position, so the dashes of two segments
    // line up.
    var t: f32 = -@mod(@abs(sg.a[0]) + @abs(sg.a[1]), 0.2);
    while (t < len) : (t += 0.2) {
        const t0 = @max(t, 0) / len;
        const t1 = @min(t + 0.12, len) / len;
        if (t1 <= t0) continue;
        try p.line(cam.x(sg.a[0] + dx * t0), cam.y(sg.a[1] + dy * t0), cam.x(sg.a[0] + dx * t1), cam.y(sg.a[1] + dy * t1), w, c);
    }
}

// ------------------------------------------------------------ overlays

pub fn overlays(p: anytype, f: Frame, b: Bounds) !void {
    const s = f.s;
    const cam = f.cam;
    const ui = f.ui;
    const size: f32 = map.size;
    const r = b.cells();

    // The grid: a line each kilometre (4 squares), or each 4 km in a far
    // view. In the build and order modes, a faint line for each square.
    const km: usize = if (cam.s < 5) 16 else 4;
    const fine_grid = (ui.mode == .logistics or ui.mode == .kill or ui.heightmap) and cam.s >= 8;
    for (0..map.size + 1) |i| {
        const fi: f32 = @floatFromInt(i);
        const major = i % km == 0;
        if (!major and !fine_grid) continue;
        const col = if (major) grid.alpha(0.6) else grid.alpha(0.22);
        try p.fill(cam.x(fi), cam.y(0), 1, cam.s * size, col);
        try p.fill(cam.x(0), cam.y(fi), cam.s * size, 1, col);
    }

    var y = r[1];
    while (y <= r[3]) : (y += 1) {
        var x = r[0];
        while (x <= r[2]) : (x += 1) {
            const c = map.idx(x, y);
            const sx = cam.x(@floatFromInt(x));
            const sy = cam.y(@floatFromInt(y));
            // The threat: the squares that red sees.
            if ((ui.mode == .intel or ui.mode == .logistics) and s.seen[c]) {
                try p.hatch(sx, sy, cam.s, cam.s, red.alpha(if (ui.mode == .intel) 0.55 else 0.25));
            }
            // In Intel, what blue sees too.
            if (ui.mode == .intel and s.blue_seen[c]) try p.fill(sx, sy, cam.s, cam.s, blue.alpha(0.07));
            // The heights, when the squares are big enough to hold them.
            if (ui.heightmap and cam.s >= 34) {
                var hb: [8]u8 = undefined;
                try p.text(std.fmt.bufPrint(&hb, "{d:.0}", .{s.m.cellHeight(c)}) catch "", sx + 4, sy + 3, 12, ink.alpha(0.8));
            }
            // Frontier: who holds each town square.
            if (s.rules.town_supply and s.m.ground[c] == .town) {
                if (s.owner[c]) |o| try p.fill(sx + 1, sy + 1, @max(3, cam.s * 0.18), @max(3, cam.s * 0.18), if (o == .blue) blue else red);
            }
            // Hold V: the sightlines.
            if (ui.sight != null and f.sight[c]) try p.fill(sx, sy, cam.s, cam.s, blue.alpha(0.16));
        }
    }

    if (ui.sight) |from| {
        try cellRect(p, cam, from, 0, blue, false, 2);
        const fc = map.centre(from);
        try icons.circle(p, cam.x(fc[0]), cam.y(fc[1]), view.sight_range * cam.s, 1, blue.alpha(0.5));
        try p.text("SIGHTLINES", cam.x(fc[0]) + 10, cam.y(fc[1]) - 22, 13, blue);
    }

    // The sectors, their postures and their objectives.
    if (ui.mode == .kill or s.rules.manoeuvre) {
        for (0..sim.sectors) |i| {
            const sx = cam.x(@floatFromInt(i * sim.sector_w));
            if (ui.mode == .kill) {
                if (i > 0) try p.fill(sx, cam.y(0), 1, cam.s * size, blue.alpha(0.35));
                if (i == ui.sector) try p.fill(sx, cam.y(0), cam.s * sim.sector_w, cam.s * size, blue.alpha(0.05));
                const label = switch (s.posture[@backingInt(sim.Side.blue)][i]) {
                    .push => "PUSH",
                    .hold => "HOLD",
                    .back => "FALL BACK",
                };
                const ly = std.math.clamp(cam.y(@floatFromInt(s.setup.front_y + 14)), view.top_bar + 40, f.h - view.bottom_bar - 30);
                try p.text(label, sx + 8, ly, 16, if (i == ui.sector) blue else blue.alpha(0.55));
            }
            if (s.goal[i]) |g| {
                const gc = map.centre(g);
                var lb: [4]u8 = undefined;
                try icons.objective(p, cam.x(gc[0]), cam.y(gc[1]), 20, std.fmt.bufPrint(&lb, "{d}", .{i + 1}) catch "", blue);
            }
        }
    }

    // The build jobs.
    for (s.jobs) |j| {
        if (!j.active) continue;
        const working = j.engineer != sim.none;
        const col = if (j.kind == .net) net_c else amber;
        try cellRect(p, cam, j.cell, cam.s * 0.12, col.alpha(if (working) 0.9 else 0.45), false, if (working) 1.5 else 1);
        if (j.kind == .road) try cellRect(p, cam, j.cell, cam.s * 0.25, amber.alpha(0.35), false, 1);
    }

    // The objective, the depot, the red posts and batteries.
    const held = s.hold_ticks > 0;
    for (s.setup.objective[0..s.setup.objective_n]) |c| try cellRect(p, cam, c, 0, (if (held) blue else ink).alpha(0.35), false, 1);
    const oc = map.centre(s.setup.objective[0]);
    try icons.objective(p, cam.x(oc[0]), cam.y(oc[1]) - cam.s * 1.5 - 12, 24, "A", if (held) blue else ink);
    const dc = map.centre(s.setup.depot);
    try icons.depot(p, cam.x(dc[0]), cam.y(dc[1]), @max(16, cam.s * 0.9));
    try p.text("DEPOT", cam.x(dc[0]) + 14, cam.y(dc[1]) - 8, 13, amber);
    for (s.setup.posts) |po| if (po[2] > 0) {
        try icons.post(p, cam.x(po[0]), cam.y(po[1]), 18, red);
    };
    if (s.rules.artillery) for (s.setup.batteries) |ba| {
        try icons.battery(p, cam.x(ba[0]), cam.y(ba[1]), 14, red.alpha(0.8));
    };

    if (ui.hover) |c| if (ui.mode != .view) try cellRect(p, cam, c, 0, ink.alpha(0.7), false, 1);
}

// ------------------------------------------------------------ units

pub fn units(p: anytype, f: Frame, b: Bounds) !void {
    const s = f.s;
    const cam = f.cam;
    const isz = std.math.clamp(cam.s * 0.6, 11, 26);
    var squad_n: u32 = 0;
    var eng_n: u32 = 0;
    for (s.units) |u| {
        if (!u.alive) continue;
        if (u.side == .blue and u.kind == .infantry) squad_n += 1;
        if (u.kind == .engineer) eng_n += 1;
        // Fog: a red squad that blue does not see shows as its ghost.
        if (s.rules.fog and u.side == .red and !u.spotted) {
            if (u.ghost_tick > 0 and b.pt(u.ghost_x, u.ghost_y)) {
                const age = @as(f32, @floatFromInt(s.tick - u.ghost_tick)) / sim.tick_hz;
                const a = std.math.clamp(1 - age / 60, 0.15, 0.6);
                try icons.enemy(p, cam.x(u.ghost_x), cam.y(u.ghost_y), isz * 0.9, 0, red.alpha(a));
                try p.text("?", cam.x(u.ghost_x) + isz * 0.6, cam.y(u.ghost_y) - isz * 0.8, 12, red.alpha(a));
            }
            continue;
        }
        if (!b.pt(u.x, u.y)) continue;
        const ux = cam.x(u.x);
        const uy = cam.y(u.y);
        var lb: [8]u8 = undefined;
        switch (u.kind) {
            .infantry => if (u.side == .blue) {
                try icons.squad(p, ux, uy, isz, u.hx, u.hy, u.strength / 100, blue);
                // The supply bar.
                try p.fill(ux - isz / 2, uy + isz / 2 + 3, isz, 2, amber.alpha(0.25));
                try p.fill(ux - isz / 2, uy + isz / 2 + 3, isz * u.supply / 100, 2, amber);
                try p.text(std.fmt.bufPrint(&lb, "{d}", .{squad_n}) catch "", ux + isz / 2 + 3, uy - isz / 2 - 6, 13, blue);
                if (u.engaged) try icons.circle(p, ux, uy, isz * 0.95, 1, blue.alpha(0.4));
            } else {
                try icons.enemy(p, ux, uy, isz, u.strength / 100, red);
                if (u.engaged) try icons.circle(p, ux, uy, isz * 0.95, 1, red.alpha(0.4));
            },
            .engineer => {
                try icons.engineer(p, ux, uy, isz * 0.8, engineer_c);
                if (u.task == .working) try icons.circle(p, ux, uy, isz * 0.8, 1, engineer_c.alpha(0.6));
                try p.text(std.fmt.bufPrint(&lb, "E{d}", .{eng_n}) catch "", ux + isz / 2 + 3, uy - isz / 2 - 6, 12, engineer_c.alpha(0.85));
            },
            .truck => try icons.truck(p, ux, uy, isz * 0.7, u.hx, u.hy, u.client != sim.none, truck_c),
        }
    }
    // The red drones: a small red cross with a trail.
    for (s.drones) |d| if (d.active and b.pt(d.x, d.y)) {
        const x = cam.x(d.x);
        const y = cam.y(d.y);
        try p.line(x - 5, y - 5, x + 5, y + 5, 2, red);
        try p.line(x - 5, y + 5, x + 5, y - 5, 2, red);
        try icons.circle(p, x, y, 3, 0, Color.rgb(255, 200, 200, 1));
    };
}

// ------------------------------------------------------------ effects

pub fn effects(p: anytype, f: Frame) !void {
    const s = f.s;
    const cam = f.cam;
    // The shots: a tracer runs from the shooter to the target in 0.25 s,
    // with a muzzle flash at the start.
    for (s.shots) |sh| {
        if (sh.tick == 0) continue;
        const age = @as(f32, @floatFromInt(s.tick -| sh.tick)) / sim.tick_hz;
        if (age > 0.4) continue;
        const col = if (sh.side == .blue) Color.rgb(190, 250, 255, 1) else Color.rgb(255, 150, 90, 1);
        const ax = cam.x(sh.from[0]);
        const ay = cam.y(sh.from[1]);
        const bx = cam.x(sh.to[0]);
        const by = cam.y(sh.to[1]);
        const head = std.math.clamp(age / 0.25, 0, 1);
        const tail = std.math.clamp(head - 0.3, 0, 1);
        try p.line(ax + (bx - ax) * tail, ay + (by - ay) * tail, ax + (bx - ax) * head, ay + (by - ay) * head, 1.4, col.alpha(1 - age / 0.4));
        if (age < 0.08) try icons.circle(p, ax, ay, 3, 0, Color.rgb(255, 240, 200, 1));
        if (head >= 1 and age < 0.33) try p.fill(bx - 1, by - 1, 2, 2, col);
    }
    // The shells in flight: a red reticle that closes. A blue mortar round:
    // a small blue one.
    for (s.shells) |sh| {
        if (!sh.active) continue;
        const flight: f32 = if (sh.mortar) artillery.mortar_flight_s else artillery.flight_s;
        const t = @as(f32, @floatFromInt(sh.timer)) / (flight * sim.tick_hz);
        const rr = artillery.radius * cam.s;
        try icons.shell(p, cam.x(sh.x), cam.y(sh.y), @max(6, if (sh.mortar) rr * 0.6 else rr), t, if (sh.mortar) blue else red);
    }
    for (s.marks) |mk| {
        const age = @as(f32, @floatFromInt(s.tick -| mk.tick)) / sim.tick_hz;
        switch (mk.kind) {
            .none => {},
            .burst => if (age < 1.2) {
                const rr = @max(6, cam.s * (0.3 + age * 0.7));
                try icons.circle(p, cam.x(mk.x), cam.y(mk.y), rr * 0.5, 0, Color.rgb(255, 160, 60, 0.5 * (1 - age / 1.2)));
                try icons.circle(p, cam.x(mk.x), cam.y(mk.y), rr, 2, Color.rgb(255, 120, 40, 1 - age / 1.2));
            },
            .wreck => if (age < 25) {
                try icons.wreck(p, cam.x(mk.x), cam.y(mk.y), 8, red.alpha(0.7 * (1 - age / 25)));
            },
        }
    }
}
