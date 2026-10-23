// The arena: an open square with walls, a centre platform, corner
// buildings, containers, pillars and crates. Target practice uses it.
//
// The practice range is south of the arena, through a doorway in the south
// wall: a lane 24 m wide and 80 m long. Dummies (range.zig) stand 10, 15,
// 25, 35, 50 and 75 m from the practice spawn. A row of waist-high walls
// stands in front of each dummy, and a pillar hides the one at 15 m. The
// sun is behind the firing line, so the dummies are lit.
const std = @import("std");
const map = @import("../map.zig");
const vec = @import("../vec.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat = map.Mat;
const Surface = map.Surface;

pub const half: f32 = 30;
pub const wall_h: f32 = 7;

/// The range: the lane half width, the z of the firing line and of the
/// inner face of the back wall.
pub const range_half: f32 = 12;
pub const range_line: f32 = 33;
pub const range_end: f32 = 113;
/// The practice spawn: on the firing line, facing down the range (+Z).
pub const range_spawn: map.Spawn = .{ .pos = v3(0, 0, range_line - 0.6), .yaw = std.math.pi };

/// A dummy of the range: x, and the distance d from the practice spawn. A
/// dummy with `walk` walks side to side, `walk` metres each way. A dummy
/// with `peek` stands behind the pillar and leans out at random times: -1
/// leans left, 1 right (player.zig lean).
pub const Dummy = struct { x: f32, d: f32, walk: f32 = 0, peek: f32 = 0 };
/// Seen from the spawn, each dummy is clear of the lines of sight to the
/// others, and the far ones are at least 5 degrees apart, so their health
/// bars do not cover each other. The angles from the spawn: 10 m -27, 25 m
/// -21, the walker -15 to -6, 75 m 0, 50 m 5, the leaner 11 (its pillar 10
/// to 19).
pub const range_dummies = [_]Dummy{
    .{ .x = -4.5, .d = 10 },
    .{ .x = -9, .d = 25 },
    .{ .x = 4.5, .d = 50 },
    .{ .x = 0, .d = 75 },
    .{ .x = -6.25, .d = 35, .walk = 2.75 },
    .{ .x = 3, .d = 15, .peek = -1 },
};

/// The feet of a dummy at its place: `d` from the spawn.
pub fn dummyHome(dm: Dummy) V3 {
    const s = range_spawn.pos;
    return v3(dm.x, 0, s[2] + @sqrt(dm.d * dm.d - dm.x * dm.x));
}

const spawns = [_][2]f32{
    .{ -24, -24 }, .{ 24, 24 }, .{ -24, 24 }, .{ 24, -24 },
    .{ 0, -25 },   .{ 0, 25 },  .{ -25, 0 },  .{ 25, 0 },
};

fn a(min: V3, max: V3, color: V3, mat: Mat, surface: Surface) void {
    _ = map.add(min, max, color, mat, surface);
}

fn put(x: f32, z: f32, sx: f32, sy: f32, sz: f32, y0: f32, color: V3, mat: Mat, surface: Surface) void {
    _ = map.put(x, z, sx, sy, sz, y0, color, mat, surface);
}

/// A lamp post with an arm toward the middle (on X). The head hangs from
/// the arm, clear of the post: the light must be outside every solid shape,
/// or its shadow map hides all of it.
fn lamp(x: f32, z: f32, h: f32) void {
    const iron = v3(0.12, 0.12, 0.13);
    const hx = x + (if (x > 0) @as(f32, -0.9) else 0.9);
    put(x, z, 0.16, h + 0.12, 0.16, 0, iron, .metal, .metal);
    put((x + hx) / 2, z, 0.9, 0.08, 0.08, h + 0.04, iron, .metal, .metal);
    put(hx, z, 0.5, 0.12, 0.5, h, iron, .metal, .sheet_metal);
    const bulb = map.add(v3(hx - 0.2, h - 0.22, z - 0.2), v3(hx + 0.2, h, z + 0.2), v3(1.0, 0.62, 0.28), .emissive, .glass);
    bulb.solid = false;
    map.addLight(v3(hx, h - 0.5, z), v3(1.0, 0.55, 0.22), 11);
}

fn crate(x: f32, z: f32, size: f32, y0: f32) void {
    put(x, z, size, size, size, y0, v3(0.55, 0.38, 0.22), .wood, .wood);
}

/// A shipping container, long side on X when `along_x`.
fn container(x: f32, z: f32, along_x: bool, color: V3) void {
    if (along_x) put(x, z, 6.0, 2.6, 2.4, 0, color, .metal, .sheet_metal) else put(x, z, 2.4, 2.6, 6.0, 0, color, .metal, .sheet_metal);
}

pub fn build() void {
    for (spawns) |sp| map.addSpawn(v3(sp[0], 0, sp[1]));
    const sand = v3(0.78, 0.66, 0.52);
    const terracotta = v3(0.72, 0.36, 0.24);
    const bone = v3(0.86, 0.82, 0.74);
    const teal = v3(0.13, 0.42, 0.45);
    const rust = v3(0.55, 0.22, 0.12);
    const navy = v3(0.16, 0.22, 0.36);

    // Floor and the outer walls.
    a(v3(-half - 2, -1, -half - 2), v3(half + 2, 0, half + 2), v3(0.44, 0.41, 0.38), .tile, .tile);
    a(v3(-half - 1, 0, -half - 1), v3(half + 1, wall_h, -half), sand, .concrete, .concrete);
    // The south wall has a doorway to the range, 4 m wide.
    a(v3(-half - 1, 0, half), v3(-2, wall_h, half + 1), sand, .concrete, .concrete);
    a(v3(2, 0, half), v3(half + 1, wall_h, half + 1), sand, .concrete, .concrete);
    a(v3(-2, 3.2, half), v3(2, wall_h, half + 1), sand, .concrete, .concrete);
    a(v3(-half - 1, 0, -half), v3(-half, wall_h, half), sand, .concrete, .concrete);
    a(v3(half, 0, -half), v3(half + 1, wall_h, half), sand, .concrete, .concrete);
    // A trim along the top of the walls.
    a(v3(-half - 1.2, wall_h, -half - 1.2), v3(half + 1.2, wall_h + 0.3, -half + 0.2), terracotta, .concrete, .concrete);
    a(v3(-half - 1.2, wall_h, half - 0.2), v3(half + 1.2, wall_h + 0.3, half + 1.2), terracotta, .concrete, .concrete);
    a(v3(-half - 1.2, wall_h, -half), v3(-half + 0.2, wall_h + 0.3, half), terracotta, .concrete, .concrete);
    a(v3(half - 0.2, wall_h, -half), v3(half + 1.2, wall_h + 0.3, half), terracotta, .concrete, .concrete);

    // The centre platform, with stairs on the north and south sides.
    put(0, 0, 10, 1.6, 10, 0, bone, .concrete, .concrete);
    for (0..4) |i| {
        const f: f32 = @floatFromInt(i);
        const h = 0.4 * (f + 1);
        put(0, 5.0 + 0.6 * (3 - f) + 0.3, 3, h, 0.6, 0, bone, .concrete, .concrete);
        put(0, -5.0 - 0.6 * (3 - f) - 0.3, 3, h, 0.6, 0, bone, .concrete, .concrete);
    }
    put(-3.2, 0, 0.5, 1.0, 4, 1.6, terracotta, .concrete, .concrete);
    put(3.2, 0, 0.5, 1.0, 4, 1.6, terracotta, .concrete, .concrete);
    crate(0, 0, 1.2, 1.6);

    // Four corner buildings: two walls each, with a doorway gap.
    const corners = [_][2]f32{ .{ -1, -1 }, .{ 1, -1 }, .{ -1, 1 }, .{ 1, 1 } };
    for (corners) |c| {
        const cx = c[0] * 17;
        const cz = c[1] * 17;
        put(cx, cz + c[1] * 3.5, 8, 3.4, 0.6, 0, terracotta, .concrete, .concrete);
        put(cx + c[0] * 3.7, cz - c[1] * 0.5, 0.6, 3.4, 4, 0, terracotta, .concrete, .concrete);
        // A roof slab gives shade over half of the floor.
        put(cx + c[0] * 1, cz + c[1] * 1.6, 6.2, 0.3, 4.4, 3.4, bone, .concrete, .concrete);
        crate(cx - c[0] * 1.5, cz + c[1] * 1.8, 1.0, 0);
    }

    // Containers on the sides.
    container(-12, 0, false, teal);
    container(12, 0, false, rust);
    container(0, -14, true, navy);
    container(0, 14, true, teal);
    put(-12, 0, 2.4, 2.6, 2.6, 2.6, rust, .metal, .sheet_metal);

    // Pillars.
    const pillars = [_][2]f32{ .{ -8, -8 }, .{ 8, -8 }, .{ -8, 8 }, .{ 8, 8 } };
    for (pillars) |p| {
        put(p[0], p[1], 1.0, 5.0, 1.0, 0, bone, .concrete, .concrete);
        put(p[0], p[1], 1.3, 0.3, 1.3, 5.0, terracotta, .concrete, .concrete);
    }

    // Low cover walls and crates.
    put(-20, -6, 4, 1.1, 0.5, 0, sand, .concrete, .concrete);
    put(20, 6, 4, 1.1, 0.5, 0, sand, .concrete, .concrete);
    put(-6, 21, 0.5, 1.1, 4, 0, sand, .concrete, .concrete);
    put(6, -21, 0.5, 1.1, 4, 0, sand, .concrete, .concrete);
    crate(-22, 10, 1.4, 0);
    crate(-20.6, 10.3, 1.2, 0);
    crate(-21.6, 10.2, 1.0, 1.4);
    crate(22, -10, 1.4, 0);
    crate(20.6, -10.3, 1.2, 0);
    crate(9, 23, 1.2, 0);
    crate(-9, -23, 1.2, 0);
    crate(25, 18, 1.4, 0);
    crate(-25, -18, 1.4, 0);

    range(sand, terracotta);

    // Lamps along the routes.
    lamp(-12, 5, 4.2);
    lamp(12, -5, 4.2);
    lamp(-5, -14, 4.2);
    lamp(5, 14, 4.2);
    lamp(-24, -12, 4.2);
    lamp(24, 12, 4.2);
}

/// The practice range, south of the arena (see the top of this file).
fn range(sand: V3, terracotta: V3) void {
    // The sun shadow covers the arena and the range.
    map.shadow_centre = v3(0, 0, 41);
    map.shadow_half = 78;
    const w = range_half;
    const z0 = half + 1;
    const z1 = range_end;
    a(v3(-w - 1, -1, z0), v3(w + 1, 0, z1 + 1), v3(0.5, 0.47, 0.43), .concrete, .concrete);
    a(v3(-w - 1, 0, z0), v3(-w, wall_h, z1), sand, .concrete, .concrete);
    a(v3(w, 0, z0), v3(w + 1, wall_h, z1), sand, .concrete, .concrete);
    a(v3(-w - 1, 0, z1), v3(w + 1, wall_h, z1 + 1), sand, .concrete, .concrete);
    a(v3(-w - 1.2, wall_h, z0), v3(-w + 0.2, wall_h + 0.3, z1 + 1.2), terracotta, .concrete, .concrete);
    a(v3(w - 0.2, wall_h, z0), v3(w + 1.2, wall_h + 0.3, z1 + 1.2), terracotta, .concrete, .concrete);
    a(v3(-w - 1.2, wall_h, z1 - 0.2), v3(w + 1.2, wall_h + 0.3, z1 + 1.2), terracotta, .concrete, .concrete);
    // The firing line: a yellow stripe on the floor, no collision.
    const stripe = map.add(v3(-w, 0, range_line), v3(w, 0.01, range_line + 0.12), v3(0.85, 0.68, 0.1), .paint, .concrete);
    stripe.solid = false;
    for (range_dummies) |dm| {
        const z = dummyHome(dm)[2];
        if (dm.peek == 0) {
            // A row in front of the dummy: five waist-high walls 3 m long,
            // with gaps of 1.5 m. The dummy stands 0.75 m behind its wall,
            // so its gun does not go into the wall.
            for ([_]f32{ -9, -4.5, 0, 4.5, 9 }) |x| put(x, z - 0.9, 3, 1.05, 0.3, 0, terracotta, .concrete, .concrete);
        } else {
            // The pillar of the leaning dummy, 0.9 m in front of it. The
            // dummy leans out past its west edge (to -X). The edge is 0.55 m
            // from the dummy: the least that hides all the hit boxes of the
            // upright dummy from the spawn. A full lean then shows about
            // 0.1 m of the head, as a player's lean does.
            const edge = dm.x - 0.55;
            put(edge + 1.1, z - 1.15, 2.2, 2.5, 0.5, 0, v3(0.13, 0.42, 0.45), .concrete, .concrete);
        }
    }
}
