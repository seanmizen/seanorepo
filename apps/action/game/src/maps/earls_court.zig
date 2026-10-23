// Earl's Court tube station, from its public layout (Wikipedia; a
// level-by-level station description). The sizes are approximate.
//
// X is east, Z is south (north is -Z), Y is up. Both lines run east-west.
//
//   y  4.8  street and concourse: the Earls Court Road entrance (east), the
//           Warwick Road entrance (west, 1937, with the glass rotunda), the
//           high-level walkway along the north side of the train shed, and
//           a spur that turns south off it mid-station, with the lifts down
//           to the District line islands.
//   y  0    District line: two island platforms under the 1878 train shed.
//           Platforms 1 and 2 (eastbound) are north of 3 and 4 (westbound).
//           Steps from both concourses.
//   y -5.6  intermediate level: a broken ring of passages. Each island has
//           two sets of steps down. The escalators leave its north-west
//           corner and go down to the east.
//   y -15   Piccadilly line: one island, platform 5 (eastbound, north) and
//           platform 6 (westbound, south), with a corridor between them.
//           A deep lift goes up to the Earls Court Road concourse.
//
// The lines run far out of the station both ways. Past the ends of the
// platforms the live rail kills (liveRail, main.zig). server/index.ts has a
// copy of the spawns and the lift levels.
//
// The platforms take full-length trains (train_car.zig): the District
// islands are 120 m long, for the 117.4 m of a 7-car S7 Stock train, and
// the Piccadilly platforms are 112 m long, for the 106.8 m of a 6-car 1973
// Stock train.
const std = @import("std");
const map = @import("../map.zig");
const train_car = @import("../train_car.zig");
const vapes = @import("../vapes.zig");
const gates = @import("../gates.zig");
const vec = @import("../vec.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;
const Mat = map.Mat;
const Surface = map.Surface;
const Rect = map.Rect;

// Levels.
pub const street_y: f32 = 4.8;
pub const deck_y: f32 = street_y - 0.8; // the underside of the decks
pub const bed_y: f32 = -0.85;
pub const mid_y: f32 = -5.6; // the intermediate level floor
pub const mid_ceil: f32 = -3.2;
pub const deep_y: f32 = -15;
pub const deep_ceil: f32 = deep_y + 4.6;
/// Past this |x| along the lines the live rail kills: just past the ends of
/// the concourses (|x| = 66).
pub const shock_x: f32 = 66.7;
/// On the Piccadilly line the live rail kills this far past the ends of
/// the platforms.
const deep_shock: f32 = 6.7;
pub const line_end: f32 = 400;

// The train shed.
const shed_x0: f32 = -45;
const shed_x1: f32 = 45;
const wall_n: f32 = -21;
const wall_s: f32 = 12.6;
// Track beds and islands, north to south: [z0, z1].
const e1 = [2]f32{ -21, -16.8 };
const island_a = [2]f32{ -16.8, -8.8 };
const e2 = [2]f32{ -8.8, -4.6 };
const w1 = [2]f32{ -3.8, 0.4 };
const island_b = [2]f32{ 0.4, 8.4 };
const w2 = [2]f32{ 8.4, 12.6 };
/// The islands: 120 m, from the shed out under the concourse decks.
const island_x = [2]f32{ -60, 60 };
/// The track centre of each track bed: 1.56 m from the platform edge, so
/// the 2.92 m wide S7 Stock stops 0.1 m from the edge. `away`: the side of
/// the bed away from the platform (+1 south, -1 north).
const Track = struct { bed: [2]f32, c: f32, away: f32 };
const track_c = [_]Track{
    .{ .bed = e1, .c = island_a[0] - 1.56, .away = -1 },
    .{ .bed = e2, .c = island_a[1] + 1.56, .away = 1 },
    .{ .bed = w1, .c = island_b[0] - 1.56, .away = -1 },
    .{ .bed = w2, .c = island_b[1] + 1.56, .away = 1 },
};
const ca: f32 = -12.8; // island centres
const cb: f32 = 4.4;
// The stair wells from the islands down to the intermediate level.
const well_x = [2][2]f32{ .{ -29, -22 }, .{ 22, 29 } };
// The walkway (north side) and the spur.
const walk_z1: f32 = -18.4;
const spur_x = [2]f32{ -3, 3 };
// District lift shafts in the spur, doors on the north face.
const lift_a = Rect{ .x0 = -1.2, .x1 = 1.2, .z0 = -12.2, .z1 = -9.8 };
const lift_b = Rect{ .x0 = -1.2, .x1 = 1.2, .z0 = 4.6, .z1 = 7.0 };
// Concourses and the buildings beyond them.
const east_x = [2]f32{ 45, 66 };
const west_x = [2]f32{ -66, -45 };
const conc_z0: f32 = -25;
const hall_x1: f32 = 78; // the Earls Court Road front
const street_e = [2]f32{ 78.6, 92.6 };
/// VAPES N MORE, in the terrace opposite the Earls Court Road front: the
/// shop front from z0 to z1.
const shop_z = [2]f32{ -37, -29 };
const warwick_x0: f32 = -84; // the Warwick Road front
const street_w = [2]f32{ -96, -84 };
// The escalators and the deep level.
const esc_z = [2]f32{ -24, -21 };
pub const esc_top_x: f32 = -30;
pub const esc_steps = 21;
pub const esc_rise: f32 = (mid_y - deep_y) / 21.0;
pub const esc_run: f32 = esc_rise * 1.732; // 30 degrees
pub const esc_bottom_x: f32 = esc_top_x + esc_run * esc_steps;
const corr_z = [2]f32{ -24, -21 }; // the deep corridor between the platforms
const p5 = [2]f32{ -27.5, -24.5 }; // platform 5 (north)
const t5 = [2]f32{ -31, -27.5 };
const p6 = [2]f32{ -20.5, -17.5 }; // platform 6 (south)
const t6 = [2]f32{ -17.5, -14 };
/// The deep track centres: 1.41 m from the platform edge, so the 2.629 m
/// wide 1973 Stock stops 0.1 m from the edge.
const t5_c: f32 = t5[1] - 1.41;
const t6_c: f32 = t6[0] + 1.41;
const plat_x = [2]f32{ 0, 112 };
const deep_lift = Rect{ .x0 = 62.4, .x1 = 64.8, .z0 = -24, .z1 = -21.6 };

// Colours.
const brick = v3(0.45, 0.21, 0.13);
const red_brick = v3(0.55, 0.2, 0.12);
const iron = v3(0.07, 0.1, 0.08);
const platform_c = v3(0.46, 0.44, 0.41);
const ballast = v3(0.25, 0.22, 0.2);
const yellow = v3(0.85, 0.68, 0.08);
const cream = v3(0.86, 0.8, 0.64);
const tile_c = v3(0.8, 0.76, 0.63);
const tile_green = v3(0.2, 0.38, 0.3);
const red = v3(0.75, 0.06, 0.05);
const blue = v3(0.04, 0.12, 0.45);
const steel = v3(0.35, 0.36, 0.37);
const dark = v3(0.012, 0.012, 0.014);
const deck_c = v3(0.42, 0.4, 0.38);
const concrete_c = v3(0.2, 0.19, 0.18);
const pave = v3(0.55, 0.54, 0.52);
const warm = v3(1.0, 0.72, 0.42);
const cool = v3(0.78, 0.88, 1.0);

var seed: u32 = 1;
fn rnd() f32 {
    seed +%= 1;
    return vec.hash(seed * 7919);
}

fn box(min: V3, max: V3, color: V3, mat: Mat, surface: Surface) void {
    _ = map.add(min, max, color, mat, surface);
}

/// A box that does not count for the ambient occlusion.
fn boxNoAo(min: V3, max: V3, color: V3, mat: Mat, surface: Surface) void {
    map.add(min, max, color, mat, surface).ao = false;
}

fn deco(min: V3, max: V3, color: V3, mat: Mat, surface: Surface) void {
    map.addDecor(Mat4.identity(), min, max, color, mat, surface);
}

fn rect(x0: f32, x1: f32, z0: f32, z1: f32) Rect {
    return .{ .x0 = x0, .x1 = x1, .z0 = z0, .z1 = z1 };
}

/// A roundel facing +Z, turned by `turn` about Y.
fn roundel(p: V3, turn: f32, size: f32) void {
    const m = vec.translate(p).mul(Mat4.rotationY(turn));
    map.addDisc(m, 0.62 * size, 0.05, red, .paint, .sheet_metal);
    map.addDisc(m.mul(vec.translate(v3(0, 0, 0.03))), 0.42 * size, 0.02, v3(0.92, 0.92, 0.9), .paint, .sheet_metal);
    map.addDecor(m, v3(-0.82 * size, -0.15 * size, 0.035), v3(0.82 * size, 0.15 * size, 0.07), blue, .paint, .sheet_metal);
}

/// A railing: a solid panel with a timber cap, at floor height y. One of
/// the two ranges is thin.
fn railing(x0: f32, x1: f32, z0: f32, z1: f32, y: f32) void {
    boxNoAo(v3(x0, y, z0), v3(x1, y + 1.1, z1), iron, .metal, .metal);
    deco(v3(x0 - 0.04, y + 1.1, z0 - 0.04), v3(x1 + 0.04, y + 1.17, z1 + 0.04), v3(0.3, 0.15, 0.08), .wood, .wood);
}

/// Stairs along X, `width` wide about z = cz. The top step starts at x_top
/// at height y_top, and `n` steps go down toward `dir` (+1 east, -1 west).
/// `floors` are the floor heights at the top and at the bottom. A ramp
/// (map.Ramp) covers the steps from the one floor to the other: its surface
/// goes through the front edges of the steps.
fn stairs(x_top: f32, dir: f32, cz: f32, width: f32, y_top: f32, n: usize, floors: [2]f32, color: V3) void {
    const rise = 0.4;
    const run = 0.5;
    const z0 = cz - width / 2;
    const z1 = cz + width / 2;
    const fn_: f32 = @floatFromInt(n);
    const bottom = y_top - rise * fn_ - 0.5;
    // The front edge of step i is at x_top + dir * run * (i + 1), at the
    // height y_top - rise * i. The ramp ends where that line meets a floor.
    const x_hi = x_top + dir * run * (y_top + rise - floors[0]) / rise;
    const x_lo = x_top + dir * run * (y_top + rise - floors[1]) / rise;
    map.addRamp(.{
        .x0 = @min(x_hi, x_lo),
        .x1 = @max(x_hi, x_lo),
        .z0 = z0,
        .z1 = z1,
        .y0 = if (dir > 0) floors[0] else floors[1],
        .y1 = if (dir > 0) floors[1] else floors[0],
        .bottom = bottom,
    });
    for (0..n) |i| {
        const fi: f32 = @floatFromInt(i);
        const top = y_top - rise * fi;
        const xa = x_top + dir * run * fi;
        const xb = xa + dir * run;
        boxNoAo(v3(@min(xa, xb), bottom, z0), v3(@max(xa, xb), top, z1), color, .concrete, .concrete);
        const nose = if (dir > 0) @min(xa, xb) else @max(xa, xb) - 0.06;
        deco(v3(nose, top, z0), v3(nose + 0.06, top + 0.012, z1), yellow, .paint, .concrete);
    }
    // Handrails: a beam to see, boxes to stop the player.
    const x_end = x_top + dir * run * fn_;
    const y_end = y_top - rise * (fn_ - 1);
    for ([_]f32{ z0 + 0.03, z1 - 0.03 }) |z| {
        map.beam(v3(x_top, y_top + 0.95, z), v3(x_end, y_end + 0.95, z), 0.06, 0.06, v3(0, 1, 0), steel, .metal, .metal);
        var k: usize = 0;
        while (k < n) : (k += 3) {
            const fa: f32 = @floatFromInt(k);
            const fb: f32 = @floatFromInt(@min(k + 3, n));
            const xa = x_top + dir * run * fa;
            const xb = x_top + dir * run * fb;
            map.addSolid(v3(@min(xa, xb), y_top - rise * (fb - 1) - 0.5, z - 0.05), v3(@max(xa, xb), y_top - rise * fa + 1.0, z + 0.05), .metal);
        }
    }
}

pub fn build() void {
    seed = 1;
    map.shadow_centre = v3(0, 0, -4);
    map.shadow_half = 80;
    map.underground_y = -3;
    map.kill_y = -30;

    districtLevel();
    roof();
    walkwayAndSpur();
    lifts();
    eastEnd();
    westEnd();
    lines();
    districtTrain();
    intermediateLevel();
    escalators();
    deepLevel();
    // Last: its random colours do not change the rest of the map.
    vapeShop();

    // Spawns. The debug teleport (Cmd+D, then Shift+1 to 9) uses this order.
    const sp = [_]V3{
        v3(-40, 0, ca - 2),   v3(40, 0, cb + 2),     v3(30, deep_y, -26),      v3(30, deep_y, -19),
        v3(-10, 0, -15.5),    v3(-10, 0, 2),         v3(-20, street_y, -19.7), v3(55, street_y, 0),
        v3(-55, street_y, 0), v3(85, street_y, -20), v3(0, mid_y, ca),         v3(-5, deep_y, -22.5),
    };
    for (sp) |p| map.addSpawn(p);
}

// ---- District level ------------------------------------------------------------

fn districtLevel() void {
    // The ground under the tracks, with the stair wells cut out.
    var wells: [4]Rect = undefined;
    var nw: usize = 0;
    for ([_]f32{ ca, cb }) |cz| {
        for (well_x) |wx| {
            wells[nw] = rect(wx[0], wx[1], cz - 1.2, cz + 1.2);
            nw += 1;
        }
    }
    map.carve(rect(shed_x0, shed_x1, wall_n, wall_s), -3, bed_y, &wells, ballast, .concrete, .ballast);

    // Islands, with their wells, and the yellow edges.
    for ([_][2]f32{ island_a, island_b }, 0..) |is, k| {
        const cz = (is[0] + is[1]) / 2;
        map.carve(rect(island_x[0], island_x[1], is[0], is[1]), bed_y, 0, wells[k * 2 .. k * 2 + 2], platform_c, .concrete, .concrete);
        deco(v3(island_x[0], 0, is[0]), v3(island_x[1], 0.012, is[0] + 0.45), yellow, .paint, .concrete);
        deco(v3(island_x[0], 0, is[1] - 0.45), v3(island_x[1], 0.012, is[1]), yellow, .paint, .concrete);
        // Railings round the wells, open at the top of the stairs.
        for (well_x) |wx| {
            railing(wx[0], wx[1], cz - 1.3, cz - 1.2, 0);
            railing(wx[0], wx[1], cz + 1.2, cz + 1.3, 0);
            const end = if (wx[0] < 0) wx[0] - 0.1 else wx[1];
            railing(end, end + 0.1, cz - 1.3, cz + 1.3, 0);
        }
        // Benches, and roundels on posts. Each post is on the side of its
        // bench toward the middle of the island, clear of the stairs.
        for ([_]f32{ -36, -12, 12, 36 }) |x| {
            boxNoAo(v3(x - 1.0, 0, cz - 0.25), v3(x + 1.0, 0.45, cz + 0.25), v3(0.35, 0.2, 0.1), .wood, .wood);
            const px: f32 = if (x > 0) x - 4 else x + 4;
            deco(v3(px - 0.05, 0, cz - 0.05), v3(px + 0.05, 2.4, cz + 0.05), iron, .metal, .metal);
            map.addSolid(v3(px - 0.1, 0, cz - 0.1), v3(px + 0.1, 2.4, cz + 0.1), .metal);
            roundel(v3(px, 2.6, cz), 0, 0.9);
            roundel(v3(px, 2.6, cz), std.math.pi, 0.9);
        }
    }
    // The fence between the eastbound and westbound pairs.
    boxNoAo(v3(shed_x0, bed_y, e2[1]), v3(shed_x1, bed_y + 1.2, w1[0]), v3(0.2, 0.2, 0.2), .metal, .metal);

    // Brick side walls. Below the decks they run the whole length of the
    // lines (lines()); above, only along the shed.
    box(v3(shed_x0, deck_y, wall_n - 0.6), v3(shed_x1, 7.5, wall_n), brick, .brick, .brick);
    box(v3(shed_x0, deck_y, wall_s), v3(shed_x1, 7.5, wall_s + 0.6), brick, .brick, .brick);
    var px: f32 = shed_x0;
    while (px <= shed_x1) : (px += 6) {
        boxNoAo(v3(px - 0.35, street_y, wall_n), v3(px + 0.35, 7.5, wall_n + 0.25), brick * vec.s(0.85), .brick, .brick);
        boxNoAo(v3(px - 0.35, bed_y, wall_s - 0.25), v3(px + 0.35, 7.5, wall_s), brick * vec.s(0.85), .brick, .brick);
    }

    // Lamps hung from the roof over the islands. Each light is just under
    // its shade.
    for ([_]f32{ ca, cb }) |cz| {
        for ([_]f32{ -25, 15 }) |x| {
            deco(v3(x - 0.02, 4.9, cz - 0.02), v3(x + 0.02, 12, cz + 0.02), iron, .metal, .metal);
            deco(v3(x - 0.35, 4.6, cz - 0.35), v3(x + 0.35, 4.9, cz + 0.35), iron, .metal, .sheet_metal);
            map.add(v3(x - 0.25, 4.5, cz - 0.25), v3(x + 0.25, 4.6, cz + 0.25), warm, .emissive, .glass).solid = false;
            map.addLight(v3(x, 4.3, cz), v3(1.2, 0.8, 0.45), 11);
        }
    }
}

// The roof arch: a half ellipse across the shed, from the springing at
// 7.5 m on the side walls to 14.5 m at z = arch_z.
const arch_z: f32 = -4.2;
const arch_half: f32 = 16.8;
const arch_rise: f32 = 7.0;
const arch_y0: f32 = 7.5;
/// The ribs of the roof: one each `rib_step` m along X, from shed_x0 to
/// shed_x1.
pub const rib_x = [2]f32{ shed_x0, shed_x1 };
pub const rib_step: f32 = 6;
/// The tie rods are 34.8 degrees up the arch from the springing: 11.5 m
/// high. They are 8 cm square.
const tie_t: f32 = 34.8 / 180.0;
pub const tie_half: f32 = 0.04;

/// The point of the arch line at x, t from 0 (the north springing) to 1
/// (the south springing).
fn archPoint(t: f32, x: f32) V3 {
    const a = t * std.math.pi;
    return v3(x, arch_y0 + @sin(a) * arch_rise, arch_z - @cos(a) * arch_half);
}

/// The height of the arch line over z. Outside the span: the springing.
pub fn archY(z: f32) f32 {
    const c = (z - arch_z) / arch_half;
    return arch_y0 + arch_rise * @sqrt(@max(0, 1 - c * c));
}

/// The tie rod of the rib at x: the centres of its two ends. The pigeons
/// (pigeons.zig) sit on the tie rods.
pub fn tieRod(x: f32) [2]V3 {
    return .{ archPoint(tie_t, x), archPoint(1 - tie_t, x) };
}

/// The iron arch roof over the shed: ribs every 6 m along X, purlins, slate
/// panels near the eaves, a raised lantern. The tie rods are at 11.5 m, out
/// of reach from the walkway (4.8 m).
fn roof() void {
    const at = struct {
        fn p(t: f32, x: f32) V3 {
            return archPoint(t, x);
        }
        fn n(t: f32) V3 {
            const a = t * std.math.pi;
            return vec.norm(v3(0, @sin(a) / arch_rise, -@cos(a) / arch_half));
        }
    };
    const segs = 16;
    var x = shed_x0;
    while (x <= shed_x1 + 0.01) : (x += rib_step) {
        for (0..segs) |i| {
            const ta = @as(f32, @floatFromInt(i)) / segs;
            const tb = @as(f32, @floatFromInt(i + 1)) / segs;
            map.beam(at.p(ta, x), at.p(tb, x), 0.28, 0.5, v3(1, 0, 0), iron, .metal, .metal);
        }
        const tie = tieRod(x);
        map.beam(tie[0], tie[1], tie_half * 2, tie_half * 2, v3(0, 1, 0), iron, .metal, .metal);
    }
    for (1..14) |i| {
        const t = @as(f32, @floatFromInt(i)) / 14;
        const a = at.p(t, shed_x0);
        map.beam(a, v3(shed_x1, a[1], a[2]), 0.16, 0.16, at.n(t), iron, .metal, .metal);
    }
    const bands = [_][2]f32{ .{ 0, 0.09 }, .{ 0.09, 0.17 }, .{ 0.83, 0.91 }, .{ 0.91, 1.0 } };
    for (bands) |b| {
        const a = at.p(b[0], shed_x0);
        const c = at.p(b[1], shed_x0);
        const nrm = at.n((b[0] + b[1]) / 2);
        const mid = (a + c) * vec.s(0.5) + nrm * vec.s(0.2);
        map.beam(mid, v3(shed_x1, mid[1], mid[2]), vec.len(c - a), 0.08, nrm, v3(0.16, 0.16, 0.18), .concrete, .tile);
    }
    map.beam(v3(shed_x0, 15.4, -4.2), v3(shed_x1, 15.4, -4.2), 5, 0.1, v3(0, 1, 0), v3(0.16, 0.16, 0.18), .concrete, .glass);
    var xp = shed_x0;
    while (xp <= shed_x1) : (xp += 6) {
        for ([_]f32{ -6.5, -1.9 }) |z| map.beam(v3(xp, 14.4, z), v3(xp, 15.4, z), 0.15, 0.15, v3(1, 0, 0), iron, .metal, .metal);
    }
}

// ---- Street level inside the shed: the walkway and the spur --------------------

fn walkwayAndSpur() void {
    // The high-level walkway along the north wall, open at the spur.
    box(v3(shed_x0, deck_y, wall_n), v3(shed_x1, street_y, walk_z1), deck_c, .concrete, .concrete);
    deco(v3(shed_x0, deck_y - 0.5, walk_z1 - 0.3), v3(shed_x1, deck_y, walk_z1), iron, .metal, .metal);
    railing(shed_x0, spur_x[0], walk_z1 - 0.12, walk_z1, street_y);
    railing(spur_x[1], shed_x1, walk_z1 - 0.12, walk_z1, street_y);

    // The spur south across the tracks, with the two lift shafts cut out.
    map.carve(rect(spur_x[0], spur_x[1], walk_z1, wall_s), deck_y, street_y, &.{ lift_a, lift_b }, deck_c, .concrete, .concrete);
    deco(v3(spur_x[0], deck_y - 0.6, walk_z1), v3(spur_x[0] + 0.3, deck_y, wall_s), iron, .metal, .metal);
    deco(v3(spur_x[1] - 0.3, deck_y - 0.6, walk_z1), v3(spur_x[1], deck_y, wall_s), iron, .metal, .metal);
    railing(spur_x[0], spur_x[0] + 0.12, walk_z1, wall_s, street_y);
    railing(spur_x[1] - 0.12, spur_x[1], walk_z1, wall_s, street_y);

    // The old train indicator board on the walkway at the spur.
    deco(v3(-1.8, street_y + 2.2, wall_n + 0.1), v3(1.8, street_y + 3.4, wall_n + 0.3), v3(0.03, 0.03, 0.03), .wood, .wood);
    for (0..3) |row| {
        const ry = street_y + 3.2 - @as(f32, @floatFromInt(row)) * 0.32;
        deco(v3(-1.5, ry - 0.08, wall_n + 0.3), v3(1.5 - 0.4 * @as(f32, @floatFromInt(row)), ry, wall_n + 0.32), v3(1.0, 0.6, 0.1), .emissive, .glass);
    }
    map.add(v3(-0.6, street_y + 3.9, -4.4), v3(0.6, street_y + 4.0, -4.0), warm, .emissive, .glass).solid = false;
    deco(v3(-0.02, street_y + 4.0, -4.22), v3(0.02, 13, -4.18), iron, .metal, .metal);
    map.addLight(v3(0, street_y + 3.6, -4.2), warm, 10);
}

// ---- Lifts -------------------------------------------------------------------

const frame_c = v3(0.1, 0.12, 0.11);
const glass_c = v3(0.06, 0.08, 0.09);

/// Two corners of a box on a door face. `on_x`: the face is at x (fa..fb)
/// and runs along z (aa..ab); else it is at z and runs along x.
fn face(on_x: bool, aa: f32, ab: f32, ya: f32, yb: f32, fa: f32, fb: f32) [2]V3 {
    return if (on_x) .{ v3(fa, ya, aa), v3(fb, yb, ab) } else .{ v3(aa, ya, fa), v3(ab, yb, fb) };
}

/// A lift shaft from levels[0] to levels[1] with its cab, doors and
/// buttons. `door_on_x`: the doors are on the west (x0) face, else on the
/// north (z0) face.
fn lift(r: Rect, levels: [2]f32, door_on_x: bool, speed: f32) void {
    const top = levels[1] + 3.2;
    const bottom = levels[0];
    // Three walls and a roof. The door face is below.
    if (door_on_x) {
        boxNoAo(v3(r.x0, bottom, r.z0), v3(r.x1, top, r.z0 + 0.1), glass_c, .metal, .glass);
        boxNoAo(v3(r.x0, bottom, r.z1 - 0.1), v3(r.x1, top, r.z1), glass_c, .metal, .glass);
        boxNoAo(v3(r.x1 - 0.1, bottom, r.z0), v3(r.x1, top, r.z1), glass_c, .metal, .glass);
    } else {
        boxNoAo(v3(r.x0, bottom, r.z0), v3(r.x0 + 0.1, top, r.z1), glass_c, .metal, .glass);
        boxNoAo(v3(r.x1 - 0.1, bottom, r.z0), v3(r.x1, top, r.z1), glass_c, .metal, .glass);
        boxNoAo(v3(r.x0, bottom, r.z1 - 0.1), v3(r.x1, top, r.z1), glass_c, .metal, .glass);
    }
    box(v3(r.x0, top, r.z0), v3(r.x1, top + 0.2, r.z1), frame_c, .metal, .metal);

    // The door face: jambs, and panels between and over the openings.
    const a0 = if (door_on_x) r.z0 else r.x0;
    const a1 = if (door_on_x) r.z1 else r.x1;
    const f0 = if (door_on_x) r.x0 else r.z0;
    const f1 = f0 + 0.1;
    const da0 = a0 + 0.35;
    const da1 = a1 - 0.35;
    for ([_][2]f32{ .{ a0, da0 }, .{ da1, a1 } }) |j| {
        const p = face(door_on_x, j[0], j[1], bottom, top, f0, f1);
        boxNoAo(p[0], p[1], frame_c, .metal, .metal);
    }
    const mid_panel = face(door_on_x, da0, da1, levels[0] + 2.3, levels[1], f0, f1);
    boxNoAo(mid_panel[0], mid_panel[1], frame_c, .metal, .metal);
    const top_panel = face(door_on_x, da0, da1, levels[1] + 2.3, top, f0, f1);
    boxNoAo(top_panel[0], top_panel[1], frame_c, .metal, .metal);
    for (levels) |ly| {
        const p = face(door_on_x, da0, da1, ly + 2.35, ly + 2.6, f0 - 0.04, f0);
        deco(p[0], p[1], v3(0.05, 0.25, 0.6), .emissive, .glass);
    }

    // The cab: a floor and a lit ceiling (dynamic).
    const inner_min = if (door_on_x) v3(f1, -0.15, r.z0 + 0.1) else v3(r.x0 + 0.1, -0.15, f1);
    const inner_max = v3(r.x1 - 0.1, 0, r.z1 - 0.1);
    const fb = map.add(inner_min, inner_max, v3(0.25, 0.25, 0.27), .metal, .metal);
    fb.dynamic = true;
    fb.ao = false;
    const cbx = map.add(v3(inner_min[0], 2.45, inner_min[2]), v3(inner_max[0], 2.57, inner_max[2]), v3(0.55, 0.6, 0.65), .emissive, .glass);
    cbx.dynamic = true;
    cbx.ao = false;
    // A full map (map.dropped) gets no lift: its boxes are not in the map.
    const floor_b = map.indexOf(fb) orelse return;
    const ceil_b = map.indexOf(cbx) orelse return;

    var l: map.Lift = .{
        // The cab floor stands 2 cm proud of the landing, so the two faces
        // do not fight in the depth buffer.
        .levels = .{ levels[0] + 0.02, levels[1] + 0.02 },
        .floor_box = floor_b,
        .ceil_box = ceil_b,
        .door_box = undefined,
        .door_closed = undefined,
        .y = levels[0] + 0.02,
        .speed = speed,
        .door_on_x = door_on_x,
    };
    const mid = (da0 + da1) / 2;
    for (levels, 0..) |ly, lv| {
        const halves = [2][2]f32{ .{ da0, mid }, .{ mid, da1 } };
        for (halves, 0..) |h, hi| {
            const p = face(door_on_x, h[0], h[1], ly, ly + 2.3, f0 + 0.02, f1 - 0.02);
            const db = map.add(p[0], p[1], steel, .metal, .sheet_metal);
            db.dynamic = true;
            db.ao = false;
            l.door_box[lv][hi] = map.indexOf(db) orelse return;
            l.door_closed[lv][hi] = .{ p[0], p[1] };
        }
    }
    const idx = map.addLift(l);

    // Call buttons on a jamb; cab buttons on a side wall inside.
    for (levels, 0..) |ly, lv| {
        const cp = face(door_on_x, a1 - 0.27, a1 - 0.13, ly + 1.05, ly + 1.2, f0 - 0.05, f0);
        map.addButton(.{ .min = cp[0], .max = cp[1], .lift = idx, .level = lv, .in_cab = false });
        const yb = 1.0 + 0.22 * @as(f32, @floatFromInt(lv));
        const bp = if (door_on_x)
            [2]V3{ v3(f1 + 0.6, yb, r.z0 + 0.1), v3(f1 + 0.75, yb + 0.12, r.z0 + 0.16) }
        else
            [2]V3{ v3(r.x0 + 0.1, yb, f1 + 0.6), v3(r.x0 + 0.16, yb + 0.12, f1 + 0.75) };
        map.addButton(.{ .min = bp[0], .max = bp[1], .lift = idx, .level = lv, .in_cab = true });
    }
}

fn lifts() void {
    // District lifts, from the spur down to each island (doors north).
    lift(lift_a, .{ 0, street_y }, false, 1.6);
    lift(lift_b, .{ 0, street_y }, false, 1.6);
    // The deep lift: the Earls Court Road concourse to the Piccadilly
    // corridor (doors west), 19.8 m, faster.
    lift(deep_lift, .{ deep_y, street_y }, true, 3.2);
}

// ---- The east end: Earls Court Road ----------------------------------------------

fn eastEnd() void {
    const y = street_y;
    const x0 = east_x[0];
    const x1 = east_x[1];
    // The concourse deck over the tracks, with the deep lift shaft cut out,
    // and the ground north of the tracks under it.
    map.carve(rect(x0, x1, conc_z0, wall_s), deck_y, y, &.{deep_lift}, deck_c, .concrete, .concrete);
    map.carve(rect(x0, x1, conc_z0 - 0.6, wall_n - 0.6), -3, deck_y, &.{deep_lift}, ballast, .concrete, .earth);
    // The concourse walls, its roof, the wall above the shed opening.
    box(v3(x0, y, conc_z0 - 0.6), v3(x1, y + 6.5, conc_z0), red_brick, .brick, .brick);
    box(v3(x0, y, wall_s), v3(x1, y + 6.5, wall_s + 0.6), red_brick, .brick, .brick);
    box(v3(x0 - 0.6, y + 6.5, conc_z0 - 0.6), v3(x1 + 0.6, y + 7.0, wall_s + 0.6), v3(0.3, 0.29, 0.27), .concrete, .concrete);
    box(v3(x0 - 0.6, y + 3.4, wall_n), v3(x0, y + 6.5, wall_s), red_brick, .brick, .brick);
    // The west wall north of the shed: the shed wall is south of the
    // concourse's north wall, so this corner opens onto nothing.
    box(v3(x0 - 0.6, y, conc_z0 - 0.6), v3(x0, y + 6.5, wall_n), red_brick, .brick, .brick);
    // The railing along the shed edge, open at the stairs; the stairs down
    // to each island, westward.
    railing(x0, x0 + 0.12, walk_z1, ca - 1.2, y);
    railing(x0, x0 + 0.12, ca + 1.2, cb - 1.2, y);
    railing(x0, x0 + 0.12, cb + 1.2, wall_s, y);
    stairs(x0, -1, ca, 2.4, y, 12, .{ y, 0 }, platform_c);
    stairs(x0, -1, cb, 2.4, y, 12, .{ y, 0 }, platform_c);
    map.add(v3(54.5, y + 6.3, -6.3), v3(56.5, y + 6.45, -5.7), v3(1.0, 0.9, 0.75), .emissive, .glass).solid = false;
    map.addLight(v3(55.5, y + 5.6, -6), v3(1.3, 1.05, 0.8), 13);

    // Ground under the hall and the street; the lines pass under it.
    const gx1 = street_e[1] + 1;
    map.carve(rect(x1, gx1, -40.6, 30.6), -3, deck_y, &.{rect(x1, gx1, wall_n - 0.6, wall_s + 0.6)}, ballast, .concrete, .earth);
    box(v3(x1, deck_y, -40.6), v3(gx1, y, 30.6), v3(0.45, 0.44, 0.42), .tile, .tile);

    // The ticket hall, then the 1915 front on Earls Court Road.
    const hz0: f32 = -12;
    const hz1: f32 = 8;
    box(v3(x1, y, conc_z0 - 0.6), v3(x1 + 0.4, y + 6.5, hz0), red_brick, .brick, .brick);
    box(v3(x1, y, hz1), v3(x1 + 0.4, y + 6.5, wall_s + 0.6), red_brick, .brick, .brick);
    box(v3(x1, y, hz0 - 0.4), v3(hall_x1, y + 5.5, hz0), cream, .paint, .plaster);
    box(v3(x1, y, hz1), v3(hall_x1, y + 5.5, hz1 + 0.4), cream, .paint, .plaster);
    box(v3(x1, y + 5.5, hz0 - 0.4), v3(hall_x1 + 0.6, y + 6, hz1 + 0.4), v3(0.75, 0.72, 0.66), .concrete, .concrete);
    const doors = [_][2]f32{ .{ -10, -7 }, .{ -3.5, -0.5 }, .{ 3, 6 } };
    var zc: f32 = hz0 - 0.4;
    for (doors) |d| {
        box(v3(hall_x1, y, zc), v3(hall_x1 + 0.6, y + 7, d[0]), red_brick, .brick, .brick);
        boxNoAo(v3(hall_x1, y + 3.8, d[0]), v3(hall_x1 + 0.6, y + 7, d[1]), red_brick, .brick, .brick);
        zc = d[1];
    }
    box(v3(hall_x1, y, zc), v3(hall_x1 + 0.6, y + 7, hz1 + 0.4), red_brick, .brick, .brick);
    deco(v3(hall_x1 + 0.6, y + 5.6, hz0), v3(hall_x1 + 0.72, y + 6.4, hz1), cream, .paint, .plaster);
    deco(v3(hall_x1 + 0.72, y + 5.85, hz0 + 0.5), v3(hall_x1 + 0.74, y + 6.15, hz1 - 0.5), blue, .paint, .sheet_metal);
    roundel(v3(hall_x1 + 0.75, y + 4.6, -2), std.math.pi / 2.0, 1.6);
    deco(v3(hall_x1 - 0.2, y + 7, hz0 - 0.8), v3(hall_x1 + 0.9, y + 7.4, hz1 + 0.8), cream * vec.s(0.9), .paint, .plaster);
    // The gate line: 8 lanes, IN on the north half (gates.zig).
    gates.addLine(71, y, hz0, hz1, -2, 8, -1);
    map.add(v3(71.5, y + 5.35, -3), v3(73.5, y + 5.5, -1), v3(1.0, 0.9, 0.75), .emissive, .glass).solid = false;
    map.addLight(v3(72.5, y + 4.8, -2), v3(1.3, 1.05, 0.8), 12);
    // Buildings either side of the hall, out to the road.
    box(v3(x1, y, -40.6), v3(street_e[0], y + 7, conc_z0 - 0.6), concrete_c, .concrete, .concrete);
    box(v3(x1 + 0.4, y, wall_s + 0.6), v3(street_e[0], y + 7, 30.6), concrete_c, .concrete, .concrete);
    box(v3(hall_x1, y, conc_z0 - 0.6), v3(street_e[0], y + 7, hz0 - 0.4), red_brick, .brick, .brick);
    box(v3(hall_x1, y, hz1 + 0.4), v3(street_e[0], y + 7, wall_s + 0.6), red_brick, .brick, .brick);

    // Earls Court Road: pavements, the road, the terrace opposite.
    const sx0 = street_e[0];
    box(v3(sx0, y, -40), v3(sx0 + 3, y + 0.12, 30), pave, .tile, .concrete);
    box(v3(sx0 + 11, y, -40), v3(sx0 + 14, y + 0.12, 30), pave, .tile, .concrete);
    deco(v3(sx0 + 3, y, -40), v3(sx0 + 11, y + 0.004, 30), v3(0.1, 0.1, 0.11), .concrete, .concrete);
    var mz: f32 = -40;
    while (mz < 30) : (mz += 4) deco(v3(sx0 + 6.9, y + 0.004, mz), v3(sx0 + 7.1, y + 0.01, mz + 2), v3(0.9, 0.9, 0.85), .paint, .concrete);
    // The terrace, with the shop front of VAPES N MORE cut out (vapeShop).
    const terrace = v3(0.84, 0.8, 0.72);
    box(v3(sx0 + 14, y, -40.6), v3(sx0 + 15, y + 13, shop_z[0]), terrace, .paint, .plaster);
    box(v3(sx0 + 14, y, shop_z[1]), v3(sx0 + 15, y + 13, 30.6), terrace, .paint, .plaster);
    box(v3(sx0 + 14, y + 3.4, shop_z[0]), v3(sx0 + 15, y + 13, shop_z[1]), terrace, .paint, .plaster);
    box(v3(sx0, y, -40.6), v3(sx0 + 14, y + 7, -40), brick, .brick, .brick);
    box(v3(sx0, y, 30), v3(sx0 + 14, y + 7, 30.6), brick, .brick, .brick);
    var wz: f32 = -38;
    while (wz < 28) : (wz += 3) {
        for (0..3) |row| {
            const wy = y + 1.2 + @as(f32, @floatFromInt(row)) * 3.6;
            const lit = rnd() < 0.45;
            const c = if (lit) v3(0.55, 0.36, 0.16) else v3(0.03, 0.035, 0.045);
            if (row == 0 and wz + 1.3 > shop_z[0] and wz < shop_z[1]) continue;
            deco(v3(sx0 + 13.94, wy, wz), v3(sx0 + 14, wy + 1.9, wz + 1.3), c, if (lit) .emissive else .paint, .glass);
        }
    }
    // The TARDIS (a police box) on the pavement north of the entrance, a
    // phone box, a bus, a black cab and a street lamp.
    const tx = sx0 + 1.4;
    const tz: f32 = -15;
    box(v3(tx - 0.62, y + 0.12, tz - 0.62), v3(tx + 0.62, y + 2.75, tz + 0.62), v3(0.03, 0.1, 0.36), .paint, .wood);
    deco(v3(tx - 0.66, y + 2.35, tz - 0.66), v3(tx + 0.66, y + 2.6, tz + 0.66), v3(0.02, 0.02, 0.025), .paint, .wood);
    deco(v3(tx - 0.5, y + 2.75, tz - 0.5), v3(tx + 0.5, y + 2.9, tz + 0.5), v3(0.03, 0.1, 0.36), .paint, .wood);
    deco(v3(tx - 0.08, y + 2.9, tz - 0.08), v3(tx + 0.08, y + 3.15, tz + 0.08), v3(0.9, 0.95, 1.0), .emissive, .glass);
    box(v3(tx - 0.45, y + 0.12, -18.5), v3(tx + 0.45, y + 2.6, -17.6), v3(0.7, 0.04, 0.03), .paint, .metal);
    const bus_red = v3(0.72, 0.05, 0.04);
    box(v3(sx0 + 3.6, y + 0.3, -8), v3(sx0 + 6.1, y + 4.4, 3), bus_red, .paint, .sheet_metal);
    for ([_]f32{ 1.4, 3.3 }) |wy| deco(v3(sx0 + 3.55, y + wy, -7.8), v3(sx0 + 6.15, y + wy + 0.9, 2.8), v3(0.04, 0.05, 0.06), .paint, .glass);
    box(v3(sx0 + 7.8, y + 0.2, 12), v3(sx0 + 9.5, y + 1.3, 16.5), v3(0.02, 0.02, 0.025), .paint, .sheet_metal);
    // The lamp head hangs from an arm over the road, clear of the post: a
    // light inside a solid shape is in its own shadow (render.zig).
    deco(v3(sx0 + 2.4, y, 19.4), v3(sx0 + 2.6, y + 5.35, 19.6), iron, .metal, .metal);
    deco(v3(sx0 + 2.6, y + 5.25, 19.45), v3(sx0 + 3.6, y + 5.35, 19.55), iron, .metal, .metal);
    map.addSolid(v3(sx0 + 2.4, y, 19.4), v3(sx0 + 2.6, y + 5.2, 19.6), .metal);
    map.add(v3(sx0 + 3.2, y + 5.1, 19.2), v3(sx0 + 3.8, y + 5.25, 19.8), v3(1.0, 0.7, 0.35), .emissive, .glass).solid = false;
    map.addLight(v3(sx0 + 3.5, y + 4.75, 19.5), v3(1.6, 1.0, 0.45), 14);
}

// ---- VAPES N MORE, on Earls Court Road ----------------------------------------

/// The pixels of each letter of the sign, 5 rows from the top. A space is
/// an empty glyph.
fn glyph(c: u8) [5][]const u8 {
    return switch (c) {
        'V' => .{ "10001", "10001", "10001", "01010", "00100" },
        'A' => .{ "01110", "10001", "11111", "10001", "10001" },
        'P' => .{ "11110", "10001", "11110", "10000", "10000" },
        'E' => .{ "11111", "10000", "11110", "10000", "11111" },
        'S' => .{ "01111", "10000", "01110", "00001", "11110" },
        'N' => .{ "10001", "11001", "10101", "10011", "10001" },
        'M' => .{ "10001", "11011", "10101", "10001", "10001" },
        'O' => .{ "01110", "10001", "10001", "10001", "01110" },
        'R' => .{ "11110", "10001", "11110", "10100", "10010" },
        else => .{ "00", "00", "00", "00", "00" },
    };
}

/// A shop in the terrace opposite the station. The player walks in through
/// the door in the south end of the front. The window is a collision box
/// only, so the bright inside shows from the street. The vapes on the
/// counter are the use items of vapes.zig.
fn vapeShop() void {
    const y = street_y;
    const fx = street_e[1]; // the front, the street face of the terrace
    const bx = fx + 7; // the back wall
    const z0 = shop_z[0];
    const z1 = shop_z[1];
    const door = [2]f32{ -31.6, -30.2 };
    const fl = y + 0.12; // the floor, at the height of the pavement
    const white = v3(0.9, 0.9, 0.93);
    const chrome = v3(0.12, 0.12, 0.14);
    const black = v3(0.02, 0.02, 0.025);
    const neon = [_]V3{
        v3(0.2, 1.0, 0.3), v3(1.0, 0.1, 0.8), v3(0.1, 0.9, 1.0), v3(1.0, 0.95, 0.1),
        v3(0.6, 0.2, 1.0), v3(1.0, 0.4, 0.1), v3(1.0, 0.2, 0.3), v3(0.3, 0.5, 1.0),
    };

    // The shell: the floor, the walls and the ceiling.
    box(v3(fx, y, z0), v3(bx, fl, z1), v3(0.85, 0.85, 0.88), .tile, .tile);
    box(v3(fx + 1, y, z0 - 0.3), v3(bx + 0.3, y + 3.4, z0), white, .paint, .plaster);
    box(v3(fx + 1, y, z1), v3(bx + 0.3, y + 3.4, z1 + 0.3), white, .paint, .plaster);
    box(v3(bx, y, z0), v3(bx + 0.3, y + 3.4, z1), white, .paint, .plaster);
    box(v3(fx + 1, y + 3.4, z0 - 0.3), v3(bx + 0.3, y + 3.7, z1 + 0.3), white, .paint, .plaster);
    // The front: the stall riser, the window, the pier south of the door,
    // and the fascia over all of it.
    box(v3(fx, y, z0), v3(fx + 0.15, y + 0.5, door[0]), chrome, .metal, .sheet_metal);
    map.addSolid(v3(fx, y + 0.5, z0), v3(fx + 0.15, y + 2.6, door[0]), .glass);
    box(v3(fx, y, door[1]), v3(fx + 0.15, y + 2.6, z1), chrome, .metal, .sheet_metal);
    box(v3(fx - 0.15, y + 2.6, z0), v3(fx + 0.15, y + 3.4, z1), black, .paint, .sheet_metal);
    // The window frame, a mullion, and the stickers on the glass.
    deco(v3(fx + 0.04, y + 2.52, z0), v3(fx + 0.11, y + 2.6, door[0]), chrome, .metal, .metal);
    deco(v3(fx + 0.04, y + 0.5, -34.35), v3(fx + 0.11, y + 2.6, -34.25), chrome, .metal, .metal);
    for ([_]V3{ v3(-36.4, 1.9, 0), v3(-33.6, 1.6, 3), v3(-32.6, 0.8, 1), v3(-35.2, 0.7, 6) }) |st| {
        const c = neon[@intFromFloat(st[2])];
        deco(v3(fx + 0.06, y + st[1], st[0]), v3(fx + 0.09, y + st[1] + 0.5, st[0] + 0.6), c, .paint, .glass);
    }
    for ([_]f32{ door[0] - 0.08, door[1] }) |dz| deco(v3(fx - 0.02, y, dz), v3(fx + 0.17, y + 2.6, dz + 0.08), chrome, .metal, .metal);

    // The sign: VAPES N MORE in pixel letters on the fascia, facing the
    // street. Facing +x, the text reads toward +z.
    const sign = "VAPES N MORE";
    const px: f32 = 0.1;
    var width: f32 = 0;
    for (sign) |ch| width += @as(f32, @floatFromInt(glyph(ch)[0].len + 1)) * px;
    var gz = (z0 + z1 - width + px) / 2;
    const top = y + 3.25;
    for (sign, 0..) |ch, i| {
        const g = glyph(ch);
        const c = if (i < 5) neon[0] else if (i < 7) neon[3] else neon[1];
        for (g, 0..) |row, r| {
            // One decoration for each run of lit pixels in the row.
            var k: usize = 0;
            while (k < row.len) {
                if (row[k] != '1') {
                    k += 1;
                    continue;
                }
                var e = k;
                while (e < row.len and row[e] == '1') e += 1;
                const ry = top - @as(f32, @floatFromInt(r + 1)) * px;
                const za = gz + @as(f32, @floatFromInt(k)) * px;
                deco(v3(fx - 0.19, ry, za), v3(fx - 0.15, ry + px, za + @as(f32, @floatFromInt(e - k)) * px), c, .emissive, .glass);
                k = e;
            }
        }
        gz += @as(f32, @floatFromInt(g[0].len + 1)) * px;
    }
    // A neon strip under the fascia, the length of the front.
    deco(v3(fx - 0.19, y + 2.6, z0 + 0.1), v3(fx - 0.15, y + 2.66, z1 - 0.1), neon[2], .emissive, .glass);

    // Inside: very bright ceiling panels, neon strips at the top of the
    // walls, and two cold lights.
    var cx: f32 = fx + 1.4;
    while (cx < bx - 0.8) : (cx += 1.5) {
        for ([_]f32{ -35.5, -31.7 }) |cz| deco(v3(cx, y + 3.36, cz), v3(cx + 1.0, y + 3.4, cz + 1.2), v3(1.0, 1.0, 1.0), .emissive, .glass);
    }
    deco(v3(fx + 1, y + 3.2, z0), v3(bx, y + 3.26, z0 + 0.04), neon[1], .emissive, .glass);
    deco(v3(fx + 1, y + 3.2, z1 - 0.04), v3(bx, y + 3.26, z1), neon[2], .emissive, .glass);
    deco(v3(bx - 0.04, y + 3.2, z0), v3(bx, y + 3.26, z1), neon[4], .emissive, .glass);
    map.addLight(v3(fx + 2.2, y + 2.9, -33), v3(1.2, 1.5, 2.2), 9);
    map.addLight(v3(bx - 1.6, y + 2.9, -33), v3(1.8, 0.5, 1.9), 8);

    // The wall displays: the back wall and the north wall, each a block
    // with backlit shelf edges and rows of colourful boxes on its face.
    box(v3(bx - 0.4, y, z0 + 0.4), v3(bx, y + 2.5, z1 - 0.4), black, .paint, .wood);
    box(v3(fx + 1.6, y, z0), v3(bx - 0.6, y + 2.3, z0 + 0.4), black, .paint, .wood);
    for ([_]f32{ 0.45, 0.95, 1.45, 1.95 }) |sh| {
        const sy = y + sh;
        deco(v3(bx - 0.46, sy - 0.03, z0 + 0.4), v3(bx - 0.4, sy, z1 - 0.4), neon[2], .emissive, .glass);
        deco(v3(fx + 1.6, sy - 0.03, z0 + 0.4), v3(bx - 0.6, sy, z0 + 0.46), neon[1], .emissive, .glass);
        var pz: f32 = z0 + 0.5;
        while (pz < z1 - 0.6) : (pz += 0.16) {
            const c = neon[@intFromFloat(rnd() * 7.99)];
            deco(v3(bx - 0.45, sy, pz), v3(bx - 0.4, sy + 0.16 + rnd() * 0.14, pz + 0.11), c, .paint, .fabric);
        }
        var qx: f32 = fx + 1.7;
        while (qx < bx - 0.75) : (qx += 0.16) {
            const c = neon[@intFromFloat(rnd() * 7.99)];
            deco(v3(qx, sy, z0 + 0.4), v3(qx + 0.11, sy + 0.16 + rnd() * 0.14, z0 + 0.45), c, .paint, .fabric);
        }
    }
    // A lightbox advert over the counter: a cloud of pink vapour.
    deco(v3(bx - 0.06, y + 2.6, -34.6), v3(bx, y + 3.1, -32.2), neon[1], .emissive, .glass);

    // The counter, with a lit front and the vapes in a row on top.
    const cx0: f32 = fx + 4;
    box(v3(cx0, y, -35.4), v3(cx0 + 0.6, y + 1.0, -31.8), white, .paint, .wood);
    deco(v3(cx0 - 0.02, y + 0.15, -35.3), v3(cx0, y + 0.85, -31.9), neon[0], .emissive, .glass);
    deco(v3(cx0 + 0.02, y + 1.0, -35.2), v3(cx0 + 0.2, y + 1.01, -32.0), black, .paint, .metal);
    vapes.clear();
    var vz: f32 = -35.0;
    var vi: usize = 0;
    while (vz < -32.1) : (vz += 0.28) {
        const base = v3(cx0 + 0.1, y + 1.01, vz);
        const h = vapes.half;
        const c = neon[vi % neon.len];
        deco(base - v3(h[0], 0, h[2]), base + v3(h[0], 2 * h[1] - 0.02, h[2]), c, .paint, .metal);
        deco(base + v3(-h[0] * 0.6, 2 * h[1] - 0.02, -h[2] * 0.5), base + v3(h[0] * 0.6, 2 * h[1], h[2] * 0.5), black, .paint, .metal);
        vapes.add(base);
        vi += 1;
    }
}

// ---- The west end: Warwick Road -----------------------------------------------

fn westEnd() void {
    const y = street_y;
    const x0 = west_x[0];
    const x1 = west_x[1];
    map.carve(rect(x0, x1, conc_z0, wall_s), deck_y, y, &.{}, deck_c, .concrete, .concrete);
    box(v3(x0, -3, conc_z0 - 0.6), v3(x1, deck_y, wall_n - 0.6), ballast, .concrete, .earth);
    box(v3(x0, y, conc_z0 - 0.6), v3(x1, y + 6.5, conc_z0), brick, .brick, .brick);
    box(v3(x0, y, wall_s), v3(x1, y + 6.5, wall_s + 0.6), brick, .brick, .brick);
    box(v3(x0 - 0.6, y + 6.5, conc_z0 - 0.6), v3(x1 + 0.6, y + 7.0, wall_s + 0.6), v3(0.3, 0.29, 0.27), .concrete, .concrete);
    box(v3(x1, y + 3.4, wall_n), v3(x1 + 0.6, y + 6.5, wall_s), brick, .brick, .brick);
    box(v3(x1, y, conc_z0 - 0.6), v3(x1 + 0.6, y + 6.5, wall_n), brick, .brick, .brick);
    railing(x1 - 0.12, x1, walk_z1, ca - 1.2, y);
    railing(x1 - 0.12, x1, ca + 1.2, cb - 1.2, y);
    railing(x1 - 0.12, x1, cb + 1.2, wall_s, y);
    stairs(x1, 1, ca, 2.4, y, 12, .{ y, 0 }, platform_c);
    stairs(x1, 1, cb, 2.4, y, 12, .{ y, 0 }, platform_c);
    map.add(v3(-56.5, y + 6.3, -6.3), v3(-54.5, y + 6.45, -5.7), v3(1.0, 0.9, 0.75), .emissive, .glass).solid = false;

    // Ground under the passage, the entrance and the road; the lines pass
    // under it in a covered way.
    const gx0 = street_w[0] - 1;
    map.carve(rect(gx0, x0, -30.6, 25.6), -3, deck_y, &.{rect(gx0, x0, wall_n - 0.6, wall_s + 0.6)}, ballast, .concrete, .earth);
    box(v3(gx0, deck_y, -30.6), v3(x0, y, 25.6), v3(0.45, 0.44, 0.42), .tile, .tile);

    // The Warwick Road passage, west to the 1937 entrance.
    const pz0: f32 = -6;
    const pz1: f32 = 2;
    box(v3(x0 - 0.4, y, conc_z0 - 0.6), v3(x0, y + 6.5, pz0), brick, .brick, .brick);
    box(v3(x0 - 0.4, y, pz1), v3(x0, y + 6.5, wall_s + 0.6), brick, .brick, .brick);
    box(v3(-78, y, pz0 - 0.4), v3(x0 - 0.4, y + 3.6, pz0), tile_c, .wall_tile, .tile);
    box(v3(-78, y, pz1), v3(x0 - 0.4, y + 3.6, pz1 + 0.4), tile_c, .wall_tile, .tile);
    box(v3(-78, y + 3.6, pz0 - 0.4), v3(x0 - 0.4, y + 4.0, pz1 + 0.4), v3(0.7, 0.68, 0.62), .concrete, .concrete);
    deco(v3(-78, y + 1.2, pz0), v3(x0 - 0.4, y + 1.4, pz0 + 0.02), tile_green, .wall_tile, .tile);
    deco(v3(-78, y + 1.2, pz1 - 0.02), v3(x0 - 0.4, y + 1.4, pz1), tile_green, .wall_tile, .tile);
    map.add(v3(-72.5, y + 3.45, -2.3), v3(-70.5, y + 3.6, -1.7), v3(1.0, 0.9, 0.75), .emissive, .glass).solid = false;
    map.addLight(v3(-71.5, y + 3.0, -2), v3(1.2, 1.0, 0.75), 11);
    // The gate line of the passage: 4 lanes, IN on the south half.
    gates.addLine(-74, y, pz0, pz1, -2, 4, 1);
    // Solid blocks beside the passage.
    box(v3(-78, y, conc_z0 - 0.6), v3(x0 - 0.4, y + 7, pz0 - 0.4), concrete_c, .concrete, .concrete);
    box(v3(-78, y, pz1 + 0.4), v3(x0 - 0.4, y + 7, wall_s + 0.6), concrete_c, .concrete, .concrete);
    // The entrance hall: brick piers, a tall glass front, the rotunda on top.
    const ex = warwick_x0;
    box(v3(ex, y, -14), v3(-78, y + 6.5, pz0 - 0.4), brick, .brick, .brick);
    box(v3(ex, y, pz1 + 0.4), v3(-78, y + 6.5, 10), brick, .brick, .brick);
    box(v3(ex, y + 6.5, -14), v3(-78, y + 7.0, 10), v3(0.3, 0.29, 0.27), .concrete, .concrete);
    box(v3(ex, y + 3.8, pz0 - 0.4), v3(ex + 0.3, y + 6.5, pz1 + 0.4), v3(0.3, 0.42, 0.5), .metal, .glass);
    deco(v3(ex - 0.1, y + 6.0, -14), v3(ex, y + 6.5, 10), cream, .paint, .plaster);
    roundel(v3(ex - 0.12, y + 5.0, -2), -std.math.pi / 2.0, 1.4);
    const rot = vec.translate(v3(-81, y + 8.5, -2)).mul(Mat4.rotationX(std.math.pi / 2.0));
    var k: usize = 0;
    while (k < 6) : (k += 1) {
        const fk: f32 = @floatFromInt(k);
        map.addDisc(rot.mul(vec.translate(v3(0, 0, -fk * 0.5 + 1.5))), 3.6 - fk * 0.05, 0.42, v3(0.25, 0.38, 0.45), .metal, .glass);
    }
    map.addDisc(rot.mul(vec.translate(v3(0, 0, -1.7))), 3.8, 0.2, v3(0.15, 0.15, 0.17), .metal, .metal);
    box(v3(ex, y, -30.6), v3(-78, y + 7, -14), concrete_c, .concrete, .concrete);
    box(v3(ex, y, 10), v3(-78, y + 7, 25.6), concrete_c, .concrete, .concrete);
    // Warwick Road.
    box(v3(street_w[1] - 3, y, -30), v3(street_w[1], y + 0.12, 25), pave, .tile, .concrete);
    deco(v3(street_w[0], y, -30), v3(street_w[1] - 3, y + 0.004, 25), v3(0.1, 0.1, 0.11), .concrete, .concrete);
    box(v3(street_w[0] - 1, y, -30.6), v3(street_w[0], y + 13, 25.6), v3(0.78, 0.74, 0.66), .paint, .plaster);
    box(v3(street_w[0], y, -30.6), v3(ex, y + 7, -30), brick, .brick, .brick);
    box(v3(street_w[0], y, 25), v3(ex, y + 7, 25.6), brick, .brick, .brick);
}

// ---- The lines out of the station ----------------------------------------------

fn lines() void {
    // The ground and the side walls of the line, the whole length. Covered
    // ways run under both ends; past them, the cuttings are open.
    box(v3(shed_x1, -3, wall_n), v3(line_end, bed_y, wall_s), ballast, .concrete, .ballast);
    box(v3(-line_end, -3, wall_n), v3(shed_x0, bed_y, wall_s), ballast, .concrete, .ballast);
    box(v3(-line_end, -3, wall_n - 0.6), v3(line_end, deck_y, wall_n), brick, .brick, .brick);
    box(v3(-line_end, -3, wall_s), v3(line_end, deck_y, wall_s + 0.6), brick, .brick, .brick);
    for ([_][2]f32{ .{ street_e[1] + 1, line_end }, .{ -line_end, street_w[0] - 1 } }) |r| {
        box(v3(r[0], deck_y, wall_n - 0.6), v3(r[1], street_y + 0.6, wall_n), brick, .brick, .brick);
        box(v3(r[0], deck_y, wall_s), v3(r[1], street_y + 0.6, wall_s + 0.6), brick, .brick, .brick);
        box(v3(r[0], 3.0, wall_n - 30), v3(r[1], street_y, wall_n - 0.6), v3(0.3, 0.32, 0.22), .concrete, .earth);
        box(v3(r[0], 3.0, wall_s + 0.6), v3(r[1], street_y, wall_s + 30), v3(0.3, 0.32, 0.22), .concrete, .earth);
    }
    box(v3(-line_end, -3, wall_n), v3(-line_end + 0.6, street_y + 3, wall_s), dark, .paint, .concrete);
    box(v3(line_end - 0.6, -3, wall_n), v3(line_end, street_y + 3, wall_s), dark, .paint, .concrete);
    // The rails, the sleepers and the live rails (the 4th rail between the
    // running rails, the 3rd outside).
    for (track_c) |t| {
        const c = t.c;
        for ([_]f32{ -0.72, 0.72 }) |off| {
            boxNoAo(v3(-line_end, bed_y, c + off - 0.04), v3(line_end, bed_y + 0.16, c + off + 0.04), steel, .metal, .metal);
        }
        deco(v3(-line_end, bed_y, c - 0.05), v3(line_end, bed_y + 0.12, c + 0.05), v3(0.5, 0.45, 0.4), .metal, .metal);
        const r3 = c + t.away * 1.2;
        deco(v3(-line_end, bed_y, r3 - 0.05), v3(line_end, bed_y + 0.12, r3 + 0.05), v3(0.5, 0.45, 0.4), .metal, .metal);
        var x: f32 = -line_end + 0.4;
        while (x < line_end) : (x += if (@abs(x) > 90) 2.7 else 0.9) {
            deco(v3(x, bed_y, c - 1.25), v3(x + 0.26, bed_y + 0.07, c + 1.25), v3(0.16, 0.11, 0.08), .wood, .wood);
        }
        // Buffer-free ends: a dark wall at each end of the world.
    }
    // A lamp now and then in the covered ways.
    var lx: f32 = east_x[1] + 10;
    while (lx < line_end) : (lx += 30) {
        deco(v3(lx, 3.0, wall_n), v3(lx + 0.6, 3.15, wall_n + 0.15), v3(0.9, 0.7, 0.4), .emissive, .glass);
        deco(v3(-lx - 0.6, 3.0, wall_n), v3(-lx, 3.15, wall_n + 0.15), v3(0.9, 0.7, 0.4), .emissive, .glass);
    }
    // Danger boards where the live rail starts to kill.
    // Each board is at the side of its bed away from the platform.
    for ([_]f32{ -shock_x, shock_x }) |sx| {
        for (track_c) |t| {
            const z0 = if (t.away > 0) t.bed[1] - 1.3 else t.bed[0] + 0.1;
            deco(v3(sx - 0.05, 0.4, z0), v3(sx + 0.05, 1.6, z0 + 1.2), yellow, .paint, .sheet_metal);
            map.addSolid(v3(sx - 0.1, bed_y, z0), v3(sx + 0.1, 1.6, z0 + 1.2), .sheet_metal);
            deco(v3(sx - 0.06, 0.7, z0 + 0.2), v3(sx + 0.06, 1.3, z0 + 1.0), v3(0.02, 0.02, 0.02), .paint, .sheet_metal);
        }
    }
}

// ---- The District train in the shed --------------------------------------------

/// The sink of train_car.parts for a parked train: static boxes. The doors
/// stay open, so a doorway is no part. The floor, the roof and the far wall
/// count for the ambient occlusion.
const ParkedParts = struct {
    n: usize = 0,
    pub fn part(self: *ParkedParts, min: V3, max: V3, kind: train_car.Kind, color: V3, mat: Mat, surface: Surface) void {
        if (kind == .doorway) return;
        const b = map.add(min, max, color, mat, surface);
        b.ao = self.n < 2 or self.n == 4;
        self.n += 1;
    }
};

/// The sink of train_car.details for a parked train: decoration.
const ParkedDetails = struct {
    pub fn box(_: ParkedDetails, min: V3, max: V3, color: V3, mat: Mat, surface: Surface) void {
        deco(min, max, color, mat, surface);
    }
};

/// A 7-car S7 Stock train at island A, its doors open (train_car.zig). Its
/// centre is at x = 0, so its train coordinates are world coordinates.
fn districtTrain() void {
    const b = train_car.body(&train_car.stock_s7, track_c[1].c, bed_y + 0.16, 0.02, -1);
    var p: ParkedParts = .{};
    train_car.parts(&b, &p);
    train_car.details(&b, ParkedDetails{}, 1);
    // The bogies.
    var ends: [9]f32 = undefined;
    for (b.carEnds(&ends)[0..train_car.stock_s7.cars.len]) |ex| {
        for ([_]f32{ 2.2, 12.5 }) |dx| deco(v3(ex + dx, bed_y, b.z0 + 0.3), v3(ex + dx + 2.4, b.y0, b.z1 - 0.3), v3(0.05, 0.05, 0.05), .metal, .metal);
    }
    map.parked_train = b;
}

// ---- The intermediate level ------------------------------------------------------

fn intermediateLevel() void {
    // Passages: north (under island A), the two south pieces (under island
    // B, with the stair wells), the west and east sides, and the way north
    // from the west side to the escalators.
    const pa0 = ca - 1.8;
    const pa1 = ca + 1.8;
    const pb0 = cb - 1.8;
    const pb1 = cb + 1.8;
    const holes = [_]Rect{
        rect(-34, 34, pa0, pa1),
        rect(-34, -22, pb0, pb1),
        rect(22, 34, pb0, pb1),
        rect(-34, -30, esc_z[0], pb1),
        rect(30, 34, pa0, pb1),
        rect(esc_top_x, -16, esc_z[0], esc_z[1]),
    };
    const area = rect(-36, 36, -26, 9);
    map.carve(area, mid_y - 1, mid_y, &.{rect(esc_top_x, -12, esc_z[0], esc_z[1])}, v3(0.3, 0.29, 0.27), .concrete, .concrete);
    map.carve(area, mid_y, mid_ceil, &holes, tile_c, .wall_tile, .tile);
    // The ceiling, open over the four stair wells.
    var wells: [4]Rect = undefined;
    var nw: usize = 0;
    for ([_]f32{ ca, cb }) |cz| {
        for (well_x) |wx| {
            wells[nw] = rect(wx[0], wx[1], cz - 1.2, cz + 1.2);
            nw += 1;
        }
    }
    map.carve(area, mid_ceil, -3, &wells, v3(0.12, 0.11, 0.1), .concrete, .concrete);

    // Stairs from the island wells down to this level: one west and one
    // east on each island. On island B they lead in opposite directions,
    // with no passage between them.
    for ([_]f32{ ca, cb }) |cz| {
        stairs(well_x[0][1], -1, cz, 2.4, -0.4, 14, .{ 0, mid_y }, platform_c);
        stairs(well_x[1][0], 1, cz, 2.4, -0.4, 14, .{ 0, mid_y }, platform_c);
    }
    for ([_][2]f32{ .{ pa0, pa0 + 0.02 }, .{ pa1 - 0.02, pa1 } }) |zz| {
        deco(v3(-22, mid_y + 1.3, zz[0]), v3(22, mid_y + 1.5, zz[1]), tile_green, .wall_tile, .tile);
    }
    for ([_]f32{ -14, 12 }) |x| {
        map.add(v3(x - 1.1, mid_ceil - 0.08, ca - 0.1), v3(x + 1.1, mid_ceil, ca + 0.1), cool, .emissive, .glass).solid = false;
        map.addLight(v3(x, mid_ceil - 0.3, ca), cool * vec.s(1.4), 12);
    }
    map.add(v3(-32.1, mid_ceil - 0.08, -6.1), v3(-31.9, mid_ceil, -3.9), cool, .emissive, .glass).solid = false;
    map.addLight(v3(-32, mid_ceil - 0.3, -5), cool * vec.s(1.4), 11);
    roundel(v3(0, mid_y + 1.5, pa0 + 0.05), 0, 1.0);
}

// ---- Escalators ---------------------------------------------------------------

fn escalators() void {
    const z0 = esc_z[0];
    const z1 = esc_z[1];
    const zd = [2]f32{ -22.7, -22.3 }; // the divider between the lanes
    for (0..esc_steps) |i| {
        const fi: f32 = @floatFromInt(i);
        const xa = esc_top_x + esc_run * fi;
        const top = mid_y - esc_rise * (fi + 1);
        boxNoAo(v3(xa, deep_y - 1, z0), v3(xa + esc_run, top, z1), v3(0.16, 0.16, 0.17), .metal, .metal);
    }
    box(v3(esc_top_x, deep_y - 1, z0 - 0.3), v3(esc_bottom_x, mid_ceil, z0), tile_c, .wall_tile, .tile);
    box(v3(esc_top_x, deep_y - 1, z1), v3(esc_bottom_x, mid_ceil, z1 + 0.3), tile_c, .wall_tile, .tile);
    const slope = vec.norm(v3(esc_bottom_x - esc_top_x, deep_y - mid_y, 0));
    const up = vec.norm(vec.cross(v3(0, 0, 1), slope));
    const top_c = v3(esc_top_x, mid_y + 4.0, (z0 + z1) / 2);
    const bot_c = v3(esc_bottom_x, deep_y + 4.0, (z0 + z1) / 2);
    map.beam(top_c, bot_c, 3.6, 0.25, up, v3(0.75, 0.72, 0.62), .wall_tile, .tile);
    for ([_]f32{ z0 + 0.1, (zd[0] + zd[1]) / 2, z1 - 0.1 }) |z| {
        const w: f32 = if (z > zd[0] and z < zd[1]) 0.4 else 0.2;
        map.beam(v3(esc_top_x, mid_y + 0.55, z), v3(esc_bottom_x, deep_y + 0.55, z), w, 1.0, up, v3(0.33, 0.27, 0.2), .wood, .wood);
    }
    // The divider and the side balustrades stop the player too: coarse
    // boxes along the slope.
    for ([_][2]f32{ zd, .{ z0, z0 + 0.2 }, .{ z1 - 0.2, z1 } }) |zz| {
        var k: usize = 0;
        while (k < esc_steps) : (k += 3) {
            const fa: f32 = @floatFromInt(k);
            const fb: f32 = @floatFromInt(@min(k + 3, esc_steps));
            map.addSolid(
                v3(esc_top_x + esc_run * fa, mid_y - esc_rise * fb, zz[0]),
                v3(esc_top_x + esc_run * fb, mid_y - esc_rise * fa + 1.05, zz[1]),
                .wood,
            );
        }
    }
    for (0..6) |i| {
        const t = (@as(f32, @floatFromInt(i)) + 0.5) / 6;
        const p = vec.lerp(v3(esc_top_x, mid_y + 1.05, -22.5), v3(esc_bottom_x, deep_y + 1.05, -22.5), t);
        deco(p - v3(0.12, 0, 0.12), p + v3(0.12, 0.45, 0.12), v3(1.0, 0.8, 0.5), .emissive, .glass);
    }
    for (0..4) |i| {
        const t = (@as(f32, @floatFromInt(i)) + 0.5) / 4;
        const p = vec.lerp(top_c, bot_c, t) - up * vec.s(0.15);
        map.beam(p - slope * vec.s(0.8), p + slope * vec.s(0.8), 0.25, 0.06, up, cool, .emissive, .glass);
    }
    map.addLight(v3((esc_top_x + esc_bottom_x) / 2, (mid_y + deep_y) / 2 + 3, -22.5), v3(1.1, 0.85, 0.6), 12);

    // The ramp over both lanes, through the front edges of the steps
    // (map.Ramp): a rider moves smoothly.
    map.addRamp(.{ .x0 = esc_top_x, .x1 = esc_bottom_x, .z0 = z0, .z1 = z1, .y0 = mid_y, .y1 = deep_y, .bottom = deep_y - 1 });
    // The lanes: the north lane goes down (east), the south lane comes up.
    // Each lane carries a rider until the feet are clear of the ramp: the
    // down lane 0.4 m (more than the player radius) past its last step.
    map.addEscalator(.{ .min = v3(esc_top_x, deep_y - 0.5, z0), .max = v3(esc_bottom_x + 0.4, mid_y + 0.5, zd[0]), .vel = v3(0.65, 0, 0) });
    map.addEscalator(.{ .min = v3(esc_top_x, deep_y - 0.5, zd[1]), .max = v3(esc_bottom_x, mid_y + 0.5, z1), .vel = v3(-0.65, 0, 0) });
}

// ---- The deep level: the Piccadilly line ---------------------------------------------

fn deepLevel() void {
    const y = deep_y;
    const floor_c = v3(0.3, 0.29, 0.27);
    const x0 = esc_bottom_x;
    const arches = [_]f32{ 6, 18, 30, 42, 54 };

    // The floor under the corridor and the platforms.
    box(v3(x0, y - 1, corr_z[0]), v3(deep_lift.x1, y, corr_z[1]), floor_c, .concrete, .concrete);
    for ([_][2]f32{ p5, p6 }) |p| box(v3(plat_x[0], y - 1, p[0]), v3(plat_x[1], y, p[1]), floor_c, .concrete, .concrete);
    // The walls between the corridor and the platforms, with arches. West
    // of the platforms they are the corridor walls; the lift closes the east
    // end.
    for ([_][2]f32{ .{ p5[1], corr_z[0] }, .{ corr_z[1], p6[0] } }) |wz| {
        var xa = x0;
        for (arches) |ax| {
            box(v3(xa, y, wz[0]), v3(ax - 1.5, deep_ceil, wz[1]), tile_c, .wall_tile, .tile);
            boxNoAo(v3(ax - 1.5, y + 2.5, wz[0]), v3(ax + 1.5, deep_ceil, wz[1]), tile_c, .wall_tile, .tile);
            xa = ax + 1.5;
        }
        box(v3(xa, y, wz[0]), v3(deep_lift.x1, deep_ceil, wz[1]), tile_c, .wall_tile, .tile);
    }
    box(v3(deep_lift.x0, y, deep_lift.z1), v3(deep_lift.x1, deep_ceil, corr_z[1]), tile_c, .wall_tile, .tile);
    // East of the lift the island is solid between the two platforms.
    box(v3(deep_lift.x1, y - 1, p5[1]), v3(plat_x[1], deep_ceil, p6[0]), tile_c, .wall_tile, .tile);
    // Platforms 5 and 6: the yellow edges, the track beds and rails the
    // whole length, the walls across the tracks, the ends, the ceiling.
    deco(v3(plat_x[0], y, p5[0]), v3(plat_x[1], y + 0.012, p5[0] + 0.45), yellow, .paint, .concrete);
    deco(v3(plat_x[0], y, p6[1] - 0.45), v3(plat_x[1], y + 0.012, p6[1]), yellow, .paint, .concrete);
    for ([_][2]f32{ t5, t6 }, [_]f32{ t5_c, t6_c }) |t, c| {
        box(v3(-line_end, y - 1.2, t[0]), v3(line_end, y - 0.85, t[1]), ballast * vec.s(0.7), .concrete, .ballast);
        for ([_]f32{ -0.72, 0.72 }) |off| {
            boxNoAo(v3(-line_end, y - 0.85, c + off - 0.04), v3(line_end, y - 0.69, c + off + 0.04), steel, .metal, .metal);
        }
        deco(v3(-line_end, y - 0.85, c - 0.05), v3(line_end, y - 0.73, c + 0.05), v3(0.5, 0.45, 0.4), .metal, .metal);
        var sx: f32 = -line_end;
        const mid = (plat_x[0] + plat_x[1]) / 2;
        while (sx < line_end) : (sx += if (@abs(sx - mid) > 90) 2.7 else 0.9) {
            deco(v3(sx, y - 0.85, t[0] + 0.25), v3(sx + 0.26, y - 0.79, t[1] - 0.25), v3(0.1, 0.08, 0.06), .wood, .wood);
        }
    }
    box(v3(-line_end, y - 1.2, t5[0] - 0.4), v3(line_end, deep_ceil, t5[0]), tile_c, .wall_tile, .tile);
    box(v3(-line_end, y - 1.2, t6[1]), v3(line_end, deep_ceil, t6[1] + 0.4), tile_c, .wall_tile, .tile);
    box(v3(-line_end, y - 1.2, t5[1]), v3(plat_x[0], deep_ceil, t5[1] + 0.3), concrete_c, .concrete, .concrete);
    box(v3(plat_x[1], y - 1.2, t5[1]), v3(line_end, deep_ceil, t5[1] + 0.3), concrete_c, .concrete, .concrete);
    box(v3(-line_end, y - 1.2, t6[0] - 0.3), v3(plat_x[0], deep_ceil, t6[0]), concrete_c, .concrete, .concrete);
    box(v3(plat_x[1], y - 1.2, t6[0] - 0.3), v3(line_end, deep_ceil, t6[0]), concrete_c, .concrete, .concrete);
    for ([_]f32{ plat_x[0] - 0.3, plat_x[1] }) |xa| {
        for ([_][2]f32{ .{ t5[1] + 0.3, p5[1] }, .{ p6[0], t6[0] - 0.3 } }) |p| box(v3(xa, y, p[0]), v3(xa + 0.3, deep_ceil, p[1]), tile_c, .wall_tile, .tile);
    }
    // The ceiling, with the escalator shaft and the deep lift shaft cut out
    // (their riders need head room), and the dark ends of the world. A
    // slab across the lift shaft catches a rider on the way down: the step
    // up puts the feet on it, and the cab goes on without the player. The
    // floorplan audit checks each shaft.
    map.carve(rect(-line_end, line_end, t5[0] - 0.4, t6[1] + 0.4), deep_ceil, deep_ceil + 0.6, &.{ rect(esc_top_x, esc_bottom_x, esc_z[0] - 0.3, esc_z[1] + 0.3), deep_lift }, v3(0.12, 0.11, 0.1), .concrete, .concrete);
    box(v3(-line_end, y - 1.2, t5[0] - 0.4), v3(-line_end + 0.4, deep_ceil, t6[1] + 0.4), dark, .paint, .concrete);
    box(v3(line_end - 0.4, y - 1.2, t5[0] - 0.4), v3(line_end, deep_ceil, t6[1] + 0.4), dark, .paint, .concrete);

    // Tile bands, roundels and posters on the walls across the tracks.
    for ([_]f32{ t5[0], t6[1] - 0.03 }) |wz| {
        deco(v3(plat_x[0], y + 2.3, wz), v3(plat_x[1], y + 2.7, wz + 0.03), v3(0.05, 0.13, 0.4), .wall_tile, .tile);
        deco(v3(plat_x[0], y + 1.15, wz), v3(plat_x[1], y + 1.25, wz + 0.03), v3(0.38, 0.05, 0.06), .wall_tile, .tile);
    }
    for ([_]f32{ 12, 30, 48, 70, 88, 106 }) |rx| {
        roundel(v3(rx, y + 1.6, t5[0] + 0.05), 0, 1.4);
        roundel(v3(rx, y + 1.6, t6[1] - 0.05), std.math.pi, 1.4);
    }
    const poster_cols = [_]V3{ v3(0.8, 0.35, 0.1), v3(0.1, 0.4, 0.55), v3(0.85, 0.75, 0.2), v3(0.45, 0.1, 0.35), v3(0.15, 0.5, 0.25), v3(0.9, 0.9, 0.85) };
    for ([_]f32{ 4, 21, 39, 56, 79, 97 }, 0..) |px, i| {
        deco(v3(px - 2, y + 0.4, t5[0]), v3(px + 2, y + 3.2, t5[0] + 0.04), v3(0.08, 0.08, 0.08), .paint, .wood);
        deco(v3(px - 1.85, y + 0.55, t5[0] + 0.04), v3(px + 1.85, y + 3.05, t5[0] + 0.06), poster_cols[i % poster_cols.len], .paint, .wood);
        deco(v3(px - 2, y + 0.4, t6[1] - 0.04), v3(px + 2, y + 3.2, t6[1]), v3(0.08, 0.08, 0.08), .paint, .wood);
        deco(v3(px - 1.85, y + 0.55, t6[1] - 0.06), v3(px + 1.85, y + 3.05, t6[1] - 0.04), poster_cols[(i + 2) % poster_cols.len], .paint, .wood);
    }
    for ([_]f32{ 12, 48, 84 }) |bx| {
        boxNoAo(v3(bx - 1.2, y, p5[1] - 1.0), v3(bx + 1.2, y + 0.45, p5[1] - 0.5), v3(0.3, 0.17, 0.09), .wood, .wood);
        boxNoAo(v3(bx - 1.2, y, p6[0] + 0.5), v3(bx + 1.2, y + 0.45, p6[0] + 1.0), v3(0.3, 0.17, 0.09), .wood, .wood);
    }
    for ([_]f32{ t5[0] + 0.4, t6[1] - 0.4 }) |pz| {
        map.beam(v3(plat_x[0] - 30, deep_ceil - 0.3, pz), v3(plat_x[1] + 30, deep_ceil - 0.3, pz), 0.18, 0.18, v3(0, 1, 0), v3(0.12, 0.11, 0.1), .metal, .metal);
    }

    // Fluorescent tubes over each platform (decoration). Each light hangs
    // just under its tube. One tube flickers: its box is dynamic
    // (main.zig).
    const flicker_x: f32 = 21;
    var tx: f32 = 3;
    while (tx < plat_x[1]) : (tx += 6) {
        for ([_][2]f32{ p5, p6 }, 0..) |p, side| {
            if (side == 1 and tx == flicker_x) continue;
            const cz = (p[0] + p[1]) / 2;
            deco(v3(tx - 1.2, deep_ceil - 0.12, cz - 0.15), v3(tx + 1.2, deep_ceil - 0.04, cz + 0.15), v3(0.85, 0.95, 1.0), .emissive, .glass);
        }
    }
    for ([_]f32{ 9, 33, 57, 87 }, 0..) |lx, i| {
        const tint = if (i % 2 == 0) v3(0.8, 1.0, 0.9) else v3(1.0, 0.95, 0.82);
        map.addLight(v3(lx, deep_ceil - 0.35, (p5[0] + p5[1]) / 2), tint * vec.s(2.3), 15);
    }
    // Platform 6 east of the arches.
    for ([_]f32{ 63, 99 }) |lx| {
        map.addLight(v3(lx, deep_ceil - 0.35, (p6[0] + p6[1]) / 2), v3(1.0, 0.95, 0.82) * vec.s(2.3), 15);
    }
    const fz = (p6[0] + p6[1]) / 2;
    map.flicker_light = map.light_count;
    map.addLight(v3(flicker_x, deep_ceil - 0.35, fz), v3(0.85, 1.0, 0.95) * vec.s(2.3), 15);
    const fl = map.add(v3(flicker_x - 1.2, deep_ceil - 0.12, fz - 0.15), v3(flicker_x + 1.2, deep_ceil - 0.04, fz + 0.15), v3(0.85, 1.0, 0.95), .emissive, .glass);
    fl.solid = false;
    fl.dynamic = true;
    fl.ao = false;
    map.flicker_box = map.indexOf(fl);
    // A red signal in the tunnel east of platform 5.
    deco(v3(plat_x[1] + 8, y + 1.8, t5[0] + 0.05), v3(plat_x[1] + 8.2, y + 2.0, t5[0] + 0.15), v3(1.0, 0.05, 0.02), .emissive, .glass);
    map.addLight(v3(plat_x[1] + 8, y + 1.9, t5[0] + 0.6), v3(2.5, 0.08, 0.03), 5);

    // Danger boards on the tunnel walls where the live rail starts to kill
    // (liveRail).
    for ([_]f32{ plat_x[0] - deep_shock, plat_x[1] + deep_shock }) |sx| {
        deco(v3(sx - 0.6, y - 0.2, t5[0]), v3(sx + 0.6, y + 1.0, t5[0] + 0.04), yellow, .paint, .sheet_metal);
        deco(v3(sx - 0.6, y - 0.2, t6[1] - 0.04), v3(sx + 0.6, y + 1.0, t6[1]), yellow, .paint, .sheet_metal);
    }

    // The Piccadilly train on platform 5: a 6-car 1973 Stock train
    // (train_car.zig, map.zig Train). A full map (map.dropped) has no
    // train. The doors open on the platform side (+Z).
    const tb = train_car.body(&train_car.stock_1973, t5_c, y - 0.69, y + 0.02, 1);
    map.addTrain(tb, (plat_x[0] + plat_x[1]) / 2);
}

/// True when the live rail kills a player with feet at `feet`: on the
/// District tracks past shock_x, and on the Piccadilly tracks past the
/// ends of the platforms. The floor of a train is above the track bed, so
/// a rider in the deep train is safe in the tunnels.
pub fn liveRail(feet: V3) bool {
    if (@abs(feet[0]) > shock_x and feet[1] < 2 and feet[1] > bed_y - 1) return true;
    const deep_track = feet[1] < deep_y - 0.4 and feet[1] > deep_y - 2;
    return deep_track and (feet[0] < plat_x[0] - deep_shock or feet[0] > plat_x[1] + deep_shock);
}
