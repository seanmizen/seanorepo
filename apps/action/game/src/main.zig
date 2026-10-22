// action.seanmizen.com: a first-person shooter on swindowzig.
//
// Modes:
//   - menu: the camera turns slowly over the arena. 1, 2 or a click on a
//     button picks a mode.
//   - deathmatch: the always-on lobby on the server (/api/ws). A match is
//     5 minutes, then the score board shows, then the next match starts.
//   - practice: offline. 60 seconds of pop-up targets, with a best score.
//
// Controls: WASD move, Space jump, mouse look, left click fire, right click
// aim, R reload, Tab scores, Esc release the mouse, M menu (while paused).
const std = @import("std");
const sw = @import("sw_app");
const core = @import("sw_core");
const gpu_mod = @import("sw_gpu");
const gfx = @import("sw_gfx2d");
const sw_text = @import("sw_text");
const platform = @import("sw_platform");
const audio_mod = @import("sw_audio");
const vec = @import("vec.zig");
const map = @import("map.zig");
const mesh = @import("mesh.zig");
const render = @import("render.zig");
const weapon = @import("weapon.zig");
const player_mod = @import("player.zig");
const net = @import("net.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;

pub fn main() void {}

// std.log on wasm32-freestanding needs a log function: the default one
// pulls in posix. This one hands the line to the console (env.jsLog).
pub const std_options: std.Options = .{ .logFn = logFn, .log_level = .info };

extern fn jsLog(ptr: [*]const u8, len: u32) void;
// 1 while the canvas has the pointer lock (backends/wasm/loader.ts).
extern fn jsPointerLocked() u32;

fn logFn(comptime level: std.log.Level, comptime scope: @TypeOf(.enum_literal), comptime fmt: []const u8, args: anytype) void {
    _ = scope;
    var buf: [512]u8 = undefined;
    const msg = std.fmt.bufPrint(&buf, "[" ++ @tagName(level) ++ "] " ++ fmt, args) catch "[log truncated]";
    jsLog(msg.ptr, @intCast(msg.len));
}

const tick_hz = 120;
const dt: f32 = 1.0 / @as(f32, tick_hz);
const font_bytes = @embedFile("assets/Lato-Regular.ttf");

const Mode = enum { menu, deathmatch, practice };

// ---- State -----------------------------------------------------------------

var alloc: std.mem.Allocator = undefined;
var mode: Mode = .menu;
// True while the canvas has the pointer lock. Each tick reads the real
// state, so a refused or lost lock always shows "click to play".
var captured = false;
var show_debug = false;
var frame_ms: f32 = 16;
// Eye adaptation: the exposure moves toward the target of where the eye is.
var exposure: f32 = 0.68;
var time: f32 = 0;
var ticks: u64 = 0;
var rng: std.Random.DefaultPrng = .init(7);

var me: player_mod.Player = .{};
var gun: weapon.Gun = .{};
var alive = true;
var hp: i32 = 100;
var damage_flash: f32 = 0;
var hit_marker: f32 = 0;
var hit_marker_kill = false;
var dead_time: f32 = 0;
var killed_by: [24]u8 = undefined;
var killed_by_len: usize = 0;

var static_mesh: mesh.Mesh = undefined;
var map_loaded = false;
var door_reopened: [4]bool = @splat(false);
var shocked = false;
var dyn: mesh.Mesh = undefined;
var hud: ?gfx.Renderer = null;
var text: ?sw_text.TextRenderer = null;
var audio: audio_mod.Audio = undefined;
var my_name: [16]u8 = undefined;
var my_name_len: usize = 0;

// Effects.
const Tracer = struct { a: V3, b: V3, life: f32 };
const Spark = struct { p: V3, v: V3, life: f32, col: V3 };
var tracers: [32]Tracer = undefined;
var tracer_n: usize = 0;
var sparks: [128]Spark = undefined;
var spark_n: usize = 0;
var remote_flash: struct { p: V3, life: f32 } = .{ .p = v3(0, 0, 0), .life = 0 };

// Deathmatch.
var client: net.Client = undefined;
var my_id: u32 = 0;
var phase_end = false;
var time_left: f32 = 0;
var sent_hello = false;
const Remote = struct {
    id: u32,
    name: [16]u8 = undefined,
    name_len: usize = 0,
    pos: V3,
    target: V3,
    yaw: f32,
    pitch: f32,
    hp: i32,
    k: u32,
    d: u32,
    alive: bool,
    fall: f32 = 0,
    stride: f32 = 0,
    seen: bool = true,
    /// The time of its last shot: the minimap shows a shooter for a moment.
    shot_t: f32 = -100,
};
var remotes: [24]Remote = undefined;
var remote_n: usize = 0;
var my_k: u32 = 0;
var my_d: u32 = 0;
const FeedLine = struct { text: [64]u8, len: usize, life: f32, mine: bool };
var feed: [5]FeedLine = undefined;
var feed_n: usize = 0;

// Practice.
const Target = struct {
    base: V3,
    yaw: f32,
    move: f32,
    phase: f32,
    fall: f32 = 0, // 0 up, rises to 1 when hit
    down_time: f32 = 0,
    up: bool = true,
};
const PracticePhase = enum { countdown, running, results };
var targets: [6]Target = undefined;
var practice_phase: PracticePhase = .countdown;
var practice_t: f32 = 0;
var score: u32 = 0;
var shots: u32 = 0;
var hits: u32 = 0;
var best: u32 = 0;
var new_best = false;
const practice_len: f32 = 60;

// ---- Helpers ---------------------------------------------------------------

fn rand() f32 {
    return rng.random().float(f32);
}

fn colorFor(id: u32) V3 {
    const palette = [_]V3{
        v3(0.75, 0.2, 0.18), v3(0.2, 0.45, 0.8), v3(0.85, 0.65, 0.15), v3(0.25, 0.65, 0.35),
        v3(0.6, 0.3, 0.75),  v3(0.9, 0.45, 0.2), v3(0.2, 0.7, 0.7),    v3(0.85, 0.85, 0.85),
    };
    return palette[id % palette.len];
}

fn copyName(dst: []u8, src: []const u8) usize {
    const n = @min(dst.len, src.len);
    @memcpy(dst[0..n], src[0..n]);
    return n;
}

fn sound(freq: f32, freq_end: ?f32, dur: f32, wave: audio_mod.Waveform, vol: f32) void {
    audio.play(.{ .frequency = freq, .frequency_end = freq_end, .duration = dur, .waveform = wave, .volume = vol });
}

fn gunshotSound(volume: f32) void {
    sound(1, null, 0.11, .noise, 0.55 * volume);
    sound(160, 45, 0.16, .sine, 0.5 * volume);
}

fn cameraMatrix() Mat4 {
    return vec.ypr(me.eyePos(), me.yaw, me.pitch, 0);
}

fn addTracer(a: V3, b: V3) void {
    tracers[tracer_n % tracers.len] = .{ .a = a, .b = b, .life = 0.07 };
    tracer_n += 1;
}

fn addSparks(p: V3, n: V3, col: V3, count: usize) void {
    for (0..count) |_| {
        const r = v3(rand() - 0.5, rand() - 0.5, rand() - 0.5);
        sparks[spark_n % sparks.len] = .{
            .p = p + n * vec.s(0.02),
            .v = (n * vec.s(2.5) + r * vec.s(4)) * vec.s(0.5 + rand()),
            .life = 0.25 + rand() * 0.25,
            .col = col,
        };
        spark_n += 1;
    }
}

fn pushFeed(line: []const u8, mine: bool) void {
    if (feed_n == feed.len) {
        for (1..feed.len) |i| feed[i - 1] = feed[i];
        feed_n -= 1;
    }
    var f: FeedLine = .{ .text = undefined, .len = 0, .life = 6, .mine = mine };
    f.len = copyName(&f.text, line);
    feed[feed_n] = f;
    feed_n += 1;
}

fn spawnAt(x: f32, y: f32, z: f32, yaw: f32) void {
    shocked = false;
    me = .{ .pos = v3(x, y, z), .yaw = yaw };
    const reserve = gun.reserve;
    gun.reset();
    if (mode == .practice) gun.reserve = reserve;
    alive = true;
    hp = 100;
}

/// Build a map and upload its static mesh. Nothing happens if it is the
/// map already loaded.
fn loadMap(ctx: *sw.Context, id: map.Id) void {
    if (map_loaded and map.id == id) return;
    map.load(id);
    map_loaded = true;
    static_mesh.clear();
    for (map.boxes[0..map.box_count]) |b| {
        if (!b.dynamic and b.visible) static_mesh.box(b.min, b.max, b.color, @floatFromInt(@backingInt(b.mat)));
    }
    for (map.decor.items) |d| {
        const m: f32 = @floatFromInt(@backingInt(d.mat));
        if (d.disc) static_mesh.disc(d.m, d.min[0], d.min[1], d.color, m) else static_mesh.orientedBox(d.m, d.min, d.max, d.color, m);
    }
    render.loadMap(ctx.gpu(), static_mesh.verts.items) catch |err| std.log.err("action: map upload: {s}", .{@errorName(err)});
}

fn crossed(a: f32, b: f32, at: f32) bool {
    return a < at and b >= at;
}

fn trainSounds(a: f32, b: f32) void {
    if (crossed(a, b, 0.05)) {
        sound(70, 38, 6.0, .sawtooth, 0.12);
        sound(1, null, 5.0, .noise, 0.08);
    }
    if (crossed(a, b, 7.5)) sound(900, 300, 1.6, .sine, 0.05); // brakes
    if (crossed(a, b, 10)) {
        sound(784, null, 0.35, .sine, 0.12);
        sound(523, null, 0.6, .sine, 0.1);
    }
    if (crossed(a, b, 23.5)) {
        sound(659, null, 0.25, .sine, 0.12);
        sound(659, null, 0.25, .sine, 0.12);
    }
    if (crossed(a, b, 27)) sound(120, 400, 6.0, .sawtooth, 0.06); // traction motors
}

/// The details of the deep train over its body box: windows lit from
/// inside, red doors that slide open, cab ends, a roof and a skirt.
fn buildTrain(tr: map.Train) void {
    const b = map.boxes[tr.box];
    if (b.max[0] < -60 or b.min[0] > 60) return;
    const zf = b.max[2]; // the platform face
    const zb = b.min[2];
    const y0 = b.min[1];
    const open = map.trainDoors(tr.t);
    dyn.box(v3(b.min[0], b.max[1], zb + 0.15), v3(b.max[0], b.max[1] + 0.25, zf - 0.15), v3(0.32, 0.33, 0.35), 3);
    for ([_]f32{ zf, zb - 0.02 }) |z| {
        const zz = z + 0.0;
        dyn.box(v3(b.min[0], y0, zz), v3(b.max[0], y0 + 0.55, zz + 0.02), v3(0.05, 0.12, 0.42), 0);
        var x = b.min[0] + 0.6;
        var car: usize = 0;
        while (x < b.max[0] - 1) : (x += 10) {
            // A car: two windows and two doors on this side.
            dyn.box(v3(x + 0.5, y0 + 1.75, zz - 0.005), v3(x + 3.2, y0 + 2.7, zz + 0.025), v3(0.42, 0.33, 0.2), 4);
            dyn.box(v3(x + 5.6, y0 + 1.75, zz - 0.005), v3(x + 8.3, y0 + 2.7, zz + 0.025), v3(0.42, 0.33, 0.2), 4);
            for ([_]f32{ 3.6, 8.7 }) |dx| {
                const slide = if (z == zf) open * 0.65 else 0;
                for ([_]f32{ -1, 1 }) |side| {
                    const c = x + dx + side * (0.33 + slide);
                    dyn.box(v3(c - 0.32, y0 + 0.6, zz - 0.01), v3(c + 0.32, y0 + 2.9, zz + 0.035), v3(0.7, 0.05, 0.04), 0);
                }
                if (z == zf and open > 0.02) {
                    // The lit car floor shows through the open doors.
                    dyn.box(v3(x + dx - 0.6 * open, y0 + 0.6, zz - 0.02), v3(x + dx + 0.6 * open, y0 + 2.9, zz - 0.01), v3(0.36, 0.3, 0.2), 4);
                }
            }
            car += 1;
        }
    }
    for ([_]f32{ b.min[0] - 0.2, b.max[0] }) |ex| {
        dyn.box(v3(ex, y0, zb), v3(ex + 0.2, b.max[1], zf), v3(0.7, 0.05, 0.04), 0);
        dyn.box(v3(ex - 0.01, y0 + 1.8, zb + 0.5), v3(ex + 0.21, y0 + 2.6, zf - 0.5), v3(0.02, 0.03, 0.04), 0);
    }
    // Headlights at the leading (-X) end.
    dyn.box(v3(b.min[0] - 0.24, y0 + 0.9, zb + 0.4), v3(b.min[0] - 0.19, y0 + 1.15, zb + 0.8), v3(1.0, 0.97, 0.9), 4);
    dyn.box(v3(b.min[0] - 0.24, y0 + 0.9, zf - 0.8), v3(b.min[0] - 0.19, y0 + 1.15, zf - 0.4), v3(1.0, 0.97, 0.9), 4);
}

/// The escalator steps are static boxes. Their yellow edges slide along
/// each tread, so the steps look as if they move: down in the left lane,
/// up in the right lane (map.zig escalators, the same speed).
fn buildEscalatorSteps() void {
    const ec = @import("maps/earls_court.zig");
    // The steps go down to the east. The north lane runs down, the south
    // lane up (maps/earls_court.zig escalators, the same speed).
    const lanes = [_]struct { z0: f32, z1: f32, dir: f32 }{
        .{ .z0 = -23.9, .z1 = -22.75, .dir = 1 },
        .{ .z0 = -22.25, .z1 = -21.1, .dir = -1 },
    };
    const k = @mod(time * 0.65 / ec.esc_run, 1.0);
    for (lanes) |lane| {
        const f = if (lane.dir > 0) k else 1 - k;
        for (0..ec.esc_steps) |i| {
            const fi: f32 = @floatFromInt(i);
            const top = ec.mid_y - ec.esc_rise * (fi + 1);
            const x = ec.esc_top_x + ec.esc_run * (fi + f);
            dyn.box(v3(x, top, lane.z0), v3(x + 0.05, top + 0.01, lane.z1), v3(0.85, 0.68, 0.08), 0);
            dyn.box(v3(x + 0.33, top, lane.z0), v3(x + 0.36, top + 0.006, lane.z1), v3(0.3, 0.3, 0.32), 3);
        }
    }
}

/// True while the tired tube is lit (see map.flicker_light).
fn flickerOn() bool {
    const t = time * 9.0;
    return vec.hash(@intFromFloat(@floor(t))) > 0.18 or vec.hash(@intFromFloat(@floor(t * 7.0))) > 0.5;
}

fn pressButton(i: usize) void {
    const b = map.buttons[i];
    if (mode == .deathmatch) {
        client.send("{{\"t\":\"use\",\"i\":{d},\"l\":{d}}}", .{ b.lift, b.level });
    } else {
        map.callLift(b.lift, b.level);
    }
    sound(1100, null, 0.05, .sine, 0.15);
}

/// The button under the crosshair, within reach.
fn aimedButton() ?usize {
    if (mode == .menu or (mode == .deathmatch and !alive)) return null;
    return map.pickButton(me.eyePos(), vec.forward(me.yaw, me.pitch), 2.6);
}

// ---- Modes -----------------------------------------------------------------

fn enterMenu(ctx: *sw.Context) void {
    if (mode == .deathmatch) client.close();
    mode = .menu;
    remote_n = 0;
    ctx.setMouseCapture(false);
    loadMap(ctx, .earls_court);
}

fn enterPractice(ctx: *sw.Context) void {
    loadMap(ctx, .arena);
    mode = .practice;
    gun.reserve = 9999;
    spawnAt(0, 1.6, 2.5, 0);
    practice_phase = .countdown;
    practice_t = 3;
    score = 0;
    shots = 0;
    hits = 0;
    new_best = false;
    for (&targets, 0..) |*t, i| placeTarget(t, i);
}

fn enterDeathmatch(ctx: *sw.Context) void {
    loadMap(ctx, .earls_court);
    mode = .deathmatch;
    remote_n = 0;
    feed_n = 0;
    my_id = 0;
    my_k = 0;
    my_d = 0;
    sent_hello = false;
    alive = false;
    dead_time = 0;
    killed_by_len = 0;
    const s = map.spawns[@intFromFloat(rand() * (@as(f32, @floatFromInt(map.spawn_count)) - 0.01))];
    spawnAt(s.pos[0], s.pos[1], s.pos[2], s.yaw);
    alive = false;
    client.connect();
}

fn placeTarget(t: *Target, salt: usize) void {
    // A ring around the centre platform, 9 to 24 m out.
    var tries: usize = 0;
    while (tries < 30) : (tries += 1) {
        const a = rand() * std.math.tau;
        const r = 9 + rand() * 15;
        const p = v3(@cos(a) * r, 0, @sin(a) * r);
        if (map.overlaps(p - v3(0.6, -0.05, 0.6), p + v3(0.6, 2.0, 0.6))) continue;
        t.* = .{
            .base = p,
            .yaw = std.math.atan2(p[0], p[2]),
            .move = if (rand() < 0.35) 1.5 + rand() * 1.5 else 0,
            .phase = rand() * 6 + @as(f32, @floatFromInt(salt % 100)),
        };
        return;
    }
}

/// The plate centre and its normal (toward the centre of the arena).
fn targetPlate(t: *const Target) struct { c: V3, n: V3 } {
    const right = v3(@cos(t.yaw), 0, -@sin(t.yaw));
    const off = right * vec.s(@sin(time * 1.3 + t.phase) * t.move);
    const n = v3(-@sin(t.yaw), 0, -@cos(t.yaw));
    return .{ .c = t.base + off + v3(0, 1.45, 0), .n = n };
}

// ---- Shooting --------------------------------------------------------------

const RemoteHit = struct { idx: usize, t: f32, head: bool };

fn rayRemotes(o: V3, d: V3) ?RemoteHit {
    var best_hit: ?RemoteHit = null;
    for (remotes[0..remote_n], 0..) |r, i| {
        if (!r.alive) continue;
        const head_c = r.pos + v3(0, 1.62, 0);
        if (map.rayBox(o, d, head_c - vec.s(0.16), head_c + vec.s(0.16))) |h| {
            if (best_hit == null or h.t < best_hit.?.t) best_hit = .{ .idx = i, .t = h.t, .head = true };
        }
        if (map.rayBox(o, d, r.pos - v3(0.3, 0, 0.3), r.pos + v3(0.3, 1.46, 0.3))) |h| {
            if (best_hit == null or h.t < best_hit.?.t) best_hit = .{ .idx = i, .t = h.t, .head = false };
        }
    }
    return best_hit;
}

fn fire() void {
    shots += 1;
    const moving = @min(1, @sqrt(me.vel[0] * me.vel[0] + me.vel[2] * me.vel[2]) / 6);
    const sp = gun.spread(moving, !me.grounded);
    const f = vec.forward(me.yaw, me.pitch);
    const right = vec.norm(vec.cross(f, v3(0, 1, 0)));
    const up = vec.cross(right, f);
    const a = rand() * std.math.tau;
    const r = @sqrt(rand()) * sp;
    const d = vec.norm(f + right * vec.s(@cos(a) * r) + up * vec.s(@sin(a) * r));
    const o = me.eyePos();

    var t_hit: f32 = 200;
    var n_hit = v3(0, 1, 0);
    var hit_world = false;
    if (map.raycast(o, d, 200)) |h| {
        t_hit = h.t;
        n_hit = h.normal;
        hit_world = true;
    }

    var remote_hit: ?RemoteHit = null;
    var target_hit: ?usize = null;
    var bull = false;
    if (mode == .deathmatch) {
        if (rayRemotes(o, d)) |rh| {
            if (rh.t < t_hit) {
                remote_hit = rh;
                t_hit = rh.t;
            }
        }
    } else if (mode == .practice and practice_phase == .running) {
        for (&targets, 0..) |*t, i| {
            if (!t.up) continue;
            const pl = targetPlate(t);
            const denom = vec.dot(d, pl.n);
            if (@abs(denom) < 1e-4) continue;
            const tt = vec.dot(pl.c - o, pl.n) / denom;
            if (tt <= 0 or tt >= t_hit) continue;
            const dist = vec.len(o + d * vec.s(tt) - pl.c);
            if (dist < 0.42) {
                t_hit = tt;
                target_hit = i;
                bull = dist < 0.12;
            }
        }
    }

    const end = o + d * vec.s(t_hit);
    const pose = gun.pose(me.stride * 1.7, 0);
    const muzzle = vec.xform(cameraMatrix().mul(pose.gun), pose.muzzle);
    addTracer(muzzle, end);
    gunshotSound(1);

    if (remote_hit) |rh| {
        addSparks(end, -d, v3(0.7, 0.05, 0.03), 10);
        hit_marker = 0.18;
        hit_marker_kill = false;
        sound(1500, 1300, 0.04, .square, 0.12);
        const rem = &remotes[rh.idx];
        client.send("{{\"t\":\"fire\",\"o\":[{d:.2},{d:.2},{d:.2}],\"e\":[{d:.2},{d:.2},{d:.2}],\"hit\":{d},\"head\":{s}}}", .{
            muzzle[0], muzzle[1], muzzle[2], end[0], end[1], end[2], rem.id, if (rh.head) "true" else "false",
        });
        return;
    }
    if (mode == .deathmatch) {
        client.send("{{\"t\":\"fire\",\"o\":[{d:.2},{d:.2},{d:.2}],\"e\":[{d:.2},{d:.2},{d:.2}],\"hit\":-1,\"head\":false}}", .{
            muzzle[0], muzzle[1], muzzle[2], end[0], end[1], end[2],
        });
    }
    if (target_hit) |i| {
        const t = &targets[i];
        t.up = false;
        t.down_time = 0;
        hits += 1;
        score += if (bull) 150 else 100;
        hit_marker = 0.18;
        hit_marker_kill = bull;
        addSparks(end, -d, v3(1.0, 0.8, 0.5), 8);
        sound(if (bull) 1900 else 1400, null, 0.05, .sine, 0.2);
    } else if (hit_world) {
        addSparks(end, n_hit, v3(1.0, 0.75, 0.4), 6);
    }
}

fn recoilKick() void {
    me.pitch = @min(1.5, me.pitch + 0.011 + 0.006 * gun.heat * (1 - 0.5 * gun.ads));
    me.yaw += (rand() - 0.5) * 0.008;
}

// ---- Networking ------------------------------------------------------------

fn findRemote(id: u32) ?*Remote {
    for (remotes[0..remote_n]) |*r| if (r.id == id) return r;
    return null;
}

fn handleSnap(m: net.Msg) void {
    phase_end = if (m.phase) |p| std.mem.eql(u8, p, "end") else false;
    time_left = m.left orelse 0;
    if (m.tt) |tt| map.syncTrain(tt);
    if (m.lifts) |ls| for (ls, 0..) |l, i| {
        map.syncLift(i, l[0], l[1], @intFromFloat(@max(0, l[2])), @intFromFloat(@max(0, l[3])));
    };
    for (remotes[0..remote_n]) |*r| r.seen = false;
    for (m.players orelse &.{}) |p| {
        if (p.id == my_id) {
            hp = p.hp;
            my_k = p.k;
            my_d = p.d;
            continue;
        }
        const target = v3(p.x, p.y, p.z);
        var r = findRemote(p.id);
        if (r == null and remote_n < remotes.len) {
            remotes[remote_n] = .{ .id = p.id, .pos = target, .target = target, .yaw = p.yaw, .pitch = p.pitch, .hp = p.hp, .k = 0, .d = 0, .alive = p.alive };
            r = &remotes[remote_n];
            remote_n += 1;
        }
        const rem = r orelse continue;
        rem.name_len = copyName(&rem.name, p.name);
        if (!rem.alive and p.alive) {
            rem.pos = target;
            rem.fall = 0;
        }
        rem.target = target;
        rem.yaw = p.yaw;
        rem.pitch = p.pitch;
        rem.hp = p.hp;
        rem.k = p.k;
        rem.d = p.d;
        rem.alive = p.alive;
        rem.seen = true;
    }
    // Drop the players that left.
    var i: usize = 0;
    while (i < remote_n) {
        if (!remotes[i].seen) {
            remotes[i] = remotes[remote_n - 1];
            remote_n -= 1;
        } else i += 1;
    }
}

fn handleNet() void {
    client.beginFrame();
    if (client.state() == .open and !sent_hello) {
        client.send("{{\"t\":\"hello\",\"name\":\"{s}\"}}", .{my_name[0..my_name_len]});
        sent_hello = true;
    }
    while (client.poll()) |m| {
        if (std.mem.eql(u8, m.t, "welcome")) {
            my_id = m.id orelse 0;
        } else if (std.mem.eql(u8, m.t, "snap")) {
            handleSnap(m);
        } else if (std.mem.eql(u8, m.t, "spawn")) {
            spawnAt(m.x orelse 0, m.y orelse 0, m.z orelse 0, m.yaw orelse 0);
            dead_time = 0;
        } else if (std.mem.eql(u8, m.t, "shot")) {
            if (m.o != null and m.e != null) {
                const a = v3(m.o.?[0], m.o.?[1], m.o.?[2]);
                const b = v3(m.e.?[0], m.e.?[1], m.e.?[2]);
                addTracer(a, b);
                addSparks(b, vec.norm(a - b), v3(1.0, 0.75, 0.4), 4);
                remote_flash = .{ .p = a, .life = 0.05 };
                if (findRemote(m.id orelse 0)) |r| r.shot_t = time;
                const dist = vec.len(a - me.eyePos());
                gunshotSound(std.math.clamp(6 / (dist + 4), 0.05, 0.6));
            }
        } else if (std.mem.eql(u8, m.t, "hit")) {
            hp = m.hp orelse hp;
            damage_flash = @min(1, damage_flash + 0.5);
            sound(220, 90, 0.12, .sawtooth, 0.25);
        } else if (std.mem.eql(u8, m.t, "kill")) {
            const killer = m.killer orelse 0;
            const victim = m.victim orelse 0;
            var line: [64]u8 = undefined;
            const s = std.fmt.bufPrint(&line, "{s}  {s}  {s}", .{
                m.kname orelse "?", if (m.head orelse false) "[HS]" else ">", m.vname orelse "?",
            }) catch "";
            pushFeed(s, killer == my_id or victim == my_id);
            if (victim == my_id) {
                alive = false;
                dead_time = 0;
                hp = 0;
                killed_by_len = copyName(&killed_by, m.kname orelse "?");
                sound(300, 60, 0.6, .sawtooth, 0.3);
            }
            if (killer == my_id and victim != my_id) {
                hit_marker = 0.35;
                hit_marker_kill = true;
                sound(900, null, 0.06, .sine, 0.25);
                sound(1350, null, 0.12, .sine, 0.2);
            }
            if (findRemote(victim)) |r| r.alive = false;
        } else if (std.mem.eql(u8, m.t, "lift")) {
            map.callLift(m.i orelse 99, m.l orelse 0);
        } else if (std.mem.eql(u8, m.t, "match")) {
            pushFeed("NEW MATCH", false);
        }
    }
}

// ---- Tick ------------------------------------------------------------------

fn gameplayTick(ctx: *sw.Context) void {
    const in = ctx.input();
    const frozen = (mode == .deathmatch and (phase_end or !alive)) or
        (mode == .practice and practice_phase == .results);
    const zoom: f32 = 1 - 0.35 * gun.ads;
    me.yaw -= in.mouse.delta_x * 0.0022 * zoom;
    me.pitch = std.math.clamp(me.pitch - in.mouse.delta_y * 0.0022 * zoom, -1.5, 1.5);

    var wish = v3(0, 0, 0);
    // Ctrl and Cmd start a shortcut (Cmd+D debug): no movement while held.
    const shortcut = in.mods.ctrl or in.mods.super;
    if (!frozen and !shortcut) {
        const fwd = v3(-@sin(me.yaw), 0, -@cos(me.yaw));
        const right = v3(@cos(me.yaw), 0, -@sin(me.yaw));
        if (in.keyDown(.W)) wish += fwd;
        if (in.keyDown(.S)) wish -= fwd;
        if (in.keyDown(.D)) wish += right;
        if (in.keyDown(.A)) wish -= right;
        if (vec.len(wish) > 0) wish = vec.norm(wish);
    }
    const jump = !frozen and in.keyDown(.Space);
    const speed_scale: f32 = 1 - 0.45 * gun.ads;
    if (mode != .deathmatch or alive) me.step(dt, wish, jump, speed_scale);

    if (!frozen and in.keyPressed(.E)) {
        if (aimedButton()) |b| pressButton(b);
    }
    const can_shoot = !frozen and !(mode == .practice and practice_phase == .countdown);
    if (can_shoot and in.keyPressed(.R)) {
        if (gun.startReload()) sound(500, 380, 0.05, .square, 0.08);
    }
    // A short click can press and release inside one tick.
    const trigger = can_shoot and (in.buttonDown(.left) or in.buttonPressed(.left));
    const ev = gun.update(dt, trigger, can_shoot and in.buttonPressed(.left), can_shoot and in.buttonDown(.right));
    switch (ev) {
        .fired => {
            fire();
            recoilKick();
        },
        .empty => {
            sound(1200, 900, 0.03, .square, 0.1);
            _ = gun.startReload();
        },
        .mag_out => sound(700, 420, 0.06, .square, 0.12),
        .mag_in => sound(950, 600, 0.05, .square, 0.15),
        .racked => {
            sound(1400, 700, 0.04, .square, 0.12);
            sound(600, 300, 0.07, .square, 0.1);
        },
        .none => {},
    }
    if (gun.ammo == 0 and gun.reloading < 0 and gun.reserve > 0 and !trigger) _ = gun.startReload();
}

fn effectsTick() void {
    for (tracers[0..@min(tracer_n, tracers.len)]) |*t| t.life -= dt;
    for (sparks[0..@min(spark_n, sparks.len)]) |*s| {
        if (s.life <= 0) continue;
        s.life -= dt;
        s.v[1] -= 9 * dt;
        s.p += s.v * vec.s(dt);
        if (s.p[1] < 0.02) {
            s.p[1] = 0.02;
            s.v = s.v * v3(0.4, -0.3, 0.4);
        }
    }
    remote_flash.life -= dt;
    damage_flash = @max(0, damage_flash - dt * 1.4);
    hit_marker = @max(0, hit_marker - dt);
    for (feed[0..feed_n]) |*f| f.life -= dt;
    while (feed_n > 0 and feed[0].life <= 0) {
        for (1..feed_n) |i| feed[i - 1] = feed[i];
        feed_n -= 1;
    }
    for (remotes[0..remote_n]) |*r| {
        const k = @min(1, dt * 14);
        const before = r.pos;
        r.pos = vec.lerp(r.pos, r.target, k);
        const mv = r.pos - before;
        r.stride += @sqrt(mv[0] * mv[0] + mv[2] * mv[2]);
        r.fall = if (r.alive) 0 else @min(1, r.fall + dt * 3);
    }
}

fn practiceTick() void {
    switch (practice_phase) {
        .countdown => {
            practice_t -= dt;
            if (practice_t <= 0) {
                practice_phase = .running;
                practice_t = practice_len;
                sound(880, null, 0.15, .sine, 0.25);
            }
        },
        .running => {
            practice_t -= dt;
            for (&targets, 0..) |*t, i| {
                if (t.up) {
                    t.fall = @max(0, t.fall - dt * 4);
                } else {
                    t.fall = @min(1, t.fall + dt * 5);
                    t.down_time += dt;
                    if (t.down_time > 0.8) placeTarget(t, i + @as(usize, @intCast(ticks % 1000)));
                }
            }
            if (practice_t <= 0) {
                practice_phase = .results;
                practice_t = 0;
                if (score > best) {
                    best = score;
                    new_best = true;
                    var buf: [16]u8 = undefined;
                    const s = std.fmt.bufPrint(&buf, "{d}", .{best}) catch "";
                    platform.storageSet("practice-best", s) catch {};
                }
                sound(660, 330, 0.4, .triangle, 0.25);
            }
        },
        .results => practice_t -= dt,
    }
}

fn tick(ctx: *sw.Context) void {
    ticks += 1;
    time += dt;
    const in = ctx.input();

    captured = jsPointerLocked() != 0;

    // Cmd+D (macOS) / Ctrl+D: the debug screen, as in the voxel example.
    if (in.keyPressed(.D) and (in.mods.super or in.mods.ctrl)) show_debug = !show_debug;

    switch (mode) {
        .menu => {
            if (in.keyPressed(.Num1)) enterDeathmatch(ctx);
            if (in.keyPressed(.Num2)) enterPractice(ctx);
            if (in.buttonPressed(.left)) {
                const b = menuButtons(ctx);
                const mx = in.mouse.x;
                const my = in.mouse.y;
                for (b, 0..) |r, i| {
                    if (mx >= r.x and mx <= r.x + r.w and my >= r.y and my <= r.y + r.h) {
                        if (i == 0) enterDeathmatch(ctx) else enterPractice(ctx);
                        // The click is a user gesture, so the lock request
                        // in this frame is allowed.
                        ctx.setMouseCapture(true);
                        return;
                    }
                }
            }
            effectsTick();
            return;
        },
        .deathmatch => {
            handleNet();
            if (!alive) dead_time += dt;
            if (client.state() == .closed and in.keyPressed(.Enter)) enterDeathmatch(ctx);
            if (ticks % 6 == 0 and alive) {
                client.send("{{\"t\":\"st\",\"x\":{d:.3},\"y\":{d:.3},\"z\":{d:.3},\"yaw\":{d:.3},\"pitch\":{d:.3}}}", .{
                    me.pos[0], me.pos[1], me.pos[2], me.yaw, me.pitch,
                });
            }
        },
        .practice => {
            practiceTick();
            const again = in.keyPressed(.Enter) or (captured and in.buttonPressed(.left) and practice_t < -1);
            if (practice_phase == .results and again) enterPractice(ctx);
        },
    }

    // The deep train: it shoves a player off the track, and it is loud.
    const train_t0 = if (map.train) |tr| tr.t else 0;
    map.stepTrain(dt);
    if (map.train) |tr| {
        const b = map.boxes[tr.box];
        const r = player_mod.radius;
        if (me.pos[0] + r > b.min[0] and me.pos[0] - r < b.max[0] and me.pos[2] + r > b.min[2] and
            me.pos[2] - r < b.max[2] and me.pos[1] < b.max[1] and me.pos[1] + player_mod.height > b.min[1])
        {
            me.pos[2] = b.max[2] + r + 0.05;
            me.pos[1] = @max(me.pos[1], tr.y0 + 0.75);
            me.vel = v3(0, 2, 4);
        }
        if (mode != .menu and me.pos[1] < map.underground_y - 4) trainSounds(train_t0, tr.t);
    }

    // The live rail: far out along the lines it kills (maps/earls_court.zig
    // shock_x). The server makes it a death.
    if (map.id == .earls_court and mode == .deathmatch and alive and !shocked and
        @abs(me.pos[0]) > @import("maps/earls_court.zig").shock_x and me.pos[1] < 2)
    {
        shocked = true;
        client.send("{{\"t\":\"shock\"}}", .{});
        addSparks(me.pos + v3(0, 0.2, 0), v3(0, 1, 0), v3(0.5, 0.7, 1.0), 30);
        sound(1, null, 0.5, .noise, 0.5);
        sound(120, 60, 0.6, .square, 0.25);
        damage_flash = 1;
    }

    // Lifts carry a player who stands in the cab.
    const riding = map.liftUnder(me.pos, player_mod.radius);
    map.stepLifts(dt);
    if (riding) |li| me.pos[1] += map.lifts[li].dy;
    // Closing doors open again for a player in the doorway, once each time.
    for (map.lifts[0..map.lift_count], 0..) |l, i| {
        if (l.phase != .closing) door_reopened[i] = false;
    }
    if (mode != .menu and (mode != .deathmatch or alive)) if (map.doorwayAt(me.pos)) |dw| {
        const l = map.lifts[dw.lift];
        if (l.phase == .closing and l.level == dw.level and !door_reopened[dw.lift]) {
            door_reopened[dw.lift] = true;
            if (mode == .deathmatch) {
                client.send("{{\"t\":\"use\",\"i\":{d},\"l\":{d}}}", .{ dw.lift, dw.level });
            } else map.callLift(dw.lift, dw.level);
        }
    };

    // Debug teleport: with the debug screen open, 1 to 9 go to a spawn.
    if (show_debug and mode != .menu) {
        const keys = [_]core.KeyCode{ .Num1, .Num2, .Num3, .Num4, .Num5, .Num6, .Num7, .Num8, .Num9 };
        for (keys, 0..) |k, i| {
            if (in.keyPressed(k) and i < map.spawn_count) {
                me.pos = map.spawns[i].pos;
                me.vel = v3(0, 0, 0);
                me.yaw = map.spawns[i].yaw;
            }
        }
    }

    if (!captured) {
        if (in.keyPressed(.M)) {
            enterMenu(ctx);
            return;
        }
        if (in.buttonPressed(.left)) ctx.setMouseCapture(true);
    } else {
        gameplayTick(ctx);
    }
    effectsTick();
}

// ---- Scene building --------------------------------------------------------

fn buildRemote(r: *const Remote) void {
    const col = colorFor(r.id);
    const dark = v3(0.13, 0.13, 0.14);
    const skin = v3(0.78, 0.58, 0.45);
    // Fall over backwards when dead.
    const base = vec.translate(r.pos).mul(Mat4.rotationY(r.yaw).mul(Mat4.rotationX(r.fall * 1.45)));
    const swing = @sin(r.stride * 2.4) * 0.55;
    const legs = [_]f32{ -1, 1 };
    for (legs) |side| {
        const hip = base.mul(vec.translate(v3(0.11 * side, 0.86, 0)).mul(Mat4.rotationX(swing * side)));
        dyn.orientedBox(hip, v3(-0.08, -0.86, -0.09), v3(0.08, 0, 0.09), dark, 6);
    }
    dyn.orientedBox(base, v3(-0.23, 0.84, -0.14), v3(0.23, 1.45, 0.14), col, 6);
    dyn.orientedBox(base, v3(-0.25, 1.0, -0.16), v3(0.25, 1.38, 0.16), dark, 6);
    dyn.orientedBox(base, v3(-0.12, 1.47, -0.12), v3(0.12, 1.74, 0.12), skin, 6);
    dyn.orientedBox(base, v3(-0.14, 1.66, -0.15), v3(0.14, 1.8, 0.15), dark, 3);
    dyn.orientedBox(base, v3(-0.1, 1.56, -0.135), v3(0.1, 1.62, -0.11), v3(0.05, 0.05, 0.06), 3);
    // Arms and the rifle, turned with the look pitch.
    const aim = base.mul(vec.translate(v3(0, 1.38, 0)).mul(Mat4.rotationX(r.pitch * (1 - r.fall))));
    dyn.orientedBox(aim, v3(0.16, -0.1, -0.45), v3(0.26, 0.02, 0.0), col, 6);
    dyn.orientedBox(aim, v3(-0.2, -0.12, -0.5), v3(-0.1, -0.02, -0.05), col, 6);
    weapon.addRifle(&dyn, aim.mul(vec.translate(v3(0.08, -0.1, -0.2))), Mat4.identity(), 0);
}

fn buildTarget(t: *const Target) void {
    const pl = targetPlate(t);
    const post_base = pl.c - v3(0, 1.45, 0);
    // The plate swings back about its base when hit.
    const base = vec.translate(post_base).mul(Mat4.rotationY(t.yaw).mul(Mat4.rotationX(-t.fall * 1.5)));
    dyn.orientedBox(base, v3(-0.05, 0, -0.05), v3(0.05, 1.05, 0.05), v3(0.3, 0.3, 0.32), 3);
    dyn.orientedBox(vec.translate(post_base).mul(Mat4.rotationY(t.yaw)), v3(-0.35, 0, -0.35), v3(0.35, 0.08, 0.35), v3(0.25, 0.25, 0.27), 3);
    const plate = base.mul(vec.translate(v3(0, 1.45, 0)));
    dyn.disc(plate, 0.42, 0.04, v3(0.9, 0.88, 0.82), 0);
    dyn.disc(plate.mul(vec.translate(v3(0, 0, -0.022))), 0.3, 0.004, v3(0.75, 0.1, 0.08), 0);
    dyn.disc(plate.mul(vec.translate(v3(0, 0, -0.025))), 0.2, 0.004, v3(0.9, 0.88, 0.82), 0);
    dyn.disc(plate.mul(vec.translate(v3(0, 0, -0.028))), 0.11, 0.004, v3(0.85, 0.12, 0.08), 4);
}

fn buildEffects() void {
    for (tracers[0..@min(tracer_n, tracers.len)]) |t| {
        if (t.life <= 0) continue;
        const d = t.b - t.a;
        const l = vec.len(d);
        if (l < 0.5) continue;
        // A thin bright streak: a box stretched along d.
        const f = d / vec.s(l);
        const up = if (@abs(f[1]) > 0.9) v3(1, 0, 0) else v3(0, 1, 0);
        const r = vec.norm(vec.cross(f, up));
        const u = vec.cross(r, f);
        const m = Mat4{ .data = .{ r[0], r[1], r[2], 0, u[0], u[1], u[2], 0, f[0], f[1], f[2], 0, t.a[0], t.a[1], t.a[2], 1 } };
        const k = t.life / 0.07;
        const w = 0.008 * k + 0.002;
        dyn.orientedBox(m, v3(-w, -w, l * (1 - k) * 0.6 + 0.4), v3(w, w, l), v3(1.0, 0.75, 0.4), 4);
    }
    for (sparks[0..@min(spark_n, sparks.len)]) |s| {
        if (s.life <= 0) continue;
        const z = 0.012 + s.life * 0.03;
        dyn.box(s.p - vec.s(z), s.p + vec.s(z), s.col, 4);
    }
}

fn buildViewmodel() void {
    if (mode == .menu) return;
    if (mode == .deathmatch and !alive) return;
    const speed = @min(1, @sqrt(me.vel[0] * me.vel[0] + me.vel[2] * me.vel[2]) / 6);
    const pose = gun.pose(me.stride * 1.7, if (me.grounded) speed else 0);
    const gm = cameraMatrix().mul(pose.gun);
    weapon.addRifle(&dyn, gm, pose.mag, 100);
    if (gun.flash > 0) {
        // A star of two crossed emissive blades at the muzzle.
        const fm = gm.mul(vec.translate(pose.muzzle).mul(Mat4.rotationZ(gun.flash_roll)));
        const s: f32 = 0.05 + rand() * 0.03;
        dyn.orientedBox(fm, v3(-s, -0.006, -s * 2.6), v3(s, 0.006, 0), v3(1.0, 0.7, 0.3), 104);
        dyn.orientedBox(fm, v3(-0.006, -s, -s * 2.6), v3(0.006, s, 0), v3(1.0, 0.7, 0.3), 104);
    }
}

fn eyeForRender() struct { eye: V3, yaw: f32, pitch: f32 } {
    if (mode == .menu) {
        // A slow drift along the train shed, over the islands.
        const x = 26 * @sin(time * 0.03);
        const z = -4.2 + 5 * @sin(time * 0.05);
        return .{ .eye = v3(x, 7.0 + 1.0 * @sin(time * 0.04), z), .yaw = std.math.pi / 2.0 + 0.4 * @sin(time * 0.045), .pitch = -0.06 + 0.1 * @sin(time * 0.03) };
    }
    if (mode == .deathmatch and !alive) {
        // Death cam: drop low and look up a little.
        const k = @min(1, dead_time * 2);
        return .{ .eye = me.pos + v3(0, 1.6 - 1.25 * k, 0), .yaw = me.yaw, .pitch = me.pitch * (1 - k) + 0.25 * k };
    }
    var eye = me.eyePos();
    if (me.grounded) eye[1] += @abs(@sin(me.stride * 1.7)) * 0.03 * (1 - gun.ads);
    return .{ .eye = eye, .yaw = me.yaw, .pitch = me.pitch };
}

// ---- HUD -------------------------------------------------------------------

const white = gfx.Color.rgba8(245, 240, 232, 255);
const dim = gfx.Color.rgba8(245, 240, 232, 150);
const accent = gfx.Color.rgba8(255, 166, 77, 255);
const panel = gfx.Color.rgba8(12, 14, 20, 170);
const red = gfx.Color.rgba8(230, 70, 60, 255);

fn logical(ctx: *sw.Context) struct { w: f32, h: f32 } {
    const win = ctx.window();
    const l = gfx.projection.logicalSize(win.width, win.height, win.dpi_scale);
    return .{ .w = l.w, .h = l.h };
}

fn menuButtons(ctx: *sw.Context) [2]gfx.Rect {
    const l = logical(ctx);
    const w: f32 = 340;
    const x = l.w / 2 - w / 2;
    const y = l.h * 0.5;
    return .{
        .{ .x = x, .y = y, .w = w, .h = 64 },
        .{ .x = x, .y = y + 80, .w = w, .h = 64 },
    };
}

fn txt(r: *gfx.Renderer, s: []const u8, x: f32, y: f32, size: f32, col: gfx.Color) void {
    _ = text.?.draw(r, s, x, y, .{ .size = size, .color = col }) catch {};
}

fn txtCenter(r: *gfx.Renderer, s: []const u8, cx: f32, y: f32, size: f32, col: gfx.Color) void {
    const m = text.?.measure(s, size);
    txt(r, s, cx - m.w / 2, y, size, col);
}

fn txtRight(r: *gfx.Renderer, s: []const u8, rx: f32, y: f32, size: f32, col: gfx.Color) void {
    const m = text.?.measure(s, size);
    txt(r, s, rx - m.w, y, size, col);
}

fn drawCrosshair(r: *gfx.Renderer, cx: f32, cy: f32) !void {
    const moving = @min(1, @sqrt(me.vel[0] * me.vel[0] + me.vel[2] * me.vel[2]) / 6);
    const gap = 5 + gun.spread(moving, !me.grounded) * 700;
    const a: u8 = @intFromFloat(230 * (1 - gun.ads));
    const c = gfx.Color.rgba8(255, 255, 255, a);
    const len: f32 = 8;
    try r.fillRect(.{ .x = cx - 1, .y = cy - gap - len, .w = 2, .h = len }, c);
    try r.fillRect(.{ .x = cx - 1, .y = cy + gap, .w = 2, .h = len }, c);
    try r.fillRect(.{ .x = cx - gap - len, .y = cy - 1, .w = len, .h = 2 }, c);
    try r.fillRect(.{ .x = cx + gap, .y = cy - 1, .w = len, .h = 2 }, c);
    try r.fillRect(.{ .x = cx - 1, .y = cy - 1, .w = 2, .h = 2 }, gfx.Color.rgba8(255, 255, 255, 200));
    if (hit_marker > 0) {
        const hc = if (hit_marker_kill) red else white;
        var i: f32 = 4;
        while (i < 10) : (i += 1) {
            try r.fillRect(.{ .x = cx + i - 1, .y = cy + i - 1, .w = 2, .h = 2 }, hc);
            try r.fillRect(.{ .x = cx - i - 1, .y = cy + i - 1, .w = 2, .h = 2 }, hc);
            try r.fillRect(.{ .x = cx + i - 1, .y = cy - i - 1, .w = 2, .h = 2 }, hc);
            try r.fillRect(.{ .x = cx - i - 1, .y = cy - i - 1, .w = 2, .h = 2 }, hc);
        }
    }
}

fn drawAmmo(r: *gfx.Renderer, w: f32, h: f32) !void {
    var buf: [32]u8 = undefined;
    try r.fillRect(.{ .x = w - 210, .y = h - 86, .w = 190, .h = 66 }, panel);
    const s = std.fmt.bufPrint(&buf, "{d}", .{gun.ammo}) catch "";
    txtRight(r, s, w - 100, h - 82, 44, if (gun.ammo <= 5) red else white);
    if (gun.reserve > 999) {
        txt(r, "/ inf", w - 92, h - 64, 20, dim);
    } else {
        const rs = std.fmt.bufPrint(&buf, "/ {d}", .{gun.reserve}) catch "";
        txt(r, rs, w - 92, h - 64, 20, dim);
    }
    if (gun.reloading >= 0) {
        const k = gun.reloading / weapon.reload_time;
        try r.fillRect(.{ .x = w - 210, .y = h - 20, .w = 190 * k, .h = 4 }, accent);
        txtCenter(r, "RELOADING", w / 2, h / 2 + 40, 16, accent);
    } else if (gun.ammo == 0) {
        txtCenter(r, "R TO RELOAD", w / 2, h / 2 + 40, 16, red);
    }
}

fn drawHealth(r: *gfx.Renderer, h: f32) !void {
    try r.fillRect(.{ .x = 20, .y = h - 86, .w = 230, .h = 66 }, panel);
    var buf: [16]u8 = undefined;
    const v = @max(0, hp);
    const s = std.fmt.bufPrint(&buf, "{d}", .{v}) catch "";
    txt(r, s, 34, h - 82, 44, if (v <= 30) red else white);
    const k = @as(f32, @floatFromInt(v)) / 100;
    try r.fillRect(.{ .x = 120, .y = h - 50, .w = 116, .h = 8 }, gfx.Color.rgba8(255, 255, 255, 40));
    try r.fillRect(.{ .x = 120, .y = h - 50, .w = 116 * k, .h = 8 }, if (v <= 30) red else accent);
    txt(r, "HEALTH", 120, h - 76, 14, dim);
}

fn timeText(buf: []u8, secs: f32) []const u8 {
    const s: u32 = @intFromFloat(@max(0, @ceil(secs)));
    return std.fmt.bufPrint(buf, "{d}:{d:0>2}", .{ s / 60, s % 60 }) catch "";
}

fn kills(i: usize) u32 {
    return if (i == remote_n) my_k else remotes[i].k;
}

fn moreKills(_: void, a: usize, b: usize) bool {
    return kills(a) > kills(b);
}

fn drawScoreboard(r: *gfx.Renderer, w: f32, h: f32, title: []const u8) !void {
    const pw: f32 = 520;
    const rows = remote_n + 1;
    const ph: f32 = 110 + @as(f32, @floatFromInt(rows)) * 34;
    const x = w / 2 - pw / 2;
    const y = h / 2 - ph / 2;
    try r.fillRect(.{ .x = x, .y = y, .w = pw, .h = ph }, gfx.Color.rgba8(10, 12, 18, 215));
    try r.fillRect(.{ .x = x, .y = y, .w = pw, .h = 3 }, accent);
    txtCenter(r, title, w / 2, y + 18, 26, white);
    txt(r, "PLAYER", x + 24, y + 66, 13, dim);
    txtRight(r, "KILLS", x + pw - 120, y + 66, 13, dim);
    txtRight(r, "DEATHS", x + pw - 24, y + 66, 13, dim);

    // Sort by kills. Index remote_n is this player.
    var order: [25]usize = undefined;
    for (0..rows) |i| order[i] = i;
    std.mem.sort(usize, order[0..rows], {}, moreKills);
    var buf: [16]u8 = undefined;
    for (order[0..rows], 0..) |idx, row| {
        const ry = y + 92 + @as(f32, @floatFromInt(row)) * 34;
        const is_me = idx == remote_n;
        if (is_me) try r.fillRect(.{ .x = x + 8, .y = ry - 4, .w = pw - 16, .h = 30 }, gfx.Color.rgba8(255, 166, 77, 40));
        const name = if (is_me) my_name[0..my_name_len] else remotes[idx].name[0..remotes[idx].name_len];
        const d = if (is_me) my_d else remotes[idx].d;
        const c = colorFor(if (is_me) my_id else remotes[idx].id);
        try r.fillRect(.{ .x = x + 24, .y = ry + 4, .w = 10, .h = 14 }, .{ .r = c[0], .g = c[1], .b = c[2], .a = 1 });
        txt(r, name, x + 44, ry, 18, if (is_me) accent else white);
        txtRight(r, std.fmt.bufPrint(&buf, "{d}", .{kills(idx)}) catch "", x + pw - 120, ry, 18, white);
        txtRight(r, std.fmt.bufPrint(&buf, "{d}", .{d}) catch "", x + pw - 24, ry, 18, dim);
    }
}

fn drawMenu(ctx: *sw.Context, r: *gfx.Renderer, w: f32, h: f32) !void {
    const cx = w / 2;
    txtCenter(r, "ACTION", cx, h * 0.2, 96, white);
    txtCenter(r, "a swindowzig shooter", cx, h * 0.2 + 104, 18, dim);
    const b = menuButtons(ctx);
    const labels = [_][]const u8{ "1   DEATHMATCH", "2   TARGET PRACTICE" };
    const subs = [_][]const u8{ "always-on lobby, 5 minute matches", "offline, 60 seconds" };
    const in = ctx.input();
    for (b, 0..) |rect, i| {
        const hover = in.mouse.x >= rect.x and in.mouse.x <= rect.x + rect.w and in.mouse.y >= rect.y and in.mouse.y <= rect.y + rect.h;
        try r.fillRect(rect, if (hover) gfx.Color.rgba8(255, 166, 77, 230) else panel);
        txt(r, labels[i], rect.x + 22, rect.y + 10, 22, if (hover) gfx.Color.rgba8(20, 14, 8, 255) else white);
        txt(r, subs[i], rect.x + 22, rect.y + 38, 13, if (hover) gfx.Color.rgba8(40, 26, 14, 255) else dim);
    }
    if (best > 0) {
        var buf: [32]u8 = undefined;
        txtCenter(r, std.fmt.bufPrint(&buf, "practice best: {d}", .{best}) catch "", cx, b[1].y + 84, 14, dim);
    }
    txtCenter(r, "WASD move  -  SPACE jump  -  MOUSE aim  -  RIGHT CLICK sights  -  R reload  -  TAB scores", cx, h - 48, 14, dim);
    txtCenter(r, "Rifle model: Quaternius Ultimate Gun Pack (CC0)", cx, h - 26, 12, dim);
}

fn drawDeathmatch(ctx: *sw.Context, r: *gfx.Renderer, w: f32, h: f32) !bool {
    const cx = w / 2;
    const cy = h / 2;
    var buf: [96]u8 = undefined;
    const st = client.state();
    if (st != .open) {
        try r.fillRect(.{ .x = 0, .y = 0, .w = w, .h = h }, gfx.Color.rgba8(5, 6, 10, 160));
        const msg = if (st == .closed) "CONNECTION LOST - press ENTER to retry, M for the menu" else "CONNECTING TO THE LOBBY...";
        txtCenter(r, msg, cx, cy - 12, 22, white);
        return false;
    }
    try r.fillRect(.{ .x = cx - 70, .y = 14, .w = 140, .h = 44 }, panel);
    txtCenter(r, timeText(&buf, time_left), cx, 20, 28, if (time_left < 30 and !phase_end) red else white);
    const pc = std.fmt.bufPrint(&buf, "{d} in lobby", .{remote_n + 1}) catch "";
    txtCenter(r, pc, cx, 62, 13, dim);
    for (feed[0..feed_n], 0..) |f, i| {
        const fy = 16 + @as(f32, @floatFromInt(i)) * 28;
        const m = text.?.measure(f.text[0..f.len], 16);
        try r.fillRect(.{ .x = w - m.w - 36, .y = fy, .w = m.w + 20, .h = 24 }, if (f.mine) gfx.Color.rgba8(255, 166, 77, 70) else panel);
        txtRight(r, f.text[0..f.len], w - 26, fy + 3, 16, white);
    }
    if (phase_end) {
        try drawScoreboard(r, w, h, "MATCH OVER");
        const ns = std.fmt.bufPrint(&buf, "next match in {d}", .{@as(u32, @intFromFloat(@max(0, @ceil(time_left))))}) catch "";
        txtCenter(r, ns, cx, h - 60, 18, dim);
        return false;
    }
    if (!alive) {
        const t = if (killed_by_len > 0) std.fmt.bufPrint(&buf, "KILLED BY {s}", .{killed_by[0..killed_by_len]}) catch "" else "SPAWNING...";
        txtCenter(r, t, cx, cy - 60, 30, red);
        txtCenter(r, "you respawn in a moment", cx, cy - 20, 16, dim);
    }
    if (ctx.input().keyDown(.Tab)) try drawScoreboard(r, w, h, "SCORES");
    return true;
}

fn drawPractice(r: *gfx.Renderer, w: f32, h: f32) !void {
    const cx = w / 2;
    const cy = h / 2;
    var buf: [96]u8 = undefined;
    try r.fillRect(.{ .x = cx - 160, .y = 14, .w = 320, .h = 50 }, panel);
    const tl = timeText(&buf, if (practice_phase == .countdown) practice_len else @max(0, practice_t));
    txt(r, tl, cx - 145, 22, 28, if (practice_phase == .running and practice_t < 10) red else white);
    var sbuf: [16]u8 = undefined;
    txtRight(r, std.fmt.bufPrint(&sbuf, "{d}", .{score}) catch "", cx + 145, 22, 28, accent);
    txtCenter(r, "SCORE", cx + 40, 30, 12, dim);
    if (practice_phase == .countdown) {
        const n: u32 = @intFromFloat(@ceil(@max(0, practice_t)));
        txtCenter(r, std.fmt.bufPrint(&buf, "{d}", .{n}) catch "", cx, cy - 140, 72, white);
        txtCenter(r, "hit the plates - the red centre scores more", cx, cy - 50, 16, dim);
    }
    if (practice_phase == .results) {
        const pw: f32 = 420;
        try r.fillRect(.{ .x = cx - pw / 2, .y = cy - 150, .w = pw, .h = 250 }, gfx.Color.rgba8(10, 12, 18, 215));
        try r.fillRect(.{ .x = cx - pw / 2, .y = cy - 150, .w = pw, .h = 3 }, accent);
        txtCenter(r, "TIME", cx, cy - 132, 26, white);
        txtCenter(r, std.fmt.bufPrint(&buf, "{d}", .{score}) catch "", cx, cy - 92, 60, accent);
        const acc: u32 = if (shots > 0) hits * 100 / shots else 0;
        txtCenter(r, std.fmt.bufPrint(&buf, "{d} hits  -  {d}% accuracy", .{ hits, acc }) catch "", cx, cy - 18, 18, white);
        const bt = if (new_best) "NEW BEST!" else std.fmt.bufPrint(&buf, "best {d}", .{best}) catch "";
        txtCenter(r, bt, cx, cy + 14, 18, if (new_best) accent else dim);
        txtCenter(r, "ENTER or click to go again  -  ESC then M for the menu", cx, cy + 60, 14, dim);
    }
}

/// The debug screen (Cmd+D / Ctrl+D): frame, render, player, input, net.
fn drawDebug(ctx: *sw.Context, r: *gfx.Renderer) !void {
    const win = ctx.window();
    const in = ctx.input();
    var lines: [16][96]u8 = undefined;
    var n: usize = 0;
    const L = struct {
        fn add(buf: *[16][96]u8, count: *usize, comptime fmt: []const u8, args: anytype) void {
            if (count.* >= buf.len) return;
            _ = std.fmt.bufPrint(&buf[count.*], fmt ++ "\x00", args) catch return;
            count.* += 1;
        }
    };
    const fps = if (frame_ms > 0) 1000 / frame_ms else 0;
    L.add(&lines, &n, "{d:.0} fps   {d:.2} ms", .{ fps, frame_ms });
    L.add(&lines, &n, "canvas {d}x{d}  dpi {d:.2}  scene {d}x{d}", .{ win.width, win.height, win.dpi_scale, render.scene_w, render.scene_h });
    L.add(&lines, &n, "triangles: map {d}  dynamic {d}  boxes {d}", .{ static_mesh.verts.items.len / 3, dyn.verts.items.len / 3, map.box_count });
    L.add(&lines, &n, "mode {s}  map {s}  pointer lock {s}", .{ @tagName(mode), @tagName(map.id), if (captured) "yes" else "no" });
    if (map.lift_count > 0) {
        const l0 = map.lifts[0];
        L.add(&lines, &n, "lift 0: y {d:.2} {s} door {d:.2}", .{ l0.y, @tagName(l0.phase), l0.door });
    }
    L.add(&lines, &n, "pos {d:.2} {d:.2} {d:.2}  {s}", .{ me.pos[0], me.pos[1], me.pos[2], if (me.grounded) "grounded" else "air" });
    L.add(&lines, &n, "vel {d:.2} {d:.2} {d:.2}", .{ me.vel[0], me.vel[1], me.vel[2] });
    L.add(&lines, &n, "yaw {d:.3}  pitch {d:.3}", .{ me.yaw, me.pitch });
    L.add(&lines, &n, "mouse {d:.0},{d:.0}  delta {d:.1},{d:.1}", .{ in.mouse.x, in.mouse.y, in.mouse.delta_x, in.mouse.delta_y });
    L.add(&lines, &n, "mods ctrl {}  cmd {}  shift {}  alt {}", .{ @intFromBool(in.mods.ctrl), @intFromBool(in.mods.super), @intFromBool(in.mods.shift), @intFromBool(in.mods.alt) });
    L.add(&lines, &n, "gun ammo {d}/{d}  reload {d:.2}  ads {d:.2}  heat {d:.2}", .{ gun.ammo, gun.reserve, gun.reloading, gun.ads, gun.heat });
    if (mode == .deathmatch) {
        L.add(&lines, &n, "net {s}  id {d}  players {d}  left {d:.1}s  {s}", .{ @tagName(client.state()), my_id, remote_n + 1, time_left, if (phase_end) "end" else "play" });
    }
    const lh: f32 = 17;
    try r.fillRect(.{ .x = 10, .y = 76, .w = 420, .h = 12 + lh * @as(f32, @floatFromInt(n)) }, gfx.Color.rgba8(0, 0, 0, 170));
    for (lines[0..n], 0..) |*line, i| {
        const len = std.mem.indexOfScalar(u8, line, 0) orelse line.len;
        txt(r, line[0..len], 18, 82 + lh * @as(f32, @floatFromInt(i)), 13, gfx.Color.rgba8(170, 255, 170, 255));
    }
}

/// The minimap, north up, centred on the player: a slice of the map at
/// body height (the walls) over a slice at foot height (the floors). The
/// same slices as `zig build floorplan`. A remote player shows for a
/// moment after it fires.
fn drawMinimap(r: *gfx.Renderer, h: f32) !void {
    const size: f32 = 180;
    const scale: f32 = 2.4; // pixels a metre
    const ox: f32 = 20;
    const oy = h - 96 - size;
    const cx = ox + size / 2;
    const cy = oy + size / 2;
    try r.fillRect(.{ .x = ox, .y = oy, .w = size, .h = size }, gfx.Color.rgba8(8, 10, 14, 170));
    const feet = me.pos[1];
    const Clip = struct {
        fn rect(min: V3, max: V3, p: V3, sc: f32, x0: f32, y0: f32, sz: f32) ?gfx.Rect {
            const ax = std.math.clamp((min[0] - p[0]) * sc + x0 + sz / 2, x0, x0 + sz);
            const bx = std.math.clamp((max[0] - p[0]) * sc + x0 + sz / 2, x0, x0 + sz);
            const ay = std.math.clamp((min[2] - p[2]) * sc + y0 + sz / 2, y0, y0 + sz);
            const by = std.math.clamp((max[2] - p[2]) * sc + y0 + sz / 2, y0, y0 + sz);
            if (bx - ax < 0.5 or by - ay < 0.5) return null;
            return .{ .x = ax, .y = ay, .w = bx - ax, .h = by - ay };
        }
    };
    // Floors near the feet, then the walls at body height.
    for ([_]bool{ false, true }) |walls| {
        for (map.boxes[0..map.box_count]) |b| {
            if (!b.solid) continue;
            const hit = if (walls) b.min[1] < feet + 1.6 and b.max[1] > feet + 0.4 else @abs(b.max[1] - feet) < 0.5;
            if (!hit) continue;
            const rc = Clip.rect(b.min, b.max, me.pos, scale, ox, oy, size) orelse continue;
            const col = if (b.dynamic) gfx.Color.rgba8(70, 130, 230, 220) else if (walls) gfx.Color.rgba8(200, 195, 185, 200) else gfx.Color.rgba8(60, 62, 66, 200);
            try r.fillRect(rc, col);
        }
    }
    for (remotes[0..remote_n]) |rm| {
        if (time - rm.shot_t > 1.5 or !rm.alive) continue;
        const px = cx + (rm.pos[0] - me.pos[0]) * scale;
        const py = cy + (rm.pos[2] - me.pos[2]) * scale;
        if (px < ox or px > ox + size or py < oy or py > oy + size) continue;
        try r.fillRect(.{ .x = px - 3, .y = py - 3, .w = 6, .h = 6 }, red);
    }
    // The player, and a line of dots for the view direction.
    const f = vec.forward(me.yaw, 0);
    for (1..6) |i| {
        const d: f32 = @floatFromInt(i * 3);
        try r.fillRect(.{ .x = cx + f[0] * d - 1, .y = cy + f[2] * d - 1, .w = 2, .h = 2 }, accent);
    }
    try r.fillRect(.{ .x = cx - 3, .y = cy - 3, .w = 6, .h = 6 }, white);
    try r.strokeRect(.{ .x = ox, .y = oy, .w = size, .h = size }, 1, gfx.Color.rgba8(255, 255, 255, 40));
}

fn drawHud(ctx: *sw.Context, r: *gfx.Renderer) !void {
    const win = ctx.window();
    r.beginFrame(win.width, win.height, win.dpi_scale);
    text.?.setDpiScale(win.dpi_scale);
    const l = logical(ctx);
    const w = l.w;
    const h = l.h;

    defer if (show_debug) drawDebug(ctx, r) catch {};
    if (mode == .menu) return drawMenu(ctx, r, w, h);
    var crosshair = true;
    if (mode == .deathmatch) {
        if (!try drawDeathmatch(ctx, r, w, h)) return;
        crosshair = alive;
    }
    if (mode == .practice) try drawPractice(r, w, h);
    if (crosshair) try drawCrosshair(r, w / 2, h / 2);
    if (captured) if (aimedButton()) |bi| {
        const b = map.buttons[bi];
        const label = if (b.in_cab) (if (b.level == 0) "E   GO DOWN" else "E   GO UP") else "E   CALL LIFT";
        txtCenter(r, label, w / 2, h / 2 + 22, 15, white);
    };
    try drawMinimap(r, h);
    try drawHealth(r, h);
    try drawAmmo(r, w, h);

    if (!captured) {
        try r.fillRect(.{ .x = 0, .y = 0, .w = w, .h = h }, gfx.Color.rgba8(5, 6, 10, 140));
        txtCenter(r, "CLICK TO PLAY", w / 2, h / 2 - 30, 34, white);
        txtCenter(r, "M for the main menu", w / 2, h / 2 + 14, 16, dim);
    }
}

// ---- Callbacks -------------------------------------------------------------

fn gameInit(ctx: *sw.Context) !void {
    alloc = ctx.allocator();
    rng = .init(ctx.timeNs());
    map.init(alloc);
    try weapon.loadModel(alloc);
    static_mesh = mesh.Mesh.init(alloc);
    dyn = mesh.Mesh.init(alloc);
    try render.init(ctx.gpu());
    loadMap(ctx, .earls_court);
    hud = try gfx.Renderer.init(alloc, ctx.gpu(), .{});
    text = try sw_text.TextRenderer.init(alloc, font_bytes);
    audio = audio_mod.Audio.init();
    client = net.Client.init();

    // The call sign and the best practice score live in local storage.
    if (platform.storageGet(alloc, "name") catch null) |n| {
        my_name_len = copyName(&my_name, n);
    } else {
        const names = [_][]const u8{ "Viper", "Ghost", "Rook", "Nomad", "Jackal", "Hex", "Kestrel", "Onyx", "Talon", "Ember", "Drift", "Saber" };
        var buf: [16]u8 = undefined;
        const s = std.fmt.bufPrint(&buf, "{s}{d}", .{ names[@intFromFloat(rand() * 11.99)], @as(u32, @intFromFloat(rand() * 90 + 10)) }) catch "Player";
        my_name_len = copyName(&my_name, s);
        platform.storageSet("name", my_name[0..my_name_len]) catch {};
    }
    if (platform.storageGet(alloc, "practice-best") catch null) |b| {
        best = std.fmt.parseInt(u32, b, 10) catch 0;
    }
}

fn gameRender(ctx: *sw.Context) !void {
    dyn.clear();
    for (map.boxes[0..map.box_count], 0..) |b, bi| {
        if (!b.dynamic or !b.visible) continue;
        const col = if (map.flicker_box == bi and !flickerOn()) b.color * vec.s(0.04) else b.color;
        dyn.box(b.min, b.max, col, @floatFromInt(@backingInt(b.mat)));
    }
    const aimed = aimedButton();
    for (map.buttons[0..map.button_count], 0..) |*b, i| {
        const bb = map.buttonBounds(b);
        const lit = map.buttonLit(b);
        const col = if (lit) v3(1.0, 0.55, 0.1) else if (aimed == i) v3(0.9, 0.9, 0.85) else v3(0.5, 0.06, 0.05);
        dyn.box(bb[0], bb[1], col, if (lit) 4 else 0);
    }
    for (remotes[0..remote_n]) |*r| buildRemote(r);
    if (map.train) |tr| buildTrain(tr);
    if (map.id == .earls_court) buildEscalatorSteps();
    if (mode == .practice) for (&targets) |*t| buildTarget(t);
    buildEffects();
    buildViewmodel();
    const cam = eyeForRender();

    var lights: [render.max_lights]map.Light = undefined;
    var n: usize = 0;
    for (map.lights[0..map.light_count], 0..) |l, i| {
        lights[n] = l;
        if (map.flicker_light == i) {
            // A tired tube: mostly on, with short drops and stutters.
            lights[n].color = l.color * vec.s(if (flickerOn()) 1.0 else 0.08);
        }
        n += 1;
    }
    // The train: a warm glow from its windows and a headlight.
    if (map.train) |tr| {
        const b = map.boxes[tr.box];
        if (b.max[0] > -60 and b.min[0] < 60 and n + 2 <= render.max_lights) {
            const mid = (b.min[0] + b.max[0]) / 2;
            lights[n] = .{ .pos = v3(std.math.clamp(mid, -25, 25), b.min[1] + 2.2, b.max[2] + 0.8), .color = v3(1.4, 1.05, 0.65), .radius = 16 };
            lights[n + 1] = .{ .pos = v3(b.min[0] - 1.5, b.min[1] + 1.2, (b.min[2] + b.max[2]) / 2), .color = v3(3.0, 2.9, 2.6), .radius = 14 };
            n += 2;
        }
    }
    // A light rides in each lift cab.
    for (map.lifts[0..map.lift_count]) |l| {
        if (n >= render.max_lights) break;
        const fb = map.boxes[l.floor_box];
        const c = (fb.min + fb.max) * vec.s(0.5);
        lights[n] = .{ .pos = v3(c[0], l.y + 2.2, c[2]), .color = v3(1.1, 1.05, 0.95), .radius = 4.5 };
        n += 1;
    }
    if (gun.flash > 0 and mode != .menu and n < render.max_lights) {
        const p = me.eyePos() + vec.forward(me.yaw, me.pitch) * vec.s(0.8);
        lights[n] = .{ .pos = p, .color = v3(9, 5.5, 2.5), .radius = 9 };
        n += 1;
    }
    if (remote_flash.life > 0 and n < render.max_lights) {
        lights[n] = .{ .pos = remote_flash.p, .color = v3(9, 5.5, 2.5), .radius = 8 };
        n += 1;
    }
    // Underground the eye opens up: about 2.4 times the outdoor exposure.
    const out_k = vec.smooth((cam.eye[1] - (map.underground_y - 5)) / 5);
    const target_exposure = 0.68 * (2.4 - 1.4 * out_k);
    exposure += (target_exposure - exposure) * @min(1, frame_ms / 1000 * 1.5);
    const fov: f32 = (74 - 22 * gun.ads) * std.math.pi / 180;
    if (hud) |*r| try drawHud(ctx, r);
    try render.draw(ctx, .{
        .eye = cam.eye,
        .yaw = cam.yaw,
        .pitch = cam.pitch,
        .fov = fov,
        .time = time,
        .damage = damage_flash,
        .exposure = exposure,
        .lights = lights[0..n],
    }, dyn.verts.items, if (hud) |*r| r else null);
}

// ---- wasm entry ------------------------------------------------------------
// The frame loop of the voxel example: the loader calls swindowzig_init
// once, then swindowzig_frame on each animation frame.

var wasm_timeline: core.FixedStepTimeline = undefined;
var wasm_bus: core.Bus = undefined;
var wasm_input: core.InputSnapshot = undefined;
var wasm_gpu: gpu_mod.GPU = .{};
var wasm_ctx: sw.Context = undefined;
var wasm_backend: platform.Backend = undefined;
var wasm_last_ns: u64 = 0;
var wasm_ready = false;

fn wasmInit() callconv(.c) void {
    if (wasm_ready) return;
    const a = std.heap.wasm_allocator;
    wasm_backend = platform.wasm_canvas.WasmBackend.create(a) catch return;
    wasm_backend.init() catch return;
    wasm_timeline = core.FixedStepTimeline.init(tick_hz);
    wasm_bus = core.Bus.init(a);
    wasm_input = core.InputSnapshot.init();
    wasm_gpu.init(null, 1280, 720) catch {
        std.log.err("action: WebGPU init failed", .{});
        return;
    };
    wasm_ctx = .{
        .alloc = a,
        .timeline = &wasm_timeline,
        .event_bus = &wasm_bus,
        .input_snapshot = &wasm_input,
        .backend = wasm_backend,
        .gpu_device = &wasm_gpu,
    };
    gameInit(&wasm_ctx) catch |err| {
        std.log.err("action: init failed: {s}", .{@errorName(err)});
        return;
    };
    wasm_last_ns = wasm_backend.getTime();
    wasm_ready = true;
}

fn wasmFrame(timestamp_ms: f64) callconv(.c) void {
    _ = timestamp_ms;
    if (!wasm_ready) return;
    wasm_backend.pollEvents(&wasm_bus) catch return;
    const info = wasm_backend.getWindowInfo();
    wasm_gpu.setSurfaceSize(info.width, info.height);
    const now = wasm_backend.getTime();
    // Clamp a long frame (a background tab), so the game does not run
    // hundreds of ticks at once.
    const frame_ns = @min(now - wasm_last_ns, 100 * std.time.ns_per_ms);
    frame_ms += (@as(f32, @floatFromInt(frame_ns)) / 1e6 - frame_ms) * 0.05;
    wasm_last_ns = now;
    const n = wasm_timeline.advance(frame_ns);
    if (n > 0) {
        wasm_bus.assignPendingToTick(wasm_timeline.currentTick() + 1);
        while (wasm_timeline.step()) {
            wasm_input.updateFromEvents(wasm_bus.eventsForTick(wasm_timeline.currentTick()));
            tick(&wasm_ctx);
        }
        wasm_bus.clear();
    }
    gameRender(&wasm_ctx) catch |err| std.log.err("action: render: {s}", .{@errorName(err)});
}

comptime {
    @export(&wasmInit, .{ .name = "swindowzig_init" });
    @export(&wasmFrame, .{ .name = "swindowzig_frame" });
}
