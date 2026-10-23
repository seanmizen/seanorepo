// Where: apps/action/game/src/shooter.zig
// When: practice mode on the arena map (main.zig practiceTick, gameRender
// and the use key).
// Why: the NPC shooter of the range. It fires at a target board next to the
// practice spawn, so the player sees and hears what it is to be shot at:
// the crack or the whiz of a near miss, the impact on the material of the
// board, and the muzzle report at the delay of the distance.
//
// - The NPC is a player model (body.zig) with the gun of the
//   panel. It stands down the range at a place of maps/arena.zig
//   shooter_stops. A new distance makes it run to the new place.
// - The control panel stands next to the spawn and faces it. The use key
//   (F) presses the button under the crosshair: the gun, the surface of the
//   board (each material, or no board), the distance, the fire mode, START
//   and STOP. shooter_hud.zig draws the text of the panel.
// - The NPC fires only after START. It stops on STOP, and when the player
//   leaves the range.
// - A round of the NPC hits the map only: never the player, a dummy or a
//   plate. A round is one path, as the shot of another player in
//   deathmatch. main.zig plays it with the sounds of that shot (sounds.zig
//   shotTo) and the impact effect of the material (impact_fx.zig).
//
// This file imports no HUD and no audio module, so the native tests run it
// (shooter_test.zig).
const std = @import("std");
const vec = @import("vec.zig");
const map = @import("map.zig");
const mesh = @import("mesh.zig");
const weapon = @import("weapon.zig");
const guns = @import("guns.zig");
const player = @import("player.zig");
const arena = @import("maps/arena.zig");
const near_miss = @import("audio/near_miss.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;

/// The fire modes. A gun allows a mode when its action can fire it
/// (`allowed`).
pub const Fire = enum { single, burst, auto };

/// What the NPC does. The panel shows it.
pub const Status = enum { stopped, moving, firing, reloading };

/// The buttons of the panel. `rect` gives the place of each on the face.
pub const Button = enum { gun_prev, gun_next, surface_prev, surface_next, dist_prev, dist_next, mode_prev, mode_next, start, stop };

/// The run speed of the NPC to a new place, m/s.
const run_speed: f32 = 8;
/// The pause after a single round or after a burst, s.
const pause: f32 = 1.0;
/// The rounds of a burst from an automatic gun.
const burst_rounds: u32 = 3;
/// The wait from START, from a new gun, or from the arrival at a place, to
/// the first round, s.
const settle: f32 = 0.6;
/// The largest radius of the group of the NPC on the board, m. The line of
/// fire past the board must stay clear of the arena (shooter_test.zig).
pub const max_group: f32 = 0.15;
/// The reach of a round, m.
const reach: f32 = 400;
/// The height of the shoulders of a body: the arms and the gun turn with
/// the pitch about this point (body.zig build).
pub const shoulder: f32 = 1.38;

/// The gun of the NPC: an index of guns.builds (and of weapon.models).
pub var gun: u8 = default_gun;
/// The material of the target board, or null: no board.
pub var surface: ?map.Surface = .concrete;
/// The place of the NPC: an index of arena.shooter_stops.
pub var stop: usize = 2;
pub var fire: Fire = .single;
/// True after START, until STOP or until the player leaves the range.
pub var on = false;

/// The body: the feet, the facing, the walked distance and the velocity
/// (body.zig walks the legs with it).
pub var pos: V3 = v3(0, 0, 0);
pub var vel: V3 = v3(0, 0, 0);
pub var yaw: f32 = 0;
pub var pitch: f32 = 0;
pub var stride: f32 = 0;
/// The muzzle flash time left, and the roll of the flash star.
pub var flash: f32 = 0;
pub var flash_roll: f32 = 0;

/// The time to the next round.
var cooldown: f32 = 0;
/// The rounds left in this string (one round, a burst or a magazine).
var string_left: u32 = 0;
var ammo: u32 = 0;
/// The time into the reload, or -1.
var reload_t: f32 = -1;
var rng: std.Random.DefaultPrng = .init(845);

/// RIFLE 2, the AKM: a supersonic 7.62x39 mm.
const default_gun: u8 = blk: {
    for (guns.builds, 0..) |b, i| {
        if (std.mem.eql(u8, b.name, "AssaultRifle_2")) break :blk @intCast(i);
    }
    @compileError("no AssaultRifle_2 in guns.builds");
};

pub fn stats() *const weapon.Stats {
    return &guns.table[gun];
}

pub fn class() weapon.Class {
    return guns.classOf(guns.builds[gun].name).?;
}

/// The feet of the NPC at place i.
pub fn home(i: usize) V3 {
    const s = arena.shooter_stops[i];
    return v3(s.x, 0, arena.range_spawn.pos[2] + s.d);
}

/// The eye of a player on the practice spawn: the place of the player.
pub fn placeEye() V3 {
    return arena.range_spawn.pos + v3(0, player.eye, 0);
}

/// True when the feet of the player are on the range: south of the
/// doorway of the arena, inside the lane.
pub fn onRange(feet: V3) bool {
    return @abs(feet[0]) < arena.range_half and feet[2] > arena.half + 1 and feet[2] < arena.range_end;
}

/// The look from the shoulders at p to the aim point.
fn aimFrom(p: V3) struct { yaw: f32, pitch: f32 } {
    const d = arena.shooter_aim - (p + v3(0, shoulder, 0));
    return .{ .yaw = std.math.atan2(-d[0], -d[2]), .pitch = std.math.atan2(d[1], @sqrt(d[0] * d[0] + d[2] * d[2])) };
}

/// The world matrix of the gun grip of an upright body with no lean. It is
/// the pose of body.zig build for a third-person body: change the two
/// together.
pub fn gunMatrix(feet: V3, y: f32, p: f32, c: weapon.Class) Mat4 {
    const aim = vec.translate(feet).mul(Mat4.rotationY(y)).mul(vec.translate(v3(0, shoulder, 0)).mul(Mat4.rotationX(p)));
    const grip = switch (c) {
        .pistol, .revolver => v3(0.06, -0.06, -0.44),
        else => v3(0.08, -0.1, -0.24),
    };
    return aim.mul(vec.translate(grip));
}

/// The muzzle of the gun of the NPC. weapon.loadModels must have run.
pub fn muzzle() V3 {
    return vec.xform(gunMatrix(pos, yaw, pitch, class()), weapon.models[gun].muzzle);
}

/// True when the action of the gun can fire mode f: single for a gun that
/// fires one round for each pull, burst for an automatic gun or a burst
/// gun, auto for an automatic gun.
pub fn allowed(st: *const weapon.Stats, f: Fire) bool {
    return switch (f) {
        .single => st.burst == 1,
        .burst => st.auto or st.burst > 1,
        .auto => st.auto,
    };
}

/// The number of fire modes that the gun allows.
pub fn modeCount(st: *const weapon.Stats) usize {
    var n: usize = 0;
    for (std.enums.values(Fire)) |f| {
        if (allowed(st, f)) n += 1;
    }
    return n;
}

/// The radius of the group of the NPC at `dist` m: the cone of the gun at
/// the sights, from 3 cm to max_group.
pub fn groupRadius(st: *const weapon.Stats, dist: f32) f32 {
    return std.math.clamp(st.spread * (1 - st.ads_tight) * dist, 0.03, max_group);
}

// ---- The surfaces ------------------------------------------------------------

/// The look of the target board for each material: the render material,
/// the colour and the name on the panel. Every look except flesh fits its
/// material (map.surfaceFits). Flesh is a block of ballistic gel.
pub const Look = struct { mat: map.Mat, color: V3, name: []const u8 };

pub const looks = std.enums.EnumArray(map.Surface, Look).init(.{
    .concrete = .{ .mat = .concrete, .color = v3(0.62, 0.6, 0.56), .name = "CONCRETE" },
    .brick = .{ .mat = .brick, .color = v3(0.6, 0.29, 0.2), .name = "BRICK" },
    .plaster = .{ .mat = .concrete, .color = v3(0.88, 0.86, 0.8), .name = "PLASTER" },
    .tile = .{ .mat = .wall_tile, .color = v3(0.86, 0.87, 0.84), .name = "TILE" },
    .metal = .{ .mat = .metal, .color = v3(0.34, 0.35, 0.37), .name = "METAL" },
    .sheet_metal = .{ .mat = .metal, .color = v3(0.2, 0.38, 0.52), .name = "SHEET METAL" },
    .glass = .{ .mat = .metal, .color = v3(0.55, 0.7, 0.74), .name = "GLASS" },
    .wood = .{ .mat = .wood, .color = v3(0.56, 0.39, 0.22), .name = "WOOD" },
    .ballast = .{ .mat = .concrete, .color = v3(0.43, 0.41, 0.38), .name = "BALLAST" },
    .earth = .{ .mat = .concrete, .color = v3(0.4, 0.3, 0.2), .name = "EARTH" },
    .fabric = .{ .mat = .cloth, .color = v3(0.25, 0.27, 0.32), .name = "FABRIC" },
    .flesh = .{ .mat = .paint, .color = v3(0.86, 0.6, 0.52), .name = "FLESH (GEL)" },
});

/// The next material in the order of map.Surface. After the last one
/// comes null (no board), then the first one.
pub fn nextSurface(s: ?map.Surface) ?map.Surface {
    const all = std.enums.values(map.Surface);
    const cur = s orelse return all[0];
    const i = @backingInt(cur);
    return if (i + 1 < all.len) all[i + 1] else null;
}

pub fn prevSurface(s: ?map.Surface) ?map.Surface {
    const all = std.enums.values(map.Surface);
    const cur = s orelse return all[all.len - 1];
    const i = @backingInt(cur);
    return if (i > 0) all[i - 1] else null;
}

/// Give the target board the selected material: its look and its surface
/// (the impact sound), or hide it and make it not solid for no board.
pub fn applySurface() void {
    if (map.id != .arena) return;
    const bi = arena.shooter_target orelse return;
    const b = &map.boxes[bi];
    b.solid = surface != null;
    b.visible = surface != null;
    if (surface) |s| {
        const l = looks.get(s);
        b.surface = s;
        b.mat = l.mat;
        b.color = l.color;
    }
}

// ---- The state -----------------------------------------------------------------

fn setGun(g: u8) void {
    gun = g;
    const st = stats();
    ammo = st.mag;
    reload_t = -1;
    string_left = 0;
    // The NPC takes out the new gun.
    cooldown = @max(cooldown, st.draw + settle);
    if (!allowed(st, fire)) {
        for (std.enums.values(Fire)) |f| {
            if (allowed(st, f)) {
                fire = f;
                break;
            }
        }
    }
}

/// Stop the NPC and put it at its place with a full magazine. The panel
/// keeps its settings. Call it after the arena loads.
pub fn reset() void {
    on = false;
    pos = home(stop);
    vel = v3(0, 0, 0);
    const a = aimFrom(pos);
    yaw = a.yaw;
    pitch = a.pitch;
    flash = 0;
    cooldown = 0;
    setGun(gun);
    applySurface();
}

/// Press a button of the panel. Returns false when the press changes
/// nothing (see `enabled`).
pub fn press(b: Button) bool {
    const n_guns: u8 = @intCast(guns.gun_count);
    const n_stops = arena.shooter_stops.len;
    switch (b) {
        .gun_prev => setGun((gun + n_guns - 1) % n_guns),
        .gun_next => setGun((gun + 1) % n_guns),
        .surface_prev => {
            surface = prevSurface(surface);
            applySurface();
        },
        .surface_next => {
            surface = nextSurface(surface);
            applySurface();
        },
        .dist_prev => {
            if (stop == 0) return false;
            stop -= 1;
        },
        .dist_next => {
            if (stop + 1 >= n_stops) return false;
            stop += 1;
        },
        .mode_prev, .mode_next => {
            const st = stats();
            if (modeCount(st) < 2) return false;
            const modes = std.enums.values(Fire);
            var i: usize = @backingInt(fire);
            while (true) {
                i = if (b == .mode_next) (i + 1) % modes.len else (i + modes.len - 1) % modes.len;
                if (allowed(st, modes[i])) break;
            }
            fire = modes[i];
            string_left = 0;
        },
        .start => {
            if (on) return false;
            on = true;
            string_left = 0;
            cooldown = @max(cooldown, settle);
        },
        .stop => {
            if (!on) return false;
            on = false;
            string_left = 0;
        },
    }
    return true;
}

pub fn status() Status {
    if (moving()) return .moving;
    if (!on) return .stopped;
    if (reload_t >= 0) return .reloading;
    return .firing;
}

fn moving() bool {
    const d = home(stop) - pos;
    return d[0] * d[0] + d[2] * d[2] > 1e-4;
}

/// One round of the NPC: the path and what it hit.
pub const Shot = struct {
    /// The muzzle, and the end of the path.
    o: V3,
    e: V3,
    /// The material at the end, or null: the round flew on in the open.
    surface: ?map.Surface,
    /// The normal of the surface at the end.
    normal: V3,
    /// The time from the shot to the end, s.
    flight: f32,
};

/// Fire one round at the aim point, with a random place in the group. The
/// round hits the map only (map.raycast): the player and the dummies are
/// not in its path.
fn shoot() Shot {
    const st = stats();
    const o = muzzle();
    const r = groupRadius(st, vec.len(arena.shooter_aim - o)) * @sqrt(rng.random().float(f32));
    const a = rng.random().float(f32) * std.math.tau;
    const d = vec.norm(arena.shooter_aim + v3(@cos(a) * r, @sin(a) * r, 0) - o);
    var out: Shot = .{ .o = o, .e = o + d * vec.s(reach), .surface = null, .normal = -d, .flight = reach / st.velocity };
    if (map.raycast(o, d, reach)) |h| {
        out.e = o + d * vec.s(h.t);
        out.surface = map.surfaceAt(out.e, h.box);
        out.normal = h.normal;
        out.flight = h.t / st.velocity;
    }
    flash = 0.05;
    flash_roll += 2.1;
    return out;
}

/// The rounds of a new string in the fire mode, at most the rounds in the
/// magazine.
fn stringLength(st: *const weapon.Stats) u32 {
    const n: u32 = switch (fire) {
        .single => 1,
        .burst => if (st.burst > 1) st.burst else burst_rounds,
        .auto => ammo,
    };
    return @max(1, @min(n, ammo));
}

/// Advance the NPC by dt. `feet`: the feet of the player. Returns the
/// round of this step, or null.
pub fn step(dt: f32, feet: V3) ?Shot {
    flash = @max(0, flash - dt);
    if (map.id != .arena) return null;
    if (on and !onRange(feet)) on = false;
    const st = stats();
    var to = home(stop) - pos;
    to[1] = 0;
    const l = vec.len(to);
    if (l > 0.01) {
        // Run to the new place, and face the way.
        const k = @min(l, run_speed * dt);
        pos += to * vec.s(k / l);
        vel = to * vec.s(run_speed / l);
        stride += k;
        yaw = std.math.atan2(-to[0], -to[2]);
        pitch = 0;
        string_left = 0;
        cooldown = @max(cooldown, settle);
        return null;
    }
    pos = home(stop);
    vel = v3(0, 0, 0);
    const a = aimFrom(pos);
    yaw = a.yaw;
    pitch = a.pitch;
    if (!on) {
        string_left = 0;
        cooldown = @max(0, cooldown - dt);
        return null;
    }
    if (reload_t >= 0) {
        reload_t += dt;
        if (reload_t < st.reload) return null;
        reload_t = -1;
        ammo = st.mag;
        cooldown = @max(cooldown, 0.3);
    }
    cooldown -= dt;
    if (cooldown > 0) return null;
    if (string_left == 0) string_left = stringLength(st);
    string_left -= 1;
    ammo -= 1;
    // The time to the next round: the gap of the string, or the pause
    // after it. The rest of this step counts, so the rate stays exact.
    const gap = if (fire == .burst and st.burst > 1) st.burst_gap else st.interval;
    cooldown += if (string_left > 0) gap else @max(pause, st.interval);
    if (ammo == 0) {
        reload_t = 0;
        string_left = 0;
    }
    return shoot();
}

/// The distance along the ray from o to the hit boxes of the NPC (a shot
/// of the player), or null. The NPC takes no damage.
pub fn ray(o: V3, d: V3) ?f32 {
    if (map.id != .arena) return null;
    var best: ?f32 = null;
    for (player.hitBoxes(pos, yaw, 0)) |b| {
        if (map.rayBox(o, d, b.min, b.max)) |h| {
            if (best == null or h.t < best.?) best = h.t;
        }
    }
    return best;
}

/// The arrival times at the place of the player of one round from the NPC
/// at its place, s after the shot: the crack (null for a subsonic gun) or
/// the closest pass of the bullet (the whiz), and the muzzle report.
pub fn timing() struct { crack: ?f32, whiz: f32, report: f32 } {
    const st = stats();
    const p = home(stop);
    const a = aimFrom(p);
    const o = vec.xform(gunMatrix(p, a.yaw, a.pitch, class()), if (weapon.models.len > gun) weapon.models[gun].muzzle else v3(0, 0, -0.5));
    const d = arena.shooter_aim - o;
    const l = vec.len(d);
    const b: near_miss.Bullet = .{ .from = o, .dir = d / vec.s(l), .length = l + 2, .speed = st.velocity, .diameter = st.bullet_d / 1000, .body = st.bullet_l / 1000 };
    const ps = near_miss.pass(b, placeEye(), guns.sound_speed);
    return .{
        .crack = if (ps.crack) |cr| cr.time else null,
        .whiz = ps.nearest + ps.miss / guns.sound_speed,
        .report = ps.muzzle,
    };
}

// ---- The panel ----------------------------------------------------------------
// The face is 1.24 m wide and 0.88 m high. It leans back by `tilt`, and it
// turns to the eye of a player on the spawn. The coordinates on the face
// are in metres from its centre: x to the right, y up.

pub const half_w: f32 = 0.62;
pub const half_h: f32 = 0.44;
const tilt: f32 = 0.35;
/// The height of a button over the face.
pub const button_depth: f32 = 0.02;

/// The rows of the settings, from the top: the y of the arrows and of the
/// value. A line of details is under each row (sub_dy).
pub const Row = enum { gun, surface, distance, mode };
pub const row_y = std.enums.EnumArray(Row, f32).init(.{ .gun = 0.245, .surface = 0.095, .distance = -0.055, .mode = -0.185 });
pub const sub_dy: f32 = -0.062;
pub const title_y: f32 = 0.375;
pub const label_x: f32 = -0.585;
/// The centre of the value, between the two arrows.
pub const value_x: f32 = 0.15;
const prev_x = [2]f32{ -0.27, -0.17 };
const next_x = [2]f32{ 0.47, 0.57 };
const arrow_half: f32 = 0.04;
/// The status lamp, right of the title.
pub const lamp_x = [2]f32{ 0.54, 0.58 };
const start_x = [2]f32{ -0.42, -0.05 };
const stop_x = [2]f32{ 0.05, 0.42 };
const action_y = [2]f32{ -0.41, -0.32 };

/// The frame of the face: the centre, the right, the up and the normal
/// (out of the face, to the player).
pub const Frame = struct { c: V3, r: V3, u: V3, n: V3 };

pub fn frame() Frame {
    const c = arena.panel_centre;
    var h = placeEye() - c;
    h[1] = 0;
    const nh = vec.norm(h);
    const r = vec.norm(vec.cross(v3(0, 1, 0), nh));
    const n = nh * vec.s(@cos(tilt)) + v3(0, @sin(tilt), 0);
    return .{ .c = c, .r = r, .u = vec.cross(n, r), .n = n };
}

/// A point on the face, `z` m out of it.
pub fn point(f: Frame, x: f32, y: f32, z: f32) V3 {
    return f.c + f.r * vec.s(x) + f.u * vec.s(y) + f.n * vec.s(z);
}

fn matrix(f: Frame) Mat4 {
    return .{ .data = .{ f.r[0], f.r[1], f.r[2], 0, f.u[0], f.u[1], f.u[2], 0, f.n[0], f.n[1], f.n[2], 0, f.c[0], f.c[1], f.c[2], 1 } };
}

/// The row of a button, or null for START and STOP.
pub fn rowOf(b: Button) ?Row {
    return switch (b) {
        .gun_prev, .gun_next => .gun,
        .surface_prev, .surface_next => .surface,
        .dist_prev, .dist_next => .distance,
        .mode_prev, .mode_next => .mode,
        .start, .stop => null,
    };
}

/// The place of a button on the face: x0, y0, x1, y1.
pub fn rect(b: Button) [4]f32 {
    if (rowOf(b)) |row| {
        const y = row_y.get(row);
        const xs = switch (b) {
            .gun_prev, .surface_prev, .dist_prev, .mode_prev => prev_x,
            else => next_x,
        };
        return .{ xs[0], y - arrow_half, xs[1], y + arrow_half };
    }
    const xs = if (b == .start) start_x else stop_x;
    return .{ xs[0], action_y[0], xs[1], action_y[1] };
}

/// The button under a ray from o (the eye) in direction d, within max_t.
/// The panel stands in the open, so no wall can be between.
pub fn pick(o: V3, d: V3, max_t: f32) ?Button {
    if (map.id != .arena) return null;
    const f = frame();
    const q = o - f.c;
    // Only from the front of the panel.
    if (vec.dot(q, f.n) <= 0) return null;
    const lo = v3(vec.dot(q, f.r), vec.dot(q, f.u), vec.dot(q, f.n));
    const ld = v3(vec.dot(d, f.r), vec.dot(d, f.u), vec.dot(d, f.n));
    const pad: f32 = 0.012;
    var best: ?Button = null;
    var best_t = max_t;
    for (std.enums.values(Button)) |b| {
        const rc = rect(b);
        if (map.rayBox(lo, ld, v3(rc[0] - pad, rc[1] - pad, -0.01), v3(rc[2] + pad, rc[3] + pad, button_depth + 0.01))) |h| {
            if (h.t < best_t) {
                best_t = h.t;
                best = b;
            }
        }
    }
    return best;
}

/// True when the button can change something: an arrow of the fire mode
/// needs two modes, a distance arrow a place in its direction, START needs
/// the NPC stopped, STOP needs it on.
pub fn enabled(b: Button) bool {
    return switch (b) {
        .mode_prev, .mode_next => modeCount(stats()) > 1,
        .dist_prev => stop > 0,
        .dist_next => stop + 1 < arena.shooter_stops.len,
        .start => !on,
        .stop => on,
        else => true,
    };
}

/// A colour on the backlit face: the colour that shows, for the emissive
/// material (scene.wgsl multiplies the albedo of mat 4 by 7, with no light).
fn glow(c: V3) V3 {
    return c / vec.s(7);
}

/// The panel: its cabinet, the face, the status lamp and the buttons. The
/// face and the buttons are backlit (emissive), so the sun does not wash
/// out the text. The aimed button is orange. START and STOP have their
/// colour while a press can change something, and are dark else. The lamp
/// glows red while the NPC fires.
pub fn buildPanel(dyn: *mesh.Mesh, aimed: ?Button) void {
    const f = frame();
    // The cabinet stands upright under the face, turned with it.
    var nh = f.n;
    nh[1] = 0;
    nh = vec.norm(nh);
    const base = f.c - v3(0, f.c[1], 0);
    const cab = Mat4{ .data = .{ f.r[0], 0, f.r[2], 0, 0, 1, 0, 0, nh[0], 0, nh[2], 0, base[0], base[1], base[2], 1 } };
    const bottom = f.c[1] - half_h * @cos(tilt);
    dyn.orientedBox(cab, v3(-half_w + 0.08, 0, -0.32), v3(half_w - 0.08, bottom + 0.02, 0.1), v3(0.09, 0.1, 0.11), 3);
    const m = matrix(f);
    // The frame round the face, then the face.
    dyn.orientedBox(m, v3(-half_w - 0.03, -half_h - 0.03, -0.06), v3(half_w + 0.03, half_h + 0.03, -0.01), v3(0.12, 0.13, 0.14), 3);
    dyn.orientedBox(m, v3(-half_w, -half_h, -0.05), v3(half_w, half_h, 0), glow(v3(0.045, 0.05, 0.065)), 4);
    // An orange band along the top, and a line under the title.
    dyn.orientedBox(m, v3(-half_w, half_h - 0.025, 0), v3(half_w, half_h, 0.004), glow(v3(0.9, 0.42, 0.1)), 4);
    dyn.orientedBox(m, v3(-half_w + 0.03, title_y - 0.05, 0), v3(half_w - 0.03, title_y - 0.045, 0.002), glow(v3(0.2, 0.21, 0.24)), 4);
    const firing = status() == .firing;
    dyn.orientedBox(m, v3(lamp_x[0], title_y - 0.02, 0), v3(lamp_x[1], title_y + 0.02, 0.012), glow(if (firing) v3(2.0, 0.3, 0.15) else v3(0.12, 0.04, 0.03)), 4);
    for (std.enums.values(Button)) |b| {
        const rc = rect(b);
        const live = enabled(b);
        var col = switch (b) {
            .start => if (live) v3(0.12, 0.6, 0.22) else v3(0.04, 0.1, 0.06),
            .stop => if (live) v3(0.75, 0.14, 0.1) else v3(0.12, 0.04, 0.035),
            else => if (live) v3(0.26, 0.28, 0.33) else v3(0.07, 0.07, 0.085),
        };
        if (aimed == b) col = v3(1.0, 0.5, 0.12);
        dyn.orientedBox(m, v3(rc[0], rc[1], 0), v3(rc[2], rc[3], button_depth), glow(col), 4);
    }
}
