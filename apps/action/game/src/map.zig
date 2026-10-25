// The current map: axis-aligned boxes, ramps, decoration, lights, spawns,
// lifts, buttons and escalators.
//
// - Boxes are the render mesh, the collision shapes, the hit-scan targets
//   and the ambient-occlusion shapes (the shader reads them from a storage
//   buffer). A dynamic box (a lift part) moves, so it is drawn each frame.
// - Ramps are invisible collision slopes over the stairs and the
//   escalators, so the feet move smoothly up and down them.
// - Decoration is visual only: oriented boxes, sloped bars (a sheared box)
//   and discs (roof ribs, signs, round rails). It casts shadows. It has no
//   collision.
// - Each box and each decoration has a surface material (`surface`, no
//   default): the sound of a bullet that hits it (audio/impact.zig). A hit
//   on a box takes the material of a decoration that lies on the hit point
//   (surfaceAt): a sleeper on the ballast, a window on a train.
//
// The maps are in maps/. The server (apps/action/server/index.ts) has a
// copy of the Earl's Court spawns and lift levels.
const std = @import("std");
const vec = @import("vec.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;
const train_car = @import("train_car.zig");

/// The surface material of a box or a decoration: it sets the impact sound.
pub const Surface = @import("audio/impact.zig").Material;

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
    /// Round amber LEDs on a grid: the train indicators
    /// (platform_display.zig). Dynamic quads only.
    led = 9,
    /// Grooved aluminium: escalator steps, comb plates and landing plates.
    /// The grooves run along X (scene.wgsl).
    tread = 10,
    /// Brushed stainless steel: a fine vertical grain (the lift doors and
    /// cabs).
    steel = 11,
    /// Glazed terracotta blocks, 600 x 300 mm, with fine joints: the
    /// Earls Court Road front of Earl's Court.
    terracotta = 12,
};

pub const Box = struct {
    min: V3,
    max: V3,
    color: V3,
    mat: Mat,
    surface: Surface,
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
    /// Local to world. It can shear the box: a sloped bar (slab).
    m: Mat4,
    min: V3,
    max: V3,
    color: V3,
    mat: Mat,
    surface: Surface,
    /// A disc of radius min[0] and thickness min[1] along local Z.
    disc: bool = false,
};

pub const Light = struct {
    pos: V3,
    color: V3,
    radius: f32,
    /// The shadow map of the light (render.zig), from 1. 0 for a light
    /// that moves: it has no shadow map, and walls do not stop it.
    shadow: u8 = 0,
};

pub const Spawn = struct { pos: V3, yaw: f32 };

/// The GPU box buffer of the ambient occlusion (render.zig uploadBoxes)
/// has this many boxes. A map with more boxes fails `zig build test` and
/// the floorplan tool.
pub const max_boxes = 2048;
/// The map lights. Each one has six shadow layers (render.zig), and
/// scene.wgsl BODY_SLOT is the same number.
pub const max_lights = 36;

pub var id: Id = .arena;
pub var boxes: [max_boxes]Box = undefined;
pub var box_count: usize = 0;
/// The boxes that the last load could not add: more than max_boxes. They
/// are not in the map. load() logs an error.
pub var dropped: usize = 0;
pub var decor: std.ArrayList(Decor) = .empty;
/// The world bounds of each decoration, in the order of `decor` (load).
pub var decor_bounds: std.ArrayList([2]V3) = .empty;
pub var lights: [max_lights]Light = undefined;
pub var light_count: usize = 0;
pub var spawns: [16]Spawn = undefined;
pub var spawn_count: usize = 0;

/// add() returns this box when the map is full: the caller can set its
/// fields, and no box of the map changes.
var overflow_box: Box = undefined;

/// The shadow map covers a square of this half size around shadow_centre.
pub var shadow_centre: V3 = v3(0, 0, 0);
pub var shadow_half: f32 = 40;
/// Below this height there is no sun and little sky light (underground).
pub var underground_y: f32 = -1000;
/// The light changes from the outdoor light to the underground light in
/// this height above underground_y: the sun, the sky light, the fog, the
/// haze (scene.wgsl outdoors) and the exposure (main.zig).
pub const light_band: f32 = 2.5;
/// A player below this height respawns.
pub var kill_y: f32 = -5;
/// A closed room with no sun and only a trace of the sky light, [min,
/// max]. The sun shadow map (shadow_half) does not reach every room, and
/// out of it the sun goes through the walls. No room: min is over max.
pub var sealed: [2]V3 = no_room;
pub const no_room = [2]V3{ v3(1, 1, 1), v3(-1, -1, -1) };
/// Scenery out of play, [min, max]: a place that a player sees and cannot
/// get to, such as the construction site behind the Warwick Road hoarding.
/// The escape audit (escape.zig) reports a standing point in it as an
/// escape. The floorplan audit does not look for reachable decoration in
/// it. No scenery: min is over max.
pub var scenery: [2]V3 = no_room;
/// A light that flickers (a tired fluorescent tube), or null, and the box
/// of its tube (dynamic, so it flickers too).
pub var flicker_light: ?usize = null;
pub var flicker_box: ?usize = null;

