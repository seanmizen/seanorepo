// The gun sounds of the game: the muzzle report of each class, the near
// miss (a crack or a whiz) of the bullet of another player, and the impact
// of a bullet on a surface material (map.Surface). audio/ has the models.
// This file gives them the listener, the room from the map, the bullet of
// each gun (guns.zig: the speed, the diameter, the length) and the volume
// settings, and plays the result (sw_audio).
//
// The times are from the shot. The muzzle report arrives after distance /
// c. A supersonic crack arrives first, from the point where the shock
// leaves the path. An impact arrives after the flight of the bullet and
// the path of its sound. Every sound follows the effects volume
// (sfx_volume) and the master volume (volume).
const std = @import("std");
const audio_mod = @import("sw_audio");
const sfx = @import("audio/root.zig");
const map = @import("map.zig");
const vec = @import("vec.zig");
const weapon = @import("weapon.zig");
const guns = @import("guns.zig");
const settings = @import("settings.zig");
const console = @import("console/root.zig");
const V3 = vec.V3;
const v3 = vec.v3;

/// The longest event, in s: a ring of steel with the tail of a station.
const max_frames: usize = @intFromFloat(2.5 * sfx.rate);

var audio: ?*audio_mod.Audio = null;
var registered = false;
var rng: sfx.Rng = .init(1);
var left: [max_frames]f32 = undefined;
var right: [max_frames]f32 = undefined;
var mono: [max_frames]f32 = undefined;
var lis: sfx.Listener = .{ .pos = .{ 0, 0, 0 }, .right = .{ 1, 0, 0 }, .forward = .{ 0, 0, -1 } };

var nearmiss_distance: *console.Cvar = undefined;
var impact_distance: *console.Cvar = undefined;

const defs = [_]console.Def{
    .{
        .name = "snd_nearmiss_distance",
        .default = .{ .float = 25 },
        .min = 0,
        .max = 200,
        .flags = .{ .saved = true },
        .description = "The largest miss distance in metres at which the bullet of another player makes a crack (supersonic) or a whiz (subsonic). 0 turns the near-miss sound off.",
        .reader = "sounds.zig nearMiss",
    },
    .{
        .name = "snd_impact_distance",
        .default = .{ .float = 60 },
        .min = 0,
        .max = 300,
        .flags = .{ .saved = true },
        .description = "The largest distance in metres at which a bullet impact makes a sound. 0 turns the impact sound off.",
        .reader = "sounds.zig impactSound",
    },
};

pub fn init(a: *audio_mod.Audio, seed: u64) void {
    audio = a;
    rng = .init(seed);
}

/// Add the cvars and the commands to the console.
pub fn register(con: *console.Console) !void {
    nearmiss_distance = try con.addCvar(defs[0]);
    impact_distance = try con.addCvar(defs[1]);
    try con.addCommand(.{
        .name = "nearmiss",
        .args = "[gun] [miss] [range]",
        .description = "Play the near miss of a bullet: a gun (rifle2, pistol1, carbine4 ...), the miss distance to your right in metres (1), and the distance to the shooter in front of you (40).",
        .handler = cmdNearMiss,
    });
    try con.addCommand(.{
        .name = "impact",
        .args = "<material> [distance]",
        .description = "Play the impact of a rifle bullet on a surface material, the distance in metres in front of you (3). The materials: concrete, brick, plaster, tile, metal, sheet_metal, glass, wood, ballast, earth, fabric, flesh.",
        .handler = cmdImpact,
    });
    registered = true;
}

/// The ears of the player: the eye, and the yaw of the head.
pub fn setListener(eye: V3, yaw: f32) void {
    lis = .{ .pos = eye, .right = v3(@cos(yaw), 0, -@sin(yaw)), .forward = v3(-@sin(yaw), 0, -@cos(yaw)) };
}

/// -1 left to 1 right: the side of p for the listener.
fn panOf(p: V3) f32 {
    return std.math.clamp(vec.dot(vec.norm(p - lis.pos), lis.right), -1, 1);
}

