// Earl's Court tube station, from its public layout (not a survey; the
// sizes are approximate).
//
//   z  62 ┌──────────── Earls Court Road: pavement, road, a bus, the TARDIS ─┐
//   z  50 │        cream faience front, three doorways, the roundel          │
//   z  36 │  ticket hall (street level, y 6), ticket gates                    │
//   z  28 │  footbridge (y 6) over the District line, two lifts, two stairs  │
//         │                                                                  │
//         │  train shed: an iron arch roof, brick side walls                 │
//         │  T1 | island 1/2 | T2 (train) | centre | T3 | island 3/4 | T4    │
//         │                                 escalator top (z -30)            │
//   z -45 └── south wall, tunnel mouths ──────────────────────────────────────┘
//            escalators down to y -16
//   z -55..-66  Piccadilly line platform 5: a deep tiled tunnel, one track
//
// Platform level is y 0, the track bed y -0.85, the street y 6, the deep
// platform y -16. server/index.ts has a copy of the spawns and the lift
// levels.
const std = @import("std");
const map = @import("../map.zig");
const vec = @import("../vec.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;
const Mat = map.Mat;

pub const street_y: f32 = 6;
pub const deep_y: f32 = -16;
pub const bed_y: f32 = -0.85;

// Colours.
const brick = v3(0.45, 0.21, 0.13);
const iron = v3(0.07, 0.1, 0.08);
const platform_c = v3(0.46, 0.44, 0.41);
const ballast = v3(0.25, 0.22, 0.2);
const yellow = v3(0.85, 0.68, 0.08);
const cream = v3(0.86, 0.8, 0.64);
const tile_c = v3(0.8, 0.76, 0.63);
const red = v3(0.75, 0.06, 0.05);
const blue = v3(0.04, 0.12, 0.45);
const steel = v3(0.35, 0.36, 0.37);
const dark = v3(0.012, 0.012, 0.014);
const warm = v3(1.0, 0.72, 0.42);
const cool = v3(0.78, 0.88, 1.0);

var seed: u32 = 1;
fn rnd() f32 {
    seed +%= 1;
    return vec.hash(seed * 7919);
}

/// A box that does not count for the ambient occlusion.
fn boxNoAo(min: V3, max: V3, color: V3, mat: Mat) void {
    map.add(min, max, color, mat).ao = false;
}

fn box(min: V3, max: V3, color: V3, mat: Mat) void {
    _ = map.add(min, max, color, mat);
}

fn deco(min: V3, max: V3, color: V3, mat: Mat) void {
    map.addDecor(Mat4.identity(), min, max, color, mat);
}

/// A roundel facing +Z (turn = 0) or another way (turn = yaw).
fn roundel(p: V3, turn: f32, size: f32) void {
    const m = vec.translate(p).mul(Mat4.rotationY(turn));
    map.addDisc(m, 0.62 * size, 0.05, red, .paint);
    map.addDisc(m.mul(vec.translate(v3(0, 0, 0.03))), 0.42 * size, 0.02, v3(0.92, 0.92, 0.9), .paint);
    map.addDecor(m, v3(-0.82 * size, -0.15 * size, 0.035), v3(0.82 * size, 0.15 * size, 0.07), blue, .paint);
}

pub fn build() void {
    seed = 1;
    map.shadow_centre = v3(0, 0, 4);
    map.shadow_half = 58;
    map.underground_y = -3;
    map.kill_y = -30;

    shed();
    footbridge();
    lifts();
    ticketHall();
    street();
    train();
    escalators();
    deepPlatform();

    // Spawns: the islands, the centre, the bridge, the hall, the street and
    // the deep platform.
    // The debug teleport (Cmd+D, then 1 to 9) uses this order.
    const sp = [_]V3{
        v3(-12, 0, 0),       v3(12, 0, 0),        v3(-20, deep_y, -58),  v3(20, deep_y, -58),
        v3(-12, 0, -35),     v3(12, 0, -35),      v3(0, 0, -10),         v3(-5, street_y, 32),
        v3(0, street_y, 43), v3(5, street_y, 32), v3(-17, street_y, 56), v3(17, street_y, 56),
    };
    for (sp) |p| map.addSpawn(p);
}

// ---- The District line train shed ----------------------------------------

fn shed() void {
    const z0: f32 = -45;
    const z1: f32 = 36;
    // The ground under the tracks. The centre strip stops at the escalator.
    box(v3(-21, -3, z0), v3(-4, bed_y, z1), ballast, .concrete);
    box(v3(4, -3, z0), v3(21, bed_y, z1), ballast, .concrete);
    box(v3(-4, -3, -30), v3(4, bed_y, z1), ballast, .concrete);

    // Island platforms and the centre platform.
    const islands = [_][2]f32{ .{ -16, -8 }, .{ 8, 16 } };
    for (islands) |is| {
        box(v3(is[0], bed_y, z0), v3(is[1], 0, z1), platform_c, .concrete);
        deco(v3(is[0], 0, z0), v3(is[0] + 0.45, 0.012, z1), yellow, .paint);
        deco(v3(is[1] - 0.45, 0, z0), v3(is[1], 0.012, z1), yellow, .paint);
        // Benches and roundels on posts.
        for ([_]f32{ -25, -5, 15 }) |z| {
            const cx = (is[0] + is[1]) / 2;
            boxNoAo(v3(cx - 0.25, 0, z - 1.0), v3(cx + 0.25, 0.45, z + 1.0), v3(0.35, 0.2, 0.1), .wood);
            map.addDecor(Mat4.identity(), v3(cx - 0.05, 0, z + 4), v3(cx + 0.05, 2.4, z + 4.1), iron, .metal);
            roundel(v3(cx, 2.6, z + 4.05), std.math.pi / 2.0, 0.9);
            roundel(v3(cx, 2.6, z + 4.05), -std.math.pi / 2.0, 0.9);
        }
    }
    box(v3(-4, bed_y, -30), v3(4, 0, z1), platform_c, .concrete);
    deco(v3(-4, 0, -30), v3(-3.55, 0.012, z1), yellow, .paint);
    deco(v3(3.55, 0, -30), v3(4, 0.012, z1), yellow, .paint);

    // Rails and sleepers.
    const tracks = [_]f32{ -18.5, -6, 6, 18.5 };
    for (tracks) |tx| {
        for ([_]f32{ -0.72, 0.72 }) |off| {
            boxNoAo(v3(tx + off - 0.04, bed_y, z0), v3(tx + off + 0.04, bed_y + 0.16, z1), steel, .metal);
        }
        var z: f32 = z0 + 0.4;
        while (z < z1) : (z += 0.9) {
            deco(v3(tx - 1.25, bed_y, z), v3(tx + 1.25, bed_y + 0.07, z + 0.26), v3(0.16, 0.11, 0.08), .wood);
        }
        // Buffer stops at the north end.
        deco(v3(tx - 1.1, bed_y, z1 - 0.6), v3(tx + 1.1, bed_y + 1.0, z1 - 0.2), red, .paint);
    }

    // Brick side walls with pilasters.
    box(v3(-21.6, -3, z0), v3(-21, 7.5, z1), brick, .brick);
    box(v3(21, -3, z0), v3(21.6, 7.5, z1), brick, .brick);
    var pz: f32 = z0;
    while (pz <= z1) : (pz += 6) {
        deco(v3(-21, -1, pz - 0.35), v3(-20.75, 7.5, pz + 0.35), brick * vec.s(0.85), .brick);
        deco(v3(20.75, -1, pz - 0.35), v3(21, 7.5, pz + 0.35), brick * vec.s(0.85), .brick);
    }

    // The south wall, with a tunnel mouth over each track.
    const sw0: f32 = z0 - 0.6;
    box(v3(-21, 4.4, sw0), v3(21, 7.5, z0), brick, .brick);
    const piers = [_][2]f32{ .{ -21, -20.8 }, .{ -16.2, -7.8 }, .{ -4.2, 4.2 }, .{ 7.8, 16.2 }, .{ 20.8, 21 } };
    // The centre pier goes down to the escalator ceiling behind it.
    for (piers) |p| box(v3(p[0], if (p[0] == -4.2) -5.8 else -3, sw0), v3(p[1], 4.4, z0), brick, .brick);
    for (tracks) |tx| {
        // The dark tunnel behind the mouth: back, sides, roof, and a red
        // signal.
        box(v3(tx - 2.4, -3, sw0 - 8), v3(tx + 2.4, 4.4, sw0 - 7.6), dark, .paint);
        boxNoAo(v3(tx - 2.6, bed_y, sw0 - 8), v3(tx - 2.4, 4.4, sw0), dark, .paint);
        boxNoAo(v3(tx + 2.4, bed_y, sw0 - 8), v3(tx + 2.6, 4.4, sw0), dark, .paint);
        box(v3(tx - 2.6, 4.4, sw0 - 8), v3(tx + 2.6, 4.7, sw0), dark, .paint);
        deco(v3(tx + 1.6, 2.4, sw0 - 0.2), v3(tx + 1.8, 2.6, sw0), v3(1.0, 0.05, 0.02), .emissive);
    }

    roof(z0, z1);

    // Lamps hung from the roof over the islands.
    for ([_]f32{ -12, 12 }) |x| {
        for ([_]f32{ -25, 10 }) |z| {
            deco(v3(x - 0.02, 4.9, z - 0.02), v3(x + 0.02, 11, z + 0.02), iron, .metal);
            deco(v3(x - 0.35, 4.6, z - 0.35), v3(x + 0.35, 4.9, z + 0.35), iron, .metal);
            map.add(v3(x - 0.25, 4.5, z - 0.25), v3(x + 0.25, 4.6, z + 0.25), warm, .emissive).solid = false;
            map.addLight(v3(x, 4.3, z), v3(1.2, 0.8, 0.45), 11);
        }
    }
}

/// The iron arch roof: ribs every 6 m, purlins along the shed, and solid
/// panels near the eaves. The middle is open, so the sun throws the shadow
/// of the ironwork onto the platforms.
fn roof(z0: f32, z1: f32) void {
    const springing: f32 = 7.5;
    const half_w: f32 = 21;
    const rise: f32 = 8.5;
    const segs = 16;
    const at = struct {
        fn p(t: f32, z: f32) V3 {
            const a = t * std.math.pi;
            return v3(-@cos(a) * 21, 7.5 + @sin(a) * 8.5, z);
        }
        fn n(t: f32) V3 {
            const a = t * std.math.pi;
            return vec.norm(v3(-@cos(a) / 21.0, @sin(a) / 8.5, 0));
        }
    };
    _ = springing;
    _ = half_w;
    _ = rise;
    var z = z0;
    while (z <= z1 + 0.01) : (z += 6) {
        for (0..segs) |i| {
            const ta = @as(f32, @floatFromInt(i)) / segs;
            const tb = @as(f32, @floatFromInt(i + 1)) / segs;
            map.beam(at.p(ta, z), at.p(tb, z), 0.28, 0.5, v3(0, 0, 1), iron, .metal);
        }
        // A tie rod across the arch and its hangers.
        map.beam(at.p(0, z), at.p(1, z), 0.08, 0.08, v3(0, 1, 0), iron, .metal);
    }
    // Purlins.
    for (1..14) |i| {
        const t = @as(f32, @floatFromInt(i)) / 14;
        const p = at.p(t, z0);
        map.beam(p, v3(p[0], p[1], z1), 0.16, 0.16, at.n(t), iron, .metal);
    }
    // Slate panels near the eaves, both sides.
    const bands = [_][2]f32{ .{ 0, 0.09 }, .{ 0.09, 0.17 }, .{ 0.83, 0.91 }, .{ 0.91, 1.0 } };
    for (bands) |b| {
        const a = at.p(b[0], z0);
        const c = at.p(b[1], z0);
        const mid = (a + c) * vec.s(0.5) + at.n((b[0] + b[1]) / 2) * vec.s(0.2);
        map.beam(mid, v3(mid[0], mid[1], z1), vec.len(c - a), 0.08, at.n((b[0] + b[1]) / 2), v3(0.16, 0.16, 0.18), .concrete);
    }
    // A raised lantern at the ridge, on short posts.
    map.beam(v3(0, 16.9, z0), v3(0, 16.9, z1), 5, 0.1, v3(0, 1, 0), v3(0.16, 0.16, 0.18), .concrete);
    var zp = z0;
    while (zp <= z1) : (zp += 6) {
        for ([_]f32{ -2.3, 2.3 }) |x| map.beam(v3(x, 15.8, zp), v3(x, 16.9, zp), 0.15, 0.15, v3(0, 0, 1), iron, .metal);
    }
}

// ---- The footbridge ----------------------------------------------------------

const bridge_z0: f32 = 28;
const bridge_z1: f32 = 36;
const shaft_z0: f32 = 31;
const shaft_z1: f32 = 33.4;
const shafts = [_][2]f32{ .{ -15.7, -13.3 }, .{ 13.3, 15.7 } };
const stairs = [_][2]f32{ .{ -12.2, -9.8 }, .{ 9.8, 12.2 } };

fn footbridge() void {
    const y0 = street_y - 0.4;
    const y1 = street_y;
    const deck = v3(0.42, 0.4, 0.38);
    box(v3(-21, y0, bridge_z0), v3(21, y1, shaft_z0), deck, .concrete);
    box(v3(-21, y0, shaft_z1), v3(21, y1, bridge_z1), deck, .concrete);
    box(v3(-21, y0, shaft_z0), v3(shafts[0][0], y1, shaft_z1), deck, .concrete);
    box(v3(shafts[0][1], y0, shaft_z0), v3(shafts[1][0], y1, shaft_z1), deck, .concrete);
    box(v3(shafts[1][1], y0, shaft_z0), v3(21, y1, shaft_z1), deck, .concrete);
    // Girders under the deck.
    deco(v3(-21, y0 - 0.6, bridge_z0), v3(21, y0, bridge_z0 + 0.3), iron, .metal);
    deco(v3(-21, y0 - 0.6, bridge_z1 - 0.3), v3(21, y0, bridge_z1), iron, .metal);

    // The railing on the south edge, open at the stairs.
    const rz0 = bridge_z0 - 0.12;
    const spans = [_][2]f32{ .{ -21, stairs[0][0] }, .{ stairs[0][1], stairs[1][0] }, .{ stairs[1][1], 21 } };
    for (spans) |s| {
        boxNoAo(v3(s[0], y1, rz0), v3(s[1], y1 + 1.1, bridge_z0), iron, .metal);
        deco(v3(s[0], y1 + 1.1, rz0 - 0.05), v3(s[1], y1 + 1.18, bridge_z0 + 0.05), v3(0.3, 0.15, 0.08), .wood);
    }

    // Stairs from the deck down to each island.
    for (stairs) |st| {
        for (0..15) |i| {
            const fi: f32 = @floatFromInt(i);
            const top = 0.4 * (fi + 1);
            const za = bridge_z0 - 0.5 * (15 - fi);
            boxNoAo(v3(st[0], 0, za), v3(st[1], top, za + 0.5), platform_c, .concrete);
            deco(v3(st[0], top, za), v3(st[1], top + 0.01, za + 0.06), yellow, .paint);
        }
        // Handrails.
        for ([_]f32{ st[0], st[1] }) |x| {
            map.beam(v3(x, 1.0, bridge_z0 - 7.5), v3(x, street_y + 1.0, bridge_z0), 0.06, 0.06, v3(1, 0, 0), steel, .metal);
        }
    }

    // The old train indicator boards hang from the bridge over the stairs.
    for ([_]f32{ -12, 12 }) |x| {
        deco(v3(x - 1.8, 3.9, bridge_z0 - 0.3), v3(x + 1.8, 5.2, bridge_z0 - 0.1), v3(0.03, 0.03, 0.03), .wood);
        for (0..3) |row| {
            const ry = 4.95 - @as(f32, @floatFromInt(row)) * 0.35;
            deco(v3(x - 1.5, ry - 0.08, bridge_z0 - 0.32), v3(x + 1.5 - 0.4 * @as(f32, @floatFromInt(row)), ry, bridge_z0 - 0.3), v3(1.0, 0.6, 0.1), .emissive);
        }
    }
    map.addLight(v3(-8, 8.6, 32), warm, 9);
    map.addLight(v3(8, 8.6, 32), warm, 9);
    for ([_]f32{ -8, 8 }) |x| {
        map.add(v3(x - 0.6, 9.2, 31.8), v3(x + 0.6, 9.3, 32.2), warm, .emissive).solid = false;
        deco(v3(x - 0.02, 9.3, 31.98), v3(x + 0.02, 12, 32.02), iron, .metal);
    }
}

// ---- Lifts ---------------------------------------------------------------

fn lifts() void {
    const top: f32 = street_y + 3.2;
    const frame = v3(0.1, 0.12, 0.11);
    const glass = v3(0.06, 0.08, 0.09);
    const levels = [2]f32{ 0, street_y };
    for (shafts, 0..) |sx, li| {
        const x0 = sx[0];
        const x1 = sx[1];
        // Shaft: west, east and north walls, a roof, and the south face
        // around the two door openings.
        boxNoAo(v3(x0, 0, shaft_z0), v3(x0 + 0.1, top, shaft_z1), glass, .metal);
        boxNoAo(v3(x1 - 0.1, 0, shaft_z0), v3(x1, top, shaft_z1), glass, .metal);
        boxNoAo(v3(x0, 0, shaft_z1 - 0.1), v3(x1, top, shaft_z1), glass, .metal);
        box(v3(x0, top, shaft_z0), v3(x1, top + 0.2, shaft_z1), frame, .metal);
        const dx0 = x0 + 0.35;
        const dx1 = x1 - 0.35;
        const fz0 = shaft_z0;
        const fz1 = shaft_z0 + 0.1;
        boxNoAo(v3(x0, 0, fz0), v3(dx0, top, fz1), frame, .metal);
        boxNoAo(v3(dx1, 0, fz0), v3(x1, top, fz1), frame, .metal);
        boxNoAo(v3(dx0, 2.3, fz0), v3(dx1, street_y, fz1), frame, .metal);
        boxNoAo(v3(dx0, street_y + 2.3, fz0), v3(dx1, top, fz1), frame, .metal);
        // A lift sign over each door.
        for (levels) |ly| deco(v3(dx0, ly + 2.35, fz0 - 0.04), v3(dx1, ly + 2.6, fz0), v3(0.05, 0.25, 0.6), .emissive);

        // The cab: a floor and a lit ceiling (dynamic).
        const floor_b = map.box_count;
        const fb = map.add(v3(x0 + 0.1, -0.15, fz1), v3(x1 - 0.1, 0, shaft_z1 - 0.1), v3(0.25, 0.25, 0.27), .metal);
        fb.dynamic = true;
        fb.ao = false;
        const ceil_b = map.box_count;
        const cb = map.add(v3(x0 + 0.1, 2.45, fz1), v3(x1 - 0.1, 2.57, shaft_z1 - 0.1), v3(0.55, 0.6, 0.65), .emissive);
        cb.dynamic = true;
        cb.ao = false;

        // Landing doors, two halves at each level (dynamic).
        var lift: map.Lift = .{
            // The cab floor stands 2 cm proud of the landing, so the two
            // faces do not fight in the depth buffer.
            .levels = .{ levels[0] + 0.02, levels[1] + 0.02 },
            .floor_box = floor_b,
            .ceil_box = ceil_b,
            .door_box = undefined,
            .door_closed = undefined,
            .y = levels[0] + 0.02,
        };
        const mid = (dx0 + dx1) / 2;
        for (levels, 0..) |ly, lv| {
            const halves = [2][2]f32{ .{ dx0, mid }, .{ mid, dx1 } };
            for (halves, 0..) |hx, h| {
                const mn = v3(hx[0], ly, fz0 + 0.02);
                const mx = v3(hx[1], ly + 2.3, fz1 - 0.02);
                lift.door_box[lv][h] = map.box_count;
                const db = map.add(mn, mx, steel, .metal);
                db.dynamic = true;
                db.ao = false;
                lift.door_closed[lv][h] = .{ mn, mx };
            }
        }
        const idx = map.addLift(lift);

        // Call buttons on the jamb, cab buttons on the cab's west wall.
        for (levels, 0..) |ly, lv| {
            map.addButton(.{
                .min = v3(x1 - 0.27, ly + 1.05, fz0 - 0.05),
                .max = v3(x1 - 0.13, ly + 1.2, fz0),
                .lift = idx,
                .level = lv,
                .in_cab = false,
            });
            map.addButton(.{
                .min = v3(x0 + 0.1, 1.0 + 0.22 * @as(f32, @floatFromInt(lv)), 32.35),
                .max = v3(x0 + 0.16, 1.12 + 0.22 * @as(f32, @floatFromInt(lv)), 32.5),
                .lift = idx,
                .level = lv,
                .in_cab = true,
            });
        }
        _ = li;
    }
}

// ---- Ticket hall and the street -----------------------------------------------

fn ticketHall() void {
    const y = street_y;
    // The ground of the north half, street level.
    box(v3(-21, -3, bridge_z1), v3(21, y, 63), v3(0.45, 0.44, 0.42), .tile);
    // Hall walls, the roof and the lintel to the bridge.
    box(v3(-14.4, y, bridge_z1), v3(-14, y + 5.5, 50.5), cream, .paint);
    box(v3(14, y, bridge_z1), v3(14.4, y + 5.5, 50.5), cream, .paint);
    box(v3(-14.4, y + 5.5, bridge_z1), v3(14.4, y + 6, 50.5), v3(0.75, 0.72, 0.66), .concrete);
    boxNoAo(v3(-14, y + 4, bridge_z1 - 0.2), v3(14, y + 5.5, bridge_z1 + 0.2), cream, .paint);
    // The Earls Court Road front: cream faience with three doorways.
    const fz0: f32 = 50;
    const fz1: f32 = 50.6;
    const piers = [_][2]f32{ .{ -14.4, -10 }, .{ -7, -1.5 }, .{ 1.5, 7 }, .{ 10, 14.4 } };
    for (piers) |p| box(v3(p[0], y, fz0), v3(p[1], y + 7, fz1), cream, .paint);
    const doors = [_][2]f32{ .{ -10, -7 }, .{ -1.5, 1.5 }, .{ 7, 10 } };
    for (doors) |d| boxNoAo(v3(d[0], y + 3.8, fz0), v3(d[1], y + 7, fz1), cream, .paint);
    // The name band and a big roundel.
    deco(v3(-13, y + 5.6, fz1), v3(13, y + 6.4, fz1 + 0.12), blue, .paint);
    deco(v3(-12.6, y + 5.85, fz1 + 0.12), v3(12.6, y + 6.15, fz1 + 0.14), v3(0.9, 0.88, 0.8), .paint);
    roundel(v3(0, y + 4.6, fz1 + 0.15), 0, 1.6);
    // A cornice.
    deco(v3(-14.8, y + 7, fz0 - 0.2), v3(14.8, y + 7.4, fz1 + 0.3), cream * vec.s(0.9), .paint);

    // Ticket gates: posts with gaps.
    var x: f32 = -9;
    while (x <= 9.01) : (x += 1.5) {
        boxNoAo(v3(x - 0.13, y, 39.4), v3(x + 0.13, y + 1.0, 40.6), v3(0.55, 0.56, 0.58), .metal);
        deco(v3(x - 0.13, y + 1.0, 39.9), v3(x + 0.13, y + 1.04, 40.1), v3(0.2, 1.0, 0.3), .emissive);
    }
    // Ceiling lights.
    for ([_]f32{ -6, 6 }) |lx| {
        map.add(v3(lx - 1.5, y + 5.35, 42.6), v3(lx + 1.5, y + 5.5, 43.4), v3(1.0, 0.9, 0.75), .emissive).solid = false;
        map.addLight(v3(lx, y + 4.8, 43), v3(1.3, 1.05, 0.8), 12);
    }
}

fn street() void {
    const y = street_y;
    // Pavements, kerbs and the road markings.
    box(v3(-21, y, 50.6), v3(21, y + 0.12, 54), v3(0.55, 0.54, 0.52), .tile);
    box(v3(-21, y, 60), v3(21, y + 0.12, 63), v3(0.55, 0.54, 0.52), .tile);
    deco(v3(-21, y, 54), v3(21, y + 0.004, 60), v3(0.1, 0.1, 0.11), .concrete);
    var mx: f32 = -20;
    while (mx < 21) : (mx += 4) deco(v3(mx, y + 0.004, 56.9), v3(mx + 2, y + 0.01, 57.1), v3(0.9, 0.9, 0.85), .paint);
    // Side walls.
    box(v3(-21.6, y, bridge_z1), v3(-21, y + 7, 63), brick, .brick);
    box(v3(21, y, bridge_z1), v3(21.6, y + 7, 63), brick, .brick);

    // The terrace across the road, with lit and dark windows.
    box(v3(-21, y, 63), v3(21, y + 13, 64), v3(0.84, 0.8, 0.72), .paint);
    deco(v3(-21, y + 3.6, 62.8), v3(21, y + 3.9, 63), v3(0.78, 0.74, 0.66), .paint);
    var wx: f32 = -19;
    while (wx < 20) : (wx += 3) {
        for (0..3) |row| {
            const wy = y + 1.2 + @as(f32, @floatFromInt(row)) * 3.6;
            const lit = rnd() < 0.45;
            const c = if (lit) v3(0.55, 0.36, 0.16) else v3(0.03, 0.035, 0.045);
            deco(v3(wx, wy, 62.94), v3(wx + 1.3, wy + 1.9, 63), c, if (lit) .emissive else .paint);
        }
    }

    // The TARDIS (a police box) and a phone box, by the entrance.
    const tx: f32 = -12.5;
    const tz: f32 = 52.2;
    box(v3(tx - 0.62, y + 0.12, tz - 0.62), v3(tx + 0.62, y + 2.75, tz + 0.62), v3(0.03, 0.1, 0.36), .paint);
    deco(v3(tx - 0.66, y + 2.35, tz - 0.66), v3(tx + 0.66, y + 2.6, tz + 0.66), v3(0.02, 0.02, 0.025), .paint);
    deco(v3(tx - 0.5, y + 2.75, tz - 0.5), v3(tx + 0.5, y + 2.9, tz + 0.5), v3(0.03, 0.1, 0.36), .paint);
    deco(v3(tx - 0.08, y + 2.9, tz - 0.08), v3(tx + 0.08, y + 3.15, tz + 0.08), v3(0.9, 0.95, 1.0), .emissive);
    for (0..2) |row| {
        const wy = y + 1.7 + @as(f32, @floatFromInt(row)) * 0.3;
        deco(v3(tx - 0.45, wy, tz + 0.62), v3(tx + 0.45, wy + 0.22, tz + 0.65), v3(0.85, 0.9, 1.0), .emissive);
    }
    box(v3(-15.9, y + 0.12, 51.5), v3(-15, y + 2.6, 52.4), v3(0.7, 0.04, 0.03), .paint);

    // A red bus and a black cab on Earls Court Road.
    const bus_red = v3(0.72, 0.05, 0.04);
    box(v3(-9, y + 0.3, 56.2), v3(2, y + 4.4, 58.7), bus_red, .paint);
    for ([_]f32{ 1.4, 3.3 }) |wy| {
        deco(v3(-8.8, y + wy, 56.15), v3(1.8, y + wy + 0.9, 58.75), v3(0.04, 0.05, 0.06), .paint);
    }
    deco(v3(-9.02, y + 3.6, 56.6), v3(-8.98, y + 4.1, 58.3), v3(1.0, 0.75, 0.2), .emissive);
    for ([_]f32{ -7, 0 }) |wx2| {
        deco(v3(wx2 - 0.5, y, 56.1), v3(wx2 + 0.5, y + 1.0, 58.8), v3(0.02, 0.02, 0.02), .paint);
    }
    box(v3(7, y + 0.2, 58.2), v3(11.5, y + 1.3, 59.9), v3(0.02, 0.02, 0.025), .paint);
    deco(v3(8, y + 1.3, 58.3), v3(10.6, y + 1.85, 59.8), v3(0.02, 0.02, 0.025), .paint);
    deco(v3(11.5, y + 0.6, 58.4), v3(11.55, y + 0.85, 59.7), v3(1.0, 0.95, 0.8), .emissive);

    // A street lamp.
    deco(v3(11.9, y, 53.4), v3(12.1, y + 5.2, 53.6), iron, .metal);
    deco(v3(11.6, y + 5.2, 53.1), v3(12.4, y + 5.4, 53.9), iron, .metal);
    map.add(v3(11.7, y + 5.05, 53.2), v3(12.3, y + 5.2, 53.8), v3(1.0, 0.7, 0.35), .emissive).solid = false;
    map.addLight(v3(12, y + 4.6, 53.5), v3(1.6, 1.0, 0.45), 14);
}

// ---- The District line train -----------------------------------------------

fn train() void {
    const x0: f32 = -7.45;
    const x1: f32 = -4.55;
    const za: f32 = -40;
    const zb: f32 = 24;
    const white = v3(0.86, 0.86, 0.84);
    box(v3(x0, -0.55, za), v3(x1, 3.1, zb), white, .metal);
    deco(v3(x0 + 0.1, 3.1, za), v3(x1 - 0.1, 3.4, zb), v3(0.32, 0.33, 0.34), .metal);
    for ([_]f32{ x0 - 0.02, x1 }) |sx| {
        const sx1 = sx + 0.02;
        deco(v3(sx, -0.55, za), v3(sx1, 0.1, zb), blue, .paint);
        deco(v3(sx, 1.15, za), v3(sx1, 2.05, zb), v3(0.03, 0.04, 0.05), .paint);
        // Doors: three pairs a car, four cars.
        for (0..4) |car| {
            const cz = za + 16 * @as(f32, @floatFromInt(car));
            for ([_]f32{ 2.8, 8, 13.2 }) |dz| {
                deco(v3(sx - 0.01, 0.1, cz + dz - 0.8), v3(sx1 + 0.01, 2.1, cz + dz + 0.8), red, .paint);
                deco(v3(sx - 0.02, 1.15, cz + dz - 0.55), v3(sx1 + 0.02, 1.9, cz + dz + 0.55), v3(0.04, 0.05, 0.06), .paint);
            }
            // The gangway between cars.
            if (car > 0) deco(v3(sx - 0.03, -0.55, cz - 0.15), v3(sx1 + 0.03, 3.1, cz + 0.15), v3(0.05, 0.05, 0.05), .paint);
        }
    }
    // The cab front at the north end: red, a windscreen, lights.
    deco(v3(x0, -0.55, zb), v3(x1, 3.1, zb + 0.25), red, .paint);
    deco(v3(x0 + 0.3, 1.3, zb + 0.25), v3(x1 - 0.3, 2.3, zb + 0.28), v3(0.02, 0.03, 0.04), .paint);
    for ([_]f32{ x0 + 0.4, x1 - 0.7 }) |hx| deco(v3(hx, 0.4, zb + 0.25), v3(hx + 0.3, 0.6, zb + 0.3), v3(1.0, 0.95, 0.85), .emissive);
    // Bogies.
    var bz = za + 2;
    while (bz < zb) : (bz += 8) deco(v3(x0 + 0.3, bed_y, bz), v3(x1 - 0.3, -0.55, bz + 2.4), v3(0.05, 0.05, 0.05), .metal);
}

// ---- Escalators to the Piccadilly line ----------------------------------------

const esc_top_z: f32 = -30;
const esc_steps = 36;
const esc_run: f32 = 0.69;
const esc_rise: f32 = 16.0 / 36.0;
const esc_bottom_z: f32 = esc_top_z - esc_run * esc_steps;

fn escalators() void {
    const deep_floor = deep_y - 1;
    for (0..esc_steps) |i| {
        const fi: f32 = @floatFromInt(i);
        const za = esc_top_z - esc_run * (fi + 1);
        const top = -esc_rise * (fi + 1);
        boxNoAo(v3(-3.7, deep_floor, za), v3(3.7, top, za + esc_run), v3(0.16, 0.16, 0.17), .metal);
        // The yellow nosing of each step on both lanes.
        deco(v3(-3.6, top, za + esc_run - 0.05), v3(-0.35, top + 0.008, za + esc_run), yellow, .paint);
        deco(v3(0.35, top, za + esc_run - 0.05), v3(3.6, top + 0.008, za + esc_run), yellow, .paint);
    }
    // Shaft walls, tiled, from the deep floor to rail height at the top.
    box(v3(-4.3, deep_floor, esc_bottom_z), v3(-4, 1.1, esc_top_z), tile_c, .wall_tile);
    box(v3(4, deep_floor, esc_bottom_z), v3(4.3, 1.1, esc_top_z), tile_c, .wall_tile);
    // Under the station the shaft has a lid.
    box(v3(-4.3, 0, esc_bottom_z), v3(4.3, 1, -45.6), v3(0.3, 0.29, 0.27), .concrete);
    // Fill the sides of the shaft south of the station.
    box(v3(-21, deep_y + 4.5, -55), v3(-4.3, bed_y, -45.6), ballast, .concrete);
    box(v3(4.3, deep_y + 4.5, -55), v3(21, bed_y, -45.6), ballast, .concrete);

    // The sloped ceiling, the side panels, the centre divider and its
    // uplighters (the classic tube escalator lamps).
    // 4.45 m over the step line, from the south wall down.
    const top_a = v3(0, -esc_rise * ((esc_top_z + 45.6) / esc_run) + 4.45, -45.6);
    const top_b = v3(0, deep_y + 4.4, esc_bottom_z);
    const slope = vec.norm(top_b - top_a);
    const up = vec.cross(slope, v3(1, 0, 0)) * vec.s(-1);
    map.beam(top_a, top_b, 8.6, 0.25, up, v3(0.75, 0.72, 0.62), .wall_tile);
    for ([_]f32{ -3.8, 0, 3.8 }) |x| {
        const a = v3(x, 0.55, esc_top_z);
        const b = v3(x, deep_y + 0.55, esc_bottom_z);
        map.beam(a, b, if (x == 0) 0.7 else 0.2, 1.0, up, v3(0.33, 0.27, 0.2), .wood);
    }
    for (0..8) |i| {
        const t = (@as(f32, @floatFromInt(i)) + 0.5) / 8;
        const p = vec.lerp(v3(0, 1.1, esc_top_z), v3(0, deep_y + 1.1, esc_bottom_z), t);
        deco(p - v3(0.12, 0, 0.12), p + v3(0.12, 0.45, 0.12), v3(1.0, 0.8, 0.5), .emissive);
    }
    // Strip lights along the sloped ceiling.
    for (0..6) |i| {
        const t = (@as(f32, @floatFromInt(i)) + 0.5) / 6;
        const p = vec.lerp(top_a, top_b, t) - up * vec.s(0.2);
        if (p[2] > -45) continue;
        map.beam(p - slope * vec.s(0.8), p + slope * vec.s(0.8), 0.25, 0.06, up, cool, .emissive);
    }
    map.addLight(v3(0, -2.5, -38), cool, 10);
    map.addLight(v3(0, -10, -48), v3(1.1, 0.85, 0.6), 11);

    // The lanes: left goes down, right goes up.
    map.addEscalator(.{ .min = v3(-3.7, deep_y - 0.5, esc_bottom_z), .max = v3(-0.3, 0.5, esc_top_z), .vel = v3(0, 0, -0.65) });
    map.addEscalator(.{ .min = v3(0.3, deep_y - 0.5, esc_bottom_z), .max = v3(3.7, 0.5, esc_top_z), .vel = v3(0, 0, 0.65) });
}

// ---- The deep-level Piccadilly line platform ----------------------------------

fn deepPlatform() void {
    const y = deep_y;
    const z_back = esc_bottom_z; // the north wall
    const z_edge: f32 = -62;
    const z_wall: f32 = -65.5;
    const ceil: f32 = y + 4.6;
    const x0: f32 = -30;
    const x1: f32 = 30;
    const floor_c = v3(0.3, 0.29, 0.27);

    box(v3(x0, y - 1, z_edge), v3(x1, y, z_back), floor_c, .concrete);
    deco(v3(x0, y, z_edge), v3(x1, y + 0.012, z_edge + 0.45), yellow, .paint);
    box(v3(x0, y - 1.2, z_wall), v3(x1, y - 0.85, z_edge), ballast * vec.s(0.7), .concrete);
    for ([_]f32{ -0.72, 0.72 }) |off| {
        boxNoAo(v3(x0 - 4, y - 0.85, -63.75 + off - 0.04), v3(x1 + 4, y - 0.69, -63.75 + off + 0.04), steel, .metal);
    }
    var sx: f32 = x0;
    while (sx < x1) : (sx += 0.9) deco(v3(sx, y - 0.85, -65), v3(sx + 0.26, y - 0.79, -62.5), v3(0.1, 0.08, 0.06), .wood);

    // North wall (with the escalator opening), the wall across the track,
    // the ends with tunnel mouths, and the ceiling.
    box(v3(x0, y, z_back), v3(-4.3, ceil, z_back + 0.35), tile_c, .wall_tile);
    box(v3(4.3, y, z_back), v3(x1, ceil, z_back + 0.35), tile_c, .wall_tile);
    box(v3(-4.3, deep_y + 4.4, z_back), v3(4.3, ceil, z_back + 0.35), tile_c, .wall_tile);
    box(v3(x0, y - 1.2, z_wall - 0.4), v3(x1, ceil, z_wall), tile_c, .wall_tile);
    box(v3(x0 - 0.4, y - 1.2, z_edge), v3(x0, ceil, z_back + 0.35), tile_c, .wall_tile);
    box(v3(x1, y - 1.2, z_edge), v3(x1 + 0.4, ceil, z_back + 0.35), tile_c, .wall_tile);
    box(v3(x0 - 0.4, y + 3.4, z_wall), v3(x0, ceil, z_edge), tile_c, .wall_tile);
    box(v3(x1, y + 3.4, z_wall), v3(x1 + 0.4, ceil, z_edge), tile_c, .wall_tile);
    box(v3(x0 - 6, y - 1.2, z_wall), v3(x0 - 5.6, y + 3.4, z_edge), dark, .paint);
    box(v3(x1 + 5.6, y - 1.2, z_wall), v3(x1 + 6, y + 3.4, z_edge), dark, .paint);
    deco(v3(x0 - 5.6, y + 3.4, z_wall), v3(x0, y + 3.5, z_edge), dark, .paint);
    deco(v3(x1, y + 3.4, z_wall), v3(x1 + 5.6, y + 3.5, z_edge), dark, .paint);
    deco(v3(x1 + 0.5, y + 1.8, z_edge - 0.3), v3(x1 + 0.7, y + 2.0, z_edge - 0.1), v3(1.0, 0.05, 0.02), .emissive);
    box(v3(x0 - 0.4, ceil, z_wall - 0.4), v3(x1 + 0.4, ceil + 0.6, z_back + 0.35), v3(0.12, 0.11, 0.1), .concrete);
    // Curved haunches where the walls meet the ceiling.
    map.beam(v3(x0, ceil - 0.55, z_back + 0.05), v3(x1, ceil - 0.55, z_back + 0.05), 1.3, 0.2, vec.norm(v3(0, -1, -1)), tile_c * vec.s(0.9), .wall_tile);
    map.beam(v3(x0, ceil - 0.55, z_wall - 0.05), v3(x1, ceil - 0.55, z_wall - 0.05), 1.3, 0.2, vec.norm(v3(0, -1, 1)), tile_c * vec.s(0.9), .wall_tile);

    // Tile bands: a deep blue frieze and a maroon line, both walls.
    for ([_][2]f32{ .{ z_back - 0.03, z_back }, .{ z_wall, z_wall + 0.03 } }) |zz| {
        deco(v3(x0, y + 2.3, zz[0]), v3(x1, y + 2.7, zz[1]), v3(0.05, 0.13, 0.4), .wall_tile);
        deco(v3(x0, y + 1.15, zz[0]), v3(x1, y + 1.25, zz[1]), v3(0.38, 0.05, 0.06), .wall_tile);
    }
    // Roundels and posters on the wall across the track.
    for ([_]f32{ -18, 0, 18 }) |rx| roundel(v3(rx, y + 1.6, z_wall + 0.05), 0, 1.4);
    const poster_cols = [_]V3{ v3(0.8, 0.35, 0.1), v3(0.1, 0.4, 0.55), v3(0.85, 0.75, 0.2), v3(0.45, 0.1, 0.35), v3(0.15, 0.5, 0.25), v3(0.9, 0.9, 0.85) };
    for ([_]f32{ -26, -9, 9, 26 }, 0..) |px, i| {
        deco(v3(px - 2, y + 0.4, z_wall + 0.02), v3(px + 2, y + 3.2, z_wall + 0.06), v3(0.08, 0.08, 0.08), .paint);
        deco(v3(px - 1.85, y + 0.55, z_wall + 0.06), v3(px + 1.85, y + 3.05, z_wall + 0.08), poster_cols[i % poster_cols.len], .paint);
        deco(v3(px - 1.85, y + 1.6, z_wall + 0.08), v3(px + 0.6, y + 2.4, z_wall + 0.09), poster_cols[(i + 3) % poster_cols.len], .paint);
    }
    // Benches on the platform, and a roundel on the north wall.
    for ([_]f32{ -22, -12, 12, 22 }) |bx| boxNoAo(v3(bx - 1.2, y, z_back - 1.0), v3(bx + 1.2, y + 0.45, z_back - 0.5), v3(0.3, 0.17, 0.09), .wood);
    for ([_]f32{ -17, 17 }) |rx| roundel(v3(rx, y + 2.0, z_back - 0.05), std.math.pi, 1.1);

    // Fluorescent strips over the platform, and their lights. One of them
    // flickers (main.zig).
    var lx: f32 = x0 + 3;
    while (lx < x1) : (lx += 6) {
        map.add(v3(lx - 1.2, ceil - 0.12, -58.7), v3(lx + 1.2, ceil - 0.04, -58.4), v3(0.85, 0.95, 1.0), .emissive).solid = false;
    }
    // The Piccadilly line train (map.zig Train): one solid body box.
    const body = map.add(v3(-400, y - 0.75, -65.2), v3(-340, y + 3.0, -62.25), v3(0.62, 0.64, 0.66), .metal);
    body.dynamic = true;
    body.ao = false;
    map.train = .{ .box = map.box_count - 1, .stop_x = 0, .z0 = -65.2, .z1 = -62.25, .y0 = y - 0.75, .y1 = y + 3.0, .half_len = 30 };
    map.flicker_light = map.light_count + 2;
    for ([_]f32{ -21, -7, 7, 21 }, 0..) |px, i| {
        // Tubes age to different whites.
        const tint = if (i % 2 == 0) v3(0.8, 1.0, 0.9) else v3(1.0, 0.95, 0.82);
        map.addLight(v3(px, ceil - 0.9, -58.5), tint * vec.s(2.3), 15);
    }
    // Pipes and cable runs along the ceiling, and a cable tray on the wall
    // across the track.
    for ([_]f32{ -55.4, -56.1, -65.0 }) |pz| {
        map.beam(v3(x0, ceil - 0.3, pz), v3(x1, ceil - 0.3, pz), 0.18, 0.18, v3(0, 1, 0), v3(0.12, 0.11, 0.1), .metal);
    }
    map.beam(v3(x0, ceil - 0.55, -55.2), v3(x1, ceil - 0.55, -55.2), 0.4, 0.06, v3(0, 1, 0), v3(0.15, 0.14, 0.12), .metal);
    map.beam(v3(x0, y + 3.6, z_wall + 0.15), v3(x1, y + 3.6, z_wall + 0.15), 0.25, 0.12, v3(0, 1, 0), v3(0.07, 0.07, 0.07), .metal);
    map.addLight(v3(x1 + 0.5, y + 1.9, z_edge - 0.6), v3(2.5, 0.08, 0.03), 5);
}