var alloc: std.mem.Allocator = undefined;

pub fn init(a: std.mem.Allocator) void {
    alloc = a;
}

/// Free the decoration lists. The tests use it: they check for leaks.
pub fn deinit() void {
    decor.clearAndFree(alloc);
    decor_bounds.clearAndFree(alloc);
}

/// Build a map. This clears the ramps, the lifts, the buttons and the
/// escalators too.
pub fn load(map: Id) void {
    id = map;
    box_count = 0;
    dropped = 0;
    ramp_count = 0;
    light_count = 0;
    spawn_count = 0;
    decor.clearRetainingCapacity();
    lift_count = 0;
    button_count = 0;
    escalator_count = 0;
    train = null;
    parked_train = null;
    shadow_centre = v3(0, 0, 0);
    shadow_half = 40;
    underground_y = -1000;
    kill_y = -5;
    sealed = no_room;
    scenery = no_room;
    flicker_light = null;
    flicker_box = null;
    @import("gates.zig").clear();
    @import("secret_room.zig").clear();
    @import("platform_display.zig").clear();
    switch (map) {
        .arena => @import("maps/arena.zig").build(),
        .earls_court => @import("maps/earls_court.zig").build(),
    }
    if (dropped > 0) std.log.err("map {s}: {d} boxes more than max_boxes ({d}). They are not in the map", .{ @tagName(map), dropped, max_boxes });
    decor_bounds.clearRetainingCapacity();
    decor_bounds.ensureTotalCapacity(alloc, decor.items.len) catch return;
    for (decor.items) |d| decor_bounds.appendAssumeCapacity(decorBounds(d));
}

// ---- Builders for the maps -------------------------------------------------

/// Add a box. When the map has max_boxes already, the box is not added:
/// `dropped` counts it, and the pointer is to a spare box.
pub fn add(min: V3, max: V3, color: V3, mat: Mat, surface: Surface) *Box {
    const b: Box = .{ .min = min, .max = max, .color = color, .mat = mat, .surface = surface };
    if (box_count >= max_boxes) {
        dropped += 1;
        overflow_box = b;
        return &overflow_box;
    }
    boxes[box_count] = b;
    box_count += 1;
    return &boxes[box_count - 1];
}

/// The index of a box that add() returned, or null for the spare box.
pub fn indexOf(b: *const Box) ?usize {
    if (b == &overflow_box) return null;
    return (@intFromPtr(b) - @intFromPtr(&boxes[0])) / @sizeOf(Box);
}

/// A collision-only box (see Box.visible). `surface`: the material of the
/// visible part (a handrail, a post).
pub fn addSolid(min: V3, max: V3, surface: Surface) void {
    const b = add(min, max, v3(0, 0, 0), .paint, surface);
    b.visible = false;
    b.ao = false;
}

pub const Rect = struct { x0: f32, x1: f32, z0: f32, z1: f32 };

/// Solid mass from y0 to y1 over the rectangle `area`, less the `holes`.
/// The holes are rooms and passages: the mass around them is their walls.
/// It sweeps along X: between two hole edges, the free Z ranges become
/// boxes.
pub fn carve(area: Rect, y0: f32, y1: f32, holes: []const Rect, color: V3, mat: Mat, surface: Surface) void {
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
            if (r[0] > z + 1e-4) _ = add(v3(xa, y0, z), v3(xb, y1, r[0]), color, mat, surface);
            z = @max(z, r[1]);
        }
        if (area.z1 > z + 1e-4) _ = add(v3(xa, y0, z), v3(xb, y1, area.z1), color, mat, surface);
    }
}

/// A box from its centre on the floor (x, z), its size and its base height.
pub fn put(x: f32, z: f32, sx: f32, sy: f32, sz: f32, y0: f32, color: V3, mat: Mat, surface: Surface) *Box {
    return add(v3(x - sx / 2, y0, z - sz / 2), v3(x + sx / 2, y0 + sy, z + sz / 2), color, mat, surface);
}

pub fn addDecor(m: Mat4, min: V3, max: V3, color: V3, mat: Mat, surface: Surface) void {
    decor.append(alloc, .{ .m = m, .min = min, .max = max, .color = color, .mat = mat, .surface = surface }) catch {};
}

pub fn addDisc(m: Mat4, r: f32, t: f32, color: V3, mat: Mat, surface: Surface) void {
    decor.append(alloc, .{ .m = m, .min = v3(r, t, 0), .max = v3(0, 0, 0), .color = color, .mat = mat, .surface = surface, .disc = true }) catch {};
}

