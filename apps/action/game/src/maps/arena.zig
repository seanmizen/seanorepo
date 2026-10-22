// The arena: an open square with walls, a centre platform, corner
// buildings, containers, pillars and crates. Target practice and the menu
// use it.
const map = @import("../map.zig");
const vec = @import("../vec.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat = map.Mat;

pub const half: f32 = 30;
pub const wall_h: f32 = 7;

const spawns = [_][2]f32{
    .{ -24, -24 }, .{ 24, 24 }, .{ -24, 24 }, .{ 24, -24 },
    .{ 0, -25 },   .{ 0, 25 },  .{ -25, 0 },  .{ 25, 0 },
};

fn a(min: V3, max: V3, color: V3, mat: Mat) void {
    _ = map.add(min, max, color, mat);
}

fn put(x: f32, z: f32, sx: f32, sy: f32, sz: f32, y0: f32, color: V3, mat: Mat) void {
    _ = map.put(x, z, sx, sy, sz, y0, color, mat);
}

fn lamp(x: f32, z: f32, h: f32) void {
    put(x, z, 0.16, h, 0.16, 0, v3(0.12, 0.12, 0.13), .metal);
    put(x, z, 0.5, 0.12, 0.5, h, v3(0.12, 0.12, 0.13), .metal);
    const bulb = map.add(v3(x - 0.2, h - 0.22, z - 0.2), v3(x + 0.2, h, z + 0.2), v3(1.0, 0.62, 0.28), .emissive);
    bulb.solid = false;
    map.addLight(v3(x, h - 0.5, z), v3(1.0, 0.55, 0.22), 11);
}

fn crate(x: f32, z: f32, size: f32, y0: f32) void {
    put(x, z, size, size, size, y0, v3(0.55, 0.38, 0.22), .wood);
}

/// A shipping container, long side on X when `along_x`.
fn container(x: f32, z: f32, along_x: bool, color: V3) void {
    if (along_x) put(x, z, 6.0, 2.6, 2.4, 0, color, .metal) else put(x, z, 2.4, 2.6, 6.0, 0, color, .metal);
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
    a(v3(-half - 2, -1, -half - 2), v3(half + 2, 0, half + 2), v3(0.44, 0.41, 0.38), .tile);
    a(v3(-half - 1, 0, -half - 1), v3(half + 1, wall_h, -half), sand, .concrete);
    a(v3(-half - 1, 0, half), v3(half + 1, wall_h, half + 1), sand, .concrete);
    a(v3(-half - 1, 0, -half), v3(-half, wall_h, half), sand, .concrete);
    a(v3(half, 0, -half), v3(half + 1, wall_h, half), sand, .concrete);
    // A trim along the top of the walls.
    a(v3(-half - 1.2, wall_h, -half - 1.2), v3(half + 1.2, wall_h + 0.3, -half + 0.2), terracotta, .concrete);
    a(v3(-half - 1.2, wall_h, half - 0.2), v3(half + 1.2, wall_h + 0.3, half + 1.2), terracotta, .concrete);
    a(v3(-half - 1.2, wall_h, -half), v3(-half + 0.2, wall_h + 0.3, half), terracotta, .concrete);
    a(v3(half - 0.2, wall_h, -half), v3(half + 1.2, wall_h + 0.3, half), terracotta, .concrete);

    // The centre platform, with stairs on the north and south sides.
    put(0, 0, 10, 1.6, 10, 0, bone, .concrete);
    for (0..4) |i| {
        const f: f32 = @floatFromInt(i);
        const h = 0.4 * (f + 1);
        put(0, 5.0 + 0.6 * (3 - f) + 0.3, 3, h, 0.6, 0, bone, .concrete);
        put(0, -5.0 - 0.6 * (3 - f) - 0.3, 3, h, 0.6, 0, bone, .concrete);
    }
    put(-3.2, 0, 0.5, 1.0, 4, 1.6, terracotta, .concrete);
    put(3.2, 0, 0.5, 1.0, 4, 1.6, terracotta, .concrete);
    crate(0, 0, 1.2, 1.6);

    // Four corner buildings: two walls each, with a doorway gap.
    const corners = [_][2]f32{ .{ -1, -1 }, .{ 1, -1 }, .{ -1, 1 }, .{ 1, 1 } };
    for (corners) |c| {
        const cx = c[0] * 17;
        const cz = c[1] * 17;
        put(cx, cz + c[1] * 3.5, 8, 3.4, 0.6, 0, terracotta, .concrete);
        put(cx + c[0] * 3.7, cz - c[1] * 0.5, 0.6, 3.4, 4, 0, terracotta, .concrete);
        // A roof slab gives shade over half of the floor.
        put(cx + c[0] * 1, cz + c[1] * 1.6, 6.2, 0.3, 4.4, 3.4, bone, .concrete);
        crate(cx - c[0] * 1.5, cz + c[1] * 1.8, 1.0, 0);
    }

    // Containers on the sides.
    container(-12, 0, false, teal);
    container(12, 0, false, rust);
    container(0, -14, true, navy);
    container(0, 14, true, teal);
    put(-12, 0, 2.4, 2.6, 2.6, 2.6, rust, .metal);

    // Pillars.
    const pillars = [_][2]f32{ .{ -8, -8 }, .{ 8, -8 }, .{ -8, 8 }, .{ 8, 8 } };
    for (pillars) |p| {
        put(p[0], p[1], 1.0, 5.0, 1.0, 0, bone, .concrete);
        put(p[0], p[1], 1.3, 0.3, 1.3, 5.0, terracotta, .concrete);
    }

    // Low cover walls and crates.
    put(-20, -6, 4, 1.1, 0.5, 0, sand, .concrete);
    put(20, 6, 4, 1.1, 0.5, 0, sand, .concrete);
    put(-6, 21, 0.5, 1.1, 4, 0, sand, .concrete);
    put(6, -21, 0.5, 1.1, 4, 0, sand, .concrete);
    crate(-22, 10, 1.4, 0);
    crate(-20.6, 10.3, 1.2, 0);
    crate(-21.6, 10.2, 1.0, 1.4);
    crate(22, -10, 1.4, 0);
    crate(20.6, -10.3, 1.2, 0);
    crate(9, 23, 1.2, 0);
    crate(-9, -23, 1.2, 0);
    crate(25, 18, 1.4, 0);
    crate(-25, -18, 1.4, 0);

    // Lamps along the routes.
    lamp(-12, 5, 4.2);
    lamp(12, -5, 4.2);
    lamp(-5, -14, 4.2);
    lamp(5, 14, 4.2);
    lamp(-24, -12, 4.2);
    lamp(24, 12, 4.2);
}
