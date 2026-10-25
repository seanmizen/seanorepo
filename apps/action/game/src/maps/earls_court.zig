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
/// Past this |x| along the District lines the live rail kills. The islands
/// are 120 m long, from -shock_x to shock_x, out under the concourse decks.
/// shock_x is the far face of the barrier at each end of each island
/// (platformEnd), so a player sees the barrier before the live rail.
pub const shock_x: f32 = 60;
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
// The escalators and the deep level. Two escalator units side by side,
// with the sizes of a London Underground unit: a step 1 m wide, a unit
// 1.6 m wide over its balustrades, steps 0.4 m deep at 30 degrees. A
// decking separates the units, and an outer decking runs along each wall.
pub const esc_step_w: f32 = 1.0;
/// One balustrade: the skirt, the panel, the handrail.
const esc_bal: f32 = 0.3;
const esc_deck: f32 = 0.8;
const esc_outer: f32 = 0.2;
const esc_cz: f32 = -22.5;
const esc_half: f32 = esc_outer + 2 * esc_bal + esc_step_w + esc_deck / 2;
/// The inner faces of the shaft walls.
const esc_z = [2]f32{ esc_cz - esc_half, esc_cz + esc_half };
/// The middle of the steps of each unit. The north unit goes down (east),
/// the south unit comes up.
pub const esc_lane_z = [2]f32{ esc_cz - esc_deck / 2 - esc_bal - esc_step_w / 2, esc_cz + esc_deck / 2 + esc_bal + esc_step_w / 2 };
pub const esc_top_x: f32 = -30;
pub const esc_steps = 41;
pub const esc_rise: f32 = (mid_y - deep_y) / @as(f32, esc_steps);
pub const esc_run: f32 = esc_rise * 1.732; // 30 degrees
pub const esc_bottom_x: f32 = esc_top_x + esc_run * esc_steps;
/// The flat steps at each end, between the slope and the comb plate.
pub const esc_flat = 2;
const esc_flat_len: f32 = esc_run * esc_flat;
const esc_comb: f32 = 0.3;
/// The handrail turns round its newel this far past the end of the slope.
const esc_newel: f32 = 1.6;
/// The lower hall at the foot of the escalators, as wide as the shaft. The
/// corridor between the platforms goes on east of it.
const esc_hall_x1: f32 = esc_bottom_x + 5.5;
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

/// The paint of the panels of the railings, and of the bars of the
/// platform-end barriers (platformEnd).
const railing_paint = v3(0.09, 0.17, 0.13);
const handrail_wood = v3(0.3, 0.15, 0.08);