/// A decoration beam from a to b, w wide and h high. `up` turns the cross
/// section.
pub fn beam(a: V3, b: V3, w: f32, h: f32, up: V3, color: V3, mat: Mat, surface: Surface) void {
    const d = b - a;
    const l = vec.len(d);
    if (l < 1e-4) return;
    const f = d / vec.s(l);
    const r = vec.norm(vec.cross(f, up));
    const u = vec.cross(r, f);
    const m = Mat4{ .data = .{ r[0], r[1], r[2], 0, u[0], u[1], u[2], 0, f[0], f[1], f[2], 0, a[0], a[1], a[2], 1 } };
    addDecor(m, v3(-w / 2, -h / 2, 0), v3(w / 2, h / 2, l), color, mat, surface);
}

/// A decoration slab: the parallelepiped from the corner `o` along the
/// edges ex, ey and ez. With ex along a slope and ey vertical, it is a
/// sloped bar whose ends are vertical: a balustrade panel or a stringer.
pub fn slab(o: V3, ex: V3, ey: V3, ez: V3, color: V3, mat: Mat, surface: Surface) void {
    const m = Mat4{ .data = .{ ex[0], ex[1], ex[2], 0, ey[0], ey[1], ey[2], 0, ez[0], ez[1], ez[2], 0, o[0], o[1], o[2], 1 } };
    addDecor(m, v3(0, 0, 0), v3(1, 1, 1), color, mat, surface);
}

/// A decoration rod from a to b of radius r: a cylinder segment (a disc as
/// long as the rod). Round handrails, posts and lamp columns.
pub fn rod(a: V3, b: V3, r: f32, color: V3, mat: Mat, surface: Surface) void {
    const d = b - a;
    const l = vec.len(d);
    if (l < 1e-4) return;
    const f = d / vec.s(l);
    const up = if (@abs(f[1]) > 0.9) v3(1, 0, 0) else v3(0, 1, 0);
    const rt = vec.norm(vec.cross(up, f));
    const u = vec.cross(f, rt);
    const c = (a + b) * vec.s(0.5);
    const m = Mat4{ .data = .{ rt[0], rt[1], rt[2], 0, u[0], u[1], u[2], 0, f[0], f[1], f[2], 0, c[0], c[1], c[2], 1 } };
    addDisc(m, r, l, color, mat, surface);
}

/// The points of a path through `p` with a bend of radius `bend` at each
/// inner corner: a quadratic curve of `n` parts. The bends must not
/// overlap: give each corner room on both sides. Writes the points to
/// `out` and returns them.
pub fn bendPath(p: []const V3, bend: f32, n: usize, out: []V3) []V3 {
    std.debug.assert(p.len >= 2 and out.len >= p.len * (n + 1));
    var k: usize = 0;
    out[k] = p[0];
    k += 1;
    for (1..p.len - 1) |i| {
        const d1 = vec.norm(p[i] - p[i - 1]);
        const d2 = vec.norm(p[i + 1] - p[i]);
        const turn = std.math.acos(std.math.clamp(vec.dot(d1, d2), -1, 1));
        const t = bend * @tan(turn / 2);
        if (t < 1e-4) {
            out[k] = p[i];
            k += 1;
            continue;
        }
        const s0 = p[i] - d1 * vec.s(t);
        const s1 = p[i] + d2 * vec.s(t);
        for (0..n + 1) |j| {
            const u: f32 = @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(n));
            out[k] = s0 * vec.s((1 - u) * (1 - u)) + p[i] * vec.s(2 * (1 - u) * u) + s1 * vec.s(u * u);
            k += 1;
        }
    }
    out[k] = p[p.len - 1];
    k += 1;
    return out[0..k];
}

/// A round rail of radius r through the points `p`, with a bend of
/// radius `bend` at each inner corner (bendPath).
pub fn rail(p: []const V3, r: f32, bend: f32, color: V3, mat: Mat, surface: Surface) void {
    var buf: [64]V3 = undefined;
    const q = bendPath(p, bend, 6, &buf);
    for (1..q.len) |i| rod(q[i - 1], q[i], r, color, mat, surface);
}

/// The world bounds (AABB) of a decoration.
pub fn decorBounds(d: Decor) [2]V3 {
    var mn = v3(1e9, 1e9, 1e9);
    var mx = v3(-1e9, -1e9, -1e9);
    const lo = if (d.disc) v3(-d.min[0], -d.min[0], -d.min[1] / 2) else d.min;
    const hi = if (d.disc) v3(d.min[0], d.min[0], d.min[1] / 2) else d.max;
    for (0..8) |i| {
        const p = vec.xform(d.m, v3(
            if (i & 1 != 0) hi[0] else lo[0],
            if (i & 2 != 0) hi[1] else lo[1],
            if (i & 4 != 0) hi[2] else lo[2],
        ));
        mn = @min(mn, p);
        mx = @max(mx, p);
    }
    return .{ mn, mx };
}

