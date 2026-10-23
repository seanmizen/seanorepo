// The player model: the box body of another player, of a practice dummy
// and of your own body in first person. main.zig builds each body into the
// dynamic mesh in each frame. This file is the one place for the parts of
// the body.
//
// The legs: a thigh, a shin and a boot. Two-bone IK puts each ankle on a
// walk path, and the knee bends to the front. The walk follows the
// distance on the ground (`cadence`, the same as the head bob), so a
// planted foot stays on the floor. The path turns to the direction of the
// move, so a strafe moves the legs to the side.
//
// Your own body (first person):
// - The camera shows the legs and the torso. The head, the arms and the
//   held weapon cast a shadow only (material + shadow_only). The view model
//   (weapon.zig Hands.pose) shows the weapon, so the two do not overlap.
// - The body is `own_back` behind the eye. The eye is then in front of the
//   chest, and a look down shows the legs and the feet. On a slope the body
//   stands on the floor or ramp under it (Feet.base).
// - Stairs: the player stands on a ramp over the steps (map.zig Ramp), so
//   the feet can be up to one rise over the tread. Feet.update finds the
//   tread under each planted foot. The body goes down to the lower foot,
//   and the knee of the higher foot bends. The model of another player and
//   of a dummy stays on the ramp: it matches the hit boxes (player.zig).
// - The cvar own_body 0 hides your body from the camera. The shadow stays.
// - The shadows: the sun shadow pass draws the whole dynamic mesh. Your
//   body also casts a shadow from the nearest map lights (render.zig
//   drawBodyShadows).
const std = @import("std");
const vec = @import("vec.zig");
const mesh = @import("mesh.zig");
const map = @import("map.zig");
const weapon = @import("weapon.zig");
const grenade = @import("grenade.zig");
const player = @import("player.zig");
const console = @import("console/root.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;

/// Add this to a material id: the part casts a shadow, and the camera does
/// not draw it (scene.wgsl vs_main, vs_shadow).
pub const shadow_only: f32 = 200;

/// The walk cycle in radians for each metre on the ground. It is the same
/// as the head bob (main.zig playerView), so a foot lands at the low point
/// of the bob.
pub const cadence: f32 = 1.7;

/// Your body is this far behind the eye (metres).
pub const own_back: f32 = 0.45;

// The legs. The hip joints are hip_h over the soles. With the legs at rest
// the knee bends a little (thigh + shin is 1 cm more than hip to ankle).
const hip_h: f32 = 0.86;
const hip_x: f32 = 0.11;
const thigh: f32 = 0.4;
const shin: f32 = 0.4;
const ankle_h: f32 = 0.07;
const reach: f32 = thigh + shin - 0.002;
/// A planted foot moves this far back under the hip in one step. The body
/// moves the same distance, so the foot stays on the floor.
const stance: f32 = 0.6;
/// The part of the cycle with the foot on the floor (radians).
const stance_phase: f32 = stance * cadence;
/// The height of a foot in the middle of its swing.
const swing_lift: f32 = 0.2;
/// The steps are full length from this part of the walk speed. A slower
/// step is shorter, so a planted foot slides a little.
const full_step: f32 = 0.3;
/// The tread search under a foot (treadUnder): from this far under the
/// floor or ramp at the foot to this far over it.
const probe_down: f32 = 0.5;
const probe_up: f32 = 0.25;
/// The deepest drop of your body on stairs: one rise and a little more.
const max_sink: f32 = 0.45;
/// The deepest drop of the hips (legs). The thighs go 0.08 over the hip
/// joints, and the torso starts 0.02 under hip_h.
const max_drop: f32 = 0.1;

pub const View = enum {
    /// Every part shows: another player or a dummy.
    third_person,
    /// Your body: the legs and the torso show. The head, the arms and the
    /// held weapon cast a shadow only.
    first_person,
    /// Your body with own_body 0: every part casts a shadow only.
    shadow,
};

/// The pose of a body.
pub const Pose = struct {
    /// The feet: on a floor or on a ramp.
    pos: V3,
    yaw: f32,
    pitch: f32,
    lean: f32,
    /// 0 upright. It rises to 1 while a dead body falls over.
    fall: f32 = 0,
    /// The distance walked on the ground.
    stride: f32,
    /// The velocity. The walk uses the speed and the direction on the
    /// ground (X and Z).
    vel: V3 = v3(0, 0, 0),
    color: V3,
    /// The class and the model of the held weapon.
    w: weapon.Class,
    m: u8,
    view: View = .third_person,
    /// Your body only (Feet), each from pos[1]: the tread under each foot
    /// (left, right), the floor or ramp under the body, the drop of the
    /// body on stairs, and 1 in the air.
    ground: [2]f32 = .{ 0, 0 },
    base: f32 = 0,
    sink: f32 = 0,
    air: f32 = 0,
};

// ---- The own_body cvar ------------------------------------------------------

pub var own_body: *console.Cvar = undefined;

pub fn register(c: *console.Console) !void {
    own_body = try c.addCvar(.{
        .name = "own_body",
        .default = .{ .bool = true },
        .flags = .{ .saved = true },
        .description = "Show your own body in first person: the legs and the torso when you look down. 0 hides it. Its shadow stays.",
        .reader = "main.zig ownPose",
    });
}

// ---- The feet of your body ---------------------------------------------------

/// The floors under your body and its feet, and the drop of the body on
/// stairs. main.zig keeps one and updates it in each tick. The values move
/// smoothly, so a foot does not jump at the edge of a step.
pub const Feet = struct {
    ground: [2]f32 = .{ 0, 0 },
    base: f32 = 0,
    sink: f32 = 0,
    air: f32 = 0,
    /// pos[1] at the last update.
    last_y: ?f32 = null,

    pub fn update(self: *Feet, p: Pose, dt: f32, grounded: bool) void {
        const kf = 1 - @exp(-dt / 0.02);
        const ka = 1 - @exp(-dt / 0.08);
        const y = p.pos[1];
        // A planted foot stays at its height in the world while the player
        // goes up or down the ramp.
        const dy = if (self.last_y) |l| y - l else 0;
        self.last_y = y;
        for (0..2) |i| {
            if (planted(p, i)) self.ground[i] -= dy;
        }
        self.air += ((if (grounded) @as(f32, 0) else 1) - self.air) * ka;
        // The body is own_back behind the player. On a slope its floor is
        // higher or lower than the feet of the player.
        var want_base: f32 = 0;
        if (grounded) {
            if (floorUnder(p.pos + axes(p.yaw).back * vec.s(own_back), y)) |top| want_base = top - y;
        }
        self.base += (want_base - self.base) * kf;
        for (0..2) |i| {
            // A planted foot goes to the tread under it. A foot in the air
            // follows the floor or the ramp.
            var want = self.base;
            if (grounded) {
                const spot = footSpot(p, i);
                if (floorUnder(spot, y + self.base)) |floor| {
                    want = floor - y;
                    // The ramp goes through the front edges of the steps:
                    // the tread is at most one rise under it.
                    if (planted(p, i)) {
                        if (treadUnder(spot, floor)) |t| want = t - y;
                    }
                }
            }
            self.ground[i] += (want - self.ground[i]) * kf;
        }
        // The body goes down to the lower foot. The higher foot bends its
        // knee.
        const low = @min(self.ground[0], self.ground[1]);
        self.sink = std.math.clamp(self.base - low, 0, max_sink);
    }

    /// Put the values in a pose.
    pub fn apply(self: *const Feet, p: *Pose) void {
        p.ground = self.ground;
        p.base = self.base;
        p.sink = self.sink;
        p.air = self.air;
    }
};

/// The top of the floor or ramp under p (X and Z), from 0.65 m under y to
/// a step (0.45 m) over it. Null when there is none. Stairs rise 0.8 m in
/// each metre. Your body is up to 0.77 m from the edge of the collision box
/// that holds the player up: own_back behind pos, and 0.32 m more to the
/// edge of the box. 0.77 x 0.8 is 0.62 m.
fn floorUnder(p: V3, y: f32) ?f32 {
    const r: f32 = 0.06;
    return map.floorTop(v3(p[0] - r, y - 0.65, p[2] - r), v3(p[0] + r, y + 0.45, p[2] + r));
}

/// The top of the highest solid box that you can see under a foot at p (X
/// and Z), from probe_down under y to probe_up over it. A ramp does not
/// count: it is over the steps. Null when there is none.
pub fn treadUnder(p: V3, y: f32) ?f32 {
    const r: f32 = 0.06;
    var best: ?f32 = null;
    for (map.boxes[0..map.box_count]) |b| {
        if (!b.solid or !b.visible) continue;
        if (p[0] + r <= b.min[0] or p[0] - r >= b.max[0] or p[2] + r <= b.min[2] or p[2] - r >= b.max[2]) continue;
        const top = b.max[1];
        if (top < y - probe_down or top > y + probe_up) continue;
        if (best == null or top > best.?) best = top;
    }
    return best;
}

// ---- The pose of the legs ----------------------------------------------------

/// The local right (+X) and back (+Z) of a yaw, in the world.
fn axes(yaw: f32) struct { right: V3, back: V3 } {
    return .{ .right = v3(@cos(yaw), 0, -@sin(yaw)), .back = v3(@sin(yaw), 0, @cos(yaw)) };
}

/// The feet of the model in the world: pos, or for your body own_back
/// behind it, on its floor and down by the sink.
fn root(p: Pose) V3 {
    if (p.view == .third_person) return p.pos;
    return p.pos + axes(p.yaw).back * vec.s(own_back) + v3(0, p.base - p.sink, 0);
}

/// The walk: the speed over the walk speed (0 to 1), and the direction of
/// the move in body space (forward is -Z).
fn walk(p: Pose) struct { amount: f32, dir: V3 } {
    const a = axes(p.yaw);
    const flat = v3(p.vel[0], 0, p.vel[2]);
    const speed = vec.len(flat);
    if (speed < 0.05) return .{ .amount = 0, .dir = v3(0, 0, -1) };
    const dir = v3(vec.dot(flat, a.right), 0, vec.dot(flat, a.back)) / vec.s(speed);
    return .{ .amount = @min(1, speed / player.walk_speed), .dir = dir };
}

/// The walk phase of foot i (0 left, 1 right), 0 to tau. 0 is the landing,
/// with the foot in front. The foot is on the floor up to stance_phase.
fn phase(p: Pose, i: usize) f32 {
    return @mod(p.stride * cadence + (if (i == 0) @as(f32, 0) else std.math.pi), std.math.tau);
}

/// True while foot i is on the floor (the tests).
pub fn planted(p: Pose, i: usize) bool {
    return p.air < 0.5 and (walk(p).amount == 0 or phase(p, i) < stance_phase);
}

/// The ankle of foot i in body space over the floor: along the walk path,
/// and the lift over the floor.
fn footPath(p: Pose, i: usize) struct { at: V3, lift: f32 } {
    const side: f32 = if (i == 0) -1 else 1;
    const w = walk(p);
    const tau = std.math.tau;
    const psi = phase(p, i);
    // How far ahead of the hip the foot is, along the move.
    var ahead: f32 = 0;
    var lift: f32 = 0;
    if (psi < stance_phase) {
        // On the floor: the foot moves back as fast as the body moves on.
        ahead = stance * (0.5 - psi / stance_phase);
    } else {
        // In the air: back to the front, up and down.
        const t = (psi - stance_phase) / (tau - stance_phase);
        ahead = stance * (vec.smooth(t) - 0.5);
        lift = swing_lift * @sin(std.math.pi * t);
    }
    // Full steps from full_step of the walk speed. A slower walk blends
    // them to the stand, so the feet come under the hips when you stop.
    const k = vec.smooth(w.amount / full_step);
    var at = v3(side * hip_x, 0, 0) + w.dir * vec.s(ahead * k);
    lift *= k;
    // In the air the feet come up and apart.
    at[2] += p.air * (if (i == 0) @as(f32, -0.08) else 0.1);
    lift += p.air * (if (i == 0) @as(f32, 0.16) else 0.1);
    return .{ .at = at, .lift = lift };
}

/// The point on the floor under foot i, in the world (the tread search of
/// Feet.update).
fn footSpot(p: Pose, i: usize) V3 {
    const a = axes(p.yaw);
    const at = footPath(p, i).at;
    // The ball of the foot: a little in front of the ankle.
    return root(p) + a.right * vec.s(at[0]) + a.back * vec.s(at[2] - 0.06);
}

pub const Leg = struct { hip: V3, knee: V3, ankle: V3 };

/// The joints of both legs in body space (the origin is root(p), under the
/// hips). A foot that the leg cannot reach pulls the hips down, at most
/// max_drop: the tops of the thighs stay inside the torso.
pub fn legs(p: Pose) [2]Leg {
    var want: [2]V3 = undefined;
    var drop: f32 = 0;
    for (0..2) |i| {
        const f = footPath(p, i);
        want[i] = f.at + v3(0, p.ground[i] - p.base + p.sink + ankle_h + f.lift, 0);
        const across = want[i][0] - (if (i == 0) -hip_x else hip_x);
        const flat2 = across * across + want[i][2] * want[i][2];
        const down = @sqrt(@max(0, reach * reach - flat2));
        drop = @max(drop, hip_h - want[i][1] - down);
    }
    drop = @min(drop, max_drop);
    var out: [2]Leg = undefined;
    for (0..2) |i| {
        const side: f32 = if (i == 0) -1 else 1;
        const hip = v3(side * hip_x, hip_h - drop, 0);
        out[i] = ik(hip, want[i], side);
    }
    return out;
}

/// Two-bone IK: the knee and the ankle for a hip and an ankle target. The
/// knee bends toward the front and a little out.
fn ik(hip: V3, target: V3, side: f32) Leg {
    const to = target - hip;
    const dist = vec.len(to);
    const u = if (dist > 1e-4) to / vec.s(dist) else v3(0, -1, 0);
    const d = std.math.clamp(dist, 0.1, reach);
    const ca = (thigh * thigh + d * d - shin * shin) / (2 * thigh * d);
    const sa = @sqrt(@max(0, 1 - ca * ca));
    // The pole: the front, at a right angle to the leg.
    const pole = vec.norm(v3(side * 0.15, 0, -1));
    var n = pole - u * vec.s(vec.dot(pole, u));
    if (vec.len(n) < 1e-4) n = v3(0, 1, 0);
    n = vec.norm(n);
    const knee = hip + (u * vec.s(ca) + n * vec.s(sa)) * vec.s(thigh);
    return .{ .hip = hip, .knee = knee, .ankle = hip + u * vec.s(d) };
}

/// The soles of the boots in the world (the tests).
pub fn soles(p: Pose) [2]V3 {
    const a = axes(p.yaw);
    const r = root(p);
    var out: [2]V3 = undefined;
    for (legs(p), 0..) |l, i| {
        out[i] = r + a.right * vec.s(l.ankle[0]) + a.back * vec.s(l.ankle[2]) + v3(0, l.ankle[1] - ankle_h, 0);
    }
    return out;
}

// ---- The build ---------------------------------------------------------------

/// A box from joint a down to joint b, `top` past a: a thigh or a shin.
/// `half` is the half size across the bone (X and Z).
fn bone(out: *mesh.Mesh, base: Mat4, a: V3, b: V3, half: [2]f32, top: f32, col: V3, mat: f32) void {
    const d = a - b;
    const l = vec.len(d);
    const y = d / vec.s(l);
    const x = vec.norm(v3(1, 0, 0) - y * vec.s(y[0]));
    const z = vec.cross(x, y);
    const m = Mat4{ .data = .{ x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, a[0], a[1], a[2], 1 } };
    out.orientedBox(base.mul(m), v3(-half[0], -l, -half[1]), v3(half[0], top, half[1]), col, mat);
}

pub fn build(out: *mesh.Mesh, p: Pose) void {
    const col = p.color;
    const dark = v3(0.13, 0.13, 0.14);
    const boot = v3(0.07, 0.06, 0.05);
    const skin = v3(0.78, 0.58, 0.45);
    // The legs and the torso, and the head, the arms and the weapon.
    const low: f32 = if (p.view == .shadow) shadow_only else 0;
    const high: f32 = if (p.view == .third_person) 0 else shadow_only;
    // Fall over backwards when dead.
    const base = vec.translate(root(p)).mul(Mat4.rotationY(p.yaw).mul(Mat4.rotationX(p.fall * 1.45)));
    for (legs(p)) |l| {
        bone(out, base, l.hip, l.knee, .{ 0.08, 0.09 }, 0.08, dark, 6 + low);
        bone(out, base, l.knee, l.ankle, .{ 0.068, 0.075 }, 0.04, dark, 6 + low);
        out.orientedBox(base.mul(vec.translate(l.ankle)), v3(-0.06, -ankle_h, -0.2), v3(0.06, 0.05, 0.07), boot, 6 + low);
    }
    // The upper body turns about the hips with the lean (player.zig
    // leanOffset). Local +X is the right of the player. When your body is
    // higher or lower than pos, the pivot stays at the pivot of the eye.
    const pivot = player.hip - p.base + p.sink;
    const upper = base.mul(vec.translate(v3(0, pivot, 0)).mul(Mat4.rotationZ(-player.leanAngle(p.lean)).mul(vec.translate(v3(0, -pivot, 0)))));
    out.orientedBox(upper, v3(-0.23, 0.84, -0.14), v3(0.23, 1.45, 0.14), col, 6 + low);
    out.orientedBox(upper, v3(-0.25, 1.0, -0.16), v3(0.25, 1.38, 0.16), dark, 6 + low);
    out.orientedBox(upper, v3(-0.12, 1.47, -0.12), v3(0.12, 1.74, 0.12), skin, 6 + high);
    out.orientedBox(upper, v3(-0.14, 1.66, -0.15), v3(0.14, 1.8, 0.15), dark, 3 + high);
    out.orientedBox(upper, v3(-0.1, 1.56, -0.135), v3(0.1, 1.62, -0.11), v3(0.05, 0.05, 0.06), 3 + high);
    // Arms and the held weapon, turned with the look pitch.
    const aim = upper.mul(vec.translate(v3(0, 1.38, 0)).mul(Mat4.rotationX(p.pitch * (1 - p.fall))));
    out.orientedBox(aim, v3(0.16, -0.1, -0.45), v3(0.26, 0.02, 0.0), col, 6 + high);
    out.orientedBox(aim, v3(-0.2, -0.12, -0.5), v3(-0.1, -0.02, -0.05), col, 6 + high);
    switch (p.w) {
        // A one-hand weapon sits in the right hand, further out.
        .grenade => grenade.addBody(out, aim.mul(vec.translate(v3(0.21, -0.05, -0.5))), high),
        .knife => weapon.addModel(out, weapon.knife_model, aim.mul(vec.translate(v3(0.21, -0.06, -0.47)).mul(Mat4.rotationX(0.5))), Mat4.identity(), high),
        .pistol, .revolver => weapon.addModel(out, p.m, aim.mul(vec.translate(v3(0.06, -0.06, -0.44))), Mat4.identity(), high),
        else => weapon.addModel(out, p.m, aim.mul(vec.translate(v3(0.08, -0.1, -0.24))), Mat4.identity(), high),
    }
}