fn tone(freq: f32, freq_end: ?f32, dur: f32, wave: audio_mod.Waveform, vol: f32, pan: f32, delay: f32) void {
    const a = audio orelse return;
    a.play(.{ .frequency = freq, .frequency_end = freq_end, .duration = dur, .waveform = wave, .volume = vol * settings.sfx_volume.float(), .pan = pan, .delay = delay });
}

/// The muzzle report of a gun of class c: a noise crack and a falling
/// thump. The shotguns are longer and deeper, the pistol and the SMG are
/// shorter. `delay`: the seconds until its sound arrives.
pub fn muzzle(volume: f32, c: weapon.Class, pan: f32, delay: f32) void {
    switch (c) {
        .shotgun, .sawn_off => {
            tone(1, null, 0.22, .noise, 0.7 * volume, pan, delay);
            tone(110, 32, 0.26, .sine, 0.6 * volume, pan, delay);
        },
        .revolver => {
            tone(1, null, 0.14, .noise, 0.6 * volume, pan, delay);
            tone(150, 40, 0.2, .sine, 0.55 * volume, pan, delay);
        },
        .pistol, .smg => {
            tone(1, null, 0.075, .noise, 0.45 * volume, pan, delay);
            tone(230, 70, 0.1, .sine, 0.4 * volume, pan, delay);
        },
        else => {
            tone(1, null, 0.11, .noise, 0.55 * volume, pan, delay);
            tone(160, 45, 0.16, .sine, 0.5 * volume, pan, delay);
        },
    }
}

fn play(out: *const sfx.Out) void {
    const a = audio orelse return;
    if (out.n == 0) return;
    a.playBuffer(.{
        .left = out.l[0..out.n],
        .right = out.r[0..out.n],
        .sample_rate = sfx.rate,
        .volume = settings.sfx_volume.float(),
        .delay = out.t0,
    });
}

/// The reflection coefficient of the box that a ray hit.
fn reflectOf(h: map.Hit) f32 {
    return sfx.impact.info.get(map.boxes[h.box].surface).reflect;
}

/// The room around p, from the map: the floor and the ceiling over and
/// under p, the nearest wall along X and along Z, and a tail. Deep
/// underground the tail is long (tiled tunnels). Under a ceiling with
/// walls it is a hall, else it is short.
fn roomAt(p: V3) sfx.Room {
    var room: sfx.Room = .{};
    var ceiling = false;
    if (map.raycast(p, v3(0, -1, 0), 40)) |h| room.add(.{ .n = v3(0, 1, 0), .d = p[1] - h.t, .k = reflectOf(h) });
    if (map.raycast(p, v3(0, 1, 0), 25)) |h| {
        room.add(.{ .n = v3(0, -1, 0), .d = -(p[1] + h.t), .k = reflectOf(h) });
        ceiling = true;
    }
    inline for (.{ 0, 2 }) |ax| {
        var best: ?map.Hit = null;
        var sign: f32 = 1;
        for ([_]f32{ 1, -1 }) |sg| {
            var d = v3(0, 0, 0);
            d[ax] = sg;
            if (map.raycast(p, d, 40)) |h| if (best == null or h.t < best.?.t) {
                best = h;
                sign = sg;
            };
        }
        if (best) |h| {
            var n = v3(0, 0, 0);
            n[ax] = -sign;
            var at = p;
            at[ax] += sign * h.t;
            room.add(.{ .n = n, .d = vec.dot(n, at), .k = reflectOf(h) });
        }
    }
    const found: f32 = @floatFromInt(room.count);
    if (p[1] < map.underground_y) {
        room.t60 = 1.5;
        room.wet = 0.035;
    } else if (ceiling and room.count >= 3) {
        room.t60 = 1.0;
        room.wet = 0.02;
    } else {
        room.t60 = 0.25 + 0.1 * found;
        room.wet = 0.003 + 0.002 * found;
    }
    return room;
}

/// True when a box of the map is between a and b.
fn blocked(a: V3, b: V3) bool {
    const d = b - a;
    const l = vec.len(d);
    if (l < 0.3) return false;
    return map.raycast(a, d / vec.s(l), l - 0.15) != null;
}