/// True when the point p is inside a decoration, or within `tol` m of it,
/// in the frame of the decoration.
pub fn insideDecor(d: Decor, p: V3, tol: f32) bool {
    const m = d.m.data;
    const c0 = v3(m[0], m[1], m[2]);
    const c1 = v3(m[4], m[5], m[6]);
    const c2 = v3(m[8], m[9], m[10]);
    const det = vec.dot(c0, vec.cross(c1, c2));
    if (@abs(det) < 1e-9) return false;
    const q = p - v3(m[12], m[13], m[14]);
    const l = v3(vec.dot(vec.cross(c1, c2), q), vec.dot(vec.cross(c2, c0), q), vec.dot(vec.cross(c0, c1), q)) / vec.s(det);
    if (d.disc) {
        const r = d.min[0] + tol;
        return l[0] * l[0] + l[1] * l[1] < r * r and @abs(l[2]) < d.min[1] / 2 + tol;
    }
    return @reduce(.And, l > d.min - vec.s(tol)) and @reduce(.And, l < d.max + vec.s(tol));
}

/// The surface material at a hit point p on box `bi`: the material of the
/// smallest decoration within 3 cm of p (a sleeper on the ballast, a
/// window on a train, a poster on a wall), else the material of the box.
pub fn surfaceAt(p: V3, bi: usize) Surface {
    const tol: f32 = 0.03;
    var best: ?usize = null;
    var best_size: f32 = std.math.inf(f32);
    for (decor_bounds.items, 0..) |bb, i| {
        if (@reduce(.Or, p < bb[0] - vec.s(tol)) or @reduce(.Or, p > bb[1] + vec.s(tol))) continue;
        const d = decor.items[i];
        if (!insideDecor(d, p, tol)) continue;
        const e = bb[1] - bb[0];
        const size = e[0] + e[1] + e[2];
        if (size < best_size) {
            best_size = size;
            best = i;
        }
    }
    if (best) |i| return decor.items[i].surface;
    return boxes[bi].surface;
}

/// True when a surface material fits the look (the render material) of a
/// box or a decoration. The floorplan audit and `zig build test` check
/// every surface of every map with it, so a typo in a map shows.
pub fn surfaceFits(look: Mat, s: Surface) bool {
    if (s == .flesh) return false;
    return switch (look) {
        .emissive, .led => s == .glass,
        .tread => s == .metal,
        .wood => s == .wood,
        .brick => s == .brick,
        .wall_tile, .terracotta => s == .tile,
        .cloth => s == .fabric,
        .tile => s == .tile or s == .concrete,
        .concrete => switch (s) {
            .concrete, .ballast, .earth, .plaster, .tile, .glass => true,
            else => false,
        },
        .metal => s == .metal or s == .sheet_metal or s == .glass,
        .steel => s == .metal or s == .sheet_metal,
        .paint => true,
    };
}

/// A map light. It does not move, so it gets a shadow map: walls stop its
/// light.
pub fn addLight(pos: V3, color: V3, radius: f32) void {
    if (light_count >= max_lights) return;
    lights[light_count] = .{ .pos = pos, .color = color, .radius = radius, .shadow = @intCast(light_count + 1) };
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
    /// The landing door halves, [level][half] (dynamic, collision only).
    door_box: [2][2]usize,
    /// The closed bounds of each landing door half, [level][half][min,
    /// max]. A half is two leaves (see doorLeaves).
    door_closed: [2][2][2]V3,
    /// The cab door halves, [half] (dynamic, collision only). They ride
    /// with the cab.
    cab_door_box: [2]usize,
    /// The closed bounds of each cab door half, [half][min, max]. Y is from
    /// the cab floor.
    cab_door_closed: [2][2]V3,
    y: f32,
    level: usize = 0, // the level the cab is at, or goes to
    door: f32 = 0, // 0 closed, 1 open
    phase: Phase = .idle,
    hold: f32 = 0,
    pending: ?usize = null,
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
    // The cab doors and the landing doors of the level where the cab
    // stands open together. The other landing doors stay shut.
    const ax: usize = if (l.door_on_x) 2 else 0;
    for (0..2) |lv| {
        for (0..2) |half| {
            const u = doorUnion(l.door_closed[lv][half], ax, half, landingOpen(l, lv));
            boxes[l.door_box[lv][half]].min = u[0];
            boxes[l.door_box[lv][half]].max = u[1];
        }
    }
    for (0..2) |half| {
        const u = doorUnion(cabDoorClosed(l, half), ax, half, cabOpen(l));
        boxes[l.cab_door_box[half]].min = u[0];
        boxes[l.cab_door_box[half]].max = u[1];
    }
}

/// How far the landing doors of level `lv` are open, 0 to 1. Only the
/// doors of the level where the cab stands open.
pub fn landingOpen(l: *const Lift, lv: usize) f32 {
    return if (@abs(l.y - l.levels[lv]) < 0.05) l.door else 0;
}

/// How far the cab doors are open, 0 to 1: the same as the landing doors
/// of the level where the cab stands.
pub fn cabOpen(l: *const Lift) f32 {
    return @max(landingOpen(l, 0), landingOpen(l, 1));
}

