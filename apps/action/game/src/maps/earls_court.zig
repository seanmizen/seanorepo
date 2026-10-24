// Earl's Court tube station, from its public layout (Wikipedia; a
// level-by-level station description; the TfL station axonometric). The
// sizes are approximate.
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
//   y -5.6  intermediate level, as on the station plan (axonometric): the
//           lower concourse under the west end of the islands, with stairs
//           up to each island. The escalators leave its north-west corner
//           and go down to the east. The emergency stairs go down from the
//           east end of platforms 1 and 2, past the deep lift, to a lobby
//           between platforms 5 and 6.
//   y -15   Piccadilly line: two round station tunnels, platform 5
//           (eastbound, north) and platform 6 (westbound, south), with a
//           corridor between them and cross-passages into both. Round
//           running tunnels go on past the ends. A deep lift goes up to the
//           Earls Court Road concourse.
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
const secret = @import("../secret_room.zig");
const gates = @import("../gates.zig");
const vec = @import("../vec.zig");
const displays = @import("../platform_display.zig");
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
/// A stair well from an island down to the intermediate level: its x
/// range, the island centre, and the direction in which the stairs go
/// down (-1 west, +1 east).
const Well = struct { x: [2]f32, cz: f32, dir: f32 };
/// As on the station plan: stairs from the west end of each island down
/// to the lower concourse, and the emergency stairs from the east end of
/// platforms 1 and 2 down to the Piccadilly line.
const wells = [_]Well{
    .{ .x = .{ -29, -22 }, .cz = ca, .dir = -1 },
    .{ .x = .{ -29, -22 }, .cz = cb, .dir = -1 },
    .{ .x = .{ 48, 55 }, .cz = ca, .dir = 1 },
};
const well_rects = blk: {
    var r: [wells.len]Rect = undefined;
    for (wells, 0..) |w, i| r[i] = .{ .x0 = w.x[0], .x1 = w.x[1], .z0 = w.cz - 1.2, .z1 = w.cz + 1.2 };
    break :blk r;
};
/// The wells of the island with centre cz.
fn islandWells(cz: f32, out: *[wells.len]Rect) []Rect {
    var n: usize = 0;
    for (wells, well_rects) |w, r| {
        if (@abs(w.cz - cz) > 0.01) continue;
        out[n] = r;
        n += 1;
    }
    return out[0..n];
}
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
/// The deep track centres. The platform edge is 1.41 m from the track
/// centre, so the 2.629 m wide 1973 Stock stops 0.1 m from the edge.
pub const t5_c: f32 = -28.8; // platform 5 (north, eastbound)
pub const t6_c: f32 = -16.2; // platform 6 (south, westbound)
const p5 = [2]f32{ t5_c + 1.41, -24.5 };
const p6 = [2]f32{ -20.5, t6_c - 1.41 };
pub const plat_x = [2]f32{ 0, 112 };
const deep_lift = Rect{ .x0 = 62.4, .x1 = 64.8, .z0 = -24, .z1 = -21.6 };
// The deep tubes, from the real Piccadilly line (Yerkes, 1906):
// - The station tunnels are 21 ft 2.5 in (6.46 m) across. The centre is
//   1.2 m above the platform and 1.3 m from the track centre toward the
//   platform. The platform is 2.9 m wide at the floor, and the curved wall
//   meets the flat back wall 2.4 m above the platform (the photo of
//   platform 6).
// - The running tunnels are 11 ft 8.25 in (3.56 m) across, centred 1.32 m
//   above the rail top on the track centre. The 1973 Stock fits tightly
//   (train_car.zig).
pub const rail_y: f32 = deep_y - 0.69;
const deep_bed: f32 = deep_y - 0.85; // the top of the track bed
pub const st_r: f32 = 3.23;
pub const st_dy: f32 = 1.2;
pub const st_dz: f32 = 1.3;
pub const run_r: f32 = 1.78;
pub const run_dy: f32 = 1.32;
/// The flat back wall of a platform (the cross-passages are in it) is this
/// high. Above it the tunnel curves over.
const back_h: f32 = 2.4;
/// A Piccadilly line track: the track centre, the side of its platform
/// (+1 south of the track, -1 north), and the platform [z0, z1].
const Tube = struct {
    c: f32,
    side: f32,
    plat: [2]f32,
    fn zc(t: Tube) f32 {
        return t.c + t.side * st_dz;
    }
    fn edge(t: Tube) f32 {
        return t.c + t.side * 1.41;
    }
};
const tubes = [_]Tube{
    .{ .c = t5_c, .side = 1, .plat = p5 },
    .{ .c = t6_c, .side = -1, .plat = p6 },
};
/// The outside of the deep level across the lines: the station tunnels
/// and their linings.
const deep_z = [2]f32{ tubes[0].zc() - st_r - 0.4, tubes[1].zc() + st_r + 0.4 };
// The emergency stairs, east of the deep lift: from the intermediate level
// (their landing) down a slot between the platform walls to a lobby with
// openings onto both platforms.
const em_cz: f32 = -22.5;
const em_top_x: f32 = 68;
const em_steps = 23;
const em_slot = Rect{ .x0 = em_top_x, .x1 = em_top_x + 0.5 * em_steps, .z0 = em_cz - 1.2, .z1 = em_cz + 1.2 };
const em_lobby = Rect{ .x0 = em_slot.x1, .x1 = em_slot.x1 + 4.5, .z0 = corr_z[0], .z1 = corr_z[1] };

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
    platformDisplays();
    // Last: its random colours do not change the rest of the map.
    vapeShop();

    // Spawns. The debug teleport (Cmd+D, then Shift+1 to 9) uses this order.
    const sp = [_]V3{
        v3(-40, 0, ca - 2),   v3(40, 0, cb + 2),     v3(30, deep_y, -26),      v3(30, deep_y, -19),
        v3(-10, 0, -15.5),    v3(-10, 0, 2),         v3(-20, street_y, -19.7), v3(55, street_y, 0),
        v3(-55, street_y, 0), v3(85, street_y, -20), v3(-36, mid_y, -4),       v3(-5, deep_y, -22.5),
    };
    for (sp) |p| map.addSpawn(p);
}

// ---- District level ------------------------------------------------------------

