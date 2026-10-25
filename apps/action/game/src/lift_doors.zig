// Where: apps/action/game/src/lift_doors.zig
// When: each frame, from gameRender in main.zig.
// Why: draws the parts of the lifts that move and that are not boxes of
// the map: the door leaves, each with a small square window near the top,
// and the cab walls, the cab front and the cab sill. The door halves of
// the map (map.Lift) are collision boxes only. This file draws the two
// leaves of each half where map.doorLeaves puts them, so the windows move
// with the doors.
const map = @import("map.zig");
const mesh = @import("mesh.zig");
const vec = @import("vec.zig");
const V3 = vec.V3;
const v3 = vec.v3;

const steel = v3(0.6, 0.61, 0.62);
const rubber = v3(0.03, 0.03, 0.03);
const sill_c = v3(0.45, 0.45, 0.44);
const rail_c = v3(0.7, 0.7, 0.68);

/// The window of a leaf: a square, its sides in m, and its bottom and top
/// above the bottom of the leaf.
const window_side: f32 = 0.2;
const window_y = [2]f32{ 1.78, 1.98 };
/// The width of the rubber seal round the window.
const seal: f32 = 0.012;

fn matOf(m: map.Mat) f32 {
    return @floatFromInt(@backingInt(m));
}

/// A plan of one lift. `a` runs along the doors, `b` across them. The
/// boxes take (a, b) ranges and a y range.
const Plan = struct {
    ax: usize,

    fn put(p: Plan, m: *mesh.Mesh, a: [2]f32, b: [2]f32, y: [2]f32, col: V3, mat: map.Mat) void {
        if (p.ax == 0) {
            m.box(v3(a[0], y[0], b[0]), v3(a[1], y[1], b[1]), col, matOf(mat));
        } else {
            m.box(v3(b[0], y[0], a[0]), v3(b[1], y[1], a[1]), col, matOf(mat));
        }
    }

    fn along(p: Plan, v: V3) f32 {
        return if (p.ax == 0) v[0] else v[2];
    }

    fn across(p: Plan, v: V3) f32 {
        return if (p.ax == 0) v[2] else v[0];
    }

    /// One leaf: a steel panel with a square hole near the top, and a
    /// rubber seal in the hole.
    fn leaf(p: Plan, m: *mesh.Mesh, box: [2]V3) void {
        const a0 = p.along(box[0]);
        const a1 = p.along(box[1]);
        const bb = [2]f32{ p.across(box[0]), p.across(box[1]) };
        const y0 = box[0][1];
        const y1 = box[1][1];
        const ac = (a0 + a1) / 2;
        const wa = [2]f32{ ac - window_side / 2, ac + window_side / 2 };
        const wy = [2]f32{ y0 + window_y[0], y0 + window_y[1] };
        p.put(m, .{ a0, a1 }, bb, .{ y0, wy[0] }, steel, .steel);
        p.put(m, .{ a0, a1 }, bb, .{ wy[1], y1 }, steel, .steel);
        p.put(m, .{ a0, wa[0] }, bb, wy, steel, .steel);
        p.put(m, .{ wa[1], a1 }, bb, wy, steel, .steel);
        const sb = [2]f32{ bb[0] - 0.002, bb[1] + 0.002 };
        p.put(m, wa, sb, .{ wy[0], wy[0] + seal }, rubber, .paint);
        p.put(m, wa, sb, .{ wy[1] - seal, wy[1] }, rubber, .paint);
        p.put(m, .{ wa[0], wa[0] + seal }, sb, wy, rubber, .paint);
        p.put(m, .{ wa[1] - seal, wa[1] }, sb, wy, rubber, .paint);
    }
};

pub fn build(m: *mesh.Mesh) void {
    for (map.lifts[0..map.lift_count]) |*l| buildLift(m, l);
}

