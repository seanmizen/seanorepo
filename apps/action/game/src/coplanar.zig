// Where: apps/action/game/src/coplanar.zig (zig build floorplan -- <map>
// audit, and zig build test)
// When: after a change to a map. The audit fails (exit code 1) when it finds
// a coplanar overlap.
// Why: two faces in the same plane, or very near it, z-fight: the depth
// buffer cannot put one in front of the other, so the screen shows stripes
// of both. The camera uses reversed Z (render.zig), and that keeps faces a
// few millimetres apart separate at a long distance. Faces at the same
// depth still fight. This audit finds them in the static mesh of a map (the
// boxes and the decoration, main.zig loadMap).
//
// A coplanar overlap is two faces with these properties:
// - They face the same way (the angle between the normals is less than
//   about 2 degrees).
// - They are less than `gap` apart.
// - They overlap in an area of `min_area` or more.
// - They have a different colour or a different material.
// - Some part of the overlap shows: the audit tests its centre and its
//   corners, just in front of the faces. Where each of these points is
//   inside an opaque shape, the overlap is hidden.
//
// To fix an overlap, move one face 1 cm or more from the other, or cut the
// lower face so that the faces do not overlap (REQ-RENDER-002).
const std = @import("std");
const map = @import("map.zig");
const vec = @import("vec.zig");
const V3 = vec.V3;
const v3 = vec.v3;

/// Two faces nearer than this fight. A fix uses 1 cm or more. The audit
/// tests a little less than 1 cm, so 1 cm in float arithmetic passes.
pub const gap: f32 = 0.0015;
/// The smallest overlap area that counts, m^2 (1 cm^2).
pub const min_area: f32 = 1e-4;
/// The narrowest overlap that counts, m: two faces that only touch at an
/// edge give a thin sliver from the float rounding.
const min_width: f32 = 0.001;
/// The two normals face the same way when their dot product is more than
/// this.
const same_dir: f32 = 0.9995;
/// The most points of a face: a disc cap has 20 (mesh.zig disc).
const max_pts = 20;

const Src = struct {
    /// A box index, or a decoration index.
    i: u32,
    decor: bool,
};

const Face = struct {
    n: V3,
    /// n . p for each point p of the face.
    d: f32,
    pts: [max_pts]V3,
    count: u8,
    lo: V3,
    hi: V3,
    col: V3,
    mat: map.Mat,
    src: Src,
};

pub const Overlap = struct {
    a: Src,
    b: Src,
    /// The distance between the two planes, m.
    dist: f32,
    /// The overlap area, m^2.
    area: f32,
    /// A point in the overlap.
    at: V3,
};

fn addFace(list: *std.ArrayList(Face), alloc: std.mem.Allocator, pts: []const V3, n_raw: V3, col: V3, mat: map.Mat, src: Src) !void {
    const n = vec.norm(n_raw);
    var f: Face = .{ .n = n, .d = 0, .pts = undefined, .count = @intCast(pts.len), .lo = pts[0], .hi = pts[0], .col = col, .mat = mat, .src = src };
    var c = v3(0, 0, 0);
    for (pts, 0..) |p, i| {
        f.pts[i] = p;
        f.lo = @min(f.lo, p);
        f.hi = @max(f.hi, p);
        c += p;
    }
    c /= vec.s(@floatFromInt(pts.len));
    f.d = vec.dot(n, c);
    try list.append(alloc, f);
}

/// The unit normal along `n`, turned to the side of `out` (mesh.zig
/// faceNormal).
fn faceNormal(n: V3, out: V3) V3 {
    const u = vec.norm(n);
    return if (vec.dot(u, out) < 0) -u else u;
}

/// The six faces of a box from local min and max, transformed by `m`, in
/// the order and with the normals of mesh.zig orientedBox.
fn boxFaces(list: *std.ArrayList(Face), alloc: std.mem.Allocator, m: vec.Mat4, mn: V3, mx: V3, col: V3, mat: map.Mat, src: Src) !void {
    var c: [8]V3 = undefined;
    for (0..8) |i| {
        const p = v3(
            if (i & 1 != 0) mx[0] else mn[0],
            if (i & 2 != 0) mx[1] else mn[1],
            if (i & 4 != 0) mx[2] else mn[2],
        );
        c[i] = vec.xform(m, p);
    }
    const ex = vec.xdir(m, v3(1, 0, 0));
    const ey = vec.xdir(m, v3(0, 1, 0));
    const ez = vec.xdir(m, v3(0, 0, 1));
    const nx = faceNormal(vec.cross(ey, ez), ex);
    const ny = faceNormal(vec.cross(ez, ex), ey);
    const nz = faceNormal(vec.cross(ex, ey), ez);
    try addFace(list, alloc, &.{ c[1], c[3], c[7], c[5] }, nx, col, mat, src);
    try addFace(list, alloc, &.{ c[0], c[4], c[6], c[2] }, -nx, col, mat, src);
    try addFace(list, alloc, &.{ c[2], c[6], c[7], c[3] }, ny, col, mat, src);
    try addFace(list, alloc, &.{ c[0], c[1], c[5], c[4] }, -ny, col, mat, src);
    try addFace(list, alloc, &.{ c[4], c[5], c[7], c[6] }, nz, col, mat, src);
    try addFace(list, alloc, &.{ c[0], c[2], c[3], c[1] }, -nz, col, mat, src);
}