/// The closed bounds of cab door half `half`, at the cab now.
pub fn cabDoorClosed(l: *const Lift, half: usize) [2]V3 {
    const c = l.cab_door_closed[half];
    return .{ c[0] + v3(0, l.y, 0), c[1] + v3(0, l.y, 0) };
}

// A lift door is a two-speed door. Each half has two leaves on two
// layers. A leaf is half the width of the half, plus a small overlap with
// the other leaf. To open, the fast leaf moves the full width of the half,
// and the slow leaf moves the width of one leaf. Open, the two leaves
// stand one behind the other, beside the opening, in a pocket one leaf
// wide. Thus each pocket is half the width of the opening, and the doors
// stay inside the shaft.

/// The overlap of the two leaves of a closed half, along the doors.
const leaf_overlap: f32 = 0.02;
/// The gap between the two layers of leaves.
const leaf_gap: f32 = 0.005;

/// The two leaves of a door half, [slow, fast][min, max].
/// - closed: the bounds of the closed half (both leaves).
/// - ax: the axis along the doors (0 X, 2 Z). Half 0 opens toward -ax,
///   half 1 toward +ax.
/// - open: 0 closed, 1 open.
/// - slow_low: the slow leaf is on the layer at the low end of the other
///   axis.
pub fn doorLeaves(closed: [2]V3, ax: usize, half: usize, open: f32, slow_low: bool) [2][2]V3 {
    const dir: f32 = if (half == 0) -1 else 1;
    // The outer edge (at the jamb) and the inner edge (at the middle).
    const edge = if (half == 0) comp(closed[0], ax) else comp(closed[1], ax);
    const middle = if (half == 0) comp(closed[1], ax) else comp(closed[0], ax);
    const w = @abs(middle - edge);
    const leaf = w / 2 + leaf_overlap / 2;
    const u = vec.smooth(open);
    // The edge of each leaf that is nearer the middle of the doors.
    const slow_in = edge + dir * leaf * u - dir * leaf;
    const fast_in = middle + dir * w * u;
    const bx: usize = if (ax == 0) 2 else 0;
    const b0 = comp(closed[0], bx);
    const b1 = comp(closed[1], bx);
    const bm = (b0 + b1) / 2;
    const low = [2]f32{ b0, bm - leaf_gap / 2 };
    const high = [2]f32{ bm + leaf_gap / 2, b1 };
    const slow_b = if (slow_low) low else high;
    const fast_b = if (slow_low) high else low;
    return .{
        leafBox(closed, ax, slow_in, slow_in + dir * leaf, slow_b),
        leafBox(closed, ax, fast_in, fast_in + dir * leaf, fast_b),
    };
}

/// The bounds of both leaves of a door half: the collision box.
pub fn doorUnion(closed: [2]V3, ax: usize, half: usize, open: f32) [2]V3 {
    const lv = doorLeaves(closed, ax, half, open, true);
    return .{ @min(lv[0][0], lv[1][0]), @max(lv[0][1], lv[1][1]) };
}

/// A box with the y of `closed`, a1 and a2 along ax, and b along the
/// other horizontal axis.
fn leafBox(closed: [2]V3, ax: usize, a1: f32, a2: f32, b: [2]f32) [2]V3 {
    const lo = @min(a1, a2);
    const hi = @max(a1, a2);
    return if (ax == 0)
        .{ v3(lo, closed[0][1], b[0]), v3(hi, closed[1][1], b[1]) }
    else
        .{ v3(b[0], closed[0][1], lo), v3(b[1], closed[1][1], hi) };
}

// ---- The deep-level train ------------------------------------------------------
//
// A train runs through the deep platform on a fixed timetable. The server
// sends its clock (the time in the cycle), so all the clients agree.
// server/index.ts has the same cycle length.
//
// The train is a hollow car body (train_car.zig): dynamic boxes (parts)
// that keep their places relative to the train centre. A player inside the
// body moves with it (trainInside and the moving platforms below), also in
// the air. A doorway part is solid while the doors are less than half
// open. trainPush moves a player out of a closed doorway, and off the
// track in front of the train.

pub const max_train_parts = 80;

pub const TrainPart = struct {
    box: usize,
    /// The bounds with the train centre at x = 0.
    min: V3,
    max: V3,
    kind: train_car.Kind,
};