/// The bullet of a gun on a path from `from` to `to`, or null (no gun).
fn bulletOf(from: V3, to: V3, st: *const weapon.Stats) ?sfx.Bullet {
    if (st.velocity <= 0 or st.bullet_d <= 0) return null;
    const d = to - from;
    const l = vec.len(d);
    if (l < 0.01) return null;
    return .{ .from = from, .dir = d / vec.s(l), .length = l, .speed = st.velocity, .diameter = st.bullet_d / 1000, .body = st.bullet_l / 1000 };
}

/// The strike energy of a bullet of the gun (audio/impact.zig strike): the
/// body damage of one bullet, against 30 for a rifle.
fn energyOf(st: *const weapon.Stats) f32 {
    return std.math.clamp(st.body / 30, 0.3, 2);
}

/// The crack or the whiz of bullet b, when it passes in
/// snd_nearmiss_distance of the listener.
fn nearMiss(b: sfx.Bullet) void {
    if (!registered) return;
    const max = nearmiss_distance.float();
    if (max <= 0) return;
    const p = sfx.near_miss.pass(b, lis.pos, guns.sound_speed);
    if (p.miss > max) return;
    // A wall between the listener and the part of the path that it hears.
    const heard = if (p.crack) |cr| cr.from else b.from + b.dir * vec.s(std.math.clamp(p.along, 0, b.length));
    const occ = blocked(lis.pos, heard);
    var out: sfx.Out = .{ .l = &left, .r = &right };
    const room = roomAt(lis.pos);
    if (!sfx.near_miss.render(&out, &mono, b, lis, &room, &rng, .{
        .c = guns.sound_speed,
        .max_miss = max,
        .occlusion = if (occ) 0.35 else 1,
        .occlusion_cutoff = if (occ) 1500 else 20000,
    })) return;
    play(&out);
}

/// An impact on `surface` at p, `time` s after the shot (the flight).
fn impactSound(p: V3, surface: map.Surface, energy: f32, time: f32) void {
    if (!registered) return;
    const max = impact_distance.float();
    if (max <= 0 or vec.len(p - lis.pos) > max) return;
    const occ = blocked(lis.pos, p);
    var out: sfx.Out = .{ .l = &left, .r = &right };
    const room = roomAt(lis.pos);
    sfx.impact.render(&out, &mono, .{
        .pos = p,
        .material = surface,
        .energy = energy,
        .time = time,
        .occlusion = if (occ) 0.3 else 1,
        .occlusion_cutoff = if (occ) 1200 else 20000,
    }, lis, &room, &rng, guns.sound_speed);
    play(&out);
}

/// The impact of a bullet of the gun `st` at p, on `surface`, after
/// `flight` m from the muzzle.
pub fn impact(p: V3, surface: map.Surface, st: *const weapon.Stats, flight: f32) void {
    const v = if (st.velocity > 0) st.velocity else guns.sound_speed;
    impactSound(p, surface, energyOf(st), flight / v);
}

/// What a shot hit at the end of its path.
const End = union(enum) { nothing, surface: map.Surface };

fn shot(o: V3, e: V3, class: weapon.Class, st: *const weapon.Stats, end: End) void {
    const dist = vec.len(o - lis.pos);
    muzzle(std.math.clamp(6 / (dist + 4), 0.05, 0.6), class, panOf(o), dist / guns.sound_speed);
    const b = bulletOf(o, e, st) orelse return;
    nearMiss(b);
    switch (end) {
        .nothing => {},
        .surface => |s| impact(e, s, st, b.length),
    }
}

/// Another player fired from o, and its first pellet ended at e. `model`
/// is the gun (the model that the shooter holds). The listener hears the
/// muzzle report when its sound arrives, the crack or the whiz of the
/// bullet, and the impact at e: on the map, or on a player when the path
/// ends short of the reach of the gun and of the map.
pub fn remoteShot(o: V3, e: V3, class: weapon.Class, model: u8) void {
    const st = weapon.gunStats(model);
    const d = e - o;
    const l = vec.len(d);
    var end: End = .nothing;
    if (l > 0.01 and l < st.range - 0.5) {
        end = .{ .surface = .flesh };
        if (map.raycast(o, d / vec.s(l), l + 0.05)) |h| {
            if (h.t > l - 0.08) end = .{ .surface = map.surfaceAt(o + d / vec.s(l) * vec.s(h.t), h.box) };
        }
    }
    shot(o, e, class, st, end);
}