/// The two flat caps of a disc (mesh.zig disc). The curved side is not in
/// the audit.
fn discFaces(list: *std.ArrayList(Face), alloc: std.mem.Allocator, m: vec.Mat4, r: f32, t: f32, col: V3, mat: map.Mat, src: Src) !void {
    const seg: usize = if (r < 0.1) 10 else 20;
    const nz = vec.xdir(m, v3(0, 0, 1));
    for ([_]f32{ 1, -1 }) |side| {
        var pts: [max_pts]V3 = undefined;
        for (0..seg) |i| {
            const a = @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(seg)) * std.math.tau;
            pts[i] = vec.xform(m, v3(@cos(a) * r, @sin(a) * r, side * t / 2));
        }
        try addFace(list, alloc, pts[0..seg], nz * vec.s(side), col, mat, src);
    }
}

const P2 = [2]f32;
const max_clip = 2 * max_pts + 8;

fn area2(p: []const P2) f32 {
    var a: f32 = 0;
    for (p, 0..) |q, i| {
        const r = p[(i + 1) % p.len];
        a += q[0] * r[1] - r[0] * q[1];
    }
    return a / 2;
}

/// The overlap of two convex polygons (counter-clockwise): its points,
/// its area and its mean width (2 area / perimeter).
const Clip = struct {
    pts: [max_clip]P2 = undefined,
    count: usize = 0,
    area: f32 = 0,
    width: f32 = 0,
};

/// Sutherland-Hodgman: clip `a` by each edge of `b`.
fn overlap(a: []const P2, b: []const P2) Clip {
    var bufs: [2][max_clip]P2 = undefined;
    var cur: []P2 = bufs[0][0..a.len];
    @memcpy(cur, a);
    for (b, 0..) |e0, i| {
        const e1 = b[(i + 1) % b.len];
        const out = &bufs[(i + 1) % 2];
        var n: usize = 0;
        const side = struct {
            fn f(p: P2, s0: P2, s1: P2) f32 {
                return (s1[0] - s0[0]) * (p[1] - s0[1]) - (s1[1] - s0[1]) * (p[0] - s0[0]);
            }
        }.f;
        for (cur, 0..) |p, j| {
            if (n >= max_clip - 1) break;
            const q = cur[(j + 1) % cur.len];
            const sp = side(p, e0, e1);
            const sq = side(q, e0, e1);
            if (sp >= 0) {
                out[n] = p;
                n += 1;
            }
            if ((sp >= 0) != (sq >= 0)) {
                const t = sp / (sp - sq);
                out[n] = .{ p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t };
                n += 1;
            }
        }
        if (n < 3) return .{};
        cur = out[0..n];
    }
    var r: Clip = .{ .count = cur.len };
    @memcpy(r.pts[0..cur.len], cur);
    var perim: f32 = 0;
    for (cur, 0..) |p, i| {
        const q = cur[(i + 1) % cur.len];
        perim += @sqrt((q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1]));
    }
    r.area = @abs(area2(cur));
    r.width = if (perim > 0) 2 * r.area / perim else 0;
    return r;
}

/// The points of a face in the plane basis u, v, counter-clockwise.
fn project(f: *const Face, u: V3, v: V3, out: *[max_pts]P2) []P2 {
    const n = f.count;
    for (0..n) |i| out[i] = .{ vec.dot(f.pts[i], u), vec.dot(f.pts[i], v) };
    if (area2(out[0..n]) < 0) std.mem.reverse(P2, out[0..n]);
    return out[0..n];
}

fn sameLook(a: *const Face, b: *const Face) bool {
    if (a.mat != b.mat) return false;
    return @reduce(.And, @abs(a.col - b.col) < vec.s(1e-3));
}

/// True when the point p is inside an opaque shape of the static mesh: a
/// visible static box or a decoration.
fn insideOpaque(p: V3) bool {
    for (map.boxes[0..map.box_count]) |b| {
        if (!b.visible or b.dynamic) continue;
        if (@reduce(.And, p > b.min) and @reduce(.And, p < b.max)) return true;
    }
    for (map.decor.items) |d| {
        if (map.insideDecor(d, p, 0)) return true;
    }
    return false;
}