pub const Train = struct {
    /// The body in train coordinates (its z and y are the world z and y).
    body: train_car.Body,
    parts: [max_train_parts]TrainPart = undefined,
    part_count: usize = 0,
    /// The floor part: a rider inside the body rides on it.
    floor: usize = 0,
    /// A part was not added (a full map, map.dropped). The map then has no
    /// train.
    full: bool = false,
    /// The centre of the train where it stops at the platform.
    stop_x: f32,
    /// Seconds into the cycle.
    t: f32 = 0,

    pub fn centre(self: *const Train) f32 {
        return self.stop_x + trainX(self.t);
    }

    /// Add a part: the sink of train_car.parts.
    pub fn part(self: *Train, min: V3, max: V3, kind: train_car.Kind, color: V3, mat: Mat, surface: Surface) void {
        const b = add(min, max, color, mat, surface);
        b.dynamic = true;
        b.ao = false;
        // The details of main.zig draw the door leaves, the roof and the
        // ends.
        if (kind == .doorway or kind == .cover) b.visible = false;
        const i = indexOf(b) orelse {
            self.full = true;
            return;
        };
        if (self.part_count >= max_train_parts) {
            self.full = true;
            return;
        }
        if (self.part_count == 0) self.floor = i;
        self.parts[self.part_count] = .{ .box = i, .min = min, .max = max, .kind = kind };
        self.part_count += 1;
    }
};

pub var train: ?Train = null;
/// A train that stands in the map with its doors open (the District line
/// train of Earl's Court): static boxes. main.zig lights its inside.
pub var parked_train: ?train_car.Body = null;

/// Make the train of the map from a body, at its place at t = 0. A full
/// map gets no train.
pub fn addTrain(body: train_car.Body, stop_x: f32) void {
    var tr: Train = .{ .body = body, .stop_x = stop_x };
    train_car.parts(&tr.body, &tr);
    if (tr.full) return;
    train = tr;
    placeTrain(&train.?);
}

// The timetable of the train: the centre offset from the stop position
// on X. The train runs to -X. It comes in from the east tunnel at line
// speed, brakes into the platform, waits with its doors open, pulls out,
// runs at line speed and brakes to a stop far down the west tunnel. There
// it waits out of sight. At the end of the cycle it jumps to the east
// tunnel, and a rider jumps with it.
pub const train_cycle: f32 = 80;
/// The speed in and out of the station, m/s, and the braking time from it.
pub const train_line_speed: f32 = 16;
pub const train_brake_t: f32 = 14;
/// The braking distance: 112 m.
const brake_d: f32 = train_line_speed * train_brake_t / 2;
/// The times of the cycle: the brakes go on, the train stops, the train
/// pulls out, it reaches line speed, the brakes go on, it stops.
pub const train_brake_in: f32 = 6;
pub const train_stop: f32 = train_brake_in + train_brake_t;
pub const train_depart: f32 = 42;
pub const train_full_speed: f32 = train_depart + train_brake_t;
pub const train_brake_out: f32 = train_full_speed + 6;
pub const train_parked: f32 = train_brake_out + train_brake_t;

/// The centre offset of the train from its stop position at a time in the
/// cycle.
pub fn trainX(t: f32) f32 {
    const v = train_line_speed;
    if (t < train_brake_in) return brake_d + v * (train_brake_in - t);
    if (t < train_stop) {
        const k = 1 - (t - train_brake_in) / train_brake_t;
        return brake_d * k * k;
    }
    if (t < train_depart) return 0;
    if (t < train_full_speed) {
        const k = (t - train_depart) / train_brake_t;
        return -brake_d * k * k;
    }
    if (t < train_brake_out) return -brake_d - v * (t - train_full_speed);
    const far = brake_d + v * (train_brake_out - train_full_speed);
    if (t < train_parked) {
        const k = (t - train_brake_out) / train_brake_t;
        return -far - brake_d * (2 * k - k * k);
    }
    return -far - brake_d;
}

/// The door times of the cycle. The sound of the doors (train_sound.zig,
/// src/tube.ts, utils/tube-sounds) starts at these times, and the doors
/// move with it:
/// - train_doors_open: the doors open, 1 s after the stop.
/// - train_doors_warn: the door warning beeps start. The doors close
///   `train_door_warning` s later, and are shut 2.2 s before the train
///   pulls out.
pub const train_doors_open: f32 = train_stop + 1;
pub const train_doors_warn: f32 = train_depart - 6;
pub const train_door_warning: f32 = 2;
/// The delay from a door command to the start of the leaf movement in the
/// sound, s: the schedule lead of tube.ts (0.05), the mean random delay
/// of a car (train.ts doorsOpen 0.12 / 2, doorsClose 0.1 / 2) and of a
/// door (0.15 / 2, 0.18 / 2), and the valve lead of the 1973 Stock door
/// engine (core/synth.ts VALVE_LEAD 0.08).
const door_lead_open: f32 = 0.05 + 0.06 + 0.075 + 0.08;
const door_lead_close: f32 = 0.05 + 0.05 + 0.09 + 0.08;
/// The leaf travel times of the pneumatic doors, s (core/synth.ts
/// DOOR_TRAVEL.pneumatic).
const door_travel_open: f32 = 1.26;
const door_travel_close: f32 = 1.5;

/// The movement of a door leaf along its travel, 0 to 1: the integral of
/// the speed curve of the slide sound (core/synth.ts doorSlide), which
/// starts slowly, runs, and slows to the stop.
fn doorTravel(u: f32) f32 {
    return (1 - @cos(std.math.pi * vec.clamp01(u))) / 2;
}