fn buildLift(m: *mesh.Mesh, l: *const map.Lift) void {
    const p: Plan = .{ .ax = if (l.door_on_x) 2 else 0 };
    const fb = map.boxes[l.floor_box];
    // The landing is on the low side of the doors along b, or the high
    // side. The slow leaf of each door is on the side of its fixed panel:
    // the jamb for a landing door, the cab front for a cab door.
    const face_b = (p.across(l.door_closed[0][0][0]) + p.across(l.door_closed[0][0][1])) / 2;
    const landing_low = face_b < (p.across(fb.min) + p.across(fb.max)) / 2;

    for (0..2) |lv| {
        const open = map.landingOpen(l, lv);
        for (0..2) |half| {
            const lvs = map.doorLeaves(l.door_closed[lv][half], p.ax, half, open, landing_low);
            for (lvs) |box| p.leaf(m, box);
        }
    }

    // The cab, at its floor height y.
    const y = l.y;
    const open = map.cabOpen(l);
    for (0..2) |half| {
        const lvs = map.doorLeaves(map.cabDoorClosed(l, half), p.ax, half, open, !landing_low);
        for (lvs) |box| p.leaf(m, box);
    }
    const c0 = map.cabDoorClosed(l, 0);
    const c1 = map.cabDoorClosed(l, 1);
    const door_top = c0[1][1];
    const top = y + map.cab_height;
    // The doorway of the cab along a, and the inside of the cab.
    const da = [2]f32{ p.along(c0[0]), p.along(c1[1]) };
    const ia = [2]f32{ p.along(fb.min), p.along(fb.max) };
    // Across the doors: the cab door layer, the front of the cab, the
    // back wall.
    const db = [2]f32{ p.across(c0[0]), p.across(c0[1]) };
    const front = if (landing_low) [2]f32{ db[1], p.across(fb.min) } else [2]f32{ p.across(fb.max), db[0] };
    const back = if (landing_low) p.across(fb.max) else p.across(fb.min);
    const inward: f32 = if (landing_low) 1 else -1;
    const sill = if (landing_low) [2]f32{ db[0], p.across(fb.min) } else [2]f32{ p.across(fb.max), db[1] };

    // The sill under the cab doors, and the front of the cab: a panel on
    // each side of the doorway (the cab doors stand behind them when
    // open), and a panel over it.
    p.put(m, ia, sill, .{ y - 0.1, y + 0.002 }, sill_c, .steel);
    p.put(m, .{ ia[0], da[0] }, front, .{ y, top }, steel, .steel);
    p.put(m, .{ da[1], ia[1] }, front, .{ y, top }, steel, .steel);
    p.put(m, da, front, .{ door_top, top }, steel, .steel);
    // The side walls and the back wall, 1 cm thick inside the shaft
    // walls, and a handrail on the back wall.
    const walls = [2]f32{ @min(front[0], back), @max(front[1], back) };
    p.put(m, .{ ia[0], ia[0] + 0.01 }, walls, .{ y, top }, steel, .steel);
    p.put(m, .{ ia[1] - 0.01, ia[1] }, walls, .{ y, top }, steel, .steel);
    const bw = [2]f32{ @min(back, back - inward * 0.01), @max(back, back - inward * 0.01) };
    p.put(m, ia, bw, .{ y, top }, steel, .steel);
    const rb = [2]f32{ @min(back - inward * 0.07, back - inward * 0.04), @max(back - inward * 0.07, back - inward * 0.04) };
    p.put(m, .{ ia[0] + 0.25, ia[1] - 0.25 }, rb, .{ y + 0.9, y + 0.94 }, rail_c, .steel);
    const sb = [2]f32{ @min(back, back - inward * 0.07), @max(back, back - inward * 0.07) };
    for ([_]f32{ ia[0] + 0.3, ia[1] - 0.32 }) |ra| {
        p.put(m, .{ ra, ra + 0.02 }, sb, .{ y + 0.9, y + 0.94 }, rail_c, .steel);
    }
}
