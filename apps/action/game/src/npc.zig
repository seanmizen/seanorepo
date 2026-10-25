// Where: apps/action/game/src/npc.zig
// When: main.zig draws each NPC of the street (roadmen.zig) into the
// dynamic mesh in each frame. The moped riders use the same model.
// Why: one model and one outfit for the people of the street: full black,
// with a large puffer jacket, a balaclava, tracksuit trousers and
// trainers. Other code gives a pose, and this file builds the parts.
//
// The model is a skeleton of rigid parts (Part). Each part has a box in
// its own frame (extents). The frame of a part has its origin at the joint
// at its top: the middle of the hips, the waist, the neck, a shoulder, an
// elbow, a hip joint or a knee. Local -Y goes down the part, -Z is the
// front, +X is the right of the body.
//
// - `skeleton` makes the frames from a Pose: a stand, a walk, a run, a
//   stab, and a seat on a moped as the driver or as the passenger. The
//   walk and the run follow the distance on the ground (`stride`).
// - `buildSkeleton` draws the outfit on any set of frames. A ragdoll can
//   move the parts as rigid bodies (the boxes of `extents`) and draw them
//   with it.
// - `hitBoxes` gives the three hit boxes of the player model (legs, torso,
//   head) round the parts of any skeleton.
//
// This file has no state, no sound and no input.
const std = @import("std");
const vec = @import("vec.zig");
const mesh = @import("mesh.zig");
const weapon = @import("weapon.zig");
const player = @import("player.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;

pub const Part = enum(u8) {
    hips,
    chest,
    head,
    upper_arm_l,
    fore_arm_l,
    upper_arm_r,
    fore_arm_r,
    thigh_l,
    shin_l,
    thigh_r,
    shin_r,
};
pub const part_count = std.enums.values(Part).len;

/// The world frame of each part, in the order of Part.
pub const Skeleton = [part_count]Mat4;

/// The box of each part in its own frame: the solid part of a ragdoll.
/// The outfit (buildSkeleton) stays inside these boxes, except the hood,
/// the trainers and the hands, which are a little larger.
pub const extents = blk: {
    var e: [part_count][2]V3 = undefined;
    e[@backingInt(Part.hips)] = .{ v3(-0.17, -0.12, -0.13), v3(0.17, 0.08, 0.13) };
    e[@backingInt(Part.chest)] = .{ v3(-0.25, -0.16, -0.17), v3(0.25, 0.56, 0.17) };
    e[@backingInt(Part.head)] = .{ v3(-0.105, 0, -0.12), v3(0.105, 0.26, 0.11) };
    for ([_]Part{ .upper_arm_l, .upper_arm_r }) |p| e[@backingInt(p)] = .{ v3(-0.085, -0.31, -0.09), v3(0.085, 0.06, 0.09) };
    for ([_]Part{ .fore_arm_l, .fore_arm_r }) |p| e[@backingInt(p)] = .{ v3(-0.075, -0.26, -0.08), v3(0.075, 0.03, 0.08) };
    for ([_]Part{ .thigh_l, .thigh_r }) |p| e[@backingInt(p)] = .{ v3(-0.08, -0.42, -0.085), v3(0.08, 0.06, 0.085) };
    // The shin with the trainer.
    for ([_]Part{ .shin_l, .shin_r }) |p| e[@backingInt(p)] = .{ v3(-0.065, -0.5, -0.2), v3(0.065, 0.03, 0.085) };
    break :blk e;
};

// The joints, in the frame of the parent part.
const waist = v3(0, 0.06, 0);
const neck = v3(0, 0.56, 0);
const shoulder_x: f32 = 0.31;
const shoulder_y: f32 = 0.5;
const elbow_y: f32 = -0.3;
const hip_x: f32 = 0.1;
const hip_y: f32 = -0.05;
const knee_y: f32 = -0.41;
/// The hips over the soles with straight legs: the hip joint, the thigh,
/// and the shin to the sole of the trainer.
const leg_len: f32 = -hip_y - knee_y + 0.5;

/// The length of one walk cycle (two steps) and one run cycle on the
/// ground, m.
const walk_cycle: f32 = 1.5;
const run_cycle: f32 = 2.6;

pub const Action = enum {
    /// Upright, the arms a little out from the bulk of the jacket.
    stand,
    walk,
    run,
    /// The knife stance: a step forward, the knife hand thrusts with
    /// Pose.stab.
    stab,
    /// On a moped: `pos` is the top of the seat. The driver holds the
    /// handlebars.
    ride_driver,
    /// On a moped behind the driver: the hands at the waist of the driver.
    /// Pose.reach puts an arm out to the side (a snatch).
    ride_passenger,
};

/// The pose of an NPC.
pub const Pose = struct {
    /// On foot: the point on the ground under the hips. On a moped: the
    /// top of the seat under the hips.
    pos: V3,
    /// 0 looks to -Z, as the player.
    yaw: f32,
    action: Action = .stand,
    /// The distance on the ground: the phase of the walk and the run.
    stride: f32 = 0,
    /// The stab: 0 to 1 over one thrust. The blade is out at 0.45.
    stab: f32 = 0,
    /// A hit: 1 at the hit, then it goes to 0. `flinch_dir` is the
    /// direction of the bullet or the blast in the world.
    flinch: f32 = 0,
    flinch_dir: V3 = v3(0, 0, -1),
    /// The roll of the body about the ground (a moped in a turn), radians.
    /// Positive leans right.
    roll: f32 = 0,
    /// The passenger: -1 to 1 puts the left (< 0) or right (> 0) arm out
    /// to the side, level with the shoulder.
    reach: f32 = 0,
    /// A knife in the right hand.
    knife: bool = false,
};

// The outfit.
const jacket = v3(0.022, 0.022, 0.025);
const quilt = v3(0.03, 0.03, 0.034);
const trousers = v3(0.028, 0.028, 0.03);
const balaclava = v3(0.018, 0.018, 0.02);
const glove = v3(0.02, 0.02, 0.02);
const trainer = v3(0.016, 0.016, 0.018);
const sole = v3(0.05, 0.05, 0.052);
const skin = v3(0.55, 0.38, 0.28);
const eye_c = v3(0.04, 0.03, 0.03);
// Material ids of scene.wgsl: paint (a smooth nylon), cloth.
const nylon: f32 = 0;
const cloth: f32 = 6;

// ---- The skeleton --------------------------------------------------------------

/// The joint angles of a pose, radians. A positive pitch swings a limb
/// forward (toward -Z). A positive roll swings it to the right (+X).
const Angles = struct {
    /// The hips over `pos`.
    hip_h: f32 = leg_len - 0.01,
    /// The whole body: forward lean.
    lean: f32 = 0,
    /// The chest about the waist: forward bend and turn (to the right).
    bend: f32 = 0,
    twist: f32 = 0,
    nod: f32 = 0,
    hip: [2]f32 = .{ 0, 0 },
    hip_roll: [2]f32 = .{ -0.03, 0.03 },
    knee: [2]f32 = .{ 0.08, 0.08 },
    shoulder: [2]f32 = .{ 0.05, 0.05 },
    shoulder_roll: [2]f32 = .{ -0.2, 0.2 },
    elbow: [2]f32 = .{ 0.25, 0.25 },
};

/// The phase of the walk or the run, radians.
fn cyclePhase(p: Pose, cycle: f32) f32 {
    return @mod(p.stride / cycle * std.math.tau, std.math.tau);
}

fn angles(p: Pose) Angles {
    var a: Angles = .{};
    switch (p.action) {
        .stand => {},
        .walk, .run => {
            const run = p.action == .run;
            const ph = cyclePhase(p, if (run) run_cycle else walk_cycle);
            const sw = @sin(ph);
            const hip_amp: f32 = if (run) 0.75 else 0.42;
            a.hip = .{ hip_amp * sw, -hip_amp * sw };
            // The knee bends while the leg swings forward.
            const kick: f32 = if (run) 1.5 else 0.85;
            a.knee = .{ 0.1 + kick * @max(0, @cos(ph)), 0.1 + kick * @max(0, -@cos(ph)) };
            const arm_amp: f32 = if (run) 0.7 else 0.35;
            a.shoulder = .{ -arm_amp * sw, arm_amp * sw };
            a.elbow = if (run) .{ 1.35, 1.35 } else .{ 0.3, 0.3 };
            a.lean = if (run) 0.22 else 0.04;
            a.twist = (if (run) @as(f32, 0.12) else 0.05) * sw;
            // The hips go down when both feet are under the body.
            a.hip_h -= (if (run) @as(f32, 0.07) else 0.03) * (1 - @abs(@cos(ph)));
        },
        .stab => {
            const s = vec.clamp01(p.stab);
            // Wind up to 0.3, the thrust to 0.45, back to the guard at 1.
            const wind = vec.smooth(s / 0.3) * (1 - vec.smooth((s - 0.3) / 0.15));
            const thrust = vec.smooth((s - 0.3) / 0.15) * (1 - vec.smooth((s - 0.45) / 0.55));
            a.hip = .{ 0.35, -0.25 };
            a.knee = .{ 0.45, 0.3 };
            a.hip_h -= 0.07;
            a.lean = 0.12 + 0.15 * thrust;
            a.twist = -0.25 * wind + 0.35 * thrust;
            // The left hand forward as a guard. The right hand: back by the
            // hip, then forward and up into the body of the target.
            a.shoulder = .{ 0.75, 0.3 - 0.9 * wind + 1.2 * thrust };
            a.shoulder_roll = .{ -0.15, 0.25 };
            a.elbow = .{ 1.3, 1.5 - 0.3 * wind - 1.3 * thrust };
        },
        .ride_driver => {
            a.hip_h = 0.1;
            a.lean = 0.18;
            a.hip = .{ 1.35, 1.35 };
            a.knee = .{ 1.25, 1.25 };
            a.hip_roll = .{ -0.15, 0.15 };
            a.shoulder = .{ 1.0, 1.0 };
            a.shoulder_roll = .{ -0.25, 0.25 };
            a.elbow = .{ 0.45, 0.45 };
        },
        .ride_passenger => {
            a.hip_h = 0.1;
            a.lean = 0.1;
            a.hip = .{ 1.25, 1.25 };
            a.knee = .{ 1.55, 1.55 };
            a.hip_roll = .{ -0.22, 0.22 };
            a.shoulder = .{ 0.75, 0.75 };
            a.shoulder_roll = .{ -0.05, 0.05 };
            a.elbow = .{ 0.9, 0.9 };
            // The snatch: one arm out to the side, level, the chest turns
            // to it.
            const r = std.math.clamp(p.reach, -1, 1);
            const i: usize = if (r < 0) 0 else 1;
            const k = @abs(r);
            a.shoulder[i] += (0.2 - a.shoulder[i]) * k;
            a.shoulder_roll[i] += ((if (i == 0) @as(f32, -1.45) else 1.45) - a.shoulder_roll[i]) * k;
            a.elbow[i] *= 1 - k;
            a.twist += -r * 0.35;
        },
    }
    // A hit: the chest goes back and turns away from the shot.
    if (p.flinch > 0) {
        const k = vec.smooth(p.flinch);
        const d = vec.norm(v3(p.flinch_dir[0], 0, p.flinch_dir[2]));
        // The forward and the right of the body in the world.
        const fwd = v3(-@sin(p.yaw), 0, -@cos(p.yaw));
        const right = v3(@cos(p.yaw), 0, -@sin(p.yaw));
        a.bend -= 0.45 * k * -vec.dot(d, fwd);
        a.twist += 0.5 * k * vec.dot(d, right);
        a.nod -= 0.4 * k;
        a.elbow[0] += 0.5 * k;
        a.elbow[1] += 0.5 * k;
    }
    return a;
}

/// The frames of all the parts for a pose.
pub fn skeleton(p: Pose) Skeleton {
    const a = angles(p);
    var sk: Skeleton = undefined;
    const hips = vec.translate(p.pos + v3(0, a.hip_h, 0)).mul(Mat4.rotationY(p.yaw).mul(Mat4.rotationZ(-p.roll).mul(Mat4.rotationX(-a.lean))));
    sk[@backingInt(Part.hips)] = hips;
    const chest = hips.mul(vec.translate(waist).mul(Mat4.rotationY(-a.twist).mul(Mat4.rotationX(-a.bend))));
    sk[@backingInt(Part.chest)] = chest;
    sk[@backingInt(Part.head)] = chest.mul(vec.translate(neck).mul(Mat4.rotationY(a.twist * 0.5).mul(Mat4.rotationX(-a.nod + a.lean * 0.6))));
    for (0..2) |i| {
        const side: f32 = if (i == 0) -1 else 1;
        const upper = chest.mul(vec.translate(v3(side * shoulder_x, shoulder_y, 0)).mul(Mat4.rotationX(a.shoulder[i]).mul(Mat4.rotationZ(a.shoulder_roll[i]))));
        const fore = upper.mul(vec.translate(v3(0, elbow_y, 0)).mul(Mat4.rotationX(a.elbow[i])));
        const thigh = hips.mul(vec.translate(v3(side * hip_x, hip_y, 0)).mul(Mat4.rotationX(a.hip[i]).mul(Mat4.rotationZ(a.hip_roll[i]))));
        const shin = thigh.mul(vec.translate(v3(0, knee_y, 0)).mul(Mat4.rotationX(-a.knee[i])));
        sk[@backingInt(if (i == 0) Part.upper_arm_l else Part.upper_arm_r)] = upper;
        sk[@backingInt(if (i == 0) Part.fore_arm_l else Part.fore_arm_r)] = fore;
        sk[@backingInt(if (i == 0) Part.thigh_l else Part.thigh_r)] = thigh;
        sk[@backingInt(if (i == 0) Part.shin_l else Part.shin_r)] = shin;
    }
    return sk;
}

// ---- The outfit ----------------------------------------------------------------

fn part(sk: Skeleton, pt: Part) Mat4 {
    return sk[@backingInt(pt)];
}

/// A ring of quilting round a part at height y: a little larger than the
/// part, h high. It makes the baffles of the puffer jacket.
fn ring(out: *mesh.Mesh, m: Mat4, e: [2]V3, y: f32, h: f32, out_by: f32, mat_add: f32) void {
    out.orientedBox(m, v3(e[0][0] - out_by, y - h / 2, e[0][2] - out_by), v3(e[1][0] + out_by, y + h / 2, e[1][2] + out_by), quilt, nylon + mat_add);
}

/// Draw the outfit on a skeleton. `mat_add` is added to each material id
/// (body.shadow_only: a shadow only).
pub fn buildSkeleton(out: *mesh.Mesh, sk: Skeleton, knife: bool, mat_add: f32) void {
    const ex = extents;
    // The tracksuit trousers and the trainers.
    out.orientedBox(part(sk, .hips), ex[@backingInt(Part.hips)][0], ex[@backingInt(Part.hips)][1], trousers, cloth + mat_add);
    for ([_]Part{ .thigh_l, .thigh_r }) |pt| {
        const e = ex[@backingInt(pt)];
        out.orientedBox(part(sk, pt), e[0], e[1], trousers, cloth + mat_add);
    }
    for ([_]Part{ .shin_l, .shin_r }) |pt| {
        const m = part(sk, pt);
        out.orientedBox(m, v3(-0.065, -0.4, -0.07), v3(0.065, 0.03, 0.07), trousers, cloth + mat_add);
        // The cuff of the trousers, gathered over the trainer.
        out.orientedBox(m, v3(-0.072, -0.4, -0.077), v3(0.072, -0.34, 0.077), trousers, cloth + mat_add);
        out.orientedBox(m, v3(-0.058, -0.49, -0.19), v3(0.058, -0.38, 0.075), trainer, nylon + mat_add);
        out.orientedBox(m, v3(-0.062, -0.5, -0.2), v3(0.062, -0.47, 0.085), sole, cloth + mat_add);
    }
    // The puffer jacket: the body, the baffles, a high collar and the hood
    // bunched behind the neck.
    const chest = part(sk, .chest);
    const ce = ex[@backingInt(Part.chest)];
    out.orientedBox(chest, ce[0], ce[1], jacket, nylon + mat_add);
    for ([_]f32{ -0.1, 0.06, 0.22, 0.38 }) |y| ring(out, chest, ce, y, 0.05, 0.016, mat_add);
    out.orientedBox(chest, v3(-0.15, 0.5, -0.13), v3(0.15, 0.66, 0.13), jacket, nylon + mat_add);
    out.orientedBox(chest, v3(-0.17, 0.46, 0.06), v3(0.17, 0.68, 0.23), quilt, nylon + mat_add);
    // The sleeves: puffy, with a baffle, and the gloves.
    for ([_]Part{ .upper_arm_l, .upper_arm_r }) |pt| {
        const e = ex[@backingInt(pt)];
        out.orientedBox(part(sk, pt), e[0], e[1], jacket, nylon + mat_add);
        ring(out, part(sk, pt), e, -0.13, 0.05, 0.012, mat_add);
    }
    for ([_]Part{ .fore_arm_l, .fore_arm_r }) |pt| {
        const m = part(sk, pt);
        const e = ex[@backingInt(pt)];
        out.orientedBox(m, e[0], e[1], jacket, nylon + mat_add);
        ring(out, m, e, -0.2, 0.05, 0.01, mat_add);
        out.orientedBox(m, v3(-0.045, -0.37, -0.05), v3(0.045, -0.25, 0.05), glove, cloth + mat_add);
    }
    // The balaclava, with the slit for the eyes.
    const head = part(sk, .head);
    const he = ex[@backingInt(Part.head)];
    out.orientedBox(head, he[0], he[1], balaclava, cloth + mat_add);
    out.orientedBox(head, v3(-0.07, 0.14, -0.13), v3(0.07, 0.18, -0.1), skin, cloth + mat_add);
    for ([_]f32{ -1, 1 }) |sd| out.orientedBox(head, v3(sd * 0.0375 - 0.0125, 0.15, -0.14), v3(sd * 0.0375 + 0.0125, 0.17, -0.12), eye_c, nylon + mat_add);
    if (knife) {
        // The blade along the forearm, out of the fist.
        const hand = part(sk, .fore_arm_r).mul(vec.translate(v3(0, -0.33, -0.01)).mul(Mat4.rotationX(-std.math.pi / 2.0)));
        weapon.addModel(out, weapon.knife_model, hand, Mat4.identity(), mat_add);
    }
}

/// Draw an NPC in a pose.
pub fn build(out: *mesh.Mesh, p: Pose) void {
    buildSkeleton(out, skeleton(p), p.knife, 0);
}

// ---- Hits ------------------------------------------------------------------------

/// The world bounds of the boxes of some parts.
fn bounds(sk: Skeleton, parts: []const Part) player.HitBox {
    var lo = v3(1e9, 1e9, 1e9);
    var hi = v3(-1e9, -1e9, -1e9);
    for (parts) |pt| {
        const e = extents[@backingInt(pt)];
        for (0..8) |c| {
            const q = v3(
                if (c & 1 != 0) e[1][0] else e[0][0],
                if (c & 2 != 0) e[1][1] else e[0][1],
                if (c & 4 != 0) e[1][2] else e[0][2],
            );
            const w = vec.xform(part(sk, pt), q);
            lo = @min(lo, w);
            hi = @max(hi, w);
        }
    }
    return .{ .min = lo, .max = hi };
}

/// The hit boxes of a skeleton, as the player has them (player.hitBoxes):
/// the legs, the torso with the arms, and the head (index 2).
pub fn hitBoxes(sk: Skeleton) [3]player.HitBox {
    return .{
        bounds(sk, &.{ .thigh_l, .shin_l, .thigh_r, .shin_r }),
        bounds(sk, &.{ .hips, .chest, .upper_arm_l, .fore_arm_l, .upper_arm_r, .fore_arm_r }),
        bounds(sk, &.{.head}),
    };
}

/// The world point of the tip of the knife hand: where a stab lands.
pub fn handTip(sk: Skeleton) V3 {
    return vec.xform(part(sk, .fore_arm_r), v3(0, -0.5, 0));
}

test "npc: a standing NPC is the height of a player, the feet on the ground" {
    const sk = skeleton(.{ .pos = v3(3, 4.8, -2), .yaw = 0.7 });
    const hb = hitBoxes(sk);
    // The soles (shin bottom) are on the ground, the head near 1.8 m.
    try std.testing.expectApproxEqAbs(@as(f32, 4.8), hb[0].min[1], 0.08);
    try std.testing.expect(hb[2].max[1] - 4.8 > 1.7 and hb[2].max[1] - 4.8 < 1.9);
    try std.testing.expect(hb[1].min[1] > hb[0].min[1] and hb[2].min[1] > hb[1].min[1] - 0.2);
}

test "npc: the stab thrust puts the knife hand in front of the body" {
    const base = Pose{ .pos = v3(0, 0, 0), .yaw = 0, .action = .stab, .knife = true };
    var wind = base;
    wind.stab = 0.3;
    var out = base;
    out.stab = 0.45;
    const back = handTip(skeleton(wind));
    const front = handTip(skeleton(out));
    // Yaw 0 faces -Z: the thrust goes forward, about chest high.
    try std.testing.expect(front[2] < back[2] - 0.4);
    try std.testing.expect(front[2] < -0.5);
    try std.testing.expect(front[1] > 0.8 and front[1] < 1.6);
}

test "npc: a seated rider has the hips on the seat" {
    for ([_]Action{ .ride_driver, .ride_passenger }) |act| {
        const sk = skeleton(.{ .pos = v3(0, 0.8, 0), .yaw = 0, .action = act });
        const hb = hitBoxes(sk);
        try std.testing.expect(hb[1].min[1] > 0.6 and hb[1].min[1] < 0.85);
        try std.testing.expect(hb[2].max[1] > 1.6 and hb[2].max[1] < 1.85);
    }
}