/// The doors: 0 closed, 1 open.
pub fn trainDoors(t: f32) f32 {
    const o = doorTravel((t - train_doors_open - door_lead_open) / door_travel_open);
    const c = doorTravel((t - train_doors_warn - train_door_warning - door_lead_close) / door_travel_close);
    return o * (1 - c);
}

pub fn stepTrain(dt: f32) void {
    if (train) |*tr| {
        tr.t = @mod(tr.t + dt, train_cycle);
        placeTrain(tr);
    }
}

/// Follow the server's train clock.
pub fn syncTrain(t: f32) void {
    if (train) |*tr| {
        var d = t - tr.t;
        if (d > train_cycle / 2) d -= train_cycle;
        if (d < -train_cycle / 2) d += train_cycle;
        if (@abs(d) > 0.5) tr.t = t else tr.t = @mod(tr.t + d * 0.1, train_cycle);
        placeTrain(tr);
    }
}

fn placeTrain(tr: *Train) void {
    const off = v3(tr.centre(), 0, 0);
    const closed = trainDoors(tr.t) < 0.5;
    for (tr.parts[0..tr.part_count]) |p| {
        const b = &boxes[p.box];
        b.min = p.min + off;
        b.max = p.max + off;
        if (p.kind == .doorway) b.solid = closed;
    }
}

/// True when box `b` is a part of the train.
pub fn trainPartOf(b: usize) bool {
    const tr = if (train) |*t| t else return false;
    for (tr.parts[0..tr.part_count]) |p| if (p.box == b) return true;
    return false;
}

/// A rider inside the train body: the floor of the train as the platform
/// of feet inside the body (from the floor to the ceiling, between the
/// walls and the cab ends), also in the air. So a player who jumps in a
/// moving train comes down at the same place in the car. Null when the
/// feet are not inside.
pub fn trainInside(feet: V3) ?Platform {
    const tr = if (train) |*t| t else return null;
    const b = &tr.body;
    if (@abs(feet[0] - tr.centre()) >= b.half_len - b.stock.cab) return null;
    if (feet[2] <= b.innerZ0() or feet[2] >= b.innerZ1()) return null;
    if (feet[1] < b.floor_y - platform_reach or feet[1] > b.ceil_y) return null;
    const fb = boxes[tr.floor];
    return .{ .box = tr.floor, .min = fb.min, .feet = feet, .above = @max(0, feet[1] - fb.max[1]) };
}

pub const Push = struct {
    /// The new feet.
    feet: V3,
    /// The train hit the player (not a door).
    hit: bool,
};