/// A railing at floor height y: framed panels of painted iron between
/// posts, a top rail and a base rail, and a timber handrail on top. One of
/// the two ranges is thin. The panels are the collision: a bullet does not
/// go through the railing.
fn railing(x0: f32, x1: f32, z0: f32, z1: f32, y: f32) void {
    boxNoAo(v3(x0, y, z0), v3(x1, y + 1.1, z1), railing_paint, .paint, .metal);
    deco(v3(x0 - 0.04, y + 1.1, z0 - 0.04), v3(x1 + 0.04, y + 1.17, z1 + 0.04), handrail_wood, .wood, .wood);
    // The frame stands 2 cm proud of each face of the panel.
    const p: f32 = 0.02;
    const along_x = x1 - x0 > z1 - z0;
    const len = if (along_x) x1 - x0 else z1 - z0;
    for ([_][2]f32{ .{ 0, 0.12 }, .{ 0.98, 1.1 } }) |h| {
        deco(v3(x0 - p, y + h[0], z0 - p), v3(x1 + p, y + h[1], z1 + p), iron, .paint, .metal);
    }
    const n: usize = @intFromFloat(@max(1, @round(len / 1.5)));
    for (0..n + 1) |i| {
        const c = @min(@max(len * @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(n)), 0.04), len - 0.04);
        if (along_x) {
            deco(v3(x0 + c - 0.04, y, z0 - p), v3(x0 + c + 0.04, y + 1.1, z1 + p), iron, .paint, .metal);
        } else {
            deco(v3(x0 - p, y, z0 + c - 0.04), v3(x1 + p, y + 1.1, z0 + c + 0.04), iron, .paint, .metal);
        }
    }
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
        // The yellow nosing at the front edge of the tread.
        const nose = if (dir > 0) @max(xa, xb) - 0.06 else @min(xa, xb);
        deco(v3(nose, top, z0), v3(nose + 0.06, top + 0.012, z1), yellow, .paint, .concrete);
    }
    // The banisters: a round handrail 0.9 m over the line of the step
    // fronts (the ramp), and a knee rail under it, on round posts. The
    // rails bend to the level at each floor and go on 0.3 m past the
    // flight to an end post. Invisible boxes along the handrail stop the
    // player.
    const rail_h: f32 = 0.9;
    const knee_h: f32 = 0.45;
    // The line of the step fronts, level on each floor.
    const line = struct {
        x_top: f32,
        y_top: f32,
        dir: f32,
        floors: [2]f32,
        fn at(l: @This(), x: f32) f32 {
            return std.math.clamp(l.y_top + rise - rise * (x - l.x_top) * l.dir / run, l.floors[1], l.floors[0]);
        }
    }{ .x_top = x_top, .y_top = y_top, .dir = dir, .floors = floors };
    const x_ends = [2]f32{ x_hi - dir * 0.3, x_lo + dir * 0.3 };
    for ([_]f32{ z0 + 0.05, z1 - 0.05 }) |z| {
        for ([_]f32{ rail_h, knee_h }, [_]f32{ 0.025, 0.015 }) |h, r| {
            map.rail(&.{
                v3(x_ends[0], floors[0] + h, z),
                v3(x_hi, floors[0] + h, z),
                v3(x_lo, floors[1] + h, z),
                v3(x_ends[1], floors[1] + h, z),
            }, r, 0.25, steel, .metal, .metal);
        }
        for (x_ends, floors) |x, f| map.rod(v3(x, f, z), v3(x, f + rail_h, z), 0.025, steel, .metal, .metal);
        var i: usize = 0;
        while (i < n) : (i += 2) {
            const fi: f32 = @floatFromInt(i);
            const x = x_top + dir * run * (fi + 0.5);
            const tread = y_top - rise * fi;
            map.rod(v3(x, tread, z), v3(x, line.at(x) + rail_h, z), 0.02, steel, .metal, .metal);
        }
        // The collision, in parts of up to 1.5 m along the rail.
        const len = @abs(x_ends[1] - x_ends[0]);
        const parts = @ceil(len / 1.5);
        var k: f32 = 0;
        while (k < parts) : (k += 1) {
            const xa = x_ends[0] + dir * len * k / parts;
            const xb = x_ends[0] + dir * len * (k + 1) / parts;
            map.addSolid(v3(@min(xa, xb), line.at(xb) + rail_h - 1.5, z - 0.05), v3(@max(xa, xb), line.at(xa) + rail_h + 0.05, z + 0.05), .metal);
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

    // Islands, with their wells, their edges, and the barriers and ramps
    // at their ends.
    for ([_][2]f32{ island_a, island_b }) |is| {
        const cz = (is[0] + is[1]) / 2;
        var buf: [wells.len]Rect = undefined;
        // The carve also makes the landings behind the barriers.
        const land = shock_x + end_land;
        map.carve(rect(-land, land, is[0], is[1]), bed_y, 0, islandWells(cz, &buf), platform_c, .concrete, .concrete);
        platformEdges(is);
        // Island A has the eastbound tracks, island B the westbound tracks.
        // A train stops at the end where it leaves.
        const leave: f32 = if (cz < 0) 1 else -1;
        for ([_]f32{ -1, 1 }) |dir| platformEnd(is, dir, dir == leave);
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

// ---- The edges and the ends of the islands -------------------------------------
//
// As at a real Underground platform end:
// - A railing with a gate goes across the island. Its far face is at
//   shock_x, where the live rail starts to kill. A sign on the gate says
//   NO ENTRY, AUTHORISED PERSONNEL ONLY.
// - Behind the gate the island goes on for a short landing. Then a ramp goes
//   down to track level, in the middle of the island.
// - The yellow line stops short of the barrier. The white line and the
//   coping go on to the end of the island.
// - A stop board for the driver (S7, the stock) hangs at the end where
//   the trains leave, just short of the barrier.
// The barrier is 1.1 m high, as each railing of the map, so a player can
// vault it. It does not stop a player: the tracks are open. It shows where
// the live rail starts.

/// The depth of the barrier along the line.
const bar_d: f32 = 0.1;
/// The landing behind the barrier, and the ramp after it.
const end_land: f32 = 1.2;
const ramp_len: f32 = 5;
const ramp_w: f32 = 1.2;
const coping_c = v3(0.6, 0.58, 0.54);
const line_white = v3(0.86, 0.86, 0.83);
const sign_white = v3(0.92, 0.92, 0.9);
const sign_black = v3(0.02, 0.02, 0.025);

/// The x range from a to b along the line toward `dir` (+1 east, -1 west).
fn span(dir: f32, a: f32, b: f32) [2]f32 {
    return .{ @min(dir * a, dir * b), @max(dir * a, dir * b) };
}

/// The z range from a to b in from an island edge. `in` is the direction
/// into the island.
fn edgeBand(edge: f32, in: f32, a: f32, b: f32) [2]f32 {
    return .{ @min(edge + in * a, edge + in * b), @max(edge + in * a, edge + in * b) };
}

/// The two edges of an island: a white line on the nose of the coping, the
/// coping stones, and the yellow line behind them.
fn platformEdges(is: [2]f32) void {
    const end = shock_x + end_land;
    const stop = shock_x - bar_d - 0.15;
    for ([_]f32{ is[0], is[1] }, [_]f32{ 1, -1 }) |edge, in| {
        const w = edgeBand(edge, in, 0, 0.1);
        const c = edgeBand(edge, in, 0.1, 0.6);
        const y = edgeBand(edge, in, 0.6, 0.75);
        deco(v3(-end, 0, w[0]), v3(end, 0.012, w[1]), line_white, .paint, .concrete);
        deco(v3(-end, 0, c[0]), v3(end, 0.008, c[1]), coping_c, .concrete, .concrete);
        deco(v3(-stop, 0, y[0]), v3(stop, 0.012, y[1]), yellow, .paint, .concrete);
    }
}

/// True when column `col` (0 at the left) of a font row is lit.
fn pixelOn(bits: u5, col: usize) bool {
    return bits & (@as(u5, 0b10000) >> @intCast(col)) != 0;
}

/// The end of the run of lit pixels that starts at column k of a font row,
/// or null when no run starts there.
fn runFrom(bits: u5, k: usize) ?usize {
    if (!pixelOn(bits, k) or (k > 0 and pixelOn(bits, k - 1))) return null;
    var e = k + 1;
    while (e < 5 and pixelOn(bits, e)) e += 1;
    return e;
}

/// Text in the pixel font of the train indicators (platform_display.zig),
/// on a sign face at `a` along the line toward `dir`. The face is toward the
/// middle of the station. The middle of the text is at z_mid, its top at `top`.
fn signText(text: []const u8, dir: f32, a: f32, z_mid: f32, top: f32, px: f32, color: V3) void {
    // A reader who looks toward `dir` reads toward +Z at the east end and
    // toward -Z at the west end.
    const m = Mat4{ .data = .{ 0, 0, dir, 0, 0, 1, 0, 0, -dir, 0, 0, 0, dir * a, top, z_mid, 1 } };
    pixelText(m, text, px, 0.003, color, .paint, .sheet_metal);
}

/// Text in the pixel font of the train indicators, in the frame m: it reads
/// along local X, local Y is up, and the text stands `depth` out along local
/// Z. The middle of the text is at the origin, its top at y = 0. One
/// decoration for each run of lit pixels in a row, and for the same run in
/// the rows below it.
fn pixelText(m: Mat4, text: []const u8, px: f32, depth: f32, color: V3, mat: Mat, surface: Surface) void {
    const cols: f32 = @floatFromInt(text.len * 6 - 1);
    const x0 = -cols * px / 2;
    for (text, 0..) |ch, i| {
        const g = displays.glyph(ch);
        for (g, 0..) |bits, r| {
            for (0..5) |k| {
                const e = runFrom(bits, k) orelse continue;
                // The row above has the same run: that decoration has it.
                if (r > 0 and runFrom(g[r - 1], k) == e) continue;
                var rows: usize = 1;
                while (r + rows < g.len and runFrom(g[r + rows], k) == e) rows += 1;
                const ya = -@as(f32, @floatFromInt(r + rows)) * px;
                const yb = -@as(f32, @floatFromInt(r)) * px;
                const xa = x0 + @as(f32, @floatFromInt(i * 6 + k)) * px;
                const xb = x0 + @as(f32, @floatFromInt(i * 6 + e)) * px;
                map.addDecor(m, v3(xa, ya, 0), v3(xb, yb, depth), color, mat, surface);
            }
        }
    }
}

/// The end of an island toward `dir`: the barrier with its gate and sign,
/// the landing, the ramp, and a stop board on each edge if `stop_board`.
fn platformEnd(is: [2]f32, dir: f32, stop_board: bool) void {
    const cz = (is[0] + is[1]) / 2;
    const near = shock_x - bar_d; // the face of the barrier toward the platform
    const mid = shock_x - bar_d / 2;

    // The ramp: a sloped slab of concrete, white lines along its sides, and
    // a map.Ramp to walk on.
    const r0 = shock_x + end_land;
    const rx = span(dir, r0, r0 + ramp_len);
    const rz = [2]f32{ cz - ramp_w / 2, cz + ramp_w / 2 };
    map.addRamp(.{
        .x0 = rx[0],
        .x1 = rx[1],
        .z0 = rz[0],
        .z1 = rz[1],
        .y0 = if (dir > 0) 0 else bed_y,
        .y1 = if (dir > 0) bed_y else 0,
        .bottom = bed_y,
    });
    const drop = -bed_y;
    const slope = @sqrt(ramp_len * ramp_len + drop * drop);
    // Local X goes down the ramp from its top edge, local Y is up from the
    // surface. The slab is deep enough to go into the ballast.
    const m = vec.translate(v3(dir * r0, 0, cz)).mul(Mat4.rotationZ(-dir * std.math.atan2(drop, ramp_len)));
    const lx = if (dir > 0) [2]f32{ 0, slope } else [2]f32{ -slope, 0 };
    map.addDecor(m, v3(lx[0], -0.9, rz[0] - cz), v3(lx[1], 0, rz[1] - cz), platform_c, .concrete, .concrete);
    for ([_]f32{ -1, 1 }) |side| {
        const e = side * ramp_w / 2;
        map.addDecor(m, v3(lx[0], 0, @min(e, e - side * 0.08)), v3(lx[1], 0.008, @max(e, e - side * 0.08)), line_white, .paint, .concrete);
    }
    // The slab tilts, so its top end leaves a gap under the edge of the
    // landing. This block fills it.
    const fill = span(dir, r0, r0 + 0.16);
    deco(v3(fill[0], bed_y, rz[0]), v3(fill[1], -0.03, rz[1]), platform_c, .concrete, .concrete);

    // The barrier: as the railings of the map (railing), a frame of
    // painted iron with posts, a base rail, a top rail and a timber
    // handrail. Round bars fill it, so a player sees the ramp behind it. A
    // gate at the top of the ramp has the same frame and bars. One solid
    // box for all of it: a bullet does not go through.
    const bx = span(dir, near, shock_x);
    map.addSolid(v3(bx[0], 0, is[0]), v3(bx[1], 1.1, is[1]), .metal);
    const fr = span(dir, mid - 0.03, mid + 0.03);
    const gate = [2]f32{ cz - 0.65, cz + 0.65 };
    for ([_][2]f32{ .{ is[0], gate[0] }, .{ gate[1], is[1] } }) |sec| {
        deco(v3(fr[0], 0, sec[0]), v3(fr[1], 0.12, sec[1]), iron, .paint, .metal);
        deco(v3(fr[0], 0.98, sec[0]), v3(fr[1], 1.1, sec[1]), iron, .paint, .metal);
        const cap = span(dir, mid - 0.06, mid + 0.06);
        deco(v3(cap[0], 1.1, sec[0]), v3(cap[1], 1.17, sec[1]), handrail_wood, .wood, .wood);
        // Posts at the ends of the section and about each 1.1 m.
        const n: usize = 3;
        for (0..n + 1) |k| {
            const z = sec[0] + 0.04 + (sec[1] - sec[0] - 0.08) * @as(f32, @floatFromInt(k)) / @as(f32, @floatFromInt(n));
            deco(v3(fr[0], 0, z - 0.04), v3(fr[1], 1.1, z + 0.04), iron, .paint, .metal);
        }
        var z = sec[0] + 0.14;
        while (z < sec[1] - 0.1) : (z += 0.12) {
            map.rod(v3(dir * mid, 0.12, z), v3(dir * mid, 0.98, z), 0.012, railing_paint, .paint, .metal);
        }
    }
    // The gate leaf: a frame with bars, its hinges on the post at -Z, and a
    // latch at the free side.
    const leaf = [2]f32{ gate[0] + 0.03, gate[1] - 0.02 };
    const lf = span(dir, mid - 0.02, mid + 0.02);
    deco(v3(lf[0], 0.12, leaf[0]), v3(lf[1], 0.2, leaf[1]), iron, .paint, .metal);
    deco(v3(lf[0], 0.98, leaf[0]), v3(lf[1], 1.06, leaf[1]), iron, .paint, .metal);
    for ([_]f32{ leaf[0], leaf[1] - 0.06 }) |z| deco(v3(lf[0], 0.12, z), v3(lf[1], 1.06, z + 0.06), iron, .paint, .metal);
    var gz = leaf[0] + 0.15;
    while (gz < leaf[1] - 0.1) : (gz += 0.12) {
        map.rod(v3(dir * mid, 0.2, gz), v3(dir * mid, 0.98, gz), 0.012, railing_paint, .paint, .metal);
    }
    for ([_]f32{ 0.25, 0.85 }) |hy| deco(v3(fr[0], hy, gate[0] - 0.005), v3(fr[1], hy + 0.08, leaf[0] + 0.02), steel, .metal, .metal);
    const latch = span(dir, mid - 0.04, mid + 0.04);
    deco(v3(latch[0], 0.88, leaf[1] - 0.1), v3(latch[1], 0.96, leaf[1]), steel, .metal, .metal);

    // The sign on the gate, toward the platform: a white plate with a red
    // NO ENTRY disc and black text.
    const plate_a = mid - 0.02;
    const plate = span(dir, plate_a - 0.01, plate_a);
    deco(v3(plate[0], 0.48, cz - 0.26), v3(plate[1], 0.96, cz + 0.26), sign_white, .paint, .sheet_metal);
    const sf = plate_a - 0.01;
    const turn = Mat4.rotationY(std.math.pi / 2.0);
    map.addDisc(vec.translate(v3(dir * (sf - 0.003), 0.83, cz)).mul(turn), 0.09, 0.006, red, .paint, .sheet_metal);
    const bar_x = span(dir, sf - 0.009, sf - 0.006);
    deco(v3(bar_x[0], 0.81, cz - 0.065), v3(bar_x[1], 0.85, cz + 0.065), sign_white, .paint, .sheet_metal);
    signText("NO ENTRY", dir, sf, cz, 0.715, 0.009, red);
    signText("AUTHORISED", dir, sf, cz, 0.625, 0.0068, sign_black);
    signText("PERSONNEL ONLY", dir, sf, cz, 0.555, 0.0052, sign_black);

    // The stop boards: a white board with S7 near each edge, toward the
    // train that comes in. Two rods hang it from the deck above, so it is
    // above head height and has no post to walk into.
    if (!stop_board) return;
    const sa = shock_x - 0.9;
    for ([_]f32{ is[0], is[1] }, [_]f32{ 1, -1 }) |edge, in| {
        const z = edge + in * 0.95;
        for ([_]f32{ -0.12, 0.12 }) |dz| map.rod(v3(dir * (sa - 0.04), 2.25, z + dz), v3(dir * (sa - 0.04), deck_y, z + dz), 0.012, iron, .paint, .metal);
        const board = span(dir, sa - 0.05, sa - 0.03);
        deco(v3(board[0], 1.95, z - 0.17), v3(board[1], 2.25, z + 0.17), sign_white, .paint, .sheet_metal);
        signText("S7", dir, sa - 0.05, z, 2.177, 0.022, sign_black);
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
/// The brushed steel of the lift doors and their frames.
const lift_steel = v3(0.6, 0.61, 0.62);
const sill_c = v3(0.45, 0.45, 0.44);
/// The clear width of a lift doorway. A two-speed door needs a pocket of
/// half this width on each side (map.doorLeaves). 1.5 x 1.45 m and the
/// leaf overlap fit in the 2.2 m inside a shaft. The landing audit needs
/// more than 1.44 m: lines at 0.4 m each side of the middle, and the
/// player radius.
const lift_opening: f32 = 1.45;
const lift_door_h: f32 = 2.3;

/// A door half: a dynamic collision box. Null when the map is full.
fn doorBox(p: [2]V3) ?usize {
    const db = map.add(p[0], p[1], lift_steel, .steel, .sheet_metal);
    db.dynamic = true;
    db.ao = false;
    db.visible = false;
    return map.indexOf(db);
}

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
    // Behind the face, from the landing in: the landing doors on a sill,
    // the cab doors, the front of the cab. The doors are two-speed
    // (map.doorLeaves): open, they stand behind the jambs, inside the
    // shaft walls.
    const a0 = if (door_on_x) r.z0 else r.x0;
    const a1 = if (door_on_x) r.z1 else r.x1;
    const f0 = if (door_on_x) r.x0 else r.z0;
    const f1 = f0 + 0.1;
    const da0 = (a0 + a1 - lift_opening) / 2;
    const da1 = (a0 + a1 + lift_opening) / 2;
    const land_door = [2]f32{ f0 + 0.105, f0 + 0.17 };
    const cab_door = [2]f32{ f0 + 0.185, f0 + 0.25 };
    const cab_f = f0 + 0.27;
    for ([_][2]f32{ .{ a0, da0 }, .{ da1, a1 } }) |j| {
        const p = face(door_on_x, j[0], j[1], bottom, top, f0, f1);
        boxNoAo(p[0], p[1], frame_c, .metal, .metal);
    }
    const mid_panel = face(door_on_x, da0, da1, levels[0] + lift_door_h, levels[1], f0, f1);
    boxNoAo(mid_panel[0], mid_panel[1], frame_c, .metal, .metal);
    const top_panel = face(door_on_x, da0, da1, levels[1] + lift_door_h, top, f0, f1);
    boxNoAo(top_panel[0], top_panel[1], frame_c, .metal, .metal);
    for (levels) |ly| {
        const p = face(door_on_x, da0, da1, ly + 2.35, ly + 2.6, f0 - 0.04, f0);
        deco(p[0], p[1], v3(0.05, 0.25, 0.6), .emissive, .glass);
        // A steel frame round the doorway.
        const fw = 0.07;
        for ([_][2]f32{ .{ da0 - fw, da0 }, .{ da1, da1 + fw } }) |j| {
            const q = face(door_on_x, j[0], j[1], ly, ly + lift_door_h + 0.05, f0 - 0.015, f0);
            deco(q[0], q[1], lift_steel, .steel, .metal);
        }
        const head = face(door_on_x, da0 - fw, da1 + fw, ly + lift_door_h, ly + lift_door_h + 0.05, f0 - 0.015, f0);
        deco(head[0], head[1], lift_steel, .steel, .metal);
        // The landing sill under the landing doors and their pockets
        // (decoration: the gap to the cab floor is narrower than a player).
        const sill = face(door_on_x, a0 + 0.1, a1 - 0.1, ly - 0.1, ly + 0.003, f1, cab_door[0] - 0.01);
        deco(sill[0], sill[1], sill_c, .steel, .metal);
    }

    // The cab: a floor and a lit ceiling (dynamic). main.zig draws its
    // walls and its doors (lift_doors.zig).
    const inner_min = if (door_on_x) v3(cab_f, -0.15, r.z0 + 0.1) else v3(r.x0 + 0.1, -0.15, cab_f);
    const inner_max = v3(r.x1 - 0.1, 0, r.z1 - 0.1);
    const fb = map.add(inner_min, inner_max, v3(0.25, 0.25, 0.27), .metal, .metal);
    fb.dynamic = true;
    fb.ao = false;
    const ceil_min = if (door_on_x) v3(cab_door[0], 2.45, inner_min[2]) else v3(inner_min[0], 2.45, cab_door[0]);
    const cbx = map.add(ceil_min, v3(inner_max[0], 2.57, inner_max[2]), v3(0.55, 0.6, 0.65), .emissive, .glass);
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
        .cab_door_box = undefined,
        .cab_door_closed = undefined,
        .y = levels[0] + 0.02,
        .speed = speed,
        .door_on_x = door_on_x,
    };
    // The door halves are collision boxes. main.zig draws their leaves.
    const mid = (da0 + da1) / 2;
    const halves = [2][2]f32{ .{ da0, mid }, .{ mid, da1 } };
    for (levels, 0..) |ly, lv| {
        for (halves, 0..) |h, hi| {
            const p = face(door_on_x, h[0], h[1], ly, ly + lift_door_h, land_door[0], land_door[1]);
            l.door_box[lv][hi] = doorBox(p) orelse return;
            l.door_closed[lv][hi] = .{ p[0], p[1] };
        }
    }
    for (halves, 0..) |h, hi| {
        const p = face(door_on_x, h[0], h[1], 0, lift_door_h, cab_door[0], cab_door[1]);
        l.cab_door_box[hi] = doorBox(p) orelse return;
        l.cab_door_closed[hi] = .{ p[0], p[1] };
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

    // The ticket hall. Its front on Earls Court Road is stationFront.
    const hz0: f32 = -12;
    const hz1: f32 = 8;
    box(v3(x1, y, conc_z0 - 0.6), v3(x1 + 0.4, y + 6.5, hz0), red_brick, .brick, .brick);
    box(v3(x1, y, hz1), v3(x1 + 0.4, y + 6.5, wall_s + 0.6), red_brick, .brick, .brick);
    box(v3(x1, y, hz0 - 0.4), v3(hall_x1, y + 5.5, hz0), cream, .paint, .plaster);
    box(v3(x1, y, hz1), v3(hall_x1, y + 5.5, hz1 + 0.4), cream, .paint, .plaster);
    box(v3(x1, y + 5.5, hz0 - 0.4), v3(hall_x1, y + 6, hz1 + 0.4), v3(0.75, 0.72, 0.66), .concrete, .concrete);
    // The gate line: 8 lanes, IN on the north half (gates.zig).
    gates.addLine(71, y, hz0, hz1, -2, 8, -1);
    map.add(v3(71.5, y + 5.35, -3), v3(73.5, y + 5.5, -1), v3(1.0, 0.9, 0.75), .emissive, .glass).solid = false;
    map.addLight(v3(72.5, y + 4.8, -2), v3(1.3, 1.05, 0.8), 12);
    stationFront();
    nextDoor();
    southBuilding();

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
    // phone box, a bus and a black cab south of the crossing (they leave
    // the station front clear), and a street lamp.
    const tx = sx0 + 1.4;
    const tz: f32 = -15;
    box(v3(tx - 0.62, y + 0.12, tz - 0.62), v3(tx + 0.62, y + 2.75, tz + 0.62), v3(0.03, 0.1, 0.36), .paint, .wood);
    deco(v3(tx - 0.66, y + 2.35, tz - 0.66), v3(tx + 0.66, y + 2.6, tz + 0.66), v3(0.02, 0.02, 0.025), .paint, .wood);
    deco(v3(tx - 0.5, y + 2.75, tz - 0.5), v3(tx + 0.5, y + 2.9, tz + 0.5), v3(0.03, 0.1, 0.36), .paint, .wood);
    deco(v3(tx - 0.08, y + 2.9, tz - 0.08), v3(tx + 0.08, y + 3.15, tz + 0.08), v3(0.9, 0.95, 1.0), .emissive, .glass);
    box(v3(tx - 0.45, y + 0.12, -18.5), v3(tx + 0.45, y + 2.6, -17.6), v3(0.7, 0.04, 0.03), .paint, .metal);
    const bus_red = v3(0.72, 0.05, 0.04);
    box(v3(sx0 + 3.6, y + 0.3, 18), v3(sx0 + 6.1, y + 4.4, 29), bus_red, .paint, .sheet_metal);
    for ([_]f32{ 1.4, 3.3 }) |wy| deco(v3(sx0 + 3.55, y + wy, 18.2), v3(sx0 + 6.15, y + wy + 0.9, 28.8), v3(0.04, 0.05, 0.06), .paint, .glass);
    box(v3(sx0 + 7.8, y + 0.2, 19.5), v3(sx0 + 9.5, y + 1.3, 24), v3(0.02, 0.02, 0.025), .paint, .sheet_metal);
    // The lamp head hangs from an arm over the road, clear of the post: a
    // light inside a solid shape is in its own shadow (render.zig).
    deco(v3(sx0 + 2.4, y, 19.4), v3(sx0 + 2.6, y + 5.35, 19.6), iron, .metal, .metal);
    deco(v3(sx0 + 2.6, y + 5.25, 19.45), v3(sx0 + 3.6, y + 5.35, 19.55), iron, .metal, .metal);
    map.addSolid(v3(sx0 + 2.4, y, 19.4), v3(sx0 + 2.6, y + 5.2, 19.6), .metal);
    map.add(v3(sx0 + 3.2, y + 5.1, 19.2), v3(sx0 + 3.8, y + 5.25, 19.8), v3(1.0, 0.7, 0.35), .emissive, .glass).solid = false;
    map.addLight(v3(sx0 + 3.5, y + 4.75, 19.5), v3(1.6, 1.0, 0.45), 14);
    streetFurniture();
}

// ---- The Earls Court Road front ----------------------------------------------------

// The station front on Earls Court Road is the 1906 District Railway front:
// glazed terracotta in buff and tan. (The Leslie Green stations of 1906
// have ox-blood red tiles. This front follows the photos.) Arched windows with white glazing bars stand between
// pilasters. A frieze carries the names of the railways, a balustrade runs
// along the top, and a raised segmental pediment crowns the middle bay.
// The portico over the entrance has the blue UNDERGROUND sign and two
// roundels on brackets. A restaurant (LEEK) fills the two bays north of
// the ticket hall. Next door to the north are three shops in yellow stock
// brick. Each shop name is an invented parody.

/// The face of the front, on the pavement.
const front_x: f32 = hall_x1 + 0.6;
const terracotta = v3(0.66, 0.35, 0.16);
/// The lighter blocks: the sills, the surrounds, the cornices.
const dressing = v3(0.76, 0.49, 0.26);
const pilaster_c = v3(0.58, 0.3, 0.13);
const frieze_c = v3(0.36, 0.44, 0.39);
const frieze_text = v3(0.8, 0.83, 0.74);
const glazing = v3(0.05, 0.06, 0.07);
const bar_white = v3(0.88, 0.88, 0.85);
const navy = v3(0.04, 0.06, 0.18);
const stock_brick = v3(0.62, 0.53, 0.34);
const sign_gold = v3(0.86, 0.66, 0.3);

// Heights above the street.
/// The top of the front wall, under the balustrade.
const front_top: f32 = 9.8;
/// The top of the shop openings, under the fascias. The shops next door
/// have the same height.
const shop_top: f32 = 3.4;
const sill_y: f32 = 4.7;
const crown_y: f32 = 8.4;
const frieze_y = [2]f32{ 8.75, 9.45 };

/// The hall doors in the front, north to south.
const hall_doors = [_][2]f32{ .{ -10, -7 }, .{ -3.5, -0.5 }, .{ 3, 6 } };
/// The shop openings of LEEK, north to south.
const leek_open = [_][2]f32{ .{ -24.9, -18.95 }, .{ -18.25, -12.75 } };
/// The centres of the pilasters, north to south. Each one is 0.7 m wide,
/// on a pier box of the full height.
const pilasters = [_]f32{ -25.25, -18.6, -12.4, -5.25, 1.25, 8.4, 12.85 };
/// The words on the frieze of each bay, north to south. Bay 3 has the
/// pediment.
const bay_text = [_][]const u8{ "RAILWAY", "BROMPTON", "G.N. PICCADILLY &", "EARLS COURT", "RAILWAY", "DISTRICT" };
const bay_window = [_]f32{ 5.0, 3.6, 3.8, 3.4, 3.8, 2.8 };
const pediment_bay = 3;

/// A frame on a vertical face: local X along `right`, local Y up, local Z
/// along `out` (out of the face). right x up must be out.
fn faceFrame(o: V3, right: V3, out: V3) Mat4 {
    return .{ .data = .{ right[0], right[1], right[2], 0, 0, 1, 0, 0, out[0], out[1], out[2], 0, o[0], o[1], o[2], 1 } };
}

/// A frame on a face toward +X (Earls Court Road): text reads toward -Z.
fn eastFace(o: V3) Mat4 {
    return faceFrame(o, v3(0, 0, -1), v3(1, 0, 0));
}

/// An ellipse on a face toward +X: `a` half wide along Z, `b` half high,
/// `t` thick along X, about the centre c.
fn ovalX(c: V3, a: f32, b: f32, t: f32, color: V3, mat: Mat, surface: Surface) void {
    const m = Mat4{ .data = .{ 0, 0, -a, 0, 0, b, 0, 0, 1, 0, 0, 0, c[0], c[1], c[2], 1 } };
    map.addDisc(m, 1, t, color, mat, surface);
}

/// A bar along the upper half of an ellipse on a face toward +X: `n`
/// beams, `w` wide, from x = x0 to x0 + depth.
fn arcX(x0: f32, depth: f32, cy: f32, cz: f32, a: f32, b: f32, w: f32, n: usize, color: V3, mat: Mat, surface: Surface) void {
    const xm = x0 + depth / 2;
    for (0..n) |i| {
        const t0 = std.math.pi * @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(n));
        const t1 = std.math.pi * @as(f32, @floatFromInt(i + 1)) / @as(f32, @floatFromInt(n));
        map.beam(v3(xm, cy + b * @sin(t0), cz + a * @cos(t0)), v3(xm, cy + b * @sin(t1), cz + a * @cos(t1)), w, depth, v3(1, 0, 0), color, mat, surface);
    }
}

/// An arched window in the front, about z = zc: `w` wide, from the sill
/// at y0 to the crown at y1. The head is a half ellipse, at most 1.5 m
/// high. A surround of lighter blocks, the glass, white glazing bars, a
/// sill and a keystone. Each layer is 1 cm or more in front of the one
/// behind it.
fn archWindow(zc: f32, w: f32, y0: f32, y1: f32) void {
    const fx = front_x;
    const a = w / 2;
    const rise = @min(a, 1.5);
    const spring = y1 - rise;
    const sur: f32 = 0.22;
    deco(v3(fx, y0 - 0.05, zc - a - sur), v3(fx + 0.02, spring, zc + a + sur), dressing, .terracotta, .tile);
    ovalX(v3(fx + 0.01, spring, zc), a + sur, rise + sur, 0.02, dressing, .terracotta, .tile);
    deco(v3(fx, y0 + 0.01, zc - a + 0.01), v3(fx + 0.03, spring, zc + a - 0.01), glazing, .paint, .glass);
    ovalX(v3(fx + 0.015, spring, zc), a - 0.01, rise - 0.01, 0.03, glazing, .paint, .glass);
    // The frame and the bars.
    const bx = [2]f32{ fx, fx + 0.045 };
    deco(v3(bx[0], y0, zc - a), v3(bx[1], y0 + 0.08, zc + a), bar_white, .paint, .wood);
    deco(v3(bx[0], y0, zc - a), v3(bx[1], spring, zc - a + 0.08), bar_white, .paint, .wood);
    deco(v3(bx[0], y0, zc + a - 0.08), v3(bx[1], spring, zc + a), bar_white, .paint, .wood);
    deco(v3(bx[0], spring - 0.04, zc - a), v3(bx[1], spring + 0.04, zc + a), bar_white, .paint, .wood);
    const mid = (y0 + spring) / 2;
    deco(v3(bx[0], mid - 0.03, zc - a), v3(bx[1], mid + 0.03, zc + a), bar_white, .paint, .wood);
    const n: usize = @intFromFloat(@max(2, @round(w / 0.7)));
    for (1..n) |k| {
        const dz = -a + w * @as(f32, @floatFromInt(k)) / @as(f32, @floatFromInt(n));
        const top = spring + rise * @sqrt(@max(0, 1 - (dz / a) * (dz / a))) - 0.03;
        deco(v3(bx[0], y0, zc + dz - 0.03), v3(bx[1], top, zc + dz + 0.03), bar_white, .paint, .wood);
    }
    arcX(bx[0], 0.045, spring, zc, a - 0.04, rise - 0.04, 0.08, 14, bar_white, .paint, .wood);
    arcX(bx[0], 0.045, spring, zc, a * 0.55, rise * 0.55, 0.05, 8, bar_white, .paint, .wood);
    // The sill and the keystone.
    deco(v3(fx, y0 - 0.2, zc - a - sur - 0.08), v3(fx + 0.12, y0 - 0.05, zc + a + sur + 0.08), dressing, .terracotta, .tile);
    deco(v3(fx, y1 - 0.12, zc - 0.2), v3(fx + 0.09, y1 + 0.3, zc + 0.2), dressing, .terracotta, .tile);
}

/// A shop front in an opening of a front at x = front_x, from the street
/// to `top`: a frame, stall risers under the windows, top lights over a
/// transom, and a door. The glass is a collision box only (the caller
/// adds it), so the inside shows from the street. Its face is at
/// front_x - 0.15, and the front stands on it.
const ShopFront = struct {
    z: [2]f32,
    door: [2]f32,
    /// Two leaves when true.
    double: bool = false,
    top: f32 = shop_top,
    frame: V3,
    frame_mat: Mat = .wood,
    frame_surface: Surface = .wood,
    riser: V3,
    riser_mat: Mat = .wall_tile,
    riser_surface: Surface = .tile,
    riser_h: f32 = 0.6,
};

fn shopFront(f: ShopFront) void {
    const y = street_y;
    const gx = front_x - 0.15;
    const top = y + f.top;
    const rh = y + f.riser_h;
    const fr = [2]f32{ gx, gx + 0.08 };
    const tr = top - 0.6; // the transom
    // The windows, either side of the door.
    for ([_][2]f32{ .{ f.z[0], f.door[0] - 0.1 }, .{ f.door[1] + 0.1, f.z[1] } }) |w| {
        if (w[1] - w[0] < 0.3) continue;
        deco(v3(gx, y, w[0]), v3(gx + 0.1, rh, w[1]), f.riser, f.riser_mat, f.riser_surface);
        deco(v3(gx, rh, w[0]), v3(gx + 0.12, rh + 0.08, w[1]), f.frame, f.frame_mat, f.frame_surface);
        const n: usize = @intFromFloat(@max(1, @round((w[1] - w[0]) / 1.3)));
        for (1..n) |k| {
            const z = w[0] + (w[1] - w[0]) * @as(f32, @floatFromInt(k)) / @as(f32, @floatFromInt(n));
            deco(v3(fr[0], rh + 0.08, z - 0.04), v3(fr[1], tr, z + 0.04), f.frame, f.frame_mat, f.frame_surface);
        }
    }
    // The posts at the ends and either side of the door, the transom, the head.
    for ([_][2]f32{ .{ f.z[0], f.z[0] + 0.12 }, .{ f.z[1] - 0.12, f.z[1] }, .{ f.door[0] - 0.1, f.door[0] }, .{ f.door[1], f.door[1] + 0.1 } }) |p| {
        deco(v3(fr[0], y, p[0]), v3(fr[1], top, p[1]), f.frame, f.frame_mat, f.frame_surface);
    }
    deco(v3(fr[0], tr, f.z[0]), v3(fr[1], tr + 0.1, f.z[1]), f.frame, f.frame_mat, f.frame_surface);
    deco(v3(fr[0], top - 0.1, f.z[0]), v3(fr[1], top, f.z[1]), f.frame, f.frame_mat, f.frame_surface);
    // The bars of the top lights.
    var z = f.z[0] + 0.45;
    while (z < f.z[1] - 0.3) : (z += 0.45) deco(v3(gx, tr + 0.1, z - 0.02), v3(gx + 0.06, top - 0.1, z + 0.02), f.frame, f.frame_mat, f.frame_surface);
    // The door: a kick panel, the stiles and the rails round the glass,
    // and a handle on each leaf.
    const d = f.door;
    const dx = [2]f32{ gx, gx + 0.06 };
    deco(v3(dx[0], y, d[0]), v3(dx[1], y + 0.9, d[1]), f.frame, f.frame_mat, f.frame_surface);
    deco(v3(dx[0], tr - 0.12, d[0]), v3(dx[1], tr, d[1]), f.frame, f.frame_mat, f.frame_surface);
    const leaves: usize = if (f.double) 2 else 1;
    const lw = (d[1] - d[0]) / @as(f32, @floatFromInt(leaves));
    for (0..leaves) |l| {
        const la = d[0] + lw * @as(f32, @floatFromInt(l));
        const lb = la + lw;
        deco(v3(dx[0], y + 0.9, la), v3(dx[1], tr - 0.12, la + 0.1), f.frame, f.frame_mat, f.frame_surface);
        deco(v3(dx[0], y + 0.9, lb - 0.1), v3(dx[1], tr - 0.12, lb), f.frame, f.frame_mat, f.frame_surface);
        const hz = if (l == 0 and leaves == 2) lb - 0.16 else la + 0.16;
        map.rod(v3(gx + 0.1, y + 0.85, hz), v3(gx + 0.1, y + 1.35, hz), 0.015, steel, .metal, .metal);
    }
}

/// A fascia on a face at x = front_x, from y0 to y1 over z0..z1, `depth`
/// thick, with a name on it. `px` is the size of a pixel of the letters.
fn fascia(z0: f32, z1: f32, y0: f32, y1: f32, depth: f32, color: V3, text: []const u8, px: f32, text_c: V3, text_mat: Mat) void {
    const fx = front_x;
    deco(v3(fx, street_y + y0, z0), v3(fx + depth, street_y + y1, z1), color, .paint, .sheet_metal);
    const h = 7 * px;
    pixelText(eastFace(v3(fx + depth, street_y + (y0 + y1 + h) / 2, (z0 + z1) / 2)), text, px, 0.012, text_c, text_mat, if (text_mat == .emissive) .glass else .sheet_metal);
}

/// Pendant lights over a shop floor: a cord, a shade, and a lit bulb
/// under it, at x along z0..z1.
fn pendants(x: f32, z0: f32, z1: f32, step: f32, ceil: f32, shade: V3) void {
    var z = z0;
    while (z <= z1 + 0.01) : (z += step) {
        map.rod(v3(x, ceil - 0.6, z), v3(x, ceil, z), 0.012, iron, .paint, .metal);
        map.rod(v3(x, ceil - 0.8, z), v3(x, ceil - 0.6, z), 0.17, shade, .paint, .metal);
        map.rod(v3(x, ceil - 0.86, z), v3(x, ceil - 0.8, z), 0.08, v3(1.0, 0.82, 0.55), .emissive, .glass);
    }
}

/// Rows of packs on shelves on a wall at x = wx (the room is toward +X),
/// from z0 to z1. `seed0` picks the colours.
fn shelvesX(wx: f32, z0: f32, z1: f32, rows: []const f32, seed0: u32, colors: []const V3) void {
    const y = street_y;
    var k: u32 = seed0;
    for (rows) |sh| {
        const sy = y + sh;
        deco(v3(wx, sy - 0.03, z0), v3(wx + 0.4, sy, z1), v3(0.85, 0.85, 0.86), .paint, .wood);
        var z = z0 + 0.04;
        while (z < z1 - 0.14) : (z += 0.16) {
            k += 1;
            const c = colors[@intFromFloat(vec.hash(k * 7919) * (@as(f32, @floatFromInt(colors.len)) - 0.01))];
            deco(v3(wx + 0.05, sy, z), v3(wx + 0.3, sy + 0.14 + vec.hash(k * 104729) * 0.14, z + 0.12), c, .paint, .fabric);
        }
    }
}

fn stationFront() void {
    const y = street_y;
    const fx = front_x;
    const x0 = hall_x1; // the back of the front wall
    const top = y + front_top;

    // The boxes: a pier under each pilaster, the full height, a lintel
    // over each hall door, and over each shop opening of LEEK the wall
    // with its glass under it.
    const piers = [_][2]f32{ .{ -25.6, -24.9 }, .{ -18.95, -18.25 }, .{ -12.75, -10 }, .{ -7, -3.5 }, .{ -0.5, 3 }, .{ 6, 13.2 } };
    for (piers) |p| box(v3(x0, y, p[0]), v3(fx, top, p[1]), terracotta, .terracotta, .tile);
    for (hall_doors) |d| boxNoAo(v3(x0, y + 3.8, d[0]), v3(fx, top, d[1]), terracotta, .terracotta, .tile);
    for (leek_open) |o| {
        box(v3(x0, y + shop_top, o[0]), v3(fx, top, o[1]), terracotta, .terracotta, .tile);
        map.addSolid(v3(x0, y, o[0]), v3(fx - 0.15, y + shop_top, o[1]), .glass);
    }
    // LEEK inside: the back wall, the ceiling, the wall to the shop next door.
    const lz = [2]f32{ -25.6, -12.4 };
    box(v3(74.6, y, lz[0]), v3(75, y + 3.6, lz[1]), cream, .paint, .plaster);
    box(v3(75, y + shop_top, lz[0]), v3(x0, y + 3.6, lz[1]), cream, .paint, .plaster);
    box(v3(75, y, -25.9), v3(fx, y + shop_top, -25.6), cream, .paint, .plaster);
    // The room is a collision box too: a player cannot get in, and the
    // tables and the counter need no boxes of their own.
    map.addSolid(v3(75, y, lz[0]), v3(x0, y + shop_top, lz[1]), .glass);

    // The pilasters, with grooves on the ground storey and a green panel
    // in the frieze, and a base at the foot of each.
    const py = y + 0.12; // the top of the pavement
    for (pilasters) |pz| {
        deco(v3(fx, py, pz - 0.35), v3(fx + 0.14, y + frieze_y[1], pz + 0.35), pilaster_c, .terracotta, .tile);
        var gy: f32 = 0.6;
        while (gy < 3.7) : (gy += 0.45) deco(v3(fx + 0.1, y + gy, pz - 0.35), v3(fx + 0.15, y + gy + 0.035, pz + 0.35), pilaster_c * vec.s(0.6), .paint, .tile);
        deco(v3(fx + 0.14, y + 8.9, pz - 0.2), v3(fx + 0.155, y + 9.3, pz + 0.2), frieze_c, .paint, .tile);
        deco(v3(fx, py, @max(pz - 0.42, -25.6)), v3(fx + 0.18, py + 0.25, @min(pz + 0.42, wall_s + 0.6)), dressing, .terracotta, .tile);
    }
    // The hall doors: a surround of lighter blocks.
    for (hall_doors) |d| {
        deco(v3(fx, py, d[0] - 0.25), v3(fx + 0.04, y + 3.8, d[0]), dressing, .terracotta, .tile);
        deco(v3(fx, py, d[1]), v3(fx + 0.04, y + 3.8, d[1] + 0.25), dressing, .terracotta, .tile);
        deco(v3(fx, y + 3.8, d[0] - 0.25), v3(fx + 0.04, y + 3.95, d[1] + 0.25), dressing, .terracotta, .tile);
    }

    // The string course over the ground storey, the arched windows, the
    // architrave, the frieze, the cornice with its dentils.
    const zn: f32 = -25.6;
    const zs: f32 = wall_s + 0.6;
    deco(v3(fx, y + 3.95, zn), v3(fx + 0.2, y + 4.25, zs), dressing, .terracotta, .tile);
    deco(v3(fx, y + 8.6, zn), v3(fx + 0.1, y + frieze_y[0], zs), dressing, .terracotta, .tile);
    deco(v3(fx, y + frieze_y[1], zn), v3(fx + 0.32, top, zs), dressing, .terracotta, .tile);
    var dz: f32 = zn + 0.15;
    while (dz < zs - 0.1) : (dz += 0.3) deco(v3(fx + 0.1, y + frieze_y[1] - 0.08, dz), v3(fx + 0.2, y + frieze_y[1], dz + 0.12), dressing, .terracotta, .tile);
    for (0..bay_text.len) |i| {
        const za = pilasters[i] + 0.35;
        const zb = pilasters[i + 1] - 0.35;
        const zc = (pilasters[i] + pilasters[i + 1]) / 2;
        archWindow(zc, bay_window[i], y + sill_y, y + crown_y);
        deco(v3(fx, y + frieze_y[0], za), v3(fx + 0.06, y + frieze_y[1], zb), frieze_c, .terracotta, .tile);
        pixelText(eastFace(v3(fx + 0.06, y + (frieze_y[0] + frieze_y[1]) / 2 + 0.21, zc)), bay_text[i], 0.06, 0.01, frieze_text, .paint, .tile);
    }

    // The balustrade: a die over each pilaster, and between them a base,
    // turned balusters and a coping. The pediment bay has the pediment.
    for (pilasters) |pz| {
        const dz0 = @max(pz - 0.32, -25.58);
        const dz1 = @min(pz + 0.32, wall_s + 0.58);
        deco(v3(x0 + 0.05, top, dz0), v3(fx, top + 1.05, dz1), dressing, .terracotta, .tile);
        deco(v3(x0, top + 1.05, @max(dz0 - 0.06, -25.58)), v3(fx + 0.05, top + 1.15, @min(dz1 + 0.06, wall_s + 0.58)), dressing, .terracotta, .tile);
    }
    const bal_x = (x0 + 0.1 + fx - 0.05) / 2;
    for (0..bay_text.len) |i| {
        if (i == pediment_bay) continue;
        const za = pilasters[i] + 0.3;
        const zb = pilasters[i + 1] - 0.3;
        deco(v3(x0 + 0.1, top, za), v3(fx - 0.05, top + 0.2, zb), dressing, .terracotta, .tile);
        deco(v3(x0 + 0.08, top + 0.8, za), v3(fx - 0.02, top + 0.95, zb), dressing, .terracotta, .tile);
        var z = za + 0.2;
        while (z < zb - 0.1) : (z += 0.24) {
            map.rod(v3(bal_x, top + 0.2, z), v3(bal_x, top + 0.8, z), 0.055, dressing, .terracotta, .tile);
            map.rod(v3(bal_x, top + 0.3, z), v3(bal_x, top + 0.55, z), 0.085, dressing, .terracotta, .tile);
        }
    }
    // The pediment: a half ellipse of blocks, its lower half in the wall,
    // a moulding along its edge, and an oval panel.
    const pc = (pilasters[pediment_bay] + pilasters[pediment_bay + 1]) / 2;
    const pa = (pilasters[pediment_bay + 1] - pilasters[pediment_bay]) / 2 - 0.35;
    ovalX(v3(fx - 0.3, top, pc), pa, 1.9, 0.5, terracotta, .terracotta, .tile);
    arcX(fx - 0.15, 0.3, top, pc, pa + 0.08, 1.98, 0.2, 16, dressing, .terracotta, .tile);
    ovalX(v3(fx - 0.03, top + 0.8, pc), 0.6, 0.36, 0.06, frieze_c, .paint, .tile);

    // The portico over the two middle doors: a canopy, its blue sign with
    // a white border, a soffit with lights, and tie rods to the front.
    const cz = [2]f32{ pilasters[3] - 0.35, pilasters[5] + 0.35 };
    const cx = fx + 1.8;
    deco(v3(fx, y + 3.9, cz[0] + 0.02), v3(cx, y + 4.35, cz[1] - 0.02), v3(0.1, 0.11, 0.13), .paint, .sheet_metal);
    deco(v3(fx + 0.1, y + 3.88, cz[0] + 0.05), v3(cx - 0.05, y + 3.9, cz[1] - 0.05), cream, .paint, .plaster);
    var lz2: f32 = cz[0] + 0.8;
    while (lz2 < cz[1] - 0.5) : (lz2 += 1.6) deco(v3(fx + 0.7, y + 3.865, lz2 - 0.2), v3(fx + 1.1, y + 3.88, lz2 + 0.2), v3(0.7, 0.62, 0.48), .emissive, .glass);
    const sign_y = [2]f32{ 3.85, 4.6 };
    deco(v3(cx, y + sign_y[0], cz[0] - 0.08), v3(cx + 0.08, y + sign_y[1], cz[1] + 0.08), blue, .paint, .sheet_metal);
    for ([_][2]f32{ .{ cz[0] - 0.08, cz[0] + 0.03 }, .{ cz[1] - 0.03, cz[1] + 0.08 } }) |e| deco(v3(fx + 0.15, y + sign_y[0], e[0]), v3(cx, y + sign_y[1], e[1]), blue, .paint, .sheet_metal);
    const split = pilasters[4] + 0.2;
    for ([_][2]f32{ .{ cz[0] + 0.05, split - 0.05 }, .{ split + 0.05, cz[1] - 0.05 } }, [_][]const u8{ "EARL'S COURT STATION", "UNDERGROUND" }, [_]f32{ 0.05, 0.07 }) |p, text, px| {
        deco(v3(cx + 0.08, y + sign_y[0] + 0.05, p[0]), v3(cx + 0.09, y + sign_y[1] - 0.05, p[1]), sign_white, .paint, .sheet_metal);
        deco(v3(cx + 0.09, y + sign_y[0] + 0.08, p[0] + 0.03), v3(cx + 0.1, y + sign_y[1] - 0.08, p[1] - 0.03), blue, .paint, .sheet_metal);
        pixelText(eastFace(v3(cx + 0.1, y + (sign_y[0] + sign_y[1] + 7 * px) / 2, (p[0] + p[1]) / 2)), text, px, 0.012, sign_white, .paint, .sheet_metal);
    }
    for ([_]f32{ pilasters[3], pilasters[4], pilasters[5] }) |pz| {
        for ([_]f32{ -0.15, 0.15 }) |o| map.rod(v3(fx + 0.14, y + 6.0, pz + o), v3(cx - 0.05, y + 4.35, pz + o), 0.022, iron, .paint, .metal);
    }
    // The two roundels on brackets, over the ends of the canopy. Each
    // shows on both sides, with UNDERGROUND on its bar.
    for ([_]f32{ pilasters[3], pilasters[5] }) |pz| {
        const rc = v3(fx + 0.95, y + 5.45, pz);
        const size: f32 = 0.85;
        map.beam(v3(fx + 0.14, y + 6.2, pz), v3(fx + 1.55, y + 6.2, pz), 0.06, 0.1, v3(0, 1, 0), iron, .paint, .metal);
        map.rod(v3(fx + 0.14, y + 5.35, pz), v3(fx + 1.0, y + 6.15, pz), 0.025, iron, .paint, .metal);
        for ([_]f32{ 0.55, 1.35 }) |hx| map.rod(v3(fx + hx, y + 5.45 + 0.62 * size, pz), v3(fx + hx, y + 6.15, pz), 0.012, iron, .paint, .metal);
        roundel(rc, 0, size);
        roundel(rc, std.math.pi, size);
        for ([_]f32{ 1, -1 }) |side| {
            const m = faceFrame(rc + v3(0, 0.06, side * 0.07), v3(side, 0, 0), v3(0, 0, side));
            pixelText(m, "UNDERGROUND", 0.017, 0.012, sign_white, .paint, .sheet_metal);
        }
    }

    // A station map on the pier north of the entrance, and a poster on the
    // south bay.
    deco(v3(fx, py + 0.9, -4.75), v3(fx + 0.08, py + 2.3, -3.85), iron, .paint, .metal);
    deco(v3(fx + 0.08, py + 0.96, -4.69), v3(fx + 0.09, py + 2.24, -3.91), sign_white, .paint, .sheet_metal);
    for ([_]V3{ v3(0.0, 0.47, 0.2), v3(0.0, 0.1, 0.55), v3(1.0, 0.8, 0.0), v3(0.6, 0.6, 0.62), v3(0.85, 0.1, 0.1) }, 0..) |c, i| {
        const fi: f32 = @floatFromInt(i);
        deco(v3(fx + 0.09, py + 1.2 + fi * 0.2, -4.6 + fi * 0.05), v3(fx + 0.1, py + 1.24 + fi * 0.2, -4.0), c, .paint, .sheet_metal);
        deco(v3(fx + 0.1, py + 1.05, -4.55 + fi * 0.13), v3(fx + 0.11, py + 2.1, -4.51 + fi * 0.13), c, .paint, .sheet_metal);
    }
    deco(v3(fx, py + 0.7, 9.3), v3(fx + 0.08, py + 2.6, 11.7), v3(0.2, 0.2, 0.22), .paint, .metal);
    deco(v3(fx + 0.08, py + 0.78, 9.38), v3(fx + 0.09, py + 2.52, 11.62), v3(0.95, 0.75, 0.15), .paint, .sheet_metal);
    deco(v3(fx + 0.09, py + 1.6, 9.5), v3(fx + 0.1, py + 2.4, 11.5), v3(0.7, 0.1, 0.4), .paint, .sheet_metal);
    pixelText(eastFace(v3(fx + 0.09, py + 1.4, 10.5)), "MIND THE GAP", 0.022, 0.012, sign_black, .paint, .sheet_metal);

    // LEEK: a restaurant in the two bays north of the hall. Navy fascias,
    // wooden fronts, green tiled stall risers, double doors in the wide bay.
    const tile_g = v3(0.12, 0.36, 0.2);
    shopFront(.{ .z = leek_open[0], .door = .{ -22.75, -21.1 }, .double = true, .frame = v3(0.24, 0.09, 0.05), .riser = tile_g });
    shopFront(.{ .z = leek_open[1], .door = .{ -14.6, -13.5 }, .frame = v3(0.24, 0.09, 0.05), .riser = tile_g });
    fascia(leek_open[0][0], leek_open[0][1], shop_top, 3.95, 0.1, navy, "NATURALLY FASTISH FOOD", 0.032, sign_gold, .paint);
    fascia(leek_open[1][0], leek_open[1][1], shop_top, 3.95, 0.1, navy, "LEEK", 0.07, v3(0.82, 0.12, 0.08), .paint);
    // Inside: a wood floor, a green tiled dado, a counter, menu boards over
    // it, tables in the windows, pendant lights.
    deco(v3(75, y, lz[0]), v3(fx - 0.3, y + 0.02, lz[1]), v3(0.32, 0.2, 0.11), .wood, .wood);
    deco(v3(75, y + 0.02, lz[0]), v3(75.02, y + 1.3, lz[1]), tile_g, .wall_tile, .tile);
    deco(v3(75.9, y + 0.02, -22.5), v3(76.6, y + 1.0, -15.5), v3(0.3, 0.16, 0.08), .wood, .wood);
    deco(v3(75.85, y + 1.0, -22.55), v3(76.65, y + 1.05, -15.45), v3(0.85, 0.83, 0.8), .paint, .concrete);
    var mz: f32 = -22.2;
    while (mz < -15.8) : (mz += 1.6) {
        deco(v3(75, y + 2.0, mz), v3(75.03, y + 2.9, mz + 1.4), navy, .paint, .wood);
        for (0..5) |r| {
            const ry = y + 2.75 - @as(f32, @floatFromInt(r)) * 0.15;
            deco(v3(75.03, ry, mz + 0.15), v3(75.04, ry + 0.04, mz + 0.5 + vec.hash(@as(u32, @intFromFloat(mz * 10 + 300)) + @as(u32, @intCast(r))) * 0.7), v3(0.9, 0.86, 0.7), .emissive, .glass);
        }
    }
    for ([_]f32{ -24.2, -20.0, -17.6, -14.0 }) |tz| {
        deco(v3(77.3, y + 0.72, tz - 0.4), v3(78.0, y + 0.76, tz + 0.4), v3(0.36, 0.22, 0.12), .wood, .wood);
        map.rod(v3(77.65, y + 0.02, tz), v3(77.65, y + 0.72, tz), 0.04, iron, .paint, .metal);
    }
    pendants(77.2, -24.2, -13.4, 1.8, y + shop_top, v3(0.1, 0.25, 0.16));
}

/// The three shops next door to the north, in two buildings of yellow
/// stock brick: FOOD & WHINE (a corner shop with an ATM) and KLONIK (a
/// white fascia) in the south one, CAFFE NEARLY (a coffee shop) in the
/// north one. Each shop has a shallow room behind its glass.
fn nextDoor() void {
    const y = street_y;
    const fx = front_x;
    const back: f32 = 75.6; // the back walls of the shops
    const gt = y + shop_top;
    const z_split: f32 = -33.75; // between the two buildings
    const stock2 = v3(0.55, 0.47, 0.32);
    const tops = [2]f32{ 13.6, 12.6 };
    box(v3(east_x[1], gt, z_split), v3(fx, y + tops[0], -25.6), stock_brick, .brick, .brick);
    box(v3(east_x[1], gt, -40.6), v3(fx, y + tops[1], z_split), stock2, .brick, .brick);
    box(v3(east_x[1], y, -40.6), v3(back, gt, -25.9), stock_brick, .brick, .brick);
    // The walls between the shops, out to the front. The north wall has
    // the door to the flats.
    box(v3(back, y, -30.4), v3(fx, gt, -30.1), stock_brick, .brick, .brick);
    box(v3(back, y, -33.9), v3(fx, gt, -33.6), stock_brick, .brick, .brick);
    box(v3(back, y, -40.6), v3(fx, gt, -39.1), stock2, .brick, .brick);
    const fw = [2]f32{ -30.1, -25.9 };
    const kl = [2]f32{ -33.6, -30.4 };
    const cf = [2]f32{ -39.1, -33.9 };
    // Each shop is a collision box from its back wall to the glass.
    for ([_][2]f32{ fw, kl, cf }) |o| map.addSolid(v3(back, y, o[0]), v3(fx - 0.15, gt, o[1]), .glass);

    // The upper floors: white sash windows, three floors, and a cornice
    // at the top of each building.
    for ([_]f32{ -27.3, -29.7, -32.1 }, 0..) |wz, c| {
        for (0..3) |f| sash(wz, 1.1, y + 4.5 + 2.9 * @as(f32, @floatFromInt(f)), 1.9, @intCast(c * 3 + f), true);
    }
    for ([_]f32{ -35.2, -37.2, -39.2 }, 0..) |wz, c| {
        for (0..3) |f| sash(wz, 1.2, y + 4.8 + 2.4 * @as(f32, @floatFromInt(f)), 1.7, @intCast(20 + c * 3 + f), false);
    }
    deco(v3(fx, y + tops[0] - 0.7, z_split), v3(fx + 0.25, y + tops[0] - 0.45, -25.6), v3(0.82, 0.78, 0.68), .concrete, .concrete);
    deco(v3(fx, y + tops[1] - 0.7, -40.6), v3(fx + 0.25, y + tops[1] - 0.45, z_split), v3(0.82, 0.78, 0.68), .concrete, .concrete);

    // FOOD & WHINE: a black fascia with green letters, black piers, an ATM
    // in the window and a red ATM sign, shelves of packs inside, and a
    // stand of fruit on the pavement.
    const black = v3(0.02, 0.02, 0.025);
    const green = v3(0.15, 0.85, 0.3);
    for ([_][2]f32{ .{ -30.4, -30.1 }, .{ -25.9, -25.6 } }) |p| deco(v3(fx, y + 0.12, p[0]), v3(fx + 0.1, gt, p[1]), black, .paint, .sheet_metal);
    fascia(-30.4, -25.6, shop_top, 4.2, 0.12, black, "FOOD & WHINE", 0.05, green, .emissive);
    deco(v3(fx + 0.12, gt + 0.18, -29.4), v3(fx + 0.125, gt + 0.2, -26.6), v3(0.8, 0.08, 0.06), .paint, .sheet_metal);
    pixelText(eastFace(v3(fx + 0.12, gt + 0.15, -28.0)), "EARLS COURT", 0.018, 0.012, v3(0.9, 0.9, 0.9), .paint, .sheet_metal);
    shopFront(.{ .z = fw, .door = .{ -28.9, -27.9 }, .frame = black, .frame_mat = .paint, .frame_surface = .metal, .riser = black, .riser_mat = .paint, .riser_surface = .metal, .riser_h = 0.4 });
    const gx = fx - 0.15;
    deco(v3(gx, y + 0.9, -27.5), v3(gx + 0.1, y + 2.0, -26.5), steel, .steel, .metal);
    deco(v3(gx + 0.1, y + 1.45, -27.3), v3(gx + 0.11, y + 1.8, -26.7), v3(0.2, 0.45, 0.9), .emissive, .glass);
    deco(v3(gx + 0.1, y + 1.05, -27.2), v3(gx + 0.13, y + 1.3, -26.8), black, .paint, .metal);
    deco(v3(fx + 0.02, gt - 0.5, -26.05), v3(fx + 0.7, gt - 0.08, -25.97), v3(0.8, 0.06, 0.05), .paint, .sheet_metal);
    for ([_]f32{ 1, -1 }) |side| {
        const m = faceFrame(v3(fx + 0.36, gt - 0.178, -26.01 + side * 0.04), v3(side, 0, 0), v3(0, 0, side));
        pixelText(m, "ATM", 0.032, 0.012, v3(0.95, 0.95, 0.95), .paint, .sheet_metal);
    }
    const packs = [_]V3{ v3(0.8, 0.1, 0.1), v3(0.95, 0.75, 0.1), v3(0.1, 0.3, 0.8), v3(0.1, 0.6, 0.25), v3(0.9, 0.45, 0.1), v3(0.6, 0.1, 0.6), v3(0.9, 0.9, 0.85) };
    shelvesX(back, fw[0], fw[1], &[_]f32{ 0.3, 0.75, 1.2, 1.65, 2.1 }, 500, &packs);
    deco(v3(76.6, y, -27.6), v3(77.2, y + 1.0, -26.2), black, .paint, .wood);
    for ([_]f32{ -29.0, -27.0 }) |pz| deco(v3(back + 0.8, y + 3.35, pz), v3(back + 1.8, y + 3.39, pz + 0.6), v3(1.0, 1.0, 1.0), .emissive, .glass);
    // The fruit stand: one box, with crates on a slope.
    box(v3(78.8, y + 0.12, -29.7), v3(79.5, y + 0.85, -27.3), v3(0.12, 0.3, 0.15), .paint, .wood);
    const fruit = [_]V3{ v3(0.9, 0.5, 0.05), v3(0.85, 0.08, 0.05), v3(0.95, 0.85, 0.1), v3(0.35, 0.65, 0.1), v3(0.4, 0.1, 0.3) };
    for (fruit, 0..) |c, i| {
        const z = -29.6 + @as(f32, @floatFromInt(i)) * 0.46;
        deco(v3(78.85, y + 0.85, z), v3(79.45, y + 0.97, z + 0.42), c, .paint, .fabric);
    }

    // KLONIK: a white fascia with black letters, white piers, a frosted
    // band on the glass, a white room with a desk and a plant.
    const white = v3(0.9, 0.9, 0.9);
    deco(v3(fx, y + 0.12, -33.9), v3(fx + 0.1, gt, -33.6), white, .paint, .sheet_metal);
    fascia(-33.75, -30.4, shop_top, 4.2, 0.12, white, "KLONIK", 0.07, sign_black, .paint);
    shopFront(.{ .z = kl, .door = .{ -31.6, -30.6 }, .frame = v3(0.15, 0.15, 0.16), .frame_mat = .paint, .frame_surface = .metal, .riser = v3(0.15, 0.15, 0.16), .riser_mat = .paint, .riser_surface = .metal, .riser_h = 0.3 });
    deco(v3(gx, y + 0.95, kl[0] + 0.12), v3(gx + 0.02, y + 1.6, -31.7), v3(0.82, 0.86, 0.86), .paint, .glass);
    deco(v3(back, y, kl[0]), v3(back + 0.02, gt, kl[1]), white, .paint, .plaster);
    deco(v3(76.4, y, -33.1), v3(77.0, y + 1.05, -31.6), white, .paint, .wood);
    deco(v3(76.35, y + 1.05, -33.15), v3(77.05, y + 1.09, -31.55), v3(0.75, 0.62, 0.45), .wood, .wood);
    map.rod(v3(77.6, y, -33.2), v3(77.6, y + 0.5, -33.2), 0.16, v3(0.85, 0.85, 0.82), .paint, .concrete);
    map.rod(v3(77.6, y + 0.5, -33.2), v3(77.6, y + 1.3, -33.2), 0.26, v3(0.15, 0.45, 0.2), .paint, .fabric);
    deco(v3(back + 0.6, y + 3.35, -33.0), v3(back + 2.2, y + 3.39, -31.0), v3(0.6, 0.6, 0.6), .emissive, .glass);

    // CAFFE NEARLY: a light blue fascia with navy letters and a line in
    // white, a grey panelled front, a blade sign, a timber ledge in the
    // window, a warm room with a counter. The grey door to the flats is
    // at the north end.
    const grey = v3(0.36, 0.38, 0.41);
    const sky = v3(0.42, 0.58, 0.86);
    deco(v3(fx, y + 0.12, -39.3), v3(fx + 0.1, gt, -39.1), grey, .paint, .wood);
    fascia(-40.45, z_split, shop_top + 0.05, 4.25, 0.12, sky, "CAFFE NEARLY", 0.065, navy, .paint);
    deco(v3(fx + 0.12, gt + 0.07, -38.4), v3(fx + 0.13, gt + 0.21, -35.8), navy, .paint, .sheet_metal);
    pixelText(eastFace(v3(fx + 0.13, gt + 0.198, -37.1)), "THE ITALIANISH COFFEE CO", 0.016, 0.012, white, .paint, .sheet_metal);
    deco(v3(fx, y + 4.35, -40.6), v3(fx + 0.28, y + 4.55, z_split), grey, .paint, .wood);
    shopFront(.{ .z = cf, .door = .{ -38.9, -37.9 }, .frame = grey, .frame_mat = .paint, .riser = grey, .riser_mat = .paint, .riser_surface = .wood, .riser_h = 0.7 });
    deco(v3(fx - 0.7, y + 1.0, -37.7), v3(fx - 0.3, y + 1.05, -34.1), v3(0.6, 0.4, 0.2), .wood, .wood);
    // The door to the flats, with its number.
    deco(v3(fx, y + 0.12, -40.45), v3(fx + 0.1, y + 2.6, -39.3), grey * vec.s(0.8), .paint, .wood);
    deco(v3(fx + 0.1, y + 0.2, -40.25), v3(fx + 0.12, y + 2.3, -39.45), grey, .paint, .wood);
    for ([_][2]f32{ .{ 0.5, 1.2 }, .{ 1.3, 1.95 } }) |ph| deco(v3(fx + 0.11, y + ph[0], -40.1), v3(fx + 0.135, y + ph[1], -39.6), grey * vec.s(1.15), .paint, .wood);
    pixelText(eastFace(v3(fx + 0.12, y + 2.25, -39.85)), "2B", 0.03, 0.012, white, .paint, .sheet_metal);
    deco(v3(fx + 0.11, y + 1.21, -40.0), v3(fx + 0.14, y + 1.28, -39.7), steel, .metal, .metal);
    // The blade sign over the door to the flats.
    map.rod(v3(fx, y + 5.0, -40.2), v3(fx + 0.85, y + 5.0, -40.2), 0.02, iron, .paint, .metal);
    deco(v3(fx + 0.15, y + 4.0, -40.24), v3(fx + 0.85, y + 4.98, -40.16), sky, .paint, .sheet_metal);
    for ([_]f32{ 1, -1 }) |side| {
        for ([_][]const u8{ "CAFFE", "NEARLY" }, 0..) |t, r| {
            const m = faceFrame(v3(fx + 0.5, y + 4.65 - @as(f32, @floatFromInt(r)) * 0.2, -40.2 + side * 0.04), v3(side, 0, 0), v3(0, 0, side));
            pixelText(m, t, 0.017, 0.012, navy, .paint, .sheet_metal);
        }
    }
    // Inside: wood panels, a counter with a lit cake case and a coffee
    // machine, warm pendant lights.
    deco(v3(back, y, cf[0]), v3(back + 0.02, gt, cf[1]), v3(0.35, 0.22, 0.13), .wood, .wood);
    deco(v3(76.3, y, -38.6), v3(76.9, y + 1.0, -35.2), v3(0.2, 0.2, 0.22), .paint, .wood);
    deco(v3(76.3, y + 1.0, -37.0), v3(76.9, y + 1.45, -35.4), v3(0.12, 0.09, 0.06), .emissive, .glass);
    deco(v3(76.4, y + 1.0, -38.3), v3(76.8, y + 1.45, -37.5), steel, .steel, .metal);
    pendants(77.3, -38.4, -34.6, 1.25, gt, v3(0.15, 0.15, 0.16));
}

/// A sash window on the face x = front_x, about z = zc: `w` wide, from
/// y0, `h` high. A stone surround and sill, glass in two sashes, and an
/// arched stone head if `arch`. `id` picks a lit window or a dark one.
fn sash(zc: f32, w: f32, y0: f32, h: f32, id: u32, arch: bool) void {
    const fx = front_x;
    const a = w / 2;
    const stone = v3(0.86, 0.83, 0.74);
    deco(v3(fx, y0 - 0.12, zc - a - 0.12), v3(fx + 0.03, y0 + h + 0.12, zc + a + 0.12), stone, .paint, .concrete);
    if (arch) ovalX(v3(fx + 0.015, y0 + h + 0.1, zc), a + 0.12, 0.3, 0.03, stone, .paint, .concrete);
    const lit = vec.hash(id * 2654 + 77) < 0.35;
    const pane = if (lit) v3(0.55, 0.36, 0.16) else glazing;
    deco(v3(fx, y0 + 0.01, zc - a + 0.01), v3(fx + 0.045, y0 + h - 0.01, zc + a - 0.01), pane, if (lit) .emissive else .paint, .glass);
    const bx = [2]f32{ fx, fx + 0.06 };
    for ([_][2]f32{ .{ y0, y0 + 0.06 }, .{ y0 + h / 2 - 0.03, y0 + h / 2 + 0.03 }, .{ y0 + h - 0.06, y0 + h } }) |r| deco(v3(bx[0], r[0], zc - a), v3(bx[1], r[1], zc + a), bar_white, .paint, .wood);
    for ([_][2]f32{ .{ zc - a, zc - a + 0.06 }, .{ zc - 0.02, zc + 0.02 }, .{ zc + a - 0.06, zc + a } }) |c| deco(v3(bx[0], y0, c[0]), v3(bx[1], y0 + h, c[1]), bar_white, .paint, .wood);
    deco(v3(fx, y0 - 0.2, zc - a - 0.18), v3(fx + 0.1, y0 - 0.12, zc + a + 0.18), stone, .paint, .concrete);
}

/// The building south of the station, out to the road: brown brick, with
/// sash windows on its upper floors.
fn southBuilding() void {
    const y = street_y;
    const z0 = wall_s + 0.6;
    box(v3(east_x[1] + 0.4, y, z0), v3(front_x, y + 13, 30.6), v3(0.42, 0.3, 0.22), .brick, .brick);
    var z: f32 = z0 + 1.6;
    var i: u32 = 40;
    while (z < 29.5) : (z += 2.4) {
        for (0..3) |f| {
            sash(z, 1.2, y + 4.4 + 2.6 * @as(f32, @floatFromInt(f)), 1.8, i, false);
            i += 1;
        }
    }
    deco(v3(front_x, y + 12.2, z0), v3(front_x + 0.25, y + 12.45, 30.6), v3(0.82, 0.78, 0.68), .concrete, .concrete);
}

/// The street furniture on the station pavement of Earls Court Road: the
/// cast iron lamp post with five globes, Sheffield bike stands, litter
/// bins, and the traffic signal of the crossing south of the station,
/// with its studs and stop line on the road.
fn streetFurniture() void {
    const y = street_y;
    const py = y + 0.12;
    const kerb = street_e[0] + 3;
    const lamp_c = v3(0.03, 0.05, 0.04);

    // The lamp post: a fluted base, a column, a collar, four arms with
    // globes and a fifth globe on top. The base is the collision.
    const lp = v3(80.95, py, -19.9);
    map.addSolid(lp + v3(-0.2, 0, -0.2), lp + v3(0.2, 3.2, 0.2), .metal);
    map.rod(lp, lp + v3(0, 0.25, 0), 0.24, lamp_c, .paint, .metal);
    map.rod(lp + v3(0, 0.25, 0), lp + v3(0, 1.1, 0), 0.17, lamp_c, .paint, .metal);
    map.rod(lp + v3(0, 1.1, 0), lp + v3(0, 3.6, 0), 0.08, lamp_c, .paint, .metal);
    map.rod(lp + v3(0, 1.1, 0), lp + v3(0, 1.2, 0), 0.13, lamp_c, .paint, .metal);
    map.rod(lp + v3(0, 3.4, 0), lp + v3(0, 3.65, 0), 0.12, lamp_c, .paint, .metal);
    const globe = v3(0.32, 0.3, 0.25);
    for ([_]V3{ v3(0.6, 0, 0), v3(-0.6, 0, 0), v3(0, 0, 0.6), v3(0, 0, -0.6) }) |d| {
        map.rail(&[_]V3{ lp + v3(0, 3.5, 0), lp + d * vec.s(0.6) + v3(0, 3.55, 0), lp + d + v3(0, 3.8, 0) }, 0.03, 0.15, lamp_c, .paint, .metal);
        const g = lp + d + v3(0, 3.8, 0);
        map.rod(g, g + v3(0, 0.08, 0), 0.06, lamp_c, .paint, .metal);
        map.rod(g + v3(0, 0.08, 0), g + v3(0, 0.44, 0), 0.15, globe, .emissive, .glass);
        map.rod(g + v3(0, 0.14, 0), g + v3(0, 0.38, 0), 0.2, globe, .emissive, .glass);
    }
    const g5 = lp + v3(0, 3.65, 0);
    map.rod(g5, g5 + v3(0, 0.5, 0), 0.05, lamp_c, .paint, .metal);
    map.rod(g5 + v3(0, 0.5, 0), g5 + v3(0, 0.86, 0), 0.15, globe, .emissive, .glass);
    map.rod(g5 + v3(0, 0.56, 0), g5 + v3(0, 0.8, 0), 0.2, globe, .emissive, .glass);
    map.rod(g5 + v3(0, 0.86, 0), g5 + v3(0, 0.98, 0), 0.03, lamp_c, .paint, .metal);

    // Sheffield bike stands, across the pavement near the kerb.
    for ([_]f32{ 9.9, 11.1, -27.7, -28.9 }) |z| {
        const x0 = kerb - 1.05;
        const x1 = kerb - 0.35;
        map.addSolid(v3(x0 - 0.04, py, z - 0.04), v3(x1 + 0.04, py + 0.82, z + 0.04), .metal);
        map.rail(&[_]V3{ v3(x0, py, z), v3(x0, py + 0.8, z), v3(x1, py + 0.8, z), v3(x1, py, z) }, 0.03, 0.2, lamp_c, .paint, .metal);
        for ([_]f32{ x0, x1 }) |bx| map.rod(v3(bx, py + 0.55, z), v3(bx, py + 0.62, z), 0.042, sign_white, .paint, .metal);
    }

    // Litter bins: black, round, with a gold band.
    for ([_]V3{ v3(81.15, py, 8.7), v3(81.15, py, -23.0) }) |b| {
        map.addSolid(b + v3(-0.28, 0, -0.28), b + v3(0.28, 1.0, 0.28), .metal);
        map.rod(b, b + v3(0, 0.95, 0), 0.27, v3(0.02, 0.02, 0.025), .paint, .metal);
        map.rod(b + v3(0, 0.72, 0), b + v3(0, 0.8, 0), 0.28, v3(0.7, 0.55, 0.2), .paint, .metal);
        map.rod(b + v3(0, 0.95, 0), b + v3(0, 1.0, 0), 0.25, v3(0.02, 0.02, 0.025), .paint, .metal);
    }

    // The traffic signal: a pole, a head toward the traffic from the
    // north with a black backboard and a white border, red lit, and a
    // push button for the crossing.
    const sp = v3(kerb - 0.3, py, 14.3);
    map.addSolid(sp + v3(-0.1, 0, -0.1), sp + v3(0.1, 3.1, 0.1), .metal);
    map.rod(sp, sp + v3(0, 3.1, 0), 0.06, v3(0.1, 0.1, 0.1), .paint, .metal);
    deco(sp + v3(-0.25, 1.95, 0.08), sp + v3(0.25, 3.05, 0.1), sign_white, .paint, .sheet_metal);
    deco(sp + v3(-0.22, 1.98, 0.06), sp + v3(0.22, 3.02, 0.08), v3(0.01, 0.01, 0.01), .paint, .sheet_metal);
    deco(sp + v3(-0.13, 2.05, -0.16), sp + v3(0.13, 2.95, 0.06), v3(0.02, 0.02, 0.025), .paint, .metal);
    for ([_]V3{ v3(0.95, 0.08, 0.05), v3(0.25, 0.16, 0.02), v3(0.02, 0.18, 0.06) }, 0..) |c, i| {
        const ly = 2.8 - @as(f32, @floatFromInt(i)) * 0.3;
        map.addDisc(vec.translate(sp + v3(0, ly, -0.172)), 0.08, 0.02, c, if (i == 0) .emissive else .paint, .glass);
        deco(sp + v3(-0.11, ly + 0.08, -0.32), sp + v3(0.11, ly + 0.1, -0.165), v3(0.02, 0.02, 0.025), .paint, .metal);
    }
    deco(sp + v3(-0.08, 1.0, -0.1), sp + v3(0.08, 1.3, -0.05), v3(0.95, 0.75, 0.1), .paint, .metal);

    // The crossing: two lines of studs across the road, and the stop line
    // for the traffic from the north.
    const mark = v3(0.9, 0.9, 0.85);
    for ([_]f32{ 14.9, 17.1 }) |z| {
        var x = kerb + 0.1;
        while (x < street_e[1] - 3.1) : (x += 0.4) deco(v3(x, y + 0.004, z - 0.1), v3(x + 0.2, y + 0.02, z + 0.1), mark, .paint, .concrete);
    }
    deco(v3(kerb, y + 0.004, 13.4), v3(kerb + 4, y + 0.02, 13.7), mark, .paint, .concrete);
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
    // West of the road: the construction site, behind a hoarding.
    warwickSite();
    box(v3(street_w[0], y, -30.6), v3(ex, y + 7, -30), brick, .brick, .brick);
    box(v3(street_w[0], y, 25), v3(ex, y + 7, 25.6), brick, .brick, .brick);
}

// ---- The construction site west of Warwick Road -------------------------------
//
// West of Warwick Road is a construction site, as the old exhibition centre
// site is in real life. A painted plywood hoarding, 2.44 m high (one
// sheet), runs along the road, with printed panels toward the road.
// Opposite the station doors, Heras fence panels on feet are the site
// gate, so a player sees into the site. The hoarding and the fence are the
// only collision. A jump (1 m) and a vault (1.4 m) do not clear them.
// All of the site behind them is decoration, and map.scenery: the escape
// audit proves that no player gets there.
//
// The District line goes west under the site in a covered way: the site
// stands on a concrete raft, as the exhibition centre did. The parapets of
// the line (lines) go through the site as two low brick walls.

/// The face of the hoarding toward the road (+X).
const hoard_x: f32 = street_w[0];
const hoard_h: f32 = 2.44;
/// The Heras fence panels of the site gate, opposite the station doors.
const heras_z = [2]f32{ -8.5, 5.5 };
const heras_h: f32 = 2.0;
const hoard_c = v3(0.12, 0.13, 0.14);
const lime = v3(0.55, 0.78, 0.16);
const hoard_white = v3(0.93, 0.93, 0.91);
const grey_text = v3(0.62, 0.63, 0.64);
const site_yellow = v3(0.92, 0.62, 0.04);
const galv = v3(0.6, 0.62, 0.62);
const timber = v3(0.55, 0.42, 0.26);
const rubber = v3(0.05, 0.05, 0.05);
const earth_c = v3(0.3, 0.24, 0.18);
const ppe_blue = v3(0.05, 0.3, 0.68);
/// The west end of the site, and its north and south ends. The site is
/// west of the road and never crosses it: the road can go on north and
/// south past the site. The hoarding runs the full length of the site.
const site_x0: f32 = -140;
const site_z = [2]f32{ -50, 45 };

/// The front of print layer k on the hoarding. Layer 0 is 2 cm in front of
/// the hoarding face, and each layer is 1 cm in front of the layer below
/// it. Thus no two faces are in one plane.
fn layerX(k: f32) f32 {
    return hoard_x + 0.02 + 0.01 * k;
}

/// A printed rectangle on the hoarding, in layer k.
fn print(k: f32, z0: f32, z1: f32, y0: f32, y1: f32, color: V3) void {
    const f = layerX(k);
    deco(v3(f - 0.006, y0, z0), v3(f, y1, z1), color, .paint, .wood);
}

/// Text in the pixel font (signText) on a face toward +X. The front of the
/// letters is at x.
fn eastText(x: f32, text: []const u8, z_mid: f32, top: f32, px: f32, color: V3) void {
    signText(text, -1, 0.003 - x, z_mid, top, px, color);
}

/// A disc toward +X, with its front at x.
fn eastDisc(x: f32, y: f32, z: f32, r: f32, color: V3) void {
    map.addDisc(vec.translate(v3(x - 0.003, y, z)).mul(Mat4.rotationY(std.math.pi / 2.0)), r, 0.006, color, .paint, .wood);
}

/// map.slab with a right-handed set of edges. A left-handed set gives the
/// same solid with ez the other way.
fn slabR(o: V3, ex: V3, ey: V3, ez: V3, color: V3, mat: Mat, surface: Surface) void {
    if (vec.dot(vec.cross(ex, ey), ez) < 0) return map.slab(o + ez, ex, ey, -ez, color, mat, surface);
    map.slab(o, ex, ey, ez, color, mat, surface);
}

/// The horizontal unit vector at the angle a from +X toward +Z.
fn heading(a: f32) V3 {
    return v3(@cos(a), 0, @sin(a));
}

/// A frame on the ground for decoration: the origin o, local X along the
/// horizontal unit vector f, Y up, and Z across (f turned 90 degrees
/// toward +Z). k scales the local sizes.
const Frame = struct {
    o: V3,
    f: V3,
    k: f32 = 1,

    fn side(fr: Frame) V3 {
        return v3(-fr.f[2], 0, fr.f[0]);
    }
    fn p(fr: Frame, q: V3) V3 {
        return fr.o + fr.f * vec.s(q[0] * fr.k) + v3(0, q[1] * fr.k, 0) + fr.side() * vec.s(q[2] * fr.k);
    }
    fn box(fr: Frame, lo: V3, hi: V3, color: V3, mat: Mat, surface: Surface) void {
        const d = (hi - lo) * vec.s(fr.k);
        slabR(fr.p(lo), fr.f * vec.s(d[0]), v3(0, d[1], 0), fr.side() * vec.s(d[2]), color, mat, surface);
    }
    fn rod(fr: Frame, a: V3, b: V3, r: f32, color: V3, mat: Mat, surface: Surface) void {
        map.rod(fr.p(a), fr.p(b), r * fr.k, color, mat, surface);
    }
    /// A beam from a to b that is not vertical.
    fn beam(fr: Frame, a: V3, b: V3, w: f32, h: f32, color: V3, mat: Mat, surface: Surface) void {
        map.beam(fr.p(a), fr.p(b), w * fr.k, h * fr.k, v3(0, 1, 0), color, mat, surface);
    }
    /// The frame at the local point q, turned by a radians about Y.
    fn turned(fr: Frame, q: V3, a: f32) Frame {
        return .{ .o = fr.p(q), .f = fr.f * vec.s(@cos(a)) + fr.side() * vec.s(@sin(a)), .k = fr.k };
    }
};

fn warwickSite() void {
    const y = street_y;
    const g = y + 0.03; // the top of the site ground
    const hb = hoard_x - 0.25; // the back of the hoarding

    // The hoarding, north and south of the gate. A lime stripe along the
    // top, and on the back the timber rails and a raking prop each 2.4 m.
    for ([_][2]f32{ .{ site_z[0], heras_z[0] }, .{ heras_z[1], site_z[1] } }) |r| {
        box(v3(hb, y, r[0]), v3(hoard_x, y + hoard_h, r[1]), hoard_c, .paint, .wood);
        print(0, r[0], r[1], y + hoard_h - 0.14, y + hoard_h - 0.06, lime);
        for ([_]f32{ 0.4, 1.9 }) |ry| deco(v3(hb - 0.07, y + ry, r[0]), v3(hb - 0.01, y + ry + 0.1, r[1]), timber, .wood, .wood);
        var z = r[0] + 1.2;
        while (z < r[1] - 0.5) : (z += 2.4) {
            map.beam(v3(hb - 0.1, y + 1.95, z), v3(hb - 1.5, g + 0.05, z), 0.07, 0.1, v3(0, 1, 0), timber, .wood, .wood);
            deco(v3(hb - 1.75, g, z - 0.12), v3(hb - 1.25, g + 0.1, z + 0.12), timber, .wood, .wood);
        }
    }
    // The prints, from the south end (on the left, seen from the station
    // doors) to the north end.
    brandPanel(20.5);
    renderPanel(8.6, 15.6);
    flyPosters(6.0, 8.2);
    sloganPanel(-12.3);
    completionPanel(-19.4);
    sorryPanel(-26.6);

    // The gate: Heras fence panels on feet. One collision box for the run.
    const fx = hoard_x - 0.1;
    map.addSolid(v3(fx - 0.12, y, heras_z[0]), v3(hoard_x + 0.05, y + heras_h, heras_z[1]), .metal);
    heras(v3(fx, y, heras_z[0]), v3(fx, y, heras_z[1]));
    gateSigns(fx + 0.05);

    // The raft over the line, the ground of the site (hardcore), a haul
    // road from the gate, and puddles on it.
    map.scenery = .{ v3(site_x0, y - 0.5, site_z[0]), v3(hb, 200, site_z[1]) };
    deco(v3(site_x0, deck_y, wall_n), v3(-97, y, wall_s), deck_c, .concrete, .concrete);
    deco(v3(site_x0, y, site_z[0]), v3(-97, g, site_z[1]), earth_c, .concrete, .earth);
    deco(v3(-118, g, -8), v3(-97, g + 0.02, 4.5), v3(0.46, 0.44, 0.4), .concrete, .concrete);
    deco(v3(-104.5, g + 0.02, -1.6), v3(-102.8, g + 0.026, 0.3), v3(0.12, 0.13, 0.15), .paint, .earth);
    deco(v3(-108.6, g + 0.02, 1.2), v3(-107.4, g + 0.026, 2.6), v3(0.12, 0.13, 0.15), .paint, .earth);

    // A mini-digger at a spoil heap behind the north hoarding.
    heap(v3(-100.6, g, -6.9), 1.6, 1.4, 0.3);
    digger(.{ .o = v3(-102.2, g, -3.6), .f = heading(0.4) }, -1.75);
    // An open trench in the haul road, with barriers round it and cones
    // along the way in.
    const pit = rect(-101.6, -99.6, 0.5, 2.3);
    deco(v3(pit.x0, g + 0.02, pit.z0), v3(pit.x1, g + 0.025, pit.z1), v3(0.03, 0.025, 0.02), .paint, .earth);
    deco(v3(pit.x0 - 0.1, g + 0.03, pit.z0 - 0.1), v3(pit.x0 + 0.9, g + 0.05, pit.z1 + 0.1), v3(0.3, 0.3, 0.32), .metal, .metal);
    barrier(v3(pit.x1 + 0.3, g, pit.z0 - 0.3), v3(pit.x1 + 0.3, g, pit.z1 + 0.3));
    barrier(v3(pit.x0 - 0.3, g, pit.z0 - 0.3), v3(pit.x1 + 0.3, g, pit.z0 - 0.3));
    barrier(v3(pit.x0 - 0.3, g, pit.z1 + 0.3), v3(pit.x1 + 0.3, g, pit.z1 + 0.3));
    for ([_][2]f32{ .{ -97.6, -6.6 }, .{ -98.9, -6.1 }, .{ -97.6, 4.0 }, .{ -99.0, 3.6 }, .{ -103.2, 2.6 }, .{ -104.6, 2.2 } }) |c| cone(v3(c[0], g + 0.02, c[1]));
    // A cone that fell over.
    const fallen = Frame{ .o = v3(-98.2, g + 0.14, 1.0), .f = heading(0.7) };
    fallen.rod(v3(0, 0, 0), v3(0.7, 0, 0), 0.08, v3(0.95, 0.32, 0.04), .paint, .fabric);

    // The skip, with rubbish and an old mattress in it.
    skip(.{ .o = v3(-105.0, g, 3.6), .f = heading(0.15) });
    // Materials: two pallets of blocks, two bulk bags of sand, scaffold
    // tubes and bundles of rebar on timber bearers, and a stack under a
    // blue tarpaulin.
    pallet(-105.0, -0.6);
    pallet(-105.1, 0.75);
    bulkBag(-105.2, -2.3);
    bulkBag(-106.2, -2.8);
    tubeStack(v3(-112.5, g, 5.0), v3(0.6, 0.62, 0.62), 0.024, 8, 3);
    tubeStack(v3(-112.5, g, 6.2), v3(0.36, 0.18, 0.1), 0.014, 14, 2);
    deco(v3(-108.9, g, -4.8), v3(-106.7, g + 0.95, -3.3), v3(0.1, 0.25, 0.62), .cloth, .fabric);
    for ([_]f32{ -4.5, -3.6 }) |z| deco(v3(-109.0, g + 0.95, z), v3(-106.6, g + 1.02, z + 0.07), timber, .wood, .wood);

    // The site office: two cabins, one on the other, with a stair at the
    // south end. The canteen is in the lower one. A portable toilet next
    // to them.
    siteOffice();
    const loo = rect(-104.6, -103.5, -10.2, -9.1);
    deco(v3(loo.x0, g, loo.z0), v3(loo.x1, g + 2.25, loo.z1), v3(0.1, 0.3, 0.7), .paint, .sheet_metal);
    deco(v3(loo.x0 - 0.04, g + 2.25, loo.z0 - 0.04), v3(loo.x1 + 0.04, g + 2.35, loo.z1 + 0.04), hoard_white, .paint, .sheet_metal);
    deco(v3(loo.x1 + 0.01, g + 0.05, loo.z0 + 0.12), v3(loo.x1 + 0.03, g + 2.1, loo.z1 - 0.12), v3(0.07, 0.22, 0.55), .paint, .sheet_metal);
    eastText(loo.x1 + 0.04, "VACANT", (loo.z0 + loo.z1) / 2, g + 1.3, 0.008, v3(0.1, 0.6, 0.2));

    // The building: a concrete frame four floors up, a core higher still,
    // and yellow edge protection on the slabs.
    concreteFrame(rect(-136, -120, -19.5, -3), g);
    // The tower crane, behind its own Heras fence.
    towerCrane(v3(-113, g, -1.5), heading(-0.6), 36);
    heras(v3(-116.5, g, -5), v3(-109.5, g, -5));
    heras(v3(-109.5, g, -5), v3(-109.5, g, 2));
    heras(v3(-109.5, g, 2), v3(-116.5, g, 2));
}

/// The developer's name and its promise.
fn brandPanel(zc: f32) void {
    const y = street_y;
    eastText(layerX(0), "WARWICK YARDS", zc, y + 2.05, 0.06, hoard_white);
    print(0, zc - 2.4, zc + 2.4, y + 1.5, y + 1.55, lime);
    eastText(layerX(0), "A NEW NEIGHBOURHOOD FOR LONDON", zc, y + 1.38, 0.024, lime);
    eastText(layerX(0), "1,700 NEW HOMES. 12 AFFORDABLE*", zc, y + 1.0, 0.022, hoard_white);
    eastText(layerX(0), "*AFFORDABLE: 80 PERCENT OF MARKET RENT", zc, y + 0.62, 0.007, grey_text);
}

/// The developer's render: glass towers on a podium of shops, a plaza
/// with trees, people and a red balloon, under a blue sky. Each element is
/// one print layer in front of the element behind it.
fn renderPanel(z0: f32, z1: f32) void {
    const y = street_y;
    const b = y + 0.62; // the bottom of the picture
    const t = y + 2.2; // its top
    print(0, z0 - 0.05, z1 + 0.05, b - 0.05, t + 0.05, hoard_white);
    const sky = [_]V3{ v3(0.86, 0.9, 0.95), v3(0.66, 0.8, 0.94), v3(0.45, 0.66, 0.92) };
    for (sky, 0..) |c, i| {
        const fi: f32 = @floatFromInt(i);
        print(1, z0, z1, b + (t - b) * fi / 3, b + (t - b) * (fi + 1) / 3, c);
    }
    eastDisc(layerX(2), t - 0.3, z0 + 0.6, 0.16, v3(1.0, 0.95, 0.75));
    // The towers: [z0, z1, top], and a colour.
    const towers = [_][3]f32{ .{ 1.0, 2.0, 1.4 }, .{ 2.3, 3.7, 1.52 }, .{ 4.1, 5.2, 1.22 }, .{ 5.5, 6.7, 1.0 } };
    const tower_c = [_]V3{ v3(0.3, 0.55, 0.62), v3(0.22, 0.42, 0.58), v3(0.35, 0.6, 0.66), v3(0.65, 0.42, 0.3) };
    for (towers, tower_c) |tw, c| {
        const za = z1 - tw[1];
        const zb = z1 - tw[0];
        const top = b + tw[2];
        print(2, za, zb, b + 0.42, top, c);
        // A light line at each floor.
        var fy = b + 0.5;
        while (fy < top - 0.06) : (fy += 0.09) print(3, za + 0.04, zb - 0.04, fy, fy + 0.015, v3(0.85, 0.92, 0.95));
    }
    // The podium of shops, and the plaza.
    print(2, z0, z1, b + 0.18, b + 0.42, v3(0.88, 0.84, 0.74));
    var sz = z0 + 0.15;
    while (sz < z1 - 0.4) : (sz += 0.5) print(3, sz, sz + 0.3, b + 0.2, b + 0.36, v3(0.95, 0.75, 0.4));
    print(2, z0, z1, b, b + 0.18, v3(0.82, 0.8, 0.74));
    // Trees.
    for ([_]f32{ 0.5, 1.9, 3.4, 4.9, 6.3 }) |d| {
        const z = z1 - d;
        print(4, z - 0.015, z + 0.015, b + 0.04, b + 0.3, v3(0.3, 0.2, 0.12));
        eastDisc(layerX(5), b + 0.36, z, 0.12, v3(0.2, 0.5, 0.18));
    }
    // People: [distance from the left edge, height], a colour.
    const people = [_][2]f32{ .{ 0.9, 0.12 }, .{ 1.15, 0.11 }, .{ 2.6, 0.13 }, .{ 3.9, 0.12 }, .{ 4.05, 0.08 }, .{ 5.6, 0.12 }, .{ 6.0, 0.115 } };
    const people_c = [_]V3{ v3(0.85, 0.2, 0.25), v3(0.15, 0.2, 0.4), v3(0.9, 0.85, 0.8), v3(0.2, 0.55, 0.6), v3(0.95, 0.75, 0.1), v3(0.1, 0.1, 0.12), v3(0.7, 0.35, 0.6) };
    for (people, people_c) |pp, c| {
        const z = z1 - pp[0];
        print(6, z - 0.018, z + 0.018, b + 0.03, b + 0.03 + pp[1], c);
        eastDisc(layerX(7), b + 0.05 + pp[1], z, 0.018, v3(0.85, 0.65, 0.5));
    }
    // The balloon of the child at 4.05 m, and a dog at 5.6 m.
    print(6, z1 - 4.08, z1 - 4.075, b + 0.1, b + 0.45, v3(0.2, 0.2, 0.2));
    eastDisc(layerX(7), b + 0.48, z1 - 4.08, 0.04, v3(0.85, 0.08, 0.08));
    print(6, z1 - 5.78, z1 - 5.68, b + 0.05, b + 0.08, v3(0.45, 0.3, 0.15));
    // The caption, and the small print.
    eastText(layerX(3), "CGI. FOR ILLUSTRATION ONLY", z0 + 0.6, b + 0.12, 0.004, v3(0.4, 0.4, 0.4));
    eastText(layerX(0), "LUXURY LIVING. MOMENTS FROM THE TUBE.", (z0 + z1) / 2, b - 0.15, 0.024, hoard_white);
}

/// "POST NO BILLS", and the bills that people posted under it.
fn flyPosters(z0: f32, z1: f32) void {
    const y = street_y;
    eastText(layerX(0), "POST NO BILLS", (z0 + z1) / 2, y + 2.1, 0.022, hoard_white);
    // [z0, z1, bottom], a colour, a title, a line and the colour of the text.
    const Bill = struct { z: [2]f32, b: f32, c: V3, title: []const u8, line: []const u8, ink: V3 };
    const bills = [_]Bill{
        .{ .z = .{ z1 - 0.75, z1 - 0.05 }, .b = 0.85, .c = v3(0.95, 0.85, 0.1), .title = "LIVE", .line = "THE VAPES", .ink = v3(0.05, 0.05, 0.05) },
        .{ .z = .{ z1 - 1.35, z1 - 0.65 }, .b = 0.9, .c = v3(0.85, 0.1, 0.5), .title = "RAVE", .line = "UNDER THE A4", .ink = hoard_white },
        .{ .z = .{ z1 - 2.05, z1 - 1.3 }, .b = 0.8, .c = v3(0.3, 0.8, 0.85), .title = "LOST CAT", .line = "ANSWERS TO KEVIN", .ink = v3(0.05, 0.05, 0.05) },
    };
    for (bills, 0..) |bl, i| {
        const k: f32 = @floatFromInt(1 + 2 * i);
        const mid = (bl.z[0] + bl.z[1]) / 2;
        print(k, bl.z[0], bl.z[1], y + bl.b, y + bl.b + 1.0, bl.c);
        const tpx: f32 = if (bl.title.len > 4) 0.014 else 0.025;
        eastText(layerX(k + 1), bl.title, mid, y + bl.b + 0.9, tpx, bl.ink);
        eastText(layerX(k + 1), bl.line, mid, y + bl.b + 0.6, 0.007, bl.ink);
    }
}

fn sloganPanel(zc: f32) void {
    const y = street_y;
    eastText(layerX(0), "LIVE. WORK. PLAY.", zc, y + 2.0, 0.05, hoard_white);
    eastText(layerX(0), "PAY.", zc, y + 1.45, 0.09, lime);
    eastText(layerX(0), "PRICES ON APPLICATION", zc, y + 0.6, 0.012, grey_text);
}

/// The completion date, delayed three times.
fn completionPanel(zc: f32) void {
    const y = street_y;
    eastText(layerX(0), "COMPLETION", zc, y + 2.0, 0.045, hoard_white);
    const years = "2019  2024  2028";
    const px: f32 = 0.04;
    const top = y + 1.5;
    eastText(layerX(0), years, zc, top, px, grey_text);
    const z0 = zc + @as(f32, @floatFromInt(years.len * 6 - 1)) * px / 2;
    for ([_]f32{ 0, 6, 12 }) |i| {
        const za = z0 - i * 6 * px;
        print(1, za - 24 * px, za + px, top - 4 * px, top - 3 * px, red);
    }
    eastText(layerX(0), "SPRING 2031", zc, y + 0.95, 0.055, lime);
}

fn sorryPanel(zc: f32) void {
    const y = street_y;
    print(0, zc - 2.3, zc + 2.3, y + 0.55, y + 2.1, hoard_white);
    eastText(layerX(1), "SORRY FOR THE NOISE", zc, y + 1.92, 0.028, hoard_c);
    eastText(layerX(1), "WE ARE BUILDING", zc, y + 1.58, 0.028, hoard_c);
    eastText(layerX(1), "A BETTER LONDON", zc, y + 1.3, 0.028, hoard_c);
    eastText(layerX(1), "(FOR SOMEBODY)", zc, y + 0.92, 0.018, red);
}

/// The signs on the gate. x: the front of the boards.
fn gateSigns(x: f32) void {
    const y = street_y;
    // The site safety board, on the north panel.
    deco(v3(x - 0.015, y + 0.7, -8.1), v3(x, y + 1.8, -6.5), hoard_white, .paint, .sheet_metal);
    deco(v3(x + 0.004, y + 1.6, -8.05), v3(x + 0.01, y + 1.75, -6.55), ppe_blue, .paint, .sheet_metal);
    eastText(x + 0.02, "SAFETY FIRST", -7.3, y + 1.71, 0.011, hoard_white);
    for ([_]f32{ -7.8, -7.3, -6.8 }, [_][]const u8{ "HARD HAT", "HI-VIS", "BOOTS" }) |z, label| {
        eastDisc(x + 0.01, y + 1.4, z, 0.12, ppe_blue);
        eastDisc(x + 0.02, y + 1.4, z, 0.05, hoard_white);
        eastText(x + 0.01, label, z, y + 1.24, 0.0045, sign_black);
    }
    eastText(x + 0.01, "ALL VISITORS MUST REPORT", -7.3, y + 1.08, 0.0055, sign_black);
    eastText(x + 0.01, "TO THE SITE OFFICE", -7.3, y + 1.0, 0.0055, sign_black);
    eastText(x + 0.01, "NO UNAUTHORISED ACCESS", -7.3, y + 0.88, 0.0065, red);
    // A yellow sign on the middle of the gate.
    deco(v3(x - 0.015, y + 1.05, 0.9), v3(x, y + 1.55, 2.3), v3(0.95, 0.8, 0.05), .paint, .sheet_metal);
    eastText(x + 0.01, "SITE ENTRANCE", 1.6, y + 1.47, 0.011, sign_black);
    eastText(x + 0.01, "KEEP CLEAR", 1.6, y + 1.28, 0.011, sign_black);
}

/// A run of Heras fence panels on feet, from a to b along the ground: a
/// galvanised tube frame and a mesh of wires, 3.5 m long or less.
fn heras(a: V3, b: V3) void {
    const len = vec.len(b - a);
    const fr = Frame{ .o = a, .f = (b - a) / vec.s(len) };
    const n = @ceil(len / 3.5);
    const w = len / n;
    const h = heras_h;
    var i: f32 = 0;
    while (i < n) : (i += 1) {
        const ua = i * w;
        const ub = ua + w;
        for ([_]f32{ ua + 0.03, ub - 0.03 }) |u| fr.rod(v3(u, 0.1, 0), v3(u, h, 0), 0.019, galv, .metal, .metal);
        for ([_]f32{ 0.2, h - 0.02 }) |v| fr.rod(v3(ua + 0.03, v, 0), v3(ub - 0.03, v, 0), 0.019, galv, .metal, .metal);
        var u = ua + 0.15;
        while (u < ub - 0.1) : (u += 0.15) fr.box(v3(u - 0.003, 0.2, -0.003), v3(u + 0.003, h - 0.02, 0.003), galv, .metal, .metal);
        var v: f32 = 0.5;
        while (v < h - 0.1) : (v += 0.3) fr.box(v3(ua + 0.03, v - 0.004, -0.004), v3(ub - 0.03, v + 0.004, 0.004), galv, .metal, .metal);
    }
    // The feet, and two clamps at each joint. The feet are longer on the
    // +Z side of the run (into the site at the gate).
    var j: f32 = 0;
    while (j <= n) : (j += 1) {
        const u = j * w;
        fr.box(v3(u - 0.1, 0, -0.14), v3(u + 0.1, 0.13, 0.32), v3(0.45, 0.44, 0.42), .concrete, .concrete);
        if (j == 0 or j == n) continue;
        for ([_]f32{ 0.5, 1.7 }) |v| fr.box(v3(u - 0.07, v, -0.035), v3(u + 0.07, v + 0.06, 0.035), galv, .metal, .metal);
    }
}

/// A traffic cone on the ground at p.
fn cone(p: V3) void {
    const orange = v3(0.95, 0.32, 0.04);
    deco(v3(p[0] - 0.19, p[1], p[2] - 0.19), v3(p[0] + 0.19, p[1] + 0.04, p[2] + 0.19), rubber, .paint, .fabric);
    const parts = [_][3]f32{ .{ 0.04, 0.24, 0.12 }, .{ 0.24, 0.38, 0.095 }, .{ 0.38, 0.52, 0.075 }, .{ 0.52, 0.72, 0.05 } };
    for (parts, 0..) |c, i| {
        map.rod(p + v3(0, c[0], 0), p + v3(0, c[1], 0), c[2], if (i == 2) hoard_white else orange, .paint, .fabric);
    }
}

/// A red and white barrier from a to b on two feet.
fn barrier(a: V3, b: V3) void {
    const len = vec.len(b - a);
    const fr = Frame{ .o = a, .f = (b - a) / vec.s(len) };
    for ([_]f32{ 0.15, len - 0.15 }) |u| {
        fr.box(v3(u - 0.05, 0, -0.3), v3(u + 0.05, 0.06, 0.3), rubber, .paint, .fabric);
        fr.box(v3(u - 0.03, 0.06, -0.03), v3(u + 0.03, 1.0, 0.03), v3(0.15, 0.15, 0.16), .paint, .fabric);
    }
    for ([_][2]f32{ .{ 0.78, 0.93 }, .{ 0.12, 0.24 } }) |bd| {
        fr.box(v3(0.005, bd[0], -0.045), v3(len - 0.005, bd[1], -0.03), hoard_white, .paint, .fabric);
        var u: f32 = 0;
        while (u < len) : (u += 0.5) fr.box(v3(u, bd[0] - 0.005, -0.05), v3(@min(u + 0.25, len), bd[1] + 0.005, -0.025), red, .paint, .fabric);
    }
}

/// A heap of earth: thin layers that get smaller and turn as they go up.
fn heap(c: V3, r: f32, h: f32, a: f32) void {
    const n = 7;
    const lh = h / @as(f32, n);
    for (0..n) |i| {
        const fi: f32 = @floatFromInt(i);
        const s = r * (1 - fi * 0.13);
        const fr = Frame{ .o = c + v3(0, fi * lh, 0), .f = heading(a + fi * 1.1) };
        fr.box(v3(-s, 0, -s * 0.75), v3(s, lh + 0.01, s * 0.75), earth_c * vec.s(0.8 + 0.04 * fi), .concrete, .earth);
    }
}

/// An excavator on tracks, at the sizes of a 1.5 t mini-digger. fr: the
/// ground under the middle of the tracks, X forward (toward the blade).
/// slew: the turn of the upper body, with its arm in the ground.
fn digger(fr: Frame, slew: f32) void {
    const grey = v3(0.2, 0.2, 0.21);
    for ([_][2]f32{ .{ -0.5, -0.27 }, .{ 0.27, 0.5 } }) |tz| {
        fr.box(v3(-0.6, 0, tz[0]), v3(0.6, 0.34, tz[1]), rubber, .paint, .metal);
        for ([_]f32{ -0.6, 0.6 }) |u| fr.rod(v3(u, 0.17, tz[0] + 0.005), v3(u, 0.17, tz[1] - 0.005), 0.17, rubber, .paint, .metal);
    }
    fr.box(v3(-0.5, 0.1, -0.265), v3(0.5, 0.3, 0.265), site_yellow, .paint, .metal);
    fr.box(v3(0.82, 0.02, -0.52), v3(0.9, 0.32, 0.52), site_yellow, .paint, .metal);
    for ([_]f32{ -0.2, 0.2 }) |w| fr.beam(v3(0.45, 0.2, w), v3(0.83, 0.17, w), 0.06, 0.08, site_yellow, .paint, .metal);
    fr.rod(v3(0, 0.3, 0), v3(0, 0.38, 0), 0.36, grey, .paint, .metal);
    // The upper body: the engine cover, the counterweight, the seat and
    // the canopy with an amber beacon.
    const h = fr.turned(v3(0, 0.38, 0), slew);
    h.box(v3(-0.6, 0, -0.48), v3(0.35, 0.42, 0.48), site_yellow, .paint, .sheet_metal);
    h.box(v3(-0.68, 0.02, -0.46), v3(-0.5, 0.4, 0.46), grey, .paint, .metal);
    h.box(v3(-0.35, 0.42, -0.18), v3(-0.05, 0.55, 0.18), rubber, .cloth, .fabric);
    h.box(v3(-0.42, 0.43, -0.18), v3(-0.34, 0.95, 0.18), rubber, .cloth, .fabric);
    for ([_]f32{ -0.5, 0.2 }) |u| for ([_]f32{ -0.42, 0.42 }) |w| h.rod(v3(u, 0.42, w), v3(u, 1.45, w), 0.025, rubber, .paint, .metal);
    h.box(v3(-0.58, 1.45, -0.47), v3(0.28, 1.52, 0.47), site_yellow, .paint, .sheet_metal);
    h.box(v3(-0.3, 1.52, -0.05), v3(-0.2, 1.62, 0.05), v3(1.0, 0.55, 0.05), .emissive, .glass);
    // The boom, the dipper with its ram, and the bucket.
    const pivot = v3(0.38, 0.3, 0.1);
    const knuckle = v3(1.35, 1.35, 0.1);
    const tip = v3(1.95, -0.1, 0.1);
    h.beam(pivot, knuckle, 0.14, 0.18, site_yellow, .paint, .metal);
    h.beam(knuckle, tip, 0.1, 0.14, site_yellow, .paint, .metal);
    h.rod(v3(0.5, 0.62, 0.1), v3(1.2, 1.58, 0.1), 0.035, v3(0.75, 0.75, 0.77), .metal, .metal);
    h.box(v3(1.8, -0.4, -0.12), v3(2.1, -0.1, 0.32), grey, .paint, .metal);
}

/// A skip: sloped ends, two steps of side wall, and rubbish in it. fr: the
/// ground under its middle, X along it.
fn skip(fr: Frame) void {
    const len: f32 = 1.3; // half the length of the floor
    const top: f32 = 1.2;
    const half_w: f32 = 0.85;
    fr.box(v3(-len, 0, -half_w), v3(len, 0.08, half_w), site_yellow, .paint, .sheet_metal);
    for ([_]f32{ -1, 1 }) |s| {
        const wz = if (s < 0) [2]f32{ -half_w, -half_w + 0.05 } else [2]f32{ half_w - 0.05, half_w };
        fr.box(v3(-len, 0, wz[0]), v3(len, top / 2, wz[1]), site_yellow, .paint, .sheet_metal);
        fr.box(v3(-len - 0.15, top / 2, wz[0]), v3(len + 0.15, top, wz[1]), site_yellow, .paint, .sheet_metal);
        // A sloped end: from the floor at s * len out to s * (len + 0.3).
        const o = fr.p(v3(s * len, 0, -half_w));
        slabR(o, fr.f * vec.s(s * 0.3) + v3(0, top, 0), fr.f * vec.s(s * 0.05), fr.side() * vec.s(2 * half_w), site_yellow, .paint, .sheet_metal);
    }
    // The rubbish: broken blocks, a plank and a mattress.
    for ([_][3]f32{ .{ -0.8, 0.3, 0.3 }, .{ 0.2, -0.4, 0.5 }, .{ 0.7, 0.35, 0.2 } }, 0..) |r, i| {
        const fi: f32 = @floatFromInt(i);
        const piece = fr.turned(v3(r[0], 0.9 + fi * 0.03, r[1]), fi * 0.9);
        piece.box(v3(-0.35, 0, -0.25), v3(0.35, r[2], 0.25), v3(0.5, 0.48, 0.45), .concrete, .concrete);
    }
    fr.beam(v3(-1.0, 0.7, -0.5), v3(1.7, 1.7, -0.3), 0.2, 0.04, timber, .wood, .wood);
    fr.beam(v3(-0.6, 1.0, 0.2), v3(1.0, 1.9, 0.45), 0.9, 0.18, v3(0.85, 0.85, 0.9), .cloth, .fabric);
}

/// A pallet of concrete blocks, at x, z on the site ground.
fn pallet(x: f32, z: f32) void {
    const g = street_y + 0.03;
    deco(v3(x - 0.6, g, z - 0.5), v3(x + 0.6, g + 0.14, z + 0.5), timber, .wood, .wood);
    deco(v3(x - 0.58, g + 0.14, z - 0.48), v3(x + 0.58, g + 0.92, z + 0.48), v3(0.62, 0.6, 0.56), .concrete, .concrete);
    var by = g + 0.355;
    while (by < g + 0.9) : (by += 0.215) deco(v3(x + 0.58, by - 0.006, z - 0.48), v3(x + 0.59, by + 0.006, z + 0.48), v3(0.42, 0.4, 0.37), .concrete, .concrete);
}

/// A bulk bag of sand (one cubic metre), with its four lifting loops.
fn bulkBag(x: f32, z: f32) void {
    const g = street_y + 0.03;
    deco(v3(x - 0.45, g, z - 0.45), v3(x + 0.45, g + 0.85, z + 0.45), v3(0.85, 0.85, 0.8), .cloth, .fabric);
    deco(v3(x - 0.4, g + 0.85, z - 0.4), v3(x + 0.4, g + 0.95, z + 0.4), v3(0.72, 0.6, 0.4), .concrete, .earth);
    for ([_]f32{ -0.42, 0.42 }) |dx| for ([_]f32{ -0.42, 0.42 }) |dz| {
        map.rod(v3(x + dx, g + 0.8, z + dz), v3(x + dx * 0.8, g + 1.05, z + dz * 0.8), 0.02, v3(0.85, 0.85, 0.8), .cloth, .fabric);
    };
}

/// A stack of long bars along X on two timber bearers: `n` bars of radius
/// r in each of `layers` layers. o: the ground at the west end and north
/// edge of the stack.
fn tubeStack(o: V3, color: V3, r: f32, n: usize, layers: usize) void {
    for ([_]f32{ 0.5, 5.5 }) |dx| deco(v3(o[0] + dx - 0.05, o[1], o[2] - 0.05), v3(o[0] + dx + 0.05, o[1] + 0.1, o[2] + 0.1 + 2.6 * r * @as(f32, @floatFromInt(n))), timber, .wood, .wood);
    for (0..layers) |l| {
        const ly = o[1] + 0.1 + r + 2 * r * @as(f32, @floatFromInt(l));
        for (0..n) |i| {
            const z = o[2] + 0.05 + r + 2.6 * r * @as(f32, @floatFromInt(i)) + (if (l % 2 == 1) 1.3 * r else 0);
            map.rod(v3(o[0], ly, z), v3(o[0] + 6, ly, z), r, color, .metal, .metal);
        }
    }
}

/// Two site cabins, one on the other, with their windows toward the road,
/// a steel stair at the south end, and signs.
fn siteOffice() void {
    const g = street_y + 0.03;
    const x0: f32 = -102.6;
    const x1: f32 = -99.6;
    const z0: f32 = -20.4;
    const z1: f32 = -10.8;
    const cabin_c = v3(0.36, 0.44, 0.5);
    const h: f32 = 2.6;
    for ([_]f32{ g + 0.12, g + h + 0.15 }) |b| {
        deco(v3(x0, b, z0), v3(x1, b + h, z1), cabin_c, .paint, .sheet_metal);
        deco(v3(x0 - 0.03, b + h - 0.12, z0 - 0.03), v3(x1 + 0.03, b + h + 0.01, z1 + 0.03), v3(0.2, 0.24, 0.27), .paint, .sheet_metal);
        for ([_]f32{ 0.8, 3.0, 7.6 }) |wz| {
            deco(v3(x1 + 0.01, b + 1.0, z0 + wz), v3(x1 + 0.03, b + 1.9, z0 + wz + 1.2), hoard_white, .paint, .metal);
            deco(v3(x1 + 0.035, b + 1.06, z0 + wz + 0.06), v3(x1 + 0.04, b + 1.84, z0 + wz + 1.14), v3(0.12, 0.16, 0.2), .metal, .glass);
        }
    }
    for ([_]f32{ x0 + 0.3, x1 - 0.3 }) |sx| for ([_]f32{ z0 + 0.4, z1 - 0.4 }) |sz| {
        deco(v3(sx - 0.15, g, sz - 0.3), v3(sx + 0.15, g + 0.12, sz + 0.3), timber, .wood, .wood);
    };
    // The signs on the upper cabin, and on the lower one.
    const ub = g + h + 0.15;
    deco(v3(x1 + 0.01, ub + 0.9, z0 + 4.5), v3(x1 + 0.025, ub + 2.1, z0 + 7.2), hoard_white, .paint, .sheet_metal);
    eastText(x1 + 0.035, "SITE OFFICE", z0 + 5.85, ub + 1.95, 0.03, sign_black);
    eastText(x1 + 0.035, "ALL VISITORS", z0 + 5.85, ub + 1.55, 0.014, sign_black);
    eastText(x1 + 0.035, "MUST SIGN IN", z0 + 5.85, ub + 1.38, 0.014, sign_black);
    deco(v3(x1 + 0.01, g + 1.5, z0 + 4.6), v3(x1 + 0.025, g + 2.0, z0 + 7.0), hoard_white, .paint, .sheet_metal);
    eastText(x1 + 0.035, "CANTEEN", z0 + 5.8, g + 1.86, 0.025, sign_black);
    // The stair: up to the west along the south end, to a landing at the
    // door of the upper cabin.
    const sz = [2]f32{ z1 + 0.1, z1 + 1.1 };
    const top = ub;
    const run: f32 = 2.6;
    const xs = x0 + 1.6 + run; // the foot of the stair
    const steps = 9;
    for (0..steps) |i| {
        const fi: f32 = @floatFromInt(i);
        const ty = g + (top - g) * (fi + 1) / @as(f32, steps) - 0.04;
        const tx = xs - run / @as(f32, steps) * (fi + 1);
        deco(v3(tx, ty, sz[0]), v3(tx + 0.3, ty + 0.04, sz[1]), galv, .metal, .metal);
    }
    for (sz) |z| {
        slabR(v3(xs, g, z - 0.02), v3(-run, top - g, 0), v3(0, 0.22, 0), v3(0, 0, 0.04), galv, .metal, .metal);
        map.rail(&.{ v3(xs, g + 1.0, z), v3(x0 + 1.6, top + 1.0, z), v3(x0 + 0.05, top + 1.0, z) }, 0.025, 0.2, galv, .metal, .metal);
        map.rod(v3(xs, g, z), v3(xs, g + 1.0, z), 0.025, galv, .metal, .metal);
    }
    deco(v3(x0, top - 0.08, sz[0]), v3(x0 + 1.6, top - 0.01, sz[1]), galv, .metal, .metal);
    for ([_]f32{ x0 + 0.05, x0 + 1.55 }) |px| map.rod(v3(px, g, sz[1]), v3(px, top + 1.0, sz[1]), 0.04, galv, .metal, .metal);
    deco(v3(x0 + 0.3, top, z1 + 0.01), v3(x0 + 1.2, top + 2.0, z1 + 0.03), v3(0.2, 0.24, 0.27), .paint, .sheet_metal);
}

/// A concrete frame building under construction: four floors of columns
/// and slabs, a core that goes higher, rebar out of the top columns, and
/// yellow edge protection on the slabs.
fn concreteFrame(r: Rect, g: f32) void {
    const conc = v3(0.6, 0.59, 0.56);
    const floor_h: f32 = 3.4;
    const cols_x = [_]f32{ r.x0 + 0.4, r.x0 + 5.5, r.x1 - 5.5, r.x1 - 0.4 };
    const cols_z = [_]f32{ r.z0 + 0.4, r.z0 + 6.4, r.z1 - 6.4, r.z1 - 0.4 };
    for (0..4) |f| {
        const fl: f32 = @floatFromInt(f);
        const b = g + fl * floor_h;
        const t = b + floor_h;
        for (cols_x) |cx| for (cols_z) |cz| {
            deco(v3(cx - 0.2, b, cz - 0.2), v3(cx + 0.2, t - 0.25, cz + 0.2), conc, .concrete, .concrete);
            if (f == 3) {
                for ([_]f32{ -0.12, 0.12 }) |dx| for ([_]f32{ -0.12, 0.12 }) |dz| {
                    map.rod(v3(cx + dx, t - 0.25, cz + dz), v3(cx + dx, t + 0.8, cz + dz), 0.012, v3(0.36, 0.18, 0.1), .metal, .metal);
                };
            }
        };
        if (f == 3) break;
        deco(v3(r.x0, t - 0.25, r.z0), v3(r.x1, t, r.z1), conc * vec.s(0.95), .concrete, .concrete);
        deco(v3(r.x1 + 0.02, t, r.z0), v3(r.x1 + 0.05, t + 1.2, r.z1), v3(0.9, 0.75, 0.1), .paint, .metal);
        deco(v3(r.x0, t, r.z1 + 0.02), v3(r.x1, t + 1.2, r.z1 + 0.05), v3(0.9, 0.75, 0.1), .paint, .metal);
    }
    deco(v3(r.x0 + 6, g, r.z0 + 7), v3(r.x0 + 10, g + 4 * floor_h + 2.5, r.z0 + 11), conc * vec.s(1.05), .concrete, .concrete);
}

/// A tower crane: a lattice mast `h` high, a jib 40 m long toward `dir`, a
/// counter-jib with its weights, a cab, a load of boards on the hook, and
/// red lights for aircraft. c: the ground at the middle of the mast.
fn towerCrane(c: V3, dir: V3, h: f32) void {
    const yel = v3(0.95, 0.75, 0.05);
    const lamp = v3(1.0, 0.1, 0.05);
    deco(v3(c[0] - 3, c[1] + 0.005, c[2] - 3), v3(c[0] + 3, c[1] + 0.45, c[2] + 3), v3(0.58, 0.57, 0.54), .concrete, .concrete);
    const m0 = c[1] + 0.45;
    const m1 = c[1] + h;
    const hw: f32 = 0.8;
    const corners = [_][2]f32{ .{ -hw, -hw }, .{ hw, -hw }, .{ hw, hw }, .{ -hw, hw } };
    for (corners) |k| map.rod(v3(c[0] + k[0], m0, c[2] + k[1]), v3(c[0] + k[0], m1, c[2] + k[1]), 0.07, yel, .paint, .metal);
    const sections: usize = @intFromFloat(@floor((m1 - m0) / 2));
    const sec = (m1 - m0) / @as(f32, @floatFromInt(sections));
    for (0..sections) |i| {
        const ya = m0 + sec * @as(f32, @floatFromInt(i));
        for (0..4) |e| {
            const a = corners[e];
            const b = corners[(e + 1) % 4];
            const pa = v3(c[0] + a[0], ya, c[2] + a[1]);
            const pb = v3(c[0] + b[0], ya, c[2] + b[1]);
            map.rod(pa, pb, 0.035, yel, .paint, .metal);
            if (i % 2 == 0) map.rod(pa, pb + v3(0, sec, 0), 0.03, yel, .paint, .metal) else map.rod(pb, pa + v3(0, sec, 0), 0.03, yel, .paint, .metal);
        }
    }
    // The slewing unit, the cab and the tower head.
    const jf = Frame{ .o = v3(c[0], m1, c[2]), .f = dir };
    jf.box(v3(-1.1, 0, -1.1), v3(1.1, 1.0, 1.1), yel, .paint, .metal);
    jf.box(v3(0.2, 0.1, 1.15), v3(2.0, 2.1, 2.6), v3(0.85, 0.85, 0.8), .paint, .sheet_metal);
    jf.box(v3(2.01, 0.9, 1.25), v3(2.04, 2.0, 2.5), v3(0.12, 0.16, 0.2), .metal, .glass);
    const apex = v3(0, 8, 0);
    for (corners) |k| jf.rod(v3(k[0], 1.0, k[1]), apex, 0.06, yel, .paint, .metal);
    jf.box(v3(-0.2, 8, -0.2), v3(0.2, 8.15, 0.2), lamp, .emissive, .glass);
    // The jib: a triangular lattice, two chords at the bottom and one at
    // the top, braced each 2 m.
    const jl: f32 = 40;
    for ([_]f32{ -0.7, 0.7 }) |w| jf.rod(v3(1.1, 1.0, w), v3(jl, 1.0, w), 0.05, yel, .paint, .metal);
    jf.rod(v3(1.1, 2.4, 0), v3(jl, 1.2, 0), 0.05, yel, .paint, .metal);
    var u: f32 = 1.1;
    while (u < jl - 1) : (u += 2) {
        const tv2 = 2.4 - 1.2 * (u + 1 - 1.1) / (jl - 1.1);
        for ([_]f32{ -0.7, 0.7 }) |w| {
            jf.rod(v3(u, 1.0, w), v3(u + 1, tv2, 0), 0.025, yel, .paint, .metal);
            jf.rod(v3(u + 1, tv2, 0), v3(u + 2, 1.0, w), 0.025, yel, .paint, .metal);
        }
        jf.rod(v3(u, 1.0, -0.7), v3(u, 1.0, 0.7), 0.025, yel, .paint, .metal);
    }
    jf.box(v3(jl - 0.15, 1.2, -0.1), v3(jl - 0.05, 1.35, 0.1), lamp, .emissive, .glass);
    // The counter-jib, its weights and the winch.
    const cl: f32 = 13;
    for ([_]f32{ -0.8, 0.8 }) |w| jf.rod(v3(-1.1, 1.0, w), v3(-cl, 1.0, w), 0.06, yel, .paint, .metal);
    jf.box(v3(-cl + 0.5, 0.85, -0.8), v3(-1.1, 0.95, 0.8), v3(0.3, 0.3, 0.3), .metal, .metal);
    for (0..3) |i| {
        const ua = -cl + 0.2 + 0.75 * @as(f32, @floatFromInt(i));
        jf.box(v3(ua, -1.2, -1.0), v3(ua + 0.7, 0.85, 1.0), v3(0.55, 0.54, 0.5), .concrete, .concrete);
    }
    jf.box(v3(-7, 1.0, -0.6), v3(-5, 2.0, 0.6), yel, .paint, .metal);
    jf.box(v3(-cl + 0.05, 1.0, -0.1), v3(-cl + 0.15, 1.15, 0.1), lamp, .emissive, .glass);
    // The ties from the tower head.
    jf.rod(apex, v3(26, 2.4 - 1.2 * (26 - 1.1) / (jl - 1.1), 0), 0.03, v3(0.2, 0.2, 0.2), .metal, .metal);
    for ([_]f32{ -0.8, 0.8 }) |w| jf.rod(apex, v3(-cl + 0.3, 1.0, w), 0.03, v3(0.2, 0.2, 0.2), .metal, .metal);
    // The trolley, the ropes, the hook block and the load: a bundle of
    // scaffold boards in two slings.
    const tu: f32 = 12;
    const hook = c[1] + 9.0 - m1; // the hook block, from the top of the mast
    jf.box(v3(tu - 0.5, 0.75, -0.6), v3(tu + 0.5, 0.95, 0.6), yel, .paint, .metal);
    for ([_]f32{ -0.15, 0.15 }) |w| jf.rod(v3(tu, 0.75, w), v3(tu, hook + 0.5, w), 0.012, v3(0.15, 0.15, 0.15), .metal, .metal);
    jf.box(v3(tu - 0.25, hook, -0.3), v3(tu + 0.25, hook + 0.5, 0.3), yel, .paint, .metal);
    const load = hook - 2.2;
    for ([_]f32{ -1.2, 1.2 }) |du| jf.rod(v3(tu, hook, 0), v3(tu + du, load + 0.3, 0), 0.015, v3(0.9, 0.5, 0.1), .cloth, .fabric);
    jf.box(v3(tu - 2.0, load, -0.35), v3(tu + 2.0, load + 0.3, 0.35), timber, .wood, .wood);
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
    // Danger boards where the live rail starts to kill, in line with the
    // barriers at the island ends (platformEnd). Each board is at the side
    // of its bed away from the platform.
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
    // Four ceiling lights over the hall, two at each end.
    for ([_]f32{ -34, -24 }) |x| for ([_]f32{ -9, 0 }) |z| {
        deco(v3(x - 0.1, mid_ceil - 0.08, z - 1.1), v3(x + 0.1, mid_ceil, z + 1.1), cool, .emissive, .glass);
        map.addLight(v3(x, mid_ceil - 0.5, z), cool * vec.s(1.4), 12);
    };

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
    deco(v3(e_pass.x0, band[0], e_pass.z0), v3(57, band[1], e_pass.z0 + 0.02), tile_green, .wall_tile, .tile);
    deco(v3(e_pass.x0, band[0], e_pass.z1 - 0.02), v3(57, band[1], e_pass.z1), tile_green, .wall_tile, .tile);
}

// ---- Escalators ---------------------------------------------------------------

const esc_tread_c = v3(0.32, 0.32, 0.33);
const esc_steel = v3(0.55, 0.56, 0.57);
const esc_deck_c = v3(0.42, 0.43, 0.44);
const esc_guide_c = v3(0.2, 0.2, 0.21);
const esc_rubber = v3(0.015, 0.015, 0.016);
const esc_bronze = v3(0.45, 0.3, 0.13);
/// The handrail centre over the step line, and the radius of the newel
/// at each end of a handrail.
const esc_rail_h: f32 = 0.95;
const esc_rn: f32 = 0.3;

/// The height of the step line (the ramp) at x: the floor at each end of
/// the escalators, the slope between.
fn escLine(x: f32) f32 {
    const t = std.math.clamp((x - esc_top_x) / (esc_bottom_x - esc_top_x), 0, 1);
    return mid_y + (deep_y - mid_y) * t;
}

/// A sloped bar along the step line from xa to xb, from ha to hb over the
/// line and from za to zb. It breaks at the ends of the slope, so it
/// follows the floors and the slope. Its ends are vertical.
fn escRun(xa: f32, xb: f32, ha: f32, hb: f32, za: f32, zb: f32, color: V3, mat: Mat, surface: Surface) void {
    const knots = [_]f32{ xa, esc_top_x, esc_bottom_x, xb };
    for (0..3) |i| {
        const a = @max(knots[i], xa);
        const b = @min(knots[i + 1], xb);
        if (b - a < 1e-3) continue;
        const ya = escLine(a);
        const yb = escLine(b);
        map.slab(v3(a, ya + ha, @min(za, zb)), v3(b - a, yb - ya, 0), v3(0, hb - ha, 0), v3(0, 0, @abs(zb - za)), color, mat, surface);
    }
}

/// A panel under the path from pa to pb: its top `drop` under the path,
/// `depth` high, from za to zb. Its ends are vertical.
fn underPath(pa: V3, pb: V3, drop: f32, depth: f32, za: f32, zb: f32, color: V3, mat: Mat, surface: Surface) void {
    map.slab(v3(pa[0], pa[1] - drop - depth, @min(za, zb)), v3(pb[0] - pa[0], pb[1] - pa[1], 0), v3(0, depth, 0), v3(0, 0, @abs(zb - za)), color, mat, surface);
}

/// The handrail round a newel: a half circle about c, on the side `side`
/// (-1 west, +1 east), then back under itself into the balustrade.
fn newelRail(c: V3, side: f32) void {
    const n = 8;
    var prev = c + v3(0, esc_rn, 0);
    for (1..n + 1) |i| {
        const a = std.math.pi * @as(f32, @floatFromInt(i)) / n;
        const p = c + v3(side * esc_rn * @sin(a), esc_rn * @cos(a), 0);
        map.rod(prev, p, 0.04, esc_rubber, .paint, .fabric);
        prev = p;
    }
    map.rod(prev, prev - v3(side * 0.35, 0, 0), 0.04, esc_rubber, .paint, .fabric);
}

/// One balustrade of a unit, beside the step edge at z = e. `s` is the
/// side away from the steps (+1 south, -1 north). The stainless skirt by
/// the steps with its black deflector brush, the panel, the handrail
/// guide, the black rubber handrail and a newel at each end. The handrail
/// follows the slope and bends to the level at each end.
fn balustrade(e: f32, s: f32) void {
    const xa = esc_top_x - esc_newel;
    const xb = esc_bottom_x + esc_newel;
    const zr = e + s * 0.04;
    escRun(xa, xb, -0.4, 0.22, e, e + s * 0.025, esc_steel, .paint, .metal);
    escRun(esc_top_x - esc_flat_len, esc_bottom_x + esc_flat_len, 0.1, 0.13, e, e - s * 0.035, esc_rubber, .cloth, .fabric);
    var buf: [32]V3 = undefined;
    const path = map.bendPath(&.{
        v3(xa, mid_y + esc_rail_h, zr),
        v3(esc_top_x, mid_y + esc_rail_h, zr),
        v3(esc_bottom_x, deep_y + esc_rail_h, zr),
        v3(xb, deep_y + esc_rail_h, zr),
    }, 1.5, 6, &buf);
    for (1..path.len) |i| {
        const pa = path[i - 1];
        const pb = path[i];
        underPath(pa, pb, 0.035, 1.5, e + s * 0.01, e + s * 0.045, esc_steel, .paint, .metal);
        underPath(pa, pb, 0.035, 0.09, e, e + s * 0.1, esc_guide_c, .paint, .metal);
        map.rod(pa, pb, 0.04, esc_rubber, .paint, .fabric);
    }
    // The newels: the handrail turns round a wheel in a round housing.
    for ([_]f32{ xa, xb }, [_]f32{ mid_y, deep_y }, [_]f32{ -1, 1 }) |x, floor, side| {
        const c = v3(x, floor + esc_rail_h - esc_rn, zr);
        newelRail(c, side);
        const zm = e + s * 0.05;
        map.addDisc(vec.translate(v3(x, c[1], zm)), esc_rn - 0.04, 0.1, esc_steel, .paint, .metal);
        const xo = x + side * (esc_rn - 0.04);
        deco(v3(@min(x, xo), floor, @min(e, e + s * 0.1)), v3(@max(x, xo), c[1], @max(e, e + s * 0.1)), esc_steel, .paint, .metal);
    }
}

/// The yellow lines at the sides of one tread of each unit, from x to
/// x + esc_run, at the height y.
fn treadEdges(x: f32, y: f32) void {
    for (esc_lane_z) |zl| for ([_]f32{ -1, 1 }) |side| {
        const za = zl + side * (esc_step_w / 2 - 0.005);
        const zb = za - side * 0.035;
        deco(v3(x + 0.015, y, @min(za, zb)), v3(x + esc_run - 0.015, y + 0.003, @max(za, zb)), yellow, .paint, .metal);
    };
}

fn escalators() void {
    const x0 = esc_top_x;
    const x1 = esc_bottom_x;
    // The steps: grooved aluminium (map.Mat.tread). One box for each step
    // goes under both units and the deckings. The yellow lines at the
    // front of each step move (main.zig buildEscalatorSteps).
    for (0..esc_steps) |i| {
        const fi: f32 = @floatFromInt(i);
        const xa = x0 + esc_run * fi;
        const top = mid_y - esc_rise * (fi + 1);
        boxNoAo(v3(xa, deep_y - 1, esc_z[0]), v3(xa + esc_run, top, esc_z[1]), esc_tread_c, .tread, .metal);
        treadEdges(xa, top);
    }
    // At each end: the flat steps, the comb plate with its yellow comb, and
    // the landing plate.
    for ([_]f32{ x0, x1 }, [_]f32{ mid_y, deep_y }, [_]f32{ -1, 1 }) |xe, floor, side| {
        for (0..esc_flat) |j| {
            const fj: f32 = @floatFromInt(j);
            treadEdges(if (side < 0) xe - esc_run * (fj + 1) else xe + esc_run * fj, floor + 0.004);
        }
        const xc = xe + side * esc_flat_len;
        const xp = xc + side * esc_comb;
        for (esc_lane_z) |zl| {
            const za = zl - esc_step_w / 2;
            const zb = zl + esc_step_w / 2;
            deco(v3(@min(xe, xc), floor, za), v3(@max(xe, xc), floor + 0.004, zb), esc_tread_c, .tread, .metal);
            deco(v3(@min(xc, xp), floor, za), v3(@max(xc, xp), floor + 0.012, zb), esc_tread_c * vec.s(1.3), .tread, .metal);
            deco(v3(@min(xc - side * 0.01, xc + side * 0.07), floor, za), v3(@max(xc - side * 0.01, xc + side * 0.07), floor + 0.016, zb), yellow, .paint, .metal);
            const xq = xp + side * 0.9;
            deco(v3(@min(xp, xq), floor, za - 0.1), v3(@max(xp, xq), floor + 0.008, zb + 0.1), esc_tread_c * vec.s(1.15), .tread, .metal);
        }
    }

    // The balustrades, and the deckings between them: the outer decking
    // along each wall and the decking between the units.
    const xa = x0 - esc_newel - (esc_rn - 0.04);
    const xb = x1 + esc_newel + (esc_rn - 0.04);
    const edges = [_]f32{ esc_lane_z[0] - esc_step_w / 2, esc_lane_z[0] + esc_step_w / 2, esc_lane_z[1] - esc_step_w / 2, esc_lane_z[1] + esc_step_w / 2 };
    for (edges, [_]f32{ -1, 1, -1, 1 }) |e, s| balustrade(e, s);
    const decks = [_][2]f32{
        .{ esc_z[0], edges[0] - 0.045 },
        .{ edges[1] + 0.045, edges[2] - 0.045 },
        .{ edges[3] + 0.045, esc_z[1] },
    };
    const deck_h: f32 = 0.86;
    for (decks) |d| escRun(xa, xb, -0.5, deck_h, d[0], d[1], esc_deck_c, .paint, .metal);
    // The lamp columns on the middle decking: bronze, with an uplighter
    // of frosted glass.
    var lamp_x: [5]f32 = undefined;
    for (&lamp_x, 0..) |*lx, k| {
        lx.* = x0 + 2 + 3 * @as(f32, @floatFromInt(k));
        const y = escLine(lx.*) + deck_h;
        map.rod(v3(lx.*, y, esc_cz), v3(lx.*, y + 0.42, esc_cz), 0.035, esc_bronze, .paint, .metal);
        map.rod(v3(lx.*, y + 0.42, esc_cz), v3(lx.*, y + 0.62, esc_cz), 0.075, v3(1.0, 0.82, 0.55), .emissive, .glass);
        map.rod(v3(lx.*, y + 0.62, esc_cz), v3(lx.*, y + 0.66, esc_cz), 0.09, esc_bronze, .paint, .metal);
        map.addSolid(v3(lx.* - 0.1, y, esc_cz - 0.1), v3(lx.* + 0.1, y + 0.66, esc_cz + 0.1), .metal);
    }
    // Studs on the deckings, so that nobody slides down them.
    for (decks) |d| {
        const zc = (d[0] + d[1]) / 2;
        var x = x0 + 0.8;
        studs: while (x < x1 - 0.5) : (x += 1.6) {
            for (lamp_x) |lx| if (@abs(x - lx) < 0.4 and @abs(zc - esc_cz) < 0.1) continue :studs;
            const y = escLine(x) + deck_h;
            map.rod(v3(x, y, zc), v3(x, y + 0.05, zc), 0.035, esc_steel, .paint, .metal);
        }
    }

    // The balustrades and the deckings stop the player too: coarse boxes
    // along the slope, up to the handrails, and boxes over the flat ends.
    const strips = [_][2]f32{ .{ esc_z[0], edges[0] }, .{ edges[1], edges[2] }, .{ edges[3], esc_z[1] } };
    for (strips) |zz| {
        map.addSolid(v3(xa, mid_y, zz[0]), v3(x0, mid_y + 1.0, zz[1]), .metal);
        map.addSolid(v3(x1, deep_y, zz[0]), v3(xb, deep_y + 1.0, zz[1]), .metal);
        var k: usize = 0;
        while (k < esc_steps) : (k += 3) {
            const fa: f32 = @floatFromInt(k);
            const fb: f32 = @floatFromInt(@min(k + 3, esc_steps));
            map.addSolid(
                v3(x0 + esc_run * fa, mid_y - esc_rise * fb, zz[0]),
                v3(x0 + esc_run * fb, mid_y - esc_rise * fa + 1.0, zz[1]),
                .metal,
            );
        }
    }

    // The shaft: tiled walls, a vault from the wall tops to the crown, and
    // light strips along the crown.
    box(v3(x0, deep_y - 1, esc_z[0] - 0.3), v3(x1, mid_ceil, esc_z[0]), tile_c, .wall_tile, .tile);
    box(v3(x0, deep_y - 1, esc_z[1]), v3(x1, mid_ceil, esc_z[1] + 0.3), tile_c, .wall_tile, .tile);
    const wall_h: f32 = 3.5;
    const crown_h: f32 = 4.6;
    const vr = (esc_half * esc_half + (crown_h - wall_h) * (crown_h - wall_h)) / (2 * (crown_h - wall_h));
    const vc = v3(0, crown_h - vr, esc_cz);
    const amax = std.math.asin(esc_half / vr);
    // The vault starts where its crown is under the ceiling of the
    // intermediate level. Over the top steps that ceiling is the roof of
    // the shaft.
    const xv = x0 + (crown_h - (mid_ceil - mid_y)) / (esc_rise / esc_run);
    const run = v3(x1 - xv, deep_y - escLine(xv), 0);
    const vault_n = 6;
    for (0..vault_n) |i| {
        const a = -amax + 2 * amax * @as(f32, @floatFromInt(i)) / vault_n;
        const b = -amax + 2 * amax * @as(f32, @floatFromInt(i + 1)) / vault_n;
        const pa = vc + v3(0, vr * @cos(a), vr * @sin(a));
        const pb = vc + v3(0, vr * @cos(b), vr * @sin(b));
        const out = vec.norm((pa + pb) * vec.s(0.5) - vc) * vec.s(0.15);
        map.slab(v3(xv, escLine(xv) + pa[1], pa[2]), run, pb - pa, out, tile_c, .wall_tile, .tile);
    }
    const slope = vec.norm(run);
    const up = vec.norm(vec.cross(v3(0, 0, 1), slope));
    for (0..4) |i| {
        const t = (@as(f32, @floatFromInt(i)) + 0.5) / 4;
        const x = xv + (x1 - xv) * t;
        const p = v3(x, escLine(x) + crown_h - 0.04, esc_cz);
        map.beam(p - slope * vec.s(0.8), p + slope * vec.s(0.8), 0.25, 0.06, up, cool, .emissive, .glass);
    }
    // Two lights under the crown, at a quarter and three quarters of the
    // slope.
    for ([_]f32{ 0.25, 0.75 }) |t| {
        const x = xv + (x1 - xv) * t;
        map.addLight(v3(x, escLine(x) + crown_h - 0.5, esc_cz), v3(1.1, 0.85, 0.6), 11);
    }

    // Adverts on both walls: level posters in black frames, one each 2.3 m
    // down the slope.
    const ads = [_]V3{ v3(0.8, 0.35, 0.1), v3(0.1, 0.4, 0.55), v3(0.85, 0.75, 0.2), v3(0.45, 0.1, 0.35), v3(0.15, 0.5, 0.25), v3(0.9, 0.9, 0.85), v3(0.7, 0.12, 0.1) };
    for ([_]f32{ esc_z[0], esc_z[1] }, [_]f32{ 1, -1 }, 0..) |zf, si, wi| {
        var x = x0 + 1.4;
        var k: usize = wi * 3;
        while (x < x1 - 0.9) : (x += 2.3) {
            const yc = escLine(x) + 2.05;
            const f = [2]f32{ zf, zf + si * 0.03 };
            const p = [2]f32{ zf + si * 0.03, zf + si * 0.036 };
            deco(v3(x - 0.42, yc - 0.6, @min(f[0], f[1])), v3(x + 0.42, yc + 0.6, @max(f[0], f[1])), v3(0.03, 0.03, 0.03), .paint, .wood);
            deco(v3(x - 0.36, yc - 0.54, @min(p[0], p[1])), v3(x + 0.36, yc + 0.54, @max(p[0], p[1])), ads[k % ads.len], .paint, .wood);
            const q = [2]f32{ p[1], p[1] + si * 0.004 };
            deco(v3(x - 0.3, yc + 0.22, @min(q[0], q[1])), v3(x + 0.3, yc + 0.42, @max(q[0], q[1])), v3(0.92, 0.92, 0.88), .paint, .wood);
            k += 1;
        }
    }

    // The ramp over both units, through the front edges of the steps
    // (map.Ramp): a rider moves smoothly. Each unit carries a rider over
    // its slope and its flat steps, to the comb plate. The north unit goes
    // down (east), the south unit comes up.
    map.addRamp(.{ .x0 = x0, .x1 = x1, .z0 = esc_z[0], .z1 = esc_z[1], .y0 = mid_y, .y1 = deep_y, .bottom = deep_y - 1 });
    for (esc_lane_z, [_]f32{ 0.65, -0.65 }) |zl, v| {
        map.addEscalator(.{
            .min = v3(x0 - esc_flat_len, deep_y - 0.5, zl - esc_step_w / 2),
            .max = v3(x1 + esc_flat_len, mid_y + 0.5, zl + esc_step_w / 2),
            .vel = v3(v, 0, 0),
        });
    }
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
    const x0 = esc_hall_x1;
    const arches = [_]f32{ 6, 18, 30, 42, 54 };
    const yc = y + st_dy;
    const crown = yc + st_r;
    const rc = rail_y + run_dy;
    const bore_top = rc + run_r;
    const ring_c = v3(0.1, 0.1, 0.11);
    const rib_c = v3(0.28, 0.11, 0.08);
    const sign_g = v3(0.05, 0.75, 0.3);

    // The lower hall at the foot of the escalators: as wide as the shaft,
    // with a header over the mouth of the shaft. The corridor goes on east
    // of it between the platforms.
    const hx0 = esc_bottom_x;
    box(v3(hx0, y - 1, esc_z[0]), v3(x0, y, esc_z[1]), floor_c, .concrete, .concrete);
    box(v3(hx0, y, esc_z[0] - 0.3), v3(x0, deep_ceil, esc_z[0]), tile_c, .wall_tile, .tile);
    box(v3(hx0, y, esc_z[1]), v3(x0, deep_ceil, esc_z[1] + 0.3), tile_c, .wall_tile, .tile);
    box(v3(x0 - 0.3, y, esc_z[0]), v3(x0, deep_ceil, corr_z[0]), tile_c, .wall_tile, .tile);
    box(v3(x0 - 0.3, y, corr_z[1]), v3(x0, deep_ceil, esc_z[1]), tile_c, .wall_tile, .tile);
    box(v3(hx0, y + 3.4, esc_z[0]), v3(hx0 + 0.3, deep_ceil, esc_z[1]), tile_c, .wall_tile, .tile);

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
    // Two ceiling lights in the corridor, between the cross-passages.
    for ([_]f32{ 12, 48 }) |lx| {
        const cz = (corr_z[0] + corr_z[1]) / 2;
        deco(v3(lx - 1.1, deep_ceil - 0.08, cz - 0.1), v3(lx + 1.1, deep_ceil, cz + 0.1), cool, .emissive, .glass);
        map.addLight(v3(lx, deep_ceil - 0.5, cz), cool * vec.s(1.3), 12);
    }

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
    for ([_]f32{ 42, 63, 81, 99 }) |lx| {
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

/// True when the live rail kills a player with feet at `feet`: between the
/// side walls of the District lines past shock_x (the tracks, and the
/// island ends behind the barriers), and on the Piccadilly tracks past the
/// ends of the platforms. The floor of a train is above the track bed, so
/// a rider in the deep train is safe in the tunnels. The deep lift is
/// outside the side walls.
pub fn liveRail(feet: V3) bool {
    const district = feet[2] > wall_n and feet[2] < wall_s;
    if (district and @abs(feet[0]) > shock_x and feet[1] < 2 and feet[1] > bed_y - 1) return true;
    const deep_track = feet[1] < deep_y - 0.4 and feet[1] > deep_y - 2;
    return deep_track and (feet[0] < plat_x[0] - deep_shock or feet[0] > plat_x[1] + deep_shock);
}

// ---- The train indicators ------------------------------------------------------

/// A dot-matrix board over each platform (platform_display.zig), two along
/// each platform. Their text follows the trains: the deep train stops at
/// platform 5 and runs west, the parked train stands at platform 2. The
/// District boards hang from the roof arch, the Piccadilly boards from the
/// tunnel lining over the middle of the platform.
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
    displays.add(.{ .number = 5, .dest = "Heathrow T5", .service = .deep_train, .board_z = (p5[0] + p5[1]) / 2, .floor_y = deep_y, .hang_y = tubeTop(t5_c, 1, (p5[0] + p5[1]) / 2), .xs = .{ 24, 84 } });
    displays.add(.{ .number = 6, .dest = "Cockfosters", .service = .none, .board_z = (p6[0] + p6[1]) / 2, .floor_y = deep_y, .hang_y = tubeTop(t6_c, -1, (p6[0] + p6[1]) / 2), .xs = .{ 24, 84 } });
}