/// The model of a gun from a name such as "rifle2": a class and the number
/// of the gun in its class (the weapon menu), or null.
fn gunByName(name: []const u8) ?struct { class: weapon.Class, model: u8 } {
    var k = name.len;
    while (k > 0 and std.ascii.isDigit(name[k - 1])) k -= 1;
    if (k == 0 or k == name.len) return null;
    const class = std.meta.stringToEnum(weapon.Class, name[0..k]) orelse return null;
    const n = std.fmt.parseInt(usize, name[k..], 10) catch return null;
    var count: usize = 0;
    for (guns.builds, 0..) |b, i| {
        if (guns.classOf(b.name) != class) continue;
        count += 1;
        if (count == n) return .{ .class = class, .model = @intCast(i) };
    }
    return null;
}

fn floatArg(args: *const console.Args, i: usize, default: f32) ?f32 {
    if (args.count() <= i) return default;
    return std.fmt.parseFloat(f32, args.get(i)) catch null;
}

fn cmdNearMiss(c: *console.Console, cmd: *const console.Command, args: *const console.Args) void {
    const name = if (args.count() > 1) args.get(1) else "rifle2";
    const gun = gunByName(name) orelse return c.printErr("{s}: no gun {s}. Give a class and a number, for example rifle2 or pistol1", .{ cmd.name, name });
    const miss = floatArg(args, 2, 1) orelse return c.printErr("usage: {s} {s}", .{ cmd.name, cmd.args });
    const range = floatArg(args, 3, 40) orelse return c.printErr("usage: {s} {s}", .{ cmd.name, cmd.args });
    const st = weapon.gunStats(gun.model);
    // The shooter stands `range` m in front, and aims `miss` m to the
    // right of the eye. The walls before the listener do not stop the
    // bullet (they make the sound dull). After the listener it flies on
    // for 30 m, or to a wall.
    const from = lis.pos + lis.forward * vec.s(@max(range, 1));
    const dir = vec.norm(lis.pos + lis.right * vec.s(miss) - from);
    const near = vec.dot(lis.pos - from, dir);
    var end: End = .nothing;
    var t = near + 30;
    if (map.raycast(from + dir * vec.s(near), dir, 30)) |h| {
        t = near + h.t;
        end = .{ .surface = map.surfaceAt(from + dir * vec.s(t), h.box) };
    }
    shot(from, from + dir * vec.s(t), gun.class, st, end);
    const p = sfx.near_miss.pass(bulletOf(from, from + dir * vec.s(t), st).?, lis.pos, guns.sound_speed);
    c.print("{s}: {s}, {d:.0} m/s, {s}", .{ name, st.calibre, st.velocity, if (st.supersonic()) "supersonic: a crack" else "subsonic: a whiz" });
    if (p.crack) |cr| {
        c.print("crack at {d:.0} ms ({d:.0} Pa, N-wave {d:.0} us), muzzle report at {d:.0} ms", .{ cr.time * 1000, cr.peak, cr.width * 1e6, p.muzzle * 1000 });
    } else {
        c.print("muzzle report at {d:.0} ms, bullet nearest at {d:.0} ms", .{ p.muzzle * 1000, (p.nearest + p.miss / guns.sound_speed) * 1000 });
    }
}

fn cmdImpact(c: *console.Console, cmd: *const console.Command, args: *const console.Args) void {
    if (args.count() < 2) return c.printErr("usage: {s} {s}", .{ cmd.name, cmd.args });
    const m = std.meta.stringToEnum(map.Surface, args.get(1)) orelse return c.printErr("{s}: no material {s}. See help impact", .{ cmd.name, args.get(1) });
    const dist = floatArg(args, 2, 3) orelse return c.printErr("usage: {s} {s}", .{ cmd.name, cmd.args });
    impactSound(lis.pos + lis.forward * vec.s(@max(dist, 0.3)), m, 1, 0);
    c.print("{s}: {s}", .{ @tagName(m), sfx.impact.info.get(m).what });
}