/// A train part in the body of a player at `feet` (radius r, height h):
/// where the player must go, or null.
/// - A closed doorway: out of it, to the nearer side (into the car or onto
///   the platform), so a closing door does not trap a player.
/// - Any other part: the train hit a player on the track. The player goes
///   onto the platform at the open side, at platform height.
pub fn trainPush(feet: V3, r: f32, h: f32) ?Push {
    const tr = if (train) |*t| t else return null;
    const lo = feet - v3(r, 0, r);
    const hi = feet + v3(r, h, r);
    for (tr.parts[0..tr.part_count]) |p| {
        const b = boxes[p.box];
        if (!b.solid) continue;
        if (lo[0] >= b.max[0] or hi[0] <= b.min[0] or lo[1] >= b.max[1] or hi[1] <= b.min[1] or lo[2] >= b.max[2] or hi[2] <= b.min[2]) continue;
        if (p.kind == .doorway) {
            const mid = (b.min[2] + b.max[2]) / 2;
            const z = if (feet[2] < mid) b.min[2] - r - 0.01 else b.max[2] + r + 0.01;
            return .{ .feet = v3(feet[0], feet[1], z), .hit = false };
        }
        const bd = &tr.body;
        const z = if (bd.side > 0) bd.z1 + r + 0.05 else bd.z0 - r - 0.05;
        return .{ .feet = v3(feet[0], @max(feet[1], bd.floor_y - 0.02), z), .hit = true };
    }
    return null;
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

// ---- Ramps ----------------------------------------------------------------
//
// A ramp is an invisible slope over a staircase or an escalator. Its
// surface goes through the front edges of the steps, so it is on or above
// each tread. The player stands on the ramp, not on the steps: the feet,
// and the camera, move up and down in a straight line, with no jump at each
// step. Only the collision uses ramps (overlaps, floorTop). Hit scan and
// the grenades use the steps under them.

/// The surface rises in a straight line along X, from y0 at x0 to y1 at x1
/// (x0 < x1). The solid fills from `bottom` up to the surface.
pub const Ramp = struct { x0: f32, x1: f32, z0: f32, z1: f32, y0: f32, y1: f32, bottom: f32 };

pub var ramps: [16]Ramp = undefined;
pub var ramp_count: usize = 0;

pub fn addRamp(r: Ramp) void {
    if (ramp_count >= ramps.len) {
        std.log.warn("map: more than {d} ramps", .{ramps.len});
        return;
    }
    ramps[ramp_count] = r;
    ramp_count += 1;
}

/// The highest point of the ramp surface between x = a and x = b.
pub fn rampTop(r: Ramp, a: f32, b: f32) f32 {
    const x = if (r.y1 > r.y0) @min(b, r.x1) else @max(a, r.x0);
    return r.y0 + (r.y1 - r.y0) * (x - r.x0) / (r.x1 - r.x0);
}

fn rampUnder(r: Ramp, min: V3, max: V3) bool {
    return min[0] < r.x1 and max[0] > r.x0 and min[2] < r.z1 and max[2] > r.z0;
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

/// True when an AABB overlaps a solid box or a ramp.
pub fn overlaps(min: V3, max: V3) bool {
    for (boxes[0..box_count]) |b| {
        if (!b.solid) continue;
        if (min[0] < b.max[0] and max[0] > b.min[0] and
            min[1] < b.max[1] and max[1] > b.min[1] and
            min[2] < b.max[2] and max[2] > b.min[2]) return true;
    }
    for (ramps[0..ramp_count]) |r| {
        if (rampUnder(r, min, max) and max[1] > r.bottom and min[1] < rampTop(r, min[0], max[0])) return true;
    }
    return false;
}

/// The highest floor under the AABB: the top of a solid box, or of a ramp,
/// that is under min..max in X and Z and from min[1] to max[1] in height.
/// Null when there is none.
pub fn floorTop(min: V3, max: V3) ?f32 {
    var best: ?f32 = null;
    for (boxes[0..box_count]) |b| {
        if (!b.solid) continue;
        if (min[0] < b.max[0] and max[0] > b.min[0] and min[2] < b.max[2] and max[2] > b.min[2] and
            b.max[1] >= min[1] and b.max[1] <= max[1]) best = @max(best orelse b.max[1], b.max[1]);
    }
    for (ramps[0..ramp_count]) |r| {
        if (!rampUnder(r, min, max)) continue;
        const t = rampTop(r, min[0], max[0]);
        if (t >= min[1] and t <= max[1]) best = @max(best orelse t, t);
    }
    return best;
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

// ---- Moving platforms ---------------------------------------------------------
//
// A moving platform is a dynamic solid box that a player stands on: a lift
// cab floor, the deep train. A player on it moves with it, in each tick:
//   1. Before anything moves, platformUnder finds the box under the feet
//      and keeps its position. Inside the deep train, trainInside gives
//      the train floor when no box is under the feet (a jump in the car).
//   2. The boxes move: the server corrections (syncLift), stepLifts,
//      stepTrain.
//   3. player.Player.ride moves the player by the move of that box. The
//      feet keep their height above its top.
// So a rider follows every move of the box, at any speed, and a server
// correction too. A new moving thing needs no new code: it is a dynamic
// solid box, and the three calls carry its riders.

/// A player on a moving box: the box and its position before the move, the
/// feet, and the height of the feet above its top.
pub const Platform = struct { box: usize, min: V3, feet: V3, above: f32 };

/// The feet are on a platform when they are this near its top.
pub const platform_reach: f32 = 0.12;

/// The moving platform under the feet, or null: the highest dynamic solid
/// box under the feet centre whose top is within platform_reach of the
/// feet. The centre must be over the box, so a player on a landing does
/// not go down with a cab that the body only touches.
pub fn platformUnder(feet: V3) ?Platform {
    var best: ?Platform = null;
    for (boxes[0..box_count], 0..) |b, i| {
        if (!b.dynamic or !b.solid) continue;
        if (feet[0] <= b.min[0] or feet[0] >= b.max[0] or feet[2] <= b.min[2] or feet[2] >= b.max[2]) continue;
        if (@abs(feet[1] - b.max[1]) > platform_reach) continue;
        if (best) |p| if (boxes[p.box].max[1] >= b.max[1]) continue;
        best = .{ .box = i, .min = b.min, .feet = feet, .above = @max(0, feet[1] - b.max[1]) };
    }
    return best;
}

/// The move of the box of a platform since platformUnder found it.
pub fn platformMove(p: Platform) V3 {
    return boxes[p.box].min - p.min;
}

/// The lift whose cab floor is box `b`, or null.
pub fn liftOfBox(b: usize) ?usize {
    for (lifts[0..lift_count], 0..) |l, i| if (l.floor_box == b) return i;
    return null;
}

/// The top of the cab floor of lift `i` when the feet are over it, or
/// null. In deathmatch, another player in a cab stands on this client's
/// cab.
pub fn cabFloorAt(i: usize, feet: V3) ?f32 {
    if (i >= lift_count) return null;
    const b = boxes[lifts[i].floor_box];
    if (feet[0] <= b.min[0] or feet[0] >= b.max[0] or feet[2] <= b.min[2] or feet[2] >= b.max[2]) return null;
    return b.max[1];
}