fn districtLevel() void {
    // The ground under the tracks, with the stair wells cut out.
    map.carve(rect(shed_x0, shed_x1, wall_n, wall_s), -3, bed_y, &well_rects, ballast, .concrete, .ballast);

    // Islands, with their wells, and the yellow edges.
    for ([_][2]f32{ island_a, island_b }) |is| {
        const cz = (is[0] + is[1]) / 2;
        var buf: [wells.len]Rect = undefined;
        map.carve(rect(island_x[0], island_x[1], is[0], is[1]), bed_y, 0, islandWells(cz, &buf), platform_c, .concrete, .concrete);
        deco(v3(island_x[0], 0, is[0]), v3(island_x[1], 0.012, is[0] + 0.45), yellow, .paint, .concrete);
        deco(v3(island_x[0], 0, is[1] - 0.45), v3(island_x[1], 0.012, is[1]), yellow, .paint, .concrete);
        // Railings round the wells, open at the top of the stairs.
        for (wells) |w| {
            if (@abs(w.cz - cz) > 0.01) continue;
            railing(w.x[0], w.x[1], cz - 1.3, cz - 1.2, 0);
            railing(w.x[0], w.x[1], cz + 1.2, cz + 1.3, 0);
            const end = if (w.dir < 0) w.x[0] - 0.1 else w.x[1];
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
    // The secret door in the back display: eight packs wide, its edges in
    // the gaps between the packs (they are 0.16 m apart from z0 + 0.5).
    const door_z = [2]f32{ z0 + 0.5 + 16 * 0.16 - 0.025, z0 + 0.5 + 24 * 0.16 - 0.025 };
    const door_h: f32 = 2.5;
    const more_z = z0 + 0.5 + 19 * 0.16;
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
    // The back wall, with the doorway of the secret room behind the door
    // section of the shelf (secretRoom).
    box(v3(bx, y, z0), v3(bx + 0.3, y + 3.4, door_z[0]), white, .paint, .plaster);
    box(v3(bx, y, door_z[1]), v3(bx + 0.3, y + 3.4, z1), white, .paint, .plaster);
    box(v3(bx, y + door_h, door_z[0]), v3(bx + 0.3, y + 3.4, door_z[1]), white, .paint, .plaster);
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
    // One section of the back display is the door of the secret room
    // (secret_room.zig): the same block, edges and boxes, but they move.
    box(v3(bx - 0.4, y, z0 + 0.4), v3(bx, y + door_h, door_z[0]), black, .paint, .wood);
    box(v3(bx - 0.4, y, door_z[1]), v3(bx, y + door_h, z1 - 0.4), black, .paint, .wood);
    secret.addDoor(v3(bx - 0.4, y, door_z[0]), v3(bx, y + door_h, door_z[1]), door_z[1] - door_z[0] + 0.1);
    box(v3(fx + 1.6, y, z0), v3(bx - 0.6, y + 2.3, z0 + 0.4), black, .paint, .wood);
    for ([_]f32{ 0.45, 0.95, 1.45, 1.95 }, 0..) |sh, row| {
        const sy = y + sh;
        deco(v3(bx - 0.46, sy - 0.03, z0 + 0.4), v3(bx - 0.4, sy, door_z[0]), neon[2], .emissive, .glass);
        deco(v3(bx - 0.46, sy - 0.03, door_z[1]), v3(bx - 0.4, sy, z1 - 0.4), neon[2], .emissive, .glass);
        secret.addPart(v3(bx - 0.46, sy - 0.03, door_z[0]), v3(bx - 0.4, sy, door_z[1]), neon[2], 4, false);
        deco(v3(fx + 1.6, sy - 0.03, z0 + 0.4), v3(bx - 0.6, sy, z0 + 0.46), neon[1], .emissive, .glass);
        var pz: f32 = z0 + 0.5;
        while (pz < z1 - 0.6) : (pz += 0.16) {
            const c = neon[@intFromFloat(rnd() * 7.99)];
            const pack_top = sy + 0.16 + rnd() * 0.14;
            if (pz > door_z[0] and pz < door_z[1]) {
                // The GET MORE pack: the second shelf from the top, near
                // the middle of the door. A white pack with a gold top.
                const more = row == 2 and pz > more_z - 0.08 and pz < more_z + 0.08;
                if (more) {
                    secret.addPart(v3(bx - 0.45, sy, pz), v3(bx - 0.4, sy + 0.24, pz + 0.11), v3(0.92, 0.9, 0.86), 0, true);
                    secret.addPart(v3(bx - 0.452, sy + 0.24, pz + 0.01), v3(bx - 0.41, sy + 0.27, pz + 0.1), v3(1.0, 0.72, 0.22), 3, false);
                } else secret.addPart(v3(bx - 0.45, sy, pz), v3(bx - 0.4, pack_top, pz + 0.11), c, 0, false);
                continue;
            }
            deco(v3(bx - 0.45, sy, pz), v3(bx - 0.4, pack_top, pz + 0.11), c, .paint, .fabric);
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
    secretRoom(bx + 0.3, door_z, door_h);
}

/// The secret room behind the back wall of VAPES N MORE: a dark chapel
/// with a golden pigeon on a plinth (secret_room.zig). A shaft of light comes
/// down on the plinth from a round light in the ceiling. Lancet windows in
/// the neon colours of the shop glow on the side walls, a gold sunburst
/// fills the far wall, and small stars light the ceiling. The room lights
/// stay dark until the door opens. `x0` is the room face of the back wall
/// of the shop, and `door_z` the doorway in it.
fn secretRoom(x0: f32, door_z: [2]f32, door_h: f32) void {
    const y = street_y;
    const fl = y + 0.12;
    const x1 = x0 + 8; // the far wall
    const z0 = shop_z[0] - 0.3;
    const z1 = shop_z[1] + 0.3;
    const top = y + 6; // the ceiling
    const cz = (door_z[0] + door_z[1]) / 2; // the axis of the room
    const cx = x0 + 4.7; // the plinth
    const wall = v3(0.05, 0.035, 0.09);
    const marble = v3(0.86, 0.85, 0.82);
    const gold = v3(1.0, 0.72, 0.28);
    const deep_gold = v3(0.55, 0.36, 0.12);
    const neon = [_]V3{ v3(1.0, 0.1, 0.8), v3(0.6, 0.2, 1.0), v3(0.1, 0.9, 1.0), v3(1.0, 0.8, 0.2), v3(1.0, 0.25, 0.45), v3(0.3, 0.5, 1.0) };

    // The shell. The shop walls close the front up to y + 3.4.
    box(v3(x0, y, z0), v3(x1, fl, z1), v3(0.025, 0.025, 0.03), .tile, .tile);
    box(v3(x0 - 0.3, y, z0 - 0.3), v3(x1 + 0.3, top + 0.3, z0), wall, .paint, .plaster);
    box(v3(x0 - 0.3, y, z1), v3(x1 + 0.3, top + 0.3, z1 + 0.3), wall, .paint, .plaster);
    box(v3(x1, y, z0), v3(x1 + 0.3, top + 0.3, z1), wall, .paint, .plaster);
    box(v3(x0 - 0.3, y + 3.4, z0), v3(x0, top + 0.3, z1), wall, .paint, .plaster);
    box(v3(x0 - 0.3, top, z0), v3(x1 + 0.3, top + 0.3, z1), v3(0.015, 0.012, 0.03), .paint, .plaster);
    // No sun and little sky light in here (map.zig sealed).
    map.sealed = .{ v3(x0 - 0.05, y - 0.5, z0 - 0.05), v3(x1 + 0.05, top + 0.05, z1 + 0.05) };
    // A gold frame round the doorway, on the room side only.
    deco(v3(x0, fl, door_z[0] - 0.08), v3(x0 + 0.02, y + door_h + 0.08, door_z[0]), gold, .emissive, .glass);
    deco(v3(x0, fl, door_z[1]), v3(x0 + 0.02, y + door_h + 0.08, door_z[1] + 0.08), gold, .emissive, .glass);
    deco(v3(x0, y + door_h, door_z[0]), v3(x0 + 0.02, y + door_h + 0.08, door_z[1]), gold, .emissive, .glass);

    // The dais and the plinth, with gold bands, and a gold square on the
    // floor round them.
    box(v3(cx - 1.2, fl, cz - 1.2), v3(cx + 1.2, fl + 0.15, cz + 1.2), marble, .tile, .tile);
    box(v3(cx - 0.28, fl + 0.15, cz - 0.28), v3(cx + 0.28, fl + 1.2, cz + 0.28), marble, .paint, .plaster);
    deco(v3(cx - 0.33, fl + 1.12, cz - 0.33), v3(cx + 0.33, fl + 1.2, cz + 0.33), marble, .paint, .plaster);
    deco(v3(cx - 0.32, fl + 0.15, cz - 0.32), v3(cx + 0.32, fl + 0.25, cz + 0.32), marble, .paint, .plaster);
    deco(v3(cx - 0.29, fl + 1.0, cz - 0.29), v3(cx + 0.29, fl + 1.04, cz + 0.29), gold, .emissive, .glass);
    for ([_]f32{ -1, 1 }) |sd| {
        deco(v3(cx - 1.22, fl + 0.12, cz + sd * 1.2 - 0.02), v3(cx + 1.22, fl + 0.155, cz + sd * 1.2 + 0.02), gold, .emissive, .glass);
        deco(v3(cx + sd * 1.2 - 0.02, fl + 0.12, cz - 1.22), v3(cx + sd * 1.2 + 0.02, fl + 0.155, cz + 1.22), gold, .emissive, .glass);
        deco(v3(cx - 1.8, fl, cz + sd * 1.8 - 0.025), v3(cx + 1.8, fl + 0.004, cz + sd * 1.8 + 0.025), deep_gold, .emissive, .glass);
        deco(v3(cx + sd * 1.8 - 0.025, fl, cz - 1.8), v3(cx + sd * 1.8 + 0.025, fl + 0.004, cz + 1.8), deep_gold, .emissive, .glass);
    }
    secret.setPlinth(v3(cx, fl + 1.2, cz));

    // Four columns round the dais, with gold capitals.
    for ([_]f32{ -1, 1 }) |sx| for ([_]f32{ -1, 1 }) |sz| {
        const px = cx + sx * 2.3;
        const pz = cz + sz * 2.6;
        box(v3(px - 0.2, fl, pz - 0.2), v3(px + 0.2, top, pz + 0.2), marble, .paint, .plaster);
        deco(v3(px - 0.24, top - 0.35, pz - 0.24), v3(px + 0.24, top - 0.3, pz + 0.24), gold, .emissive, .glass);
        deco(v3(px - 0.24, fl, pz - 0.24), v3(px + 0.24, fl + 0.12, pz + 0.24), marble, .paint, .plaster);
    };

    // The round light in the ceiling over the plinth, and its gold ring.
    // The shaft of light (secret_room.zig) comes down from it.
    const down = Mat4.rotationX(std.math.pi / 2.0);
    map.addDisc(vec.translate(v3(cx, top - 0.01, cz)).mul(down), 1.05, 0.015, gold, .emissive, .glass);
    map.addDisc(vec.translate(v3(cx, top - 0.02, cz)).mul(down), 0.9, 0.015, v3(1.0, 0.95, 0.82), .emissive, .glass);
    secret.setShaft(v3(cx, top - 0.03, cz), v3(cx, fl + 0.15, cz), 0.9, 1.25);

    // The sunburst on the far wall, behind the plinth: gold rays round a
    // white sun.
    const sun_c = v3(x1 - 0.02, fl + 3.1, cz);
    const sun_m = vec.translate(sun_c).mul(Mat4.rotationY(-std.math.pi / 2.0));
    map.addDisc(sun_m, 0.62, 0.02, gold, .emissive, .glass);
    map.addDisc(sun_m.mul(vec.translate(v3(0, 0, 0.015))), 0.46, 0.02, v3(1.0, 0.96, 0.86), .emissive, .glass);
    const rays = 24;
    for (0..rays) |i| {
        const a = @as(f32, @floatFromInt(i)) / rays * std.math.tau;
        const long = i % 2 == 0;
        const len: f32 = if (long) 2.0 else 1.2;
        const m = vec.translate(sun_c - v3(0.005, 0, 0)).mul(Mat4.rotationX(a));
        const c = if (long) deep_gold else deep_gold * vec.s(0.6);
        map.addDecor(m, v3(-0.01, -0.025, 0.75), v3(0.01, 0.025, 0.75 + len), c, .emissive, .glass);
    }

    // Lancet windows of coloured light on the side walls: a tall panel and
    // two steps for the point, a dark mullion and a transom.
    for ([_]f32{ -1, 1 }, 0..) |side, si| {
        const wz = if (side < 0) z0 else z1;
        for ([_]f32{ x0 + 1.6, x0 + 4.1, x0 + 6.6 }, 0..) |wx, wi| {
            const c = neon[(si * 3 + wi) % neon.len] * vec.s(0.55);
            const d0 = wz - side * 0.02;
            const za = @min(wz, d0);
            const zb = @max(wz, d0);
            deco(v3(wx - 0.35, fl + 1.0, za), v3(wx + 0.35, fl + 3.9, zb), c, .emissive, .glass);
            deco(v3(wx - 0.24, fl + 3.9, za), v3(wx + 0.24, fl + 4.12, zb), c, .emissive, .glass);
            deco(v3(wx - 0.12, fl + 4.12, za), v3(wx + 0.12, fl + 4.32, zb), c, .emissive, .glass);
            const m0 = wz - side * 0.03;
            const ma = @min(wz, m0);
            const mb = @max(wz, m0);
            deco(v3(wx - 0.025, fl + 1.0, ma), v3(wx + 0.025, fl + 4.32, mb), v3(0.02, 0.015, 0.03), .metal, .metal);
            deco(v3(wx - 0.35, fl + 2.6, ma), v3(wx + 0.35, fl + 2.65, mb), v3(0.02, 0.015, 0.03), .metal, .metal);
        }
    }

    // Stars on the ceiling.
    for (0..48) |_| {
        const sx = x0 + 0.3 + rnd() * 7.4;
        const sz = z0 + 0.3 + rnd() * (z1 - z0 - 0.6);
        if (@abs(sx - cx) < 1.3 and @abs(sz - cz) < 1.3) continue;
        const sz2 = 0.02 + rnd() * 0.03;
        const warmth = rnd();
        deco(v3(sx, top - 0.004, sz), v3(sx + sz2, top, sz + sz2), v3(0.9, 0.85 + 0.1 * warmth, 0.7 + 0.3 * warmth), .emissive, .glass);
    }

    // The lights: the shaft over the plinth, a magenta and a cyan wash on
    // the windows, and the glow of the sunburst. They stay dark while the
    // door is shut (secret_room.zig glow).
    const first = map.light_count;
    map.addLight(v3(cx, fl + 3.4, cz), v3(3.4, 2.8, 1.9), 8);
    map.addLight(v3(x0 + 4.1, fl + 2.6, z0 + 1.0), v3(1.5, 0.3, 1.4), 6);
    map.addLight(v3(x0 + 4.1, fl + 2.6, z1 - 1.0), v3(0.3, 1.1, 1.6), 6);
    map.addLight(v3(x1 - 1.2, fl + 3.1, cz), v3(1.6, 1.0, 0.4), 5);
    secret.setLights(first, map.light_count - first);
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
    map.carve(rect(shed_x1, line_end, wall_n, wall_s), -3, bed_y, &well_rects, ballast, .concrete, .ballast);
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
        // The details draw the roof and the ends in the shape of the stock.
        if (kind == .cover) b.visible = false;
        self.n += 1;
    }
};

/// The sink of train_car.details for a parked train: decoration.
const ParkedDetails = struct {
    pub fn box(_: ParkedDetails, min: V3, max: V3, color: V3, mat: Mat, surface: Surface) void {
        deco(min, max, color, mat, surface);
    }
    pub fn slab(_: ParkedDetails, m: Mat4, min: V3, max: V3, color: V3, mat: Mat, surface: Surface) void {
        map.addDecor(m, min, max, color, mat, surface);
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
    const wall_c = v3(0.12, 0.11, 0.1);
    const floor_c = v3(0.3, 0.29, 0.27);

    // The lower concourse under the west end of the islands: one hall
    // under both islands, with the stairs from each island down into it,
    // and the landing of the escalators in its north-west corner. Four
    // columns hold up the track beds.
    const hall = rect(-40, -18, -18, 7.6);
    const landing = rect(-40, esc_top_x, esc_z[0] - 0.3, hall.z0);
    const area_w = rect(hall.x0 - 1, hall.x1 + 1, landing.z0 - 0.7, hall.z1 + 1);
    const esc_floor = rect(esc_top_x, area_w.x1, esc_z[0], esc_z[1]);
    const esc_shaft = rect(esc_top_x, area_w.x1, esc_z[0] - 0.3, esc_z[1] + 0.3);
    map.carve(area_w, mid_y - 1, mid_y, &.{esc_floor}, floor_c, .concrete, .concrete);
    map.carve(area_w, mid_y, mid_ceil, &.{ hall, landing, esc_shaft }, tile_c, .wall_tile, .tile);
    map.carve(area_w, mid_ceil, -3, well_rects[0..2], wall_c, .concrete, .concrete);
    for ([_]f32{ -35, -24 }) |x| for ([_]f32{ -6, -1 }) |z| {
        box(v3(x - 0.35, mid_y, z - 0.35), v3(x + 0.35, mid_ceil, z + 0.35), tile_c, .wall_tile, .tile);
    };
    // A green tile band round the hall, and a roundel on the west wall.
    const band = [2]f32{ mid_y + 1.3, mid_y + 1.5 };
    deco(v3(hall.x0, band[0], hall.z0), v3(hall.x0 + 0.02, band[1], hall.z1), tile_green, .wall_tile, .tile);
    deco(v3(hall.x1 - 0.02, band[0], hall.z0), v3(hall.x1, band[1], hall.z1), tile_green, .wall_tile, .tile);
    deco(v3(hall.x0, band[0], hall.z1 - 0.02), v3(hall.x1, band[1], hall.z1), tile_green, .wall_tile, .tile);
    deco(v3(esc_top_x, band[0], hall.z0), v3(hall.x1, band[1], hall.z0 + 0.02), tile_green, .wall_tile, .tile);
    roundel(v3(hall.x0 + 0.06, mid_y + 1.6, -4), std.math.pi / 2.0, 1.0);

    // The stairs from the west end of each island down into the hall.
    for (wells[0..2]) |w| stairs(w.x[1], -1, w.cz, 2.4, -0.4, 14, .{ 0, mid_y }, platform_c);
    for ([_]f32{ -9, 0 }) |z| {
        map.add(v3(-34.1, mid_ceil - 0.08, z - 1.1), v3(-33.9, mid_ceil, z + 1.1), cool, .emissive, .glass).solid = false;
        map.addLight(v3(-34, mid_ceil - 0.3, z), cool * vec.s(1.4), 12);
    }

    // The emergency stairs from the east end of platforms 1 and 2: down
    // the well to a passage, north past the deep lift shaft, and to the
    // landing at the top of the long flight down to the Piccadilly line
    // (deepLevel).
    const e_well = well_rects[2];
    const e_pass = rect(e_well.x0, 60, ca - 1.5, ca + 1.5);
    const e_north = rect(57, 60, -21.3, e_pass.z1);
    const e_east = rect(57, em_top_x, -21.3, -18.3);
    const e_land = rect(65, em_top_x, corr_z[0], -18.3);
    const area_e = rect(e_well.x0 - 1, em_slot.x1 + 1, corr_z[0] - 1, e_pass.z1 + 1);
    map.carve(area_e, mid_y - 1, mid_y, &.{ em_slot, deep_lift }, floor_c, .concrete, .concrete);
    map.carve(area_e, mid_y, mid_ceil, &.{ e_pass, e_north, e_east, e_land, em_slot, deep_lift }, tile_c, .wall_tile, .tile);
    map.carve(area_e, mid_ceil, -3, &.{ e_well, deep_lift }, wall_c, .concrete, .concrete);
    stairs(wells[2].x[0], 1, wells[2].cz, 2.4, -0.4, 14, .{ 0, mid_y }, platform_c);
    map.add(v3(57.4, mid_ceil - 0.08, -17.1), v3(59.6, mid_ceil, -16.9), cool, .emissive, .glass).solid = false;
    map.addLight(v3(58.5, mid_ceil - 0.3, -17), cool * vec.s(1.2), 11);
    // Green running-man signs over the way on.
    const sign_g = v3(0.05, 0.75, 0.3);
    deco(v3(59.96, mid_y + 2.0, ca - 0.5), v3(60, mid_y + 2.3, ca + 0.5), sign_g, .emissive, .glass);
    deco(v3(57.5, mid_y + 2.0, -21.3), v3(58.5, mid_y + 2.3, -21.26), sign_g, .emissive, .glass);
    deco(v3(em_top_x - 0.04, mid_y + 2.0, em_cz - 0.5), v3(em_top_x, mid_y + 2.3, em_cz + 0.5), sign_g, .emissive, .glass);
    deco(v3(e_pass.x0, band[0], e_pass.z0), v3(60, band[1], e_pass.z0 + 0.02), tile_green, .wall_tile, .tile);
    deco(v3(e_pass.x0, band[0], e_pass.z1 - 0.02), v3(57, band[1], e_pass.z1), tile_green, .wall_tile, .tile);
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

/// The lining of a round tunnel: a ring of decoration beams along X, about
/// the centre (cy, cz), inner radius r, `t` thick. The inner face of each
/// beam is tangent to the circle, so no part of the lining is inside the
/// circle (the train fits in it). A beam that is all below `bottom` is left
/// out. With `side` set, the beams on the platform side of `edge` (the
/// platform and its flat back wall) are left out below `wall_top`.
const Lining = struct {
    cz: f32,
    cy: f32,
    r: f32,
    t: f32 = 0.2,
    bottom: f32,
    side: f32 = 0,
    edge: f32 = 0,
    wall_top: f32 = 0,
};
const lining_segs = 32;

fn lining(l: Lining, x0: f32, x1: f32, color: V3, mat: Mat, surface: Surface) void {
    const half = std.math.pi / @as(f32, lining_segs);
    const w = 2 * l.r * @tan(half) + 0.04;
    for (0..lining_segs) |i| {
        const a = (@as(f32, @floatFromInt(i)) * 2 + 1) * half;
        const n = v3(0, @sin(a), @cos(a));
        const p = v3(0, l.cy, l.cz) + n * vec.s(l.r + l.t / 2);
        if (p[1] + w / 2 < l.bottom) continue;
        if (l.side != 0 and (p[2] - l.edge) * l.side > 0 and p[1] < l.wall_top) continue;
        map.beam(v3(x0, p[1], p[2]), v3(x1, p[1], p[2]), w, l.t, n, color, mat, surface);
    }
}

/// The widest half chord of a circle (radius r, centre height c) between
/// the heights ya and yb. 0 when the band misses the circle.
fn widest(r: f32, c: f32, ya: f32, yb: f32) f32 {
    if (ya <= c and yb >= c) return r;
    const d = @min(@abs(ya - c), @abs(yb - c));
    return if (d >= r) 0 else @sqrt(r * r - d * d);
}

/// The height of the lining of the station tunnel of `t` over the point z.
pub fn tubeTop(t_c: f32, side: f32, z: f32) f32 {
    const dz = z - (t_c + side * st_dz);
    return deep_y + st_dy + @sqrt(@max(0, st_r * st_r - dz * dz));
}

/// The flat end wall of a station tunnel, from x0 to x1: the circle of the
/// station tunnel less the bore of the running tunnel, in strips 0.2 m
/// high. Each strip covers the widest part of the station circle in it and
/// leaves out the widest part of the bore, so no part is inside the bore.
fn endWall(t: Tube, x0: f32, x1: f32) void {
    const zc = t.zc();
    const yc = deep_y + st_dy;
    const rc = rail_y + run_dy;
    var y = deep_bed;
    while (y < yc + st_r) : (y += 0.2) {
        const yb = @min(y + 0.2, yc + st_r);
        const ws = widest(st_r, yc, y, yb);
        const wr = widest(run_r, rc, y, yb);
        const parts = if (wr > 0)
            [2][2]f32{ .{ zc - ws, t.c - wr }, .{ t.c + wr, zc + ws } }
        else
            [2][2]f32{ .{ zc - ws, zc + ws }, .{ 0, 0 } };
        for (parts) |pz| {
            if (pz[1] - pz[0] > 0.01) deco(v3(x0, y, pz[0]), v3(x1, yb, pz[1]), tile_c, .wall_tile, .tile);
        }
    }
}

/// A panel that follows the curve of the track-side wall of a station
/// tunnel, from x0 to x1 and from the height ya to yb, `inset` from the
/// lining: slices no more than 0.5 m high.
fn wallPanel(t: Tube, x0: f32, x1: f32, ya: f32, yb: f32, inset: f32, color: V3, mat: Mat, surface: Surface) void {
    const zc = t.zc();
    const yc = deep_y + st_dy;
    const rr = st_r - inset - 0.01;
    const pa = std.math.asin((ya - yc) / st_r);
    const pb = std.math.asin((yb - yc) / st_r);
    const n_f = @ceil((yb - ya) / 0.5);
    const n: usize = @intFromFloat(n_f);
    for (0..n) |i| {
        const fa = pa + (pb - pa) * @as(f32, @floatFromInt(i)) / n_f;
        const fb = pa + (pb - pa) * @as(f32, @floatFromInt(i + 1)) / n_f;
        const fm = (fa + fb) / 2;
        const nrm = v3(0, @sin(fm), -t.side * @cos(fm));
        const p = v3(0, yc, zc) + nrm * vec.s(rr);
        map.beam(v3(x0, p[1], p[2]), v3(x1, p[1], p[2]), 2 * st_r * @sin((fb - fa) / 2), 0.02, nrm, color, mat, surface);
    }
}

/// An invisible box from x0 to x1, from za to zb (either order), from ya to
/// yb: the collision of a curved wall that is decoration.
fn solid(x0: f32, x1: f32, za: f32, zb: f32, ya: f32, yb: f32) void {
    map.addSolid(v3(x0, ya, @min(za, zb)), v3(x1, yb, @max(za, zb)), .tile);
}

fn deepLevel() void {
    const y = deep_y;
    const floor_c = v3(0.3, 0.29, 0.27);
    const x0 = esc_bottom_x;
    const arches = [_]f32{ 6, 18, 30, 42, 54 };
    const yc = y + st_dy;
    const crown = yc + st_r;
    const rc = rail_y + run_dy;
    const bore_top = rc + run_r;
    const ring_c = v3(0.1, 0.1, 0.11);
    const rib_c = v3(0.28, 0.11, 0.08);
    const sign_g = v3(0.05, 0.75, 0.3);

    // The floor under the corridor and the platforms.
    box(v3(x0, y - 1, corr_z[0]), v3(deep_lift.x1, y, corr_z[1]), floor_c, .concrete, .concrete);
    for (tubes) |t| box(v3(plat_x[0], y - 1, t.plat[0]), v3(plat_x[1], y, t.plat[1]), floor_c, .concrete, .concrete);
    for (tubes) |t| {
        const e = t.edge();
        deco(v3(plat_x[0], y, @min(e, e + t.side * 0.45)), v3(plat_x[1], y + 0.012, @max(e, e + t.side * 0.45)), yellow, .paint, .concrete);
    }
    // The flat back walls of the platforms, between them and the corridor,
    // with the cross-passages; west of the platforms they are the corridor
    // walls. The lift closes the east end of the corridor. East of it the
    // lobby of the emergency stairs opens onto both platforms.
    for ([_][2]f32{ .{ p5[1], corr_z[0] }, .{ corr_z[1], p6[0] } }) |wz| {
        var xa = x0;
        for (arches) |ax| {
            box(v3(xa, y, wz[0]), v3(ax - 1.5, deep_ceil, wz[1]), tile_c, .wall_tile, .tile);
            boxNoAo(v3(ax - 1.5, y + back_h, wz[0]), v3(ax + 1.5, deep_ceil, wz[1]), tile_c, .wall_tile, .tile);
            xa = ax + 1.5;
        }
        box(v3(xa, y, wz[0]), v3(em_lobby.x0 + 0.5, deep_ceil, wz[1]), tile_c, .wall_tile, .tile);
        boxNoAo(v3(em_lobby.x0 + 0.5, y + back_h, wz[0]), v3(em_lobby.x1 - 0.5, deep_ceil, wz[1]), tile_c, .wall_tile, .tile);
        box(v3(em_lobby.x1 - 0.5, y, wz[0]), v3(plat_x[1], deep_ceil, wz[1]), tile_c, .wall_tile, .tile);
    }
    box(v3(deep_lift.x0, y, deep_lift.z1), v3(deep_lift.x1, deep_ceil, corr_z[1]), tile_c, .wall_tile, .tile);

    // East of the lift the island between the back walls is solid, but for
    // the emergency stairs: their slot, which goes on up to their landing
    // on the intermediate level, and the lobby at their foot.
    map.carve(rect(deep_lift.x1, plat_x[1], corr_z[0], corr_z[1]), y - 1, deep_ceil, &.{ em_slot, em_lobby }, tile_c, .wall_tile, .tile);
    box(v3(em_slot.x0, y - 1, em_slot.z0), v3(em_slot.x1, y, em_slot.z1), floor_c, .concrete, .concrete);
    box(v3(em_lobby.x0, y - 1, em_lobby.z0), v3(em_lobby.x1, y, em_lobby.z1), floor_c, .concrete, .concrete);
    box(v3(em_slot.x0, deep_ceil, corr_z[0]), v3(em_slot.x1, mid_y - 1, em_slot.z0), tile_c, .wall_tile, .tile);
    box(v3(em_slot.x0, deep_ceil, em_slot.z1), v3(em_slot.x1, mid_y - 1, corr_z[1]), tile_c, .wall_tile, .tile);
    box(v3(em_slot.x1, deep_ceil, corr_z[0]), v3(em_slot.x1 + 0.3, mid_ceil, corr_z[1]), tile_c, .wall_tile, .tile);
    stairs(em_top_x, 1, em_cz, 2.4, y + 0.4 * @as(f32, em_steps - 1), em_steps, .{ mid_y, y }, platform_c);
    for ([_]f32{ em_lobby.z0, em_lobby.z1 - 0.04 }) |z| {
        deco(v3(em_lobby.x0 + 1.4, y + 2.5, z), v3(em_lobby.x1 - 1.4, y + 2.8, z + 0.04), sign_g, .emissive, .glass);
    }

    // The tracks, the tunnels and their linings, and the collision of the
    // curved walls (the linings are decoration).
    for (tubes) |t| {
        const zc = t.zc();
        const s = t.side;
        const c = t.c;
        const out = [2][2]f32{ .{ -line_end, plat_x[0] }, .{ plat_x[1], line_end } };
        // The track bed: wide in the station tunnel (the lining hides the
        // rest of it), the width of the bore beyond.
        box(v3(plat_x[0], y - 1.2, @min(zc - s * 3.4, t.edge())), v3(plat_x[1], deep_bed, @max(zc - s * 3.4, t.edge())), ballast * vec.s(0.7), .concrete, .ballast);
        for (out) |r| box(v3(r[0], y - 1.2, c - 1.5), v3(r[1], deep_bed, c + 1.5), ballast * vec.s(0.7), .concrete, .ballast);
        // The running rails, the 4th rail, the sleepers.
        for ([_]f32{ -0.72, 0.72 }) |off| {
            boxNoAo(v3(-line_end, deep_bed, c + off - 0.04), v3(line_end, rail_y, c + off + 0.04), steel, .metal, .metal);
        }
        deco(v3(-line_end, deep_bed, c - 0.05), v3(line_end, y - 0.73, c + 0.05), v3(0.5, 0.45, 0.4), .metal, .metal);
        var sx: f32 = -line_end;
        const mid = (plat_x[0] + plat_x[1]) / 2;
        while (sx < line_end) : (sx += if (@abs(sx - mid) > 90) 2.7 else 0.9) {
            deco(v3(sx, deep_bed, c - 0.95), v3(sx + 0.26, deep_bed + 0.06, c + 0.95), v3(0.1, 0.08, 0.06), .wood, .wood);
        }

        // The station tunnel: the tiled lining, the dark rings over the
        // platform, the end walls round the bores. The running tunnels:
        // cast iron.
        lining(.{ .cz = zc, .cy = yc, .r = st_r, .bottom = deep_bed - 0.1, .side = s, .edge = t.edge(), .wall_top = y + back_h }, plat_x[0], plat_x[1], tile_c, .wall_tile, .tile);
        var rx: f32 = plat_x[0] + 2;
        while (rx < plat_x[1]) : (rx += 4) {
            lining(.{ .cz = zc, .cy = yc, .r = st_r - 0.06, .t = 0.06, .bottom = y + back_h + 0.3 }, rx, rx + 0.35, rib_c, .wall_tile, .tile);
        }
        endWall(t, plat_x[0] - 0.3, plat_x[0]);
        endWall(t, plat_x[1], plat_x[1] + 0.3);
        for (out) |r| {
            const xa = if (r[0] < 0) r[0] else r[0] + 0.3;
            const xb = if (r[0] < 0) r[1] - 0.3 else r[1];
            lining(.{ .cz = c, .cy = rc, .r = run_r, .bottom = deep_bed - 0.1 }, xa, xb, ring_c, .metal, .metal);
        }

        // Collision: the track side of the station tunnel (the lining at
        // the track bed), the curve over the back wall, the sides and the
        // top of the running tunnels (outside the train), the end walls.
        const zt = zc - s * 2.5;
        solid(plat_x[0], plat_x[1], zt, zc - s * 3.5, deep_bed, crown);
        solid(plat_x[0], plat_x[1], zc + s * 2.6, zc + s * 3.0, y + back_h, crown);
        for (out) |r| {
            solid(r[0], r[1], c - 1.4, c - 1.7, deep_bed, bore_top + 0.3);
            solid(r[0], r[1], c + 1.4, c + 1.7, deep_bed, bore_top + 0.3);
            solid(r[0], r[1], c - 1.7, c + 1.7, bore_top, bore_top + 0.3);
        }
        for ([_]f32{ plat_x[0] - 0.3, plat_x[1] }) |xa| {
            solid(xa, xa + 0.3, t.edge(), zc + s * 3.0, y, crown);
            solid(xa, xa + 0.3, zc - s * 3.5, c - s * 1.4, deep_bed, crown);
            solid(xa, xa + 0.3, c + s * 1.4, t.edge(), deep_bed, crown);
            solid(xa, xa + 0.3, c - 1.4, c + 1.4, bore_top, crown);
        }
    }
    // The ceiling over the tunnels, with the escalator shaft, the deep lift
    // shaft and the slot of the emergency stairs cut out (their riders and
    // walkers need head room), and the dark ends of the world. A slab
    // across the lift shaft catches a rider on the way down: the step up
    // puts the feet on it, and the cab goes on without the player. The
    // floorplan audit checks each shaft.
    map.carve(rect(-line_end, line_end, deep_z[0], deep_z[1]), deep_ceil, deep_ceil + 0.6, &.{ rect(esc_top_x, esc_bottom_x, esc_z[0] - 0.3, esc_z[1] + 0.3), deep_lift, em_slot }, v3(0.12, 0.11, 0.1), .concrete, .concrete);
    box(v3(-line_end, y - 1.2, deep_z[0]), v3(-line_end + 0.4, deep_ceil, deep_z[1]), dark, .paint, .concrete);
    box(v3(line_end - 0.4, y - 1.2, deep_z[0]), v3(line_end, deep_ceil, deep_z[1]), dark, .paint, .concrete);

    // On the track-side wall, as in the photo of platform 6: a dark red
    // band at the top of the wall, posters that follow the curve, and
    // roundels between them.
    const poster_cols = [_]V3{ v3(0.8, 0.35, 0.1), v3(0.1, 0.4, 0.55), v3(0.85, 0.75, 0.2), v3(0.45, 0.1, 0.35), v3(0.15, 0.5, 0.25), v3(0.9, 0.9, 0.85) };
    for (tubes, 0..) |t, ti| {
        wallPanel(t, plat_x[0], plat_x[1], y + back_h + 0.35, y + back_h + 0.6, 0.01, rib_c, .wall_tile, .tile);
        for ([_]f32{ 4, 21, 39, 56, 79, 97 }, 0..) |px, i| {
            wallPanel(t, px - 2, px + 2, y + 0.5, y + 2.6, 0.02, v3(0.08, 0.08, 0.08), .paint, .wood);
            wallPanel(t, px - 1.85, px + 1.85, y + 0.62, y + 2.48, 0.04, poster_cols[(i + 2 * ti) % poster_cols.len], .paint, .wood);
        }
        for ([_]f32{ 12, 30, 48, 70, 88, 106 }) |rx| {
            roundel(v3(rx, y + 1.5, t.zc() - t.side * 2.98), if (t.side > 0) 0 else std.math.pi, 1.2);
        }
    }
    for ([_]f32{ 12, 48, 84 }) |bx| {
        boxNoAo(v3(bx - 1.2, y, p5[1] - 1.0), v3(bx + 1.2, y + 0.45, p5[1] - 0.5), v3(0.3, 0.17, 0.09), .wood, .wood);
        boxNoAo(v3(bx - 1.2, y, p6[0] + 0.5), v3(bx + 1.2, y + 0.45, p6[0] + 1.0), v3(0.3, 0.17, 0.09), .wood, .wood);
    }

    // Fluorescent tubes along the crown over each platform (decoration).
    // Each light hangs just under its tube. One tube flickers: its box is
    // dynamic (main.zig).
    const flicker_x: f32 = 21;
    const lz = [2]f32{ tubes[0].zc() + 1.6, tubes[1].zc() - 1.6 };
    const ly = tubeTop(t5_c, 1, lz[0]);
    var tx: f32 = 3;
    while (tx < plat_x[1]) : (tx += 6) {
        for (lz, 0..) |cz, side| {
            if (side == 1 and tx == flicker_x) continue;
            deco(v3(tx - 1.2, ly - 0.14, cz - 0.15), v3(tx + 1.2, ly - 0.06, cz + 0.15), v3(0.85, 0.95, 1.0), .emissive, .glass);
        }
    }
    for ([_]f32{ 9, 33, 57, 87 }, 0..) |lx, i| {
        const tint = if (i % 2 == 0) v3(0.8, 1.0, 0.9) else v3(1.0, 0.95, 0.82);
        map.addLight(v3(lx, ly - 0.45, lz[0]), tint * vec.s(2.3), 15);
    }
    // Platform 6 east of the arches.
    for ([_]f32{ 63, 99 }) |lx| {
        map.addLight(v3(lx, ly - 0.45, lz[1]), v3(1.0, 0.95, 0.82) * vec.s(2.3), 15);
    }
    map.flicker_light = map.light_count;
    map.addLight(v3(flicker_x, ly - 0.45, lz[1]), v3(0.85, 1.0, 0.95) * vec.s(2.3), 15);
    const fl = map.add(v3(flicker_x - 1.2, ly - 0.14, lz[1] - 0.15), v3(flicker_x + 1.2, ly - 0.06, lz[1] + 0.15), v3(0.85, 1.0, 0.95), .emissive, .glass);
    fl.solid = false;
    fl.dynamic = true;
    fl.ao = false;
    map.flicker_box = map.indexOf(fl);
    // A red signal on the wall of the running tunnel east of platform 5,
    // clear of the train.
    const sig_z = t5_c - 1.62;
    deco(v3(plat_x[1] + 8, rail_y + 1.9, sig_z - 0.06), v3(plat_x[1] + 8.2, rail_y + 2.1, sig_z + 0.04), v3(1.0, 0.05, 0.02), .emissive, .glass);
    map.addLight(v3(plat_x[1] + 8.1, rail_y + 2.0, t5_c - 1.42), v3(2.5, 0.08, 0.03), 5);

    // Danger boards on the walls of the running tunnels where the live
    // rail starts to kill (liveRail).
    for ([_]f32{ plat_x[0] - deep_shock, plat_x[1] + deep_shock }) |sx| {
        for (tubes) |t| {
            const bz = t.c - t.side * 1.6;
            deco(v3(sx - 0.6, rail_y + 0.5, @min(bz, bz - t.side * 0.04)), v3(sx + 0.6, rail_y + 1.5, @max(bz, bz - t.side * 0.04)), yellow, .paint, .sheet_metal);
        }
    }

    // The Piccadilly train on platform 5: a 6-car 1973 Stock train
    // (train_car.zig, map.zig Train). A full map (map.dropped) has no
    // train. The doors open on the platform side (+Z).
    const tb = train_car.body(&train_car.stock_1973, t5_c, rail_y, y + 0.02, 1);
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

// ---- The train indicators ------------------------------------------------------

/// A dot-matrix board over each platform (platform_display.zig), two along
/// each platform. Their text follows the trains: the deep train stops at
/// platform 5 and runs west, the parked train stands at platform 2. The
/// District boards hang from the roof arch, the Piccadilly boards from the
/// ceiling over the middle of the platform.
fn platformDisplays() void {
    const district = [_]struct { n: u8, dest: []const u8, track: usize, s: displays.Service }{
        .{ .n = 1, .dest = "Edgware Road", .track = 0, .s = .none },
        .{ .n = 2, .dest = "Tower Hill", .track = 1, .s = .parked_train },
        .{ .n = 3, .dest = "Wimbledon", .track = 2, .s = .none },
        .{ .n = 4, .dest = "Richmond", .track = 3, .s = .none },
    };
    for (district) |d| {
        const t = track_c[d.track];
        // The platform edge is on the side of the bed toward the island.
        const edge = if (t.away < 0) t.bed[1] else t.bed[0];
        const z = edge + t.away * -1.2;
        displays.add(.{ .number = d.n, .dest = d.dest, .service = d.s, .board_z = z, .floor_y = 0, .hang_y = archY(z), .xs = .{ -40, 38 } });
    }
    displays.add(.{ .number = 5, .dest = "Heathrow T5", .service = .deep_train, .board_z = (p5[0] + p5[1]) / 2, .floor_y = deep_y, .hang_y = deep_ceil, .xs = .{ 24, 84 } });
    displays.add(.{ .number = 6, .dest = "Cockfosters", .service = .none, .board_z = (p6[0] + p6[1]) / 2, .floor_y = deep_y, .hang_y = deep_ceil, .xs = .{ 24, 84 } });
}
