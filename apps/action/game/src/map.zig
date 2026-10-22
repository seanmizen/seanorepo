// The current map: axis-aligned boxes, decoration, lights, spawns, lifts,
// buttons and escalators.
//
// - Boxes are the render mesh, the collision shapes, the hit-scan targets
//   and the ambient-occlusion shapes (the shader reads them from a storage
//   buffer). A dynamic box (a lift part) moves, so it is drawn each frame.
// - Decoration is visual only: oriented boxes and discs (roof ribs, signs).
//   It casts shadows. It has no collision.
//
// The maps are in maps/. The server (apps/action/server/index.ts) has a
// copy of the Earl's Court spawns and lift levels.
const std = @import("std");
const vec = @import("vec.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;

pub const Id = enum { arena, earls_court };

pub const Mat = enum(u8) {
    paint = 0,
    concrete = 1,
    tile = 2,
    metal = 3,
    emissive = 4,
    wood = 5,
    cloth = 6,
    wall_tile = 7,
    brick = 8,
};

pub const Box = struct {
    min: V3,
    max: V3,
    color: V3,
    mat: Mat,
    /// Collision and hit scan skip a box with solid = false (lamp bulbs).
    solid: bool = true,
    /// The ambient occlusion skips a box with ao = false (small parts,
    /// escalator steps).
    ao: bool = true,
    /// A dynamic box moves (lift parts). It is not in the static mesh.
    dynamic: bool = false,
    /// An invisible box is collision only (handrails, balustrades whose
    /// visible part is a decoration beam).
    visible: bool = true,
};

pub const Decor = struct {
    m: Mat4,
    min: V3,
    max: V3,
    color: V3,
    mat: Mat,
    /// A disc of radius min[0] and thickness min[1] along local Z.
    disc: bool = false,
};

pub const Light = struct {
    pos: V3,
    color: V3,
    radius: f32,
};

pub const Spawn = struct { pos: V3, yaw: f32 };

pub const max_boxes = 640;
pub const max_lights = 20;

pub var id: Id = .arena;
pub var boxes: [max_boxes]Box = undefined;
pub var box_count: usize = 0;
pub var decor: std.ArrayList(Decor) = .empty;
pub var lights: [max_lights]Light = undefined;
pub var light_count: usize = 0;
pub var spawns: [16]Spawn = undefined;
pub var spawn_count: usize = 0;

/// The shadow map covers a square of this half size around shadow_centre.
pub var shadow_centre: V3 = v3(0, 0, 0);
pub var shadow_half: f32 = 40;
/// Below this height there is no sun and little sky light (underground).
pub var underground_y: f32 = -1000;
/// A player below this height respawns.
pub var kill_y: f32 = -5;
/// A light that flickers (a tired fluorescent tube), or null, and the box
/// of its tube (dynamic, so it flickers too).
pub var flicker_light: ?usize = null;
pub var flicker_box: ?usize = null;

var alloc: std.mem.Allocator = undefined;

pub fn init(a: std.mem.Allocator) void {
    alloc = a;
}

/// Build a map. This clears the lifts, the buttons and the escalators too.
pub fn load(map: Id) void {
    id = map;
    box_count = 0;
    light_count = 0;
    spawn_count = 0;
    decor.clearRetainingCapacity();
    lift_count = 0;
    button_count = 0;
    escalator_count = 0;
    train = null;
    shadow_centre = v3(0, 0, 0);
    shadow_half = 40;
    underground_y = -1000;
    kill_y = -5;
    flicker_light = null;
    flicker_box = null;
    switch (map) {
        .arena => @import("maps/arena.zig").build(),
        .earls_court => @import("maps/earls_court.zig").build(),
    }
}

// ---- Builders for the maps -------------------------------------------------

pub fn add(min: V3, max: V3, color: V3, mat: Mat) *Box {
    if (box_count >= max_boxes) {
        std.log.warn("map: more than {d} boxes", .{max_boxes});
        return &boxes[max_boxes - 1];
    }
    boxes[box_count] = .{ .min = min, .max = max, .color = color, .mat = mat };
    box_count += 1;
    return &boxes[box_count - 1];
}

/// A collision-only box (see Box.visible).
pub fn addSolid(min: V3, max: V3) void {
    const b = add(min, max, v3(0, 0, 0), .paint);
    b.visible = false;
    b.ao = false;
}

pub const Rect = struct { x0: f32, x1: f32, z0: f32, z1: f32 };

/// Solid mass from y0 to y1 over the rectangle `area`, less the `holes`.
/// The holes are rooms and passages: the mass around them is their walls.
/// It sweeps along X: between two hole edges, the free Z ranges become
/// boxes.
pub fn carve(area: Rect, y0: f32, y1: f32, holes: []const Rect, color: V3, mat: Mat) void {
    var xs: [130]f32 = undefined;
    var n: usize = 0;
    xs[n] = area.x0;
    n += 1;
    xs[n] = area.x1;
    n += 1;
    for (holes) |h| {
        for ([_]f32{ h.x0, h.x1 }) |x| {
            if (x > area.x0 and x < area.x1 and n < xs.len) {
                xs[n] = x;
                n += 1;
            }
        }
    }
    std.mem.sort(f32, xs[0..n], {}, std.sort.asc(f32));
    var i: usize = 0;
    while (i + 1 < n) : (i += 1) {
        const xa = xs[i];
        const xb = xs[i + 1];
        if (xb - xa < 1e-4) continue;
        const xm = (xa + xb) / 2;
        // The Z ranges that holes cover in this X strip.
        var cut: [64][2]f32 = undefined;
        var c: usize = 0;
        for (holes) |h| {
            if (h.x0 < xm and h.x1 > xm and c < cut.len) {
                cut[c] = .{ @max(h.z0, area.z0), @min(h.z1, area.z1) };
                c += 1;
            }
        }
        const S = struct {
            fn less(_: void, a: [2]f32, b: [2]f32) bool {
                return a[0] < b[0];
            }
        };
        std.mem.sort([2]f32, cut[0..c], {}, S.less);
        var z = area.z0;
        for (cut[0..c]) |r| {
            if (r[0] > z + 1e-4) _ = add(v3(xa, y0, z), v3(xb, y1, r[0]), color, mat);
            z = @max(z, r[1]);
        }
        if (area.z1 > z + 1e-4) _ = add(v3(xa, y0, z), v3(xb, y1, area.z1), color, mat);
    }
}

/// A box from its centre on the floor (x, z), its size and its base height.
pub fn put(x: f32, z: f32, sx: f32, sy: f32, sz: f32, y0: f32, color: V3, mat: Mat) *Box {
    return add(v3(x - sx / 2, y0, z - sz / 2), v3(x + sx / 2, y0 + sy, z + sz / 2), color, mat);
}

pub fn addDecor(m: Mat4, min: V3, max: V3, color: V3, mat: Mat) void {
    decor.append(alloc, .{ .m = m, .min = min, .max = max, .color = color, .mat = mat }) catch {};
}

pub fn addDisc(m: Mat4, r: f32, t: f32, color: V3, mat: Mat) void {
    decor.append(alloc, .{ .m = m, .min = v3(r, t, 0), .max = v3(0, 0, 0), .color = color, .mat = mat, .disc = true }) catch {};
}

/// A decoration beam from a to b, w wide and h high. `up` turns the cross
/// section.
pub fn beam(a: V3, b: V3, w: f32, h: f32, up: V3, color: V3, mat: Mat) void {
    const d = b - a;
    const l = vec.len(d);
    if (l < 1e-4) return;
    const f = d / vec.s(l);
    const r = vec.norm(vec.cross(f, up));
    const u = vec.cross(r, f);
    const m = Mat4{ .data = .{ r[0], r[1], r[2], 0, u[0], u[1], u[2], 0, f[0], f[1], f[2], 0, a[0], a[1], a[2], 1 } };
    addDecor(m, v3(-w / 2, -h / 2, 0), v3(w / 2, h / 2, l), color, mat);
}

pub fn addLight(pos: V3, color: V3, radius: f32) void {
    if (light_count >= max_lights) return;
    lights[light_count] = .{ .pos = pos, .color = color, .radius = radius };
    light_count += 1;
}

pub fn addSpawn(pos: V3) void {
    if (spawn_count >= spawns.len) return;
    // Face the middle of the map. Yaw 0 looks to -Z.
    spawns[spawn_count] = .{ .pos = pos, .yaw = std.math.atan2(pos[0], pos[2]) };
    spawn_count += 1;
}

// ---- Lifts -----------------------------------------------------------------
//
// A lift is a cab that moves between floor heights (levels). Each level has
// landing doors that open when the cab is there. server/index.ts runs the
// same state machine: a call goes to the server, the server sends it to
// every client, and each client applies it. So all the cabs agree.

pub const Phase = enum { idle, opening, open, closing, moving };

pub const Lift = struct {
    levels: [2]f32,
    /// The cab floor and cab ceiling boxes (dynamic).
    floor_box: usize,
    ceil_box: usize,
    /// The landing door halves, [level][half] (dynamic).
    door_box: [2][2]usize,
    /// The closed bounds of each door half, [level][half][min, max].
    door_closed: [2][2][2]V3,
    y: f32,
    level: usize = 0, // the level the cab is at, or goes to
    door: f32 = 0, // 0 closed, 1 open
    phase: Phase = .idle,
    hold: f32 = 0,
    pending: ?usize = null,
    /// The height change of the last step, to carry a rider.
    dy: f32 = 0,
    /// Metres a second.
    speed: f32 = 1.6,
    /// The landing doors are on an X face and slide along Z (true), or on
    /// a Z face and slide along X (false).
    door_on_x: bool = false,
};

pub const lift_speed: f32 = 1.6;
pub const door_time: f32 = 0.8;
pub const door_hold: f32 = 6.0;
pub const cab_height: f32 = 2.45;

pub var lifts: [4]Lift = undefined;
pub var lift_count: usize = 0;

pub fn addLift(l: Lift) usize {
    lifts[lift_count] = l;
    lift_count += 1;
    placeLift(&lifts[lift_count - 1]);
    return lift_count - 1;
}

/// Call a lift to a level: a button press offline, or the server's echo of
/// a press in deathmatch.
pub fn callLift(i: usize, level: usize) void {
    if (i >= lift_count) return;
    const l = &lifts[i];
    if (level >= l.levels.len) return;
    switch (l.phase) {
        .idle => {
            if (l.level == level and @abs(l.y - l.levels[level]) < 0.01) {
                l.phase = .opening;
            } else {
                l.level = level;
                l.phase = .moving;
            }
        },
        .open, .opening => {
            if (level == l.level) {
                l.hold = door_hold;
            } else {
                l.pending = level;
                l.phase = .closing;
            }
        },
        .closing => {
            if (level == l.level) l.phase = .opening else l.pending = level;
        },
        .moving => l.pending = level,
    }
}

pub fn stepLifts(dt: f32) void {
    for (lifts[0..lift_count]) |*l| {
        const before = l.y;
        switch (l.phase) {
            .idle => {},
            .moving => {
                const target = l.levels[l.level];
                const d = target - l.y;
                const step = l.speed * dt;
                if (@abs(d) <= step) {
                    l.y = target;
                    l.phase = .opening;
                } else l.y += std.math.sign(d) * step;
            },
            .opening => {
                l.door = @min(1, l.door + dt / door_time);
                if (l.door >= 1) {
                    l.phase = .open;
                    l.hold = door_hold;
                }
            },
            .open => {
                l.hold -= dt;
                if (l.hold <= 0) l.phase = .closing;
            },
            .closing => {
                l.door = @max(0, l.door - dt / door_time);
                if (l.door <= 0) {
                    l.phase = .idle;
                    if (l.pending) |p| {
                        l.pending = null;
                        if (p != l.level) {
                            l.level = p;
                            l.phase = .moving;
                        }
                    }
                }
            },
        }
        l.dy = l.y - before;
        placeLift(l);
    }
}

/// Correct a lift from the server state: y, door, level and the phase
/// number (the order of Phase).
pub fn syncLift(i: usize, y: f32, door: f32, level: usize, phase: usize) void {
    if (i >= lift_count or level >= 2 or phase > 4) return;
    const l = &lifts[i];
    if (@abs(l.y - y) > 0.3) l.y = y;
    if (@abs(l.door - door) > 0.3) l.door = door;
    l.level = level;
    l.phase = @fromBackingInt(@intCast(phase));
    placeLift(l);
}

fn placeLift(l: *Lift) void {
    const fb = &boxes[l.floor_box];
    const h = fb.max[1] - fb.min[1];
    fb.max[1] = l.y;
    fb.min[1] = l.y - h;
    const cb = &boxes[l.ceil_box];
    const ch = cb.max[1] - cb.min[1];
    cb.min[1] = l.y + cab_height;
    cb.max[1] = cb.min[1] + ch;
    // Only the doors of the level where the cab stands open. The two
    // halves slide apart along X.
    for (0..2) |lv| {
        const here = @abs(l.y - l.levels[lv]) < 0.05;
        const open = if (here) l.door else 0;
        for (0..2) |half| {
            const closed = l.door_closed[lv][half];
            const ax: usize = if (l.door_on_x) 2 else 0;
            const w = comp(closed[1], ax) - comp(closed[0], ax);
            const dir: f32 = if (half == 0) -1 else 1;
            const d = dir * w * 0.92 * vec.smooth(open);
            const off = if (l.door_on_x) v3(0, 0, d) else v3(d, 0, 0);
            boxes[l.door_box[lv][half]].min = closed[0] + off;
            boxes[l.door_box[lv][half]].max = closed[1] + off;
        }
    }
}

// ---- The deep-level train ------------------------------------------------------
//
// A train runs through the deep platform on a fixed timetable. The server
// sends its clock (the time in the cycle), so all the clients agree.
// server/index.ts has the same cycle length.

pub const Train = struct {
    /// The solid body box (dynamic).
    box: usize,
    /// The track: the stop position on X, the track z range, the floor y.
    stop_x: f32,
    z0: f32,
    z1: f32,
    y0: f32,
    y1: f32,
    half_len: f32,
    /// Seconds into the cycle.
    t: f32 = 0,
};

pub const train_cycle: f32 = 70;
pub var train: ?Train = null;

/// The front position of the train at a time in the cycle: it brakes into
/// the platform from +X, waits with its doors open, and pulls out to -X.
pub fn trainX(t: f32) f32 {
    if (t < 9) {
        const k = 1 - t / 9;
        return 100 * k * k;
    }
    if (t < 27) return 0;
    if (t < 36) {
        const k = (t - 27) / 9;
        return -100 * k * k;
    }
    return -400;
}

/// 0 closed, 1 open.
pub fn trainDoors(t: f32) f32 {
    return vec.smooth((t - 10) / 1.2) * (1 - vec.smooth((t - 24) / 1.2));
}

pub fn stepTrain(dt: f32) void {
    const tr = &(train orelse return);
    tr.t = @mod(tr.t + dt, train_cycle);
    placeTrain(tr);
}

/// Follow the server's train clock.
pub fn syncTrain(t: f32) void {
    const tr = &(train orelse return);
    var d = t - tr.t;
    if (d > train_cycle / 2) d -= train_cycle;
    if (d < -train_cycle / 2) d += train_cycle;
    if (@abs(d) > 0.5) tr.t = t else tr.t = @mod(tr.t + d * 0.1, train_cycle);
    placeTrain(tr);
}

fn placeTrain(tr: *Train) void {
    const x = tr.stop_x + trainX(tr.t);
    boxes[tr.box].min = v3(x - tr.half_len, tr.y0, tr.z0);
    boxes[tr.box].max = v3(x + tr.half_len, tr.y1, tr.z1);
}

/// One component of a vector, by a run-time index.
fn comp(v: V3, i: usize) f32 {
    return switch (i) {
        0 => v[0],
        1 => v[1],
        else => v[2],
    };
}

// ---- Buttons ---------------------------------------------------------------

pub const Button = struct {
    min: V3,
    max: V3,
    lift: usize,
    level: usize,
    /// A cab button moves with the cab: its y is relative to the cab floor.
    in_cab: bool,
};

pub var buttons: [16]Button = undefined;
pub var button_count: usize = 0;

pub fn addButton(b: Button) void {
    if (button_count >= buttons.len) return;
    buttons[button_count] = b;
    button_count += 1;
}

pub fn buttonBounds(b: *const Button) [2]V3 {
    if (!b.in_cab) return .{ b.min, b.max };
    const y = lifts[b.lift].y;
    return .{ b.min + v3(0, y, 0), b.max + v3(0, y, 0) };
}

/// True while the lift of the button goes to, or waits at, its level.
pub fn buttonLit(b: *const Button) bool {
    const l = &lifts[b.lift];
    if (l.pending) |p| if (p == b.level) return true;
    return l.level == b.level and l.phase != .idle;
}

/// The button that the ray points at within reach, if no wall is nearer.
pub fn pickButton(o: V3, d: V3, reach: f32) ?usize {
    var best: ?usize = null;
    var best_t: f32 = reach;
    for (buttons[0..button_count], 0..) |*b, i| {
        const bb = buttonBounds(b);
        if (rayBox(o, d, bb[0] - vec.s(0.05), bb[1] + vec.s(0.05))) |h| {
            if (h.t < best_t) {
                best_t = h.t;
                best = i;
            }
        }
    }
    if (best == null) return null;
    if (raycast(o, d, best_t)) |wall| if (wall.t < best_t - 0.08) return null;
    return best;
}

// ---- Escalators ------------------------------------------------------------

/// A zone that moves a player who stands in it, at a constant velocity.
pub const Escalator = struct { min: V3, max: V3, vel: V3 };

pub var escalators: [4]Escalator = undefined;
pub var escalator_count: usize = 0;

pub fn addEscalator(e: Escalator) void {
    if (escalator_count >= escalators.len) return;
    escalators[escalator_count] = e;
    escalator_count += 1;
}

/// The escalator velocity at these feet, or zero.
pub fn escalatorAt(p: V3) V3 {
    for (escalators[0..escalator_count]) |e| {
        if (p[0] > e.min[0] and p[0] < e.max[0] and p[1] > e.min[1] and p[1] < e.max[1] and
            p[2] > e.min[2] and p[2] < e.max[2]) return e.vel;
    }
    return v3(0, 0, 0);
}

// ---- Queries ---------------------------------------------------------------

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

/// The lift and level whose doorway these feet stand in, or null.
pub fn doorwayAt(feet: V3) ?struct { lift: usize, level: usize } {
    for (lifts[0..lift_count], 0..) |l, i| {
        for (0..2) |lv| {
            const mn = l.door_closed[lv][0][0];
            const mx = l.door_closed[lv][1][1];
            // Along the doors, and up to 0.6 m in front of or behind them.
            const a: usize = if (l.door_on_x) 2 else 0;
            const b: usize = if (l.door_on_x) 0 else 2;
            if (comp(feet, a) > comp(mn, a) and comp(feet, a) < comp(mx, a) and
                comp(feet, b) > comp(mn, b) - 0.6 and comp(feet, b) < comp(mx, b) + 0.6 and
                feet[1] > mn[1] - 0.3 and feet[1] < mn[1] + 1.0) return .{ .lift = i, .level = lv };
        }
    }
    return null;
}

/// The lift whose cab floor is under these feet, or null.
pub fn liftUnder(feet: V3, radius: f32) ?usize {
    for (lifts[0..lift_count], 0..) |l, i| {
        const b = boxes[l.floor_box];
        if (feet[0] + radius > b.min[0] and feet[0] - radius < b.max[0] and
            feet[2] + radius > b.min[2] and feet[2] - radius < b.max[2] and
            @abs(feet[1] - b.max[1]) < 0.12) return i;
    }
    return null;
}
