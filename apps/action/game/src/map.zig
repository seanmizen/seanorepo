// The arena: a list of axis-aligned boxes. The boxes are the render mesh,
// the collision shapes, the hit-scan targets and the ambient-occlusion
// shapes (the shader reads them from a storage buffer).
//
// The server (apps/action/server/src/index.ts) has a copy of `spawns`.
const std = @import("std");
const vec = @import("vec.zig");
const V3 = vec.V3;
const v3 = vec.v3;

pub const Mat = enum(u8) {
    paint = 0,
    concrete = 1,
    tile = 2,
    metal = 3,
    emissive = 4,
    wood = 5,
    cloth = 6,
};

pub const Box = struct {
    min: V3,
    max: V3,
    color: V3,
    mat: Mat,
    /// Hit scan and collision ignore a box with solid = false (lamp bulbs).
    solid: bool = true,
};

pub const Light = struct {
    pos: V3,
    color: V3,
    radius: f32,
};

pub const max_boxes = 160;
pub var boxes: [max_boxes]Box = undefined;
pub var box_count: usize = 0;
pub var lights: [8]Light = undefined;
pub var light_count: usize = 0;

pub const half: f32 = 30;
pub const wall_h: f32 = 7;

pub const spawns = [_][2]f32{
    .{ -24, -24 }, .{ 24, 24 }, .{ -24, 24 }, .{ 24, -24 },
    .{ 0, -25 },   .{ 0, 25 },  .{ -25, 0 },  .{ 25, 0 },
};

fn add(min: V3, max: V3, color: V3, mat: Mat) void {
    if (box_count >= max_boxes) return;
    boxes[box_count] = .{ .min = min, .max = max, .color = color, .mat = mat };
    box_count += 1;
}

/// A box from its centre on the floor (x, z), its size and its base height.
fn put(x: f32, z: f32, sx: f32, sy: f32, sz: f32, y0: f32, color: V3, mat: Mat) void {
    add(v3(x - sx / 2, y0, z - sz / 2), v3(x + sx / 2, y0 + sy, z + sz / 2), color, mat);
}

fn lamp(x: f32, z: f32, h: f32) void {
    put(x, z, 0.16, h, 0.16, 0, v3(0.12, 0.12, 0.13), .metal);
    put(x, z, 0.5, 0.12, 0.5, h, v3(0.12, 0.12, 0.13), .metal);
    add(v3(x - 0.2, h - 0.22, z - 0.2), v3(x + 0.2, h, z + 0.2), v3(1.0, 0.62, 0.28), .emissive);
    boxes[box_count - 1].solid = false;
    if (light_count < 6) {
        lights[light_count] = .{ .pos = v3(x, h - 0.5, z), .color = v3(1.0, 0.55, 0.22), .radius = 11 };
        light_count += 1;
    }
}

fn crate(x: f32, z: f32, size: f32, y0: f32) void {
    put(x, z, size, size, size, y0, v3(0.55, 0.38, 0.22), .wood);
}

/// A shipping container, long side on X when `along_x`.
fn container(x: f32, z: f32, along_x: bool, color: V3) void {
    if (along_x) put(x, z, 6.0, 2.6, 2.4, 0, color, .metal) else put(x, z, 2.4, 2.6, 6.0, 0, color, .metal);
}

pub fn build() void {
    box_count = 0;
    light_count = 0;
    const sand = v3(0.78, 0.66, 0.52);
    const terracotta = v3(0.72, 0.36, 0.24);
    const bone = v3(0.86, 0.82, 0.74);
    const teal = v3(0.13, 0.42, 0.45);
    const rust = v3(0.55, 0.22, 0.12);
    const navy = v3(0.16, 0.22, 0.36);

    // Floor and the outer walls.
    add(v3(-half - 2, -1, -half - 2), v3(half + 2, 0, half + 2), v3(0.44, 0.41, 0.38), .tile);
    add(v3(-half - 1, 0, -half - 1), v3(half + 1, wall_h, -half), sand, .concrete);
    add(v3(-half - 1, 0, half), v3(half + 1, wall_h, half + 1), sand, .concrete);
    add(v3(-half - 1, 0, -half), v3(-half, wall_h, half), sand, .concrete);
    add(v3(half, 0, -half), v3(half + 1, wall_h, half), sand, .concrete);
    // A trim along the top of the walls.
    add(v3(-half - 1.2, wall_h, -half - 1.2), v3(half + 1.2, wall_h + 0.3, -half + 0.2), terracotta, .concrete);
    add(v3(-half - 1.2, wall_h, half - 0.2), v3(half + 1.2, wall_h + 0.3, half + 1.2), terracotta, .concrete);
    add(v3(-half - 1.2, wall_h, -half), v3(-half + 0.2, wall_h + 0.3, half), terracotta, .concrete);
    add(v3(half - 0.2, wall_h, -half), v3(half + 1.2, wall_h + 0.3, half), terracotta, .concrete);

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

pub const Hit = struct {
    t: f32,
    normal: V3,
    box: usize,
};

/// Ray against one box (slab test). Returns the entry distance and normal.
pub fn rayBox(o: V3, d: V3, min: V3, max: V3) ?struct { t: f32, n: V3 } {
    var tmin: f32 = -1e30;
    var tmax: f32 = 1e30;
    var n = v3(0, 0, 0);
    inline for (0..3) |a| {
        if (@abs(d[a]) < 1e-8) {
            if (o[a] < min[a] or o[a] > max[a]) return null;
        } else {
            const inv = 1.0 / d[a];
            var t0 = (min[a] - o[a]) * inv;
            var t1 = (max[a] - o[a]) * inv;
            var sign: f32 = -1;
            if (t0 > t1) {
                const tmp = t0;
                t0 = t1;
                t1 = tmp;
                sign = 1;
            }
            if (t0 > tmin) {
                tmin = t0;
                n = v3(0, 0, 0);
                n[a] = sign;
            }
            tmax = @min(tmax, t1);
            if (tmin > tmax) return null;
        }
    }
    if (tmax < 0) return null;
    return .{ .t = @max(tmin, 0), .n = n };
}

/// The nearest solid box that the ray hits within max_t.
pub fn raycast(o: V3, d: V3, max_t: f32) ?Hit {
    var best: ?Hit = null;
    for (boxes[0..box_count], 0..) |b, i| {
        if (!b.solid) continue;
        if (rayBox(o, d, b.min, b.max)) |h| {
            if (h.t <= max_t and (best == null or h.t < best.?.t)) best = .{ .t = h.t, .normal = h.n, .box = i };
        }
    }
    return best;
}

/// True when an AABB overlaps a solid box.
pub fn overlaps(min: V3, max: V3) bool {
    for (boxes[0..box_count]) |b| {
        if (!b.solid) continue;
        if (min[0] < b.max[0] and max[0] > b.min[0] and
            min[1] < b.max[1] and max[1] > b.min[1] and
            min[2] < b.max[2] and max[2] > b.min[2]) return true;
    }
    return false;
}