fn lessLoX(_: void, a: Face, b: Face) bool {
    return a.lo[0] < b.lo[0];
}

/// Find the coplanar overlaps of the loaded map. `out` gets them, up to
/// its length. Returns the count.
pub fn find(alloc: std.mem.Allocator, out: []Overlap) !usize {
    var faces: std.ArrayList(Face) = .empty;
    defer faces.deinit(alloc);
    const id = vec.Mat4.identity();
    for (map.boxes[0..map.box_count], 0..) |b, i| {
        if (b.dynamic or !b.visible) continue;
        try boxFaces(&faces, alloc, id, b.min, b.max, b.color, b.mat, .{ .i = @intCast(i), .decor = false });
    }
    for (map.decor.items, 0..) |d, i| {
        const src: Src = .{ .i = @intCast(i), .decor = true };
        if (d.disc) try discFaces(&faces, alloc, d.m, d.min[0], d.min[1], d.color, d.mat, src) else try boxFaces(&faces, alloc, d.m, d.min, d.max, d.color, d.mat, src);
    }
    const fs = faces.items;
    // Sweep along X: a face only meets the faces that start before it ends.
    std.mem.sort(Face, fs, {}, lessLoX);
    var count: usize = 0;
    for (fs, 0..) |*a, i| {
        for (fs[i + 1 ..]) |*b| {
            if (b.lo[0] > a.hi[0] + gap) break;
            if (b.lo[1] > a.hi[1] + gap or b.hi[1] < a.lo[1] - gap) continue;
            if (b.lo[2] > a.hi[2] + gap or b.hi[2] < a.lo[2] - gap) continue;
            if (a.src.i == b.src.i and a.src.decor == b.src.decor) continue;
            if (vec.dot(a.n, b.n) < same_dir) continue;
            const dist = @abs(vec.dot(a.n, b.pts[0]) - a.d);
            if (dist >= gap) continue;
            if (sameLook(a, b)) continue;
            // A basis of the plane of a.
            const t = if (@abs(a.n[0]) < 0.9) v3(1, 0, 0) else v3(0, 1, 0);
            const u = vec.norm(vec.cross(a.n, t));
            const v = vec.cross(a.n, u);
            var pa: [max_pts]P2 = undefined;
            var pb: [max_pts]P2 = undefined;
            const o = overlap(project(a, u, v, &pa), project(b, u, v, &pb));
            if (o.area < min_area or o.width < min_width) continue;
            // The overlap is hidden when its centre and each of its corners
            // (a little in toward the centre) are inside an opaque shape,
            // just in front of the outer face.
            const front = @max(a.d, vec.dot(a.n, b.pts[0])) + 0.001;
            var c2: P2 = .{ 0, 0 };
            for (o.pts[0..o.count]) |q| c2 = .{ c2[0] + q[0], c2[1] + q[1] };
            c2 = .{ c2[0] / @as(f32, @floatFromInt(o.count)), c2[1] / @as(f32, @floatFromInt(o.count)) };
            const at = u * vec.s(c2[0]) + v * vec.s(c2[1]) + a.n * vec.s(front);
            var hidden = insideOpaque(at);
            for (o.pts[0..o.count]) |q| {
                if (!hidden) break;
                const k = [2]f32{ q[0] + (c2[0] - q[0]) * 0.1, q[1] + (c2[1] - q[1]) * 0.1 };
                hidden = insideOpaque(u * vec.s(k[0]) + v * vec.s(k[1]) + a.n * vec.s(front));
            }
            if (hidden) continue;
            if (count < out.len) out[count] = .{ .a = a.src, .b = b.src, .dist = dist, .area = o.area, .at = at };
            count += 1;
        }
    }
    return count;
}

/// The colour, the material and the bounds of a source, for a report.
pub fn describe(s: Src, buf: []u8) []const u8 {
    if (s.decor) {
        const d = map.decor.items[s.i];
        const bb = map.decorBounds(d);
        return std.fmt.bufPrint(buf, "decor {d} ({d:.3} {d:.3} {d:.3}) .. ({d:.3} {d:.3} {d:.3}) {s} rgb({d:.2} {d:.2} {d:.2})", .{
            s.i, bb[0][0], bb[0][1], bb[0][2], bb[1][0], bb[1][1], bb[1][2], @tagName(d.mat), d.color[0], d.color[1], d.color[2],
        }) catch buf;
    }
    const b = map.boxes[s.i];
    return std.fmt.bufPrint(buf, "box {d} ({d:.3} {d:.3} {d:.3}) .. ({d:.3} {d:.3} {d:.3}) {s} rgb({d:.2} {d:.2} {d:.2})", .{
        s.i, b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2], @tagName(b.mat), b.color[0], b.color[1], b.color[2],
    }) catch buf;
}
