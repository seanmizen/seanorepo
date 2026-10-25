// The secret room of VAPES N MORE (maps/earls_court.zig vapeShop and
// secretRoom).
//
// - One section of the back shelf is a door. Nothing shows it: its packs
//   and its lit shelf edges are the same as the rest of the shelf. One
//   pack on it is GET MORE. Aim at it and press F (GET MORE).
// - The door section pushes back through the wall, then slides aside. An
//   angelic choir sings (audio/choir.zig), and the lights of the room come
//   up with the door.
// - In the room a golden pigeon turns over a plinth, under a shaft of light
//   from the ceiling. Aim at it and press F (MORE): the player gets a blessing
//   for bless_time s. A halo of white pigeons circles the head, the player
//   shines gold, moves faster, and the aim locks on the head of the enemy
//   nearest the middle of the screen (Aim, main.zig autoAim). The camera
//   stays with the mouse. The crosshair, the gun and the shots go to the
//   head, with a glide of aim_glide s. F still picks along the camera
//   forward. The guns have no spread. A death ends it.
// - The door stays open until the map loads again or a new match starts.
// - Deathmatch: the door is the same on each client. The client that opens
//   it sends {t:"more", k:"open"}, and the server sends it to the other
//   players. A player who joins later gets k "now": the door is open, with
//   no choir. A blessing goes the same way (k "bless"), so the other
//   players see the halo and the shine.
//
// The door is a dynamic box (map.zig): collision only. build draws it
// and its packs at the place of the box.
const std = @import("std");
const vec = @import("vec.zig");
const map = @import("map.zig");
const mesh = @import("mesh.zig");
const pigeons = @import("pigeons.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;

/// The door pushes back `push` m into the room in `push_time` s, then
/// slides `slide` m along +Z.
pub const push: f32 = 0.8;
pub const push_time: f32 = 1.1;
pub const slide_from: f32 = 1.3;
pub const slide_time: f32 = 2.2;
/// The lights of the room come up over this time from the press.
pub const glow_time: f32 = 3.8;
/// The blessing of MORE: its length in s, and the walk speed factor.
pub const bless_time: f32 = 45;
pub const bless_speed: f32 = 1.5;
/// The aim locks on a head within this angle of the middle of the screen.
pub const aim_cone: f32 = 0.6;
/// The aim glides to a new target, and back to the middle, in this time.
pub const aim_glide: f32 = 0.1;
/// The use reach to the GET MORE pack and to the golden pigeon.
pub const reach: f32 = 2.6;
const pad: f32 = 0.03;

/// A pack on the door: its closed bounds and colour. `mat` is the mesh
/// material (4 for the lit shelf edges).
pub const Part = struct { min: V3, max: V3, color: V3, mat: f32 };

var parts: [64]Part = undefined;
var part_n: usize = 0;
/// The door box (map.boxes), its closed bounds, and the slide.
var door_box: ?usize = null;
var closed: [2]V3 = undefined;
var slide: f32 = 1.35;
/// The GET MORE pack (an index in parts).
var more_part: ?usize = null;
/// The plinth: the top centre, where the golden pigeon floats.
var plinth_top: ?V3 = null;
/// The shaft of light: from the ceiling to the plinth, its radius at the
/// top and at the bottom.
var shaft_top: V3 = undefined;
var shaft_bottom: V3 = undefined;
var shaft_r = [2]f32{ 0.9, 1.25 };
/// The room lights (map.lights): they come up with the door.
var light_first: usize = 0;
var light_n: usize = 0;

/// The seconds since the door started to open, or null while it is shut.
pub var since: ?f32 = null;
/// The seconds of blessing left for this player, or null.
pub var blessed: ?f32 = null;
/// The time of the scene, for the float and the turn of the vape.
var clock: f32 = 0;

/// The map has no secret room (map.load calls it before the build).
pub fn clear() void {
    part_n = 0;
    door_box = null;
    more_part = null;
    plinth_top = null;
    light_n = 0;
    since = null;
    blessed = null;
}

/// The door: a dynamic box at `min`..`max` that slides `slide_len` m along
/// +Z after its push.
pub fn addDoor(min: V3, max: V3, slide_len: f32) void {
    const b = map.add(min, max, v3(0.02, 0.02, 0.025), .paint, .wood);
    b.dynamic = true;
    b.visible = false;
    door_box = map.indexOf(b);
    closed = .{ min, max };
    slide = slide_len;
}

/// A part of the door, at its closed place. `more`: the GET MORE pack.
pub fn addPart(min: V3, max: V3, color: V3, mat: f32, more: bool) void {
    if (part_n == parts.len) return;
    parts[part_n] = .{ .min = min, .max = max, .color = color, .mat = mat };
    if (more) more_part = part_n;
    part_n += 1;
}

pub fn setPlinth(top: V3) void {
    plinth_top = top;
}

pub fn setShaft(top: V3, bottom: V3, r_top: f32, r_bottom: f32) void {
    shaft_top = top;
    shaft_bottom = bottom;
    shaft_r = .{ r_top, r_bottom };
}

/// The lights from map.lights[first] to [first + n - 1] are the room
/// lights.
pub fn setLights(first: usize, n: usize) void {
    light_first = first;
    light_n = n;
}

/// The offset of the door from its closed place.
fn offset() V3 {
    const t = since orelse return v3(0, 0, 0);
    return v3(push * vec.smooth(t / push_time), 0, slide * vec.smooth((t - slide_from) / slide_time));
}

/// The middle of the shut door: the choir comes from here.
pub fn doorCentre() V3 {
    return (closed[0] + closed[1]) * vec.s(0.5);
}

pub fn isOpen() bool {
    return since != null;
}

/// Start to open the door. False if it is open already, or if the map has
/// no door.
pub fn open() bool {
    if (door_box == null or since != null) return false;
    since = 0;
    return true;
}

/// Open the door at once, with no motion (a join after the door opened).
pub fn openNow() void {
    if (door_box == null) return;
    since = slide_from + slide_time + glow_time;
    place();
}

/// Shut the door at once (a new match).
pub fn shut() void {
    since = null;
    place();
}

fn place() void {
    const bi = door_box orelse return;
    const off = offset();
    map.boxes[bi].min = closed[0] + off;
    map.boxes[bi].max = closed[1] + off;
}

pub fn step(dt: f32) void {
    clock += dt;
    if (since) |t| since = t + dt;
    if (blessed) |b| blessed = if (b - dt > 0) b - dt else null;
    place();
}

/// MORE: bless this player for bless_time s.
pub fn bless() void {
    blessed = bless_time;
}

/// A head that the aim of a blessing can lock on: the player id and the
/// centre of the head.
pub const Head = struct { id: u32, pos: V3 };

/// The aim of a blessing: a direction apart from the camera. The camera
/// stays with the mouse. The crosshair, the gun and the shots go along the
/// aim. With no target, the aim is the camera forward.
pub const Aim = struct {
    /// The id of the target, or null: the aim goes to the camera forward.
    id: ?u32 = null,
    /// The head of the target. It stays after the target goes, for the
    /// glide back.
    head: V3 = .{ 0, 0, 0 },
    /// The start of the glide, in camera space (-Z is forward).
    from: V3 = .{ 0, 0, -1 },
    /// The glide from `from` to the target: 0 to 1 in aim_glide s.
    t: f32 = 1,

    /// The camera space axes of a yaw and pitch, in world space: right, up,
    /// back (+Z).
    fn axes(yaw: f32, pitch: f32) [3]V3 {
        const r = Mat4.rotationY(yaw).mul(Mat4.rotationX(pitch));
        return .{ vec.xdir(r, v3(1, 0, 0)), vec.xdir(r, v3(0, 1, 0)), vec.xdir(r, v3(0, 0, 1)) };
    }

    /// True when the aim is the camera forward.
    pub fn idle(self: *const Aim) bool {
        return self.id == null and self.t >= 1;
    }

    /// The aim direction from `eye` for a camera at `yaw` and `pitch`.
    pub fn dir(self: *const Aim, eye: V3, yaw: f32, pitch: f32) V3 {
        const f = vec.forward(yaw, pitch);
        if (self.idle()) return f;
        const to = if (self.id != null) vec.norm(self.head - eye) else f;
        if (self.t >= 1) return to;
        const ax = axes(yaw, pitch);
        const from = ax[0] * vec.s(self.from[0]) + ax[1] * vec.s(self.from[1]) + ax[2] * vec.s(self.from[2]);
        return vec.norm(vec.lerp(from, to, vec.smooth(self.t)));
    }

    /// The aim direction in camera space (-Z is forward).
    pub fn local(self: *const Aim, eye: V3, yaw: f32, pitch: f32) V3 {
        if (self.idle()) return v3(0, 0, -1);
        const d = self.dir(eye, yaw, pitch);
        const ax = axes(yaw, pitch);
        return v3(vec.dot(d, ax[0]), vec.dot(d, ax[1]), vec.dot(d, ax[2]));
    }

    /// The point that the aim looks at: the head, or a far point.
    pub fn point(self: *const Aim, eye: V3, yaw: f32, pitch: f32) V3 {
        const far: f32 = if (self.idle()) 30 else @max(1, vec.len(self.head - eye));
        return eye + self.dir(eye, yaw, pitch) * vec.s(far);
    }

    /// One tick. `on`: a blessing, alive. The target is the head in
    /// `heads` nearest the camera forward, within aim_cone, with no wall
    /// on the line from the eye. A change of target starts a new glide
    /// from the aim of now. Yaw and pitch do not change.
    pub fn step(self: *Aim, dt: f32, eye: V3, yaw: f32, pitch: f32, heads: []const Head, on: bool) void {
        const f = vec.forward(yaw, pitch);
        var best: ?Head = null;
        var best_a: f32 = aim_cone;
        if (on) for (heads) |h| {
            const d = h.pos - eye;
            const l = vec.len(d);
            if (l < 0.3) continue;
            const a = std.math.acos(std.math.clamp(vec.dot(f, d / vec.s(l)), -1, 1));
            if (a >= best_a) continue;
            if (map.raycast(eye, d / vec.s(l), l - 0.2) != null) continue;
            best_a = a;
            best = h;
        };
        const new_id: ?u32 = if (best) |b| b.id else null;
        if (new_id != self.id) {
            self.from = self.local(eye, yaw, pitch);
            self.t = 0;
            self.id = new_id;
        }
        if (best) |b| self.head = b.pos;
        self.t = @min(1, self.t + dt / aim_glide);
    }
};

/// The shine of a blessing with `left` s to go: 0 to 1. It comes up fast
/// and fades over the last 3 s.
pub fn shine(left: f32) f32 {
    return vec.smooth((bless_time - left) / 0.6) * vec.smooth(left / 3);
}

/// 0 to 1: the light of the room. A small swell over the top as the door
/// slides aside.
pub fn glow() f32 {
    const t = since orelse return 0;
    const up = vec.smooth((t - 0.3) / glow_time);
    const swell = 0.35 * @exp(-((t - 3.6) * (t - 3.6)) / 1.2);
    return up + swell;
}

/// True when map light i is a room light.
pub fn isRoomLight(i: usize) bool {
    return light_n > 0 and i >= light_first and i < light_first + light_n;
}

fn bounds(p: Part) [2]V3 {
    return .{ p.min - vec.s(pad), p.max + vec.s(pad) };
}

/// The nearest wall hit along the ray, or reach.
fn wallT(o: V3, d: V3, t: f32) bool {
    if (map.raycast(o, d, t)) |wall| return wall.t >= t - 0.08;
    return true;
}

/// True when the ray points at the GET MORE pack within reach, with no
/// wall nearer. Only while the door is shut.
pub fn pickGetMore(o: V3, d: V3) bool {
    if (since != null) return false;
    const i = more_part orelse return false;
    const bb = bounds(parts[i]);
    const h = map.rayBox(o, d, bb[0], bb[1]) orelse return false;
    return h.t < reach and wallT(o, d, h.t);
}

/// The bounds of the golden pigeon over the plinth top, with its float.
fn pigeonBounds(top: V3) [2]V3 {
    const c = top + v3(0, 0.2, 0);
    return .{ c - v3(0.2, 0.15, 0.2), c + v3(0.2, 0.2, 0.2) };
}

/// True when the ray points at the golden pigeon within reach. Only when
/// the door is open and this player has no blessing.
pub fn pickMore(o: V3, d: V3) bool {
    if (since == null or blessed != null) return false;
    const top = plinth_top orelse return false;
    const bb = pigeonBounds(top);
    const h = map.rayBox(o, d, bb[0], bb[1]) orelse return false;
    return h.t < reach and wallT(o, d, h.t);
}

/// The door, its packs, the golden pigeon and its halo.
pub fn build(dyn: *mesh.Mesh) void {
    if (door_box) |bi| {
        const b = map.boxes[bi];
        dyn.box(b.min, b.max, v3(0.02, 0.02, 0.025), 0);
        const off = offset();
        for (parts[0..part_n]) |p| dyn.box(p.min + off, p.max + off, p.color, p.mat);
    }
    const top = plinth_top orelse return;
    // The golden pigeon: it floats, bobs and turns, with its wings half
    // up. A gold halo floats over it.
    const bob = 0.03 * @sin(clock * 1.6);
    const c = top + v3(0, 0.2 + bob, 0);
    const m = vec.translate(c).mul(Mat4.rotationY(clock * 0.9)).mul(Mat4.scaling(1.4));
    pigeons.showModel(dyn, m, v3(1.0, 0.74, 0.24), .{ 0.5 + 0.12 * @sin(clock * 2.4), 0.25 }, 3);
    ring(dyn, c + v3(0, 0.22 + 0.01 * @sin(clock * 2.3), 0), 0.085, -clock * 0.5);
}

/// A gold ring of light, flat, of radius r at c.
fn ring(dyn: *mesh.Mesh, c: V3, r: f32, turn: f32) void {
    const halo = vec.translate(c).mul(Mat4.rotationY(turn));
    const seg = 14;
    for (0..seg) |k| {
        const a = @as(f32, @floatFromInt(k)) / seg * std.math.tau;
        const sm = halo.mul(vec.translate(v3(@cos(a) * r, 0, @sin(a) * r))).mul(Mat4.rotationY(-a));
        const half = r * std.math.pi / seg + 0.002;
        dyn.orientedBox(sm, v3(-0.006, -0.005, -half), v3(0.006, 0.005, half), v3(1.0, 0.82, 0.4), 4);
    }
}

/// The halo of a blessed player: white pigeons that fly round over the
/// head, and a gold ring. `head`: the centre of the head. `k`: the shine
/// (0 to 1). `t`: a clock. `phase` keeps two players apart.
pub fn buildHalo(dyn: *mesh.Mesh, head: V3, k: f32, t: f32, phase: f32) void {
    if (k <= 0.01) return;
    const n = 6;
    const r = 0.5 * k;
    const c = head + v3(0, 0.38, 0);
    for (0..n) |i| {
        const a = phase + t * 1.4 + @as(f32, @floatFromInt(i)) / n * std.math.tau;
        const p = c + v3(@cos(a) * r, 0.05 * @sin(t * 3 + @as(f32, @floatFromInt(i))), @sin(a) * r);
        // Forward is -Z. The pigeon flies along the tangent of the circle.
        const yaw = std.math.atan2(@sin(a), -@cos(a));
        const flap = t * 11 + @as(f32, @floatFromInt(i)) * 1.3;
        const m = vec.translate(p).mul(Mat4.rotationY(yaw)).mul(Mat4.rotationZ(0.35)).mul(Mat4.scaling(0.7 * k));
        pigeons.showModel(dyn, m, v3(0.95, 0.93, 0.88), .{ 0.2 + 0.85 * @sin(flap), 0.4 * @sin(flap - 0.6) }, 6);
    }
    ring(dyn, head + v3(0, 0.22, 0), 0.13 * k, t * 0.8);
}

/// The shine of a blessed player: a soft gold glow round the body, as
/// quads that face the camera. `feet`: the feet. `k`: the shine.
pub fn buildAura(trans: *mesh.Mesh, feet: V3, k: f32, right: V3, up: V3, t: f32) void {
    if (k <= 0.01) return;
    const tris = [6]usize{ 0, 1, 2, 0, 2, 3 };
    const uv = [4][2]f32{ .{ -1, -1 }, .{ 1, -1 }, .{ 1, 1 }, .{ -1, 1 } };
    const col = v3(1.0, 0.82, 0.45);
    // A tall glow round the body, and a bright one round the head.
    const glows = [_]struct { y: f32, w: f32, h: f32, a: f32, e: f32 }{
        .{ .y = 0.95, .w = 0.75, .h = 1.25, .a = 0.22, .e = 2.5 },
        .{ .y = 1.62, .w = 0.4, .h = 0.4, .a = 0.35, .e = 4 },
    };
    const pulse = 0.85 + 0.15 * @sin(t * 3.1);
    for (glows) |g| {
        const p = feet + v3(0, g.y, 0);
        const r = right * vec.s(g.w);
        const u = up * vec.s(g.h);
        const corners = [4]V3{ p - r - u, p + r - u, p + r + u, p - r + u };
        for (tris) |ci| trans.push(corners[ci], v3(uv[ci][0], uv[ci][1], g.e), col, -(g.a * k * pulse));
    }
}

/// The shaft of light from the ceiling and the dust in it: soft emissive
/// quads that face the camera (scene.wgsl fs_trans, a negative mat). It
/// comes up with the room lights.
pub fn buildTranslucent(trans: *mesh.Mesh, right: V3) void {
    if (plinth_top == null) return;
    const g = @min(1, glow());
    if (g <= 0.01) return;
    // Across the shaft: the camera right, flat.
    var side = v3(right[0], 0, right[2]);
    const sl = vec.len(side);
    side = if (sl > 0.01) side / vec.s(sl) else v3(1, 0, 0);
    const tris = [6]usize{ 0, 1, 2, 0, 2, 3 };
    const col = v3(1.0, 0.86, 0.62);
    const segs = 10;
    for (0..segs) |i| {
        const k0 = @as(f32, @floatFromInt(i)) / segs;
        const k1 = @as(f32, @floatFromInt(i + 1)) / segs;
        const p0 = shaft_top + (shaft_bottom - shaft_top) * vec.s(k0);
        const p1 = shaft_top + (shaft_bottom - shaft_top) * vec.s(k1);
        const r0 = shaft_r[0] + (shaft_r[1] - shaft_r[0]) * k0;
        const r1 = shaft_r[0] + (shaft_r[1] - shaft_r[0]) * k1;
        // Brightest near the ceiling, a little brighter again on the dais.
        const a0 = g * (0.16 - 0.08 * k0 + 0.03 * k0 * k0);
        const a1 = g * (0.16 - 0.08 * k1 + 0.03 * k1 * k1);
        const corners = [4]V3{ p0 - side * vec.s(r0), p0 + side * vec.s(r0), p1 + side * vec.s(r1), p1 - side * vec.s(r1) };
        const u = [4]f32{ -1, 1, 1, -1 };
        const a = [4]f32{ a0, a0, a1, a1 };
        for (tris) |ci| trans.push(corners[ci], v3(u[ci], 0, 2.2), col, -a[ci]);
    }
    // Dust that turns slowly in the light.
    const up = v3(0, 1, 0);
    const motes = 36;
    const h = shaft_top[1] - shaft_bottom[1];
    for (0..motes) |i| {
        const fi: u32 = @intCast(i);
        const ang = vec.hash(fi * 31 + 7) * std.math.tau + clock * (0.05 + 0.1 * vec.hash(fi * 17 + 3));
        const rr = shaft_r[1] * 0.8 * @sqrt(vec.hash(fi * 13 + 1));
        const y = @mod(vec.hash(fi * 7 + 5) * h + clock * (0.03 + 0.05 * vec.hash(fi * 3 + 11)), h);
        const p = shaft_bottom + v3(@cos(ang) * rr, y, @sin(ang) * rr);
        const size: f32 = 0.012;
        const r = side * vec.s(size);
        const uu = up * vec.s(size);
        const corners = [4]V3{ p - r - uu, p + r - uu, p + r + uu, p - r + uu };
        const uv = [4][2]f32{ .{ -1, -1 }, .{ 1, -1 }, .{ 1, 1 }, .{ -1, 1 } };
        const twinkle = 0.5 + 0.5 * @sin(clock * (1.5 + vec.hash(fi * 5 + 2) * 2) + @as(f32, @floatFromInt(i)));
        for (tris) |ci| trans.push(corners[ci], v3(uv[ci][0], uv[ci][1], 5), col, -(g * 0.7 * twinkle));
    }
}
