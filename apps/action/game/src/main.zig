// action.seanmizen.com: a first-person shooter on swindowzig.
//
// Modes:
//   - menu: the camera turns slowly over the arena. 1, 2 or a click on a
//     button picks a mode. 3 opens the settings (settings.zig).
//   - deathmatch: the always-on lobby on the server (/api/ws). A match is
//     5 minutes, then the score board shows, then the next match starts.
//   - practice: offline. The range (range.zig): dummies behind waist-high
//     walls, with health bars and damage numbers. In the arena, a hit on a
//     plate starts a 60 second round, with a best score.
//
// Controls: WASD move, Space jump, mouse look, left click fire, right click
// aim, R reload, G grenade, F use (lift buttons), Q and E lean, 1 to 4 the
// weapon slots (primary, secondary, knife, grenade), B the weapon menu,
// Tab scores, Esc release the mouse, M menu (while paused).
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
const grenade = @import("grenade.zig");
const settings = @import("settings.zig");
const weapon_menu = @import("weapon_menu.zig");
const range = @import("range.zig");
const arena = @import("maps/arena.zig");
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
/// The four weapon slots and the hands (weapon.zig).
var loadout: weapon.Loadout = .{};
/// The primary and the secondary that the player picked in the weapon menu
/// (local storage "loadout"), and the pick of this life. Practice applies a
/// pick at once. In deathmatch the server applies it: at once at the spawn
/// point, else at the next spawn.
var choice: weapon.Choice = undefined;
var applied: weapon.Choice = undefined;
var alive = true;
var hp: i32 = 100;
var damage_flash: f32 = 0;
var hit_marker: f32 = 0;
var hit_marker_kill = false;
var dead_time: f32 = 0;
var killed_by: [24]u8 = undefined;
var killed_by_len: usize = 0;
// The time to the next grenade throw. The grenades left are in the
// grenade slot of the loadout.
var nade_cd: f32 = 0;

var static_mesh: mesh.Mesh = undefined;
var map_loaded = false;
var door_reopened: [4]bool = @splat(false);
var shocked = false;
var dyn: mesh.Mesh = undefined;
// The alpha-blended triangles of a frame (smoke, the debug blast volume).
var trans: mesh.Mesh = undefined;
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
    /// The lean (-1 left to 1 right), and the last value from the server.
    lean: f32 = 0,
    lean_target: f32 = 0,
    seen: bool = true,
    /// The time of its last shot: the minimap shows a shooter for a moment.
    shot_t: f32 = -100,
    /// The held weapon: its class and its model.
    w: weapon.Class = .rifle,
    m: u8 = 0,
    /// The ping in ms (-1: no value yet), and stale: no answer for 10 s.
    ping: i32 = -1,
    ping_stale: bool = false,
};
var remotes: [24]Remote = undefined;
var remote_n: usize = 0;
var my_k: u32 = 0;
var my_d: u32 = 0;
var my_ping: i32 = -1;
var my_ping_stale = false;
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
/// Idle: the plates stand, and a hit on a plate starts a round. Running:
/// the round of 60 seconds. The player is never frozen, so the range stays
/// free to use.
const PracticePhase = enum { idle, running };
var targets: [6]Target = undefined;
var practice_phase: PracticePhase = .idle;
/// The time left in the round.
var practice_t: f32 = 0;
/// While more than 0, the result of the last round shows.
var result_t: f32 = 0;
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

/// A sound effect: it follows the effects volume and the master volume.
fn sound(freq: f32, freq_end: ?f32, dur: f32, wave: audio_mod.Waveform, vol: f32) void {
    ambient(freq, freq_end, dur, wave, vol * settings.v.sfx);
}

/// A sound of the world (the trains): it follows the master volume only.
fn ambient(freq: f32, freq_end: ?f32, dur: f32, wave: audio_mod.Waveform, vol: f32) void {
    audio.play(.{ .frequency = freq, .frequency_end = freq_end, .duration = dur, .waveform = wave, .volume = vol });
}

/// A shot: a noise crack and a falling thump. The shotguns are longer and
/// deeper, the pistol and the SMG are shorter.
fn gunshotSound(volume: f32, c: weapon.Class) void {
    switch (c) {
        .shotgun, .sawn_off => {
            sound(1, null, 0.22, .noise, 0.7 * volume);
            sound(110, 32, 0.26, .sine, 0.6 * volume);
        },
        .revolver => {
            sound(1, null, 0.14, .noise, 0.6 * volume);
            sound(150, 40, 0.2, .sine, 0.55 * volume);
        },
        .pistol, .smg => {
            sound(1, null, 0.075, .noise, 0.45 * volume);
            sound(230, 70, 0.1, .sine, 0.4 * volume);
        },
        else => {
            sound(1, null, 0.11, .noise, 0.55 * volume);
            sound(160, 45, 0.16, .sine, 0.5 * volume);
        },
    }
}

/// The camera of the live player: the eye with the lean, the head bob and
/// the roll. The view model hangs from it. The shots and the throws start
/// at me.eyePos(), which has the lean but not the bob.
fn playerView() struct { eye: V3, roll: f32 } {
    var eye = me.eyePos();
    var roll = -me.lean * player_mod.lean_roll;
    // The head bob: the amount follows the speed on the ground (me.bob is 0
    // in the air and when standing still), times the setting (0 is off).
    const amp = me.bob * settings.v.bob * (1 - 0.7 * loadout.hands.ads);
    if (amp > 0) {
        // The same phase as the bob of the gun. The head is highest, and
        // furthest to the side, in the middle of each step.
        const ph = me.stride * 1.7;
        const right = v3(@cos(me.yaw), 0, -@sin(me.yaw));
        eye[1] += amp * 0.02 * (2 * @abs(@sin(ph)) - 1);
        eye += right * vec.s(amp * 0.015 * @sin(ph));
        roll -= amp * 0.005 * @sin(ph);
    }
    return .{ .eye = eye, .roll = roll };
}

fn cameraMatrix() Mat4 {
    const pv = playerView();
    return vec.ypr(pv.eye, me.yaw, me.pitch, pv.roll);
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
    // Practice has no end of rounds.
    loadout.equip(applied, grenade.per_life, mode == .practice);
    alive = true;
    hp = 100;
    nade_cd = 0;
}

// ---- The weapon pick -------------------------------------------------------

/// Read the pick from local storage ("p=AssaultRifle_3 s=Pistol_2"). A
/// missing or bad value keeps the default.
fn loadChoice() void {
    choice = weapon.Choice.default();
    const stored = (platform.storageGet(alloc, "loadout") catch null) orelse return;
    defer alloc.free(stored);
    var c = choice;
    var pairs = std.mem.tokenizeScalar(u8, stored, ' ');
    while (pairs.next()) |pair| {
        if (pair.len < 3) continue;
        const id = weapon.byName(pair[2..]) orelse continue;
        if (std.mem.startsWith(u8, pair, "p=")) c.primary = id;
        if (std.mem.startsWith(u8, pair, "s=")) c.secondary = id;
    }
    if (c.valid()) choice = c;
}

fn saveChoice() void {
    var buf: [64]u8 = undefined;
    const s = std.fmt.bufPrint(&buf, "p={s} s={s}", .{ weapon.models[choice.primary].name, weapon.models[choice.secondary].name }) catch return;
    platform.storageSet("loadout", s) catch {};
}

/// The pick as [class, model] pairs for the lobby messages.
fn sendChoice(comptime kind: []const u8) void {
    const p = weapon.models[choice.primary];
    const s = weapon.models[choice.secondary];
    client.send("{{\"t\":\"" ++ kind ++ "\",\"name\":\"{s}\",\"p\":[{d},{d}],\"s\":[{d},{d}]}}", .{
        my_name[0..my_name_len], @backingInt(p.class), choice.primary, @backingInt(s.class), choice.secondary,
    });
}

/// A pick from a lobby message, or null when it is not valid.
fn choiceFrom(p: ?[2]u32, s: ?[2]u32) ?weapon.Choice {
    const pp = p orelse return null;
    const ss = s orelse return null;
    if (pp[1] > 255 or ss[1] > 255) return null;
    const c: weapon.Choice = .{ .primary = @intCast(pp[1]), .secondary = @intCast(ss[1]) };
    return if (c.valid()) c else null;
}

/// The player picked a weapon in the menu.
fn pickChanged() void {
    saveChoice();
    switch (mode) {
        .practice => {
            applied = choice;
            loadout.rearm(applied, true);
        },
        // The server answers with the pick of this life.
        .deathmatch => sendChoice("loadout"),
        .menu => {},
    }
    sound(900, 700, 0.04, .square, 0.08);
}

/// The model to draw for a remote player: its own when it is of the right
/// class, else the first model of the class.
fn remoteModel(r: *const Remote) u8 {
    if (r.w == .knife) return weapon.knife_model;
    if (r.m < weapon.models.len and weapon.models[r.m].class == r.w) return r.m;
    return weapon.firstOf(r.w);
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
    render.loadMap(ctx.gpu(), static_mesh.verts.items, map.lights[0..map.light_count]) catch |err| std.log.err("action: map upload: {s}", .{@errorName(err)});
}

fn crossed(a: f32, b: f32, at: f32) bool {
    return a < at and b >= at;
}

fn trainSounds(a: f32, b: f32) void {
    if (crossed(a, b, 0.05)) {
        ambient(70, 38, 6.0, .sawtooth, 0.12);
        ambient(1, null, 5.0, .noise, 0.08);
    }
    if (crossed(a, b, 7.5)) ambient(900, 300, 1.6, .sine, 0.05); // brakes
    if (crossed(a, b, 10)) {
        ambient(784, null, 0.35, .sine, 0.12);
        ambient(523, null, 0.6, .sine, 0.1);
    }
    if (crossed(a, b, 23.5)) {
        ambient(659, null, 0.25, .sine, 0.12);
        ambient(659, null, 0.25, .sine, 0.12);
    }
    if (crossed(a, b, 27)) ambient(120, 400, 6.0, .sawtooth, 0.06); // traction motors
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
    grenade.reset();
    weapon_menu.close();
    ctx.setMouseCapture(false);
    loadMap(ctx, .earls_court);
}

fn enterPractice(ctx: *sw.Context) void {
    loadMap(ctx, .arena);
    mode = .practice;
    grenade.reset();
    applied = choice;
    spawnRange();
    practice_phase = .idle;
    practice_t = 0;
    result_t = 0;
    score = 0;
    shots = 0;
    hits = 0;
    new_best = false;
    for (&targets, 0..) |*t, i| placeTarget(t, i);
    range.reset();
}

/// The practice spawn: on the firing line of the range.
fn spawnRange() void {
    const sp = arena.range_spawn;
    spawnAt(sp.pos[0], sp.pos[1], sp.pos[2], sp.yaw);
}

/// A hit on a plate while no round runs: the round starts. The shot that
/// hit counts.
fn startRound() void {
    practice_phase = .running;
    practice_t = practice_len;
    result_t = 0;
    score = 0;
    shots = 1;
    hits = 0;
    new_best = false;
    sound(880, null, 0.15, .sine, 0.25);
}

fn enterDeathmatch(ctx: *sw.Context) void {
    loadMap(ctx, .earls_court);
    mode = .deathmatch;
    grenade.reset();
    remote_n = 0;
    feed_n = 0;
    my_id = 0;
    my_k = 0;
    my_d = 0;
    my_ping = -1;
    my_ping_stale = false;
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
        for (player_mod.hitBoxes(r.pos, r.yaw, r.lean), 0..) |b, k| {
            if (map.rayBox(o, d, b.min, b.max)) |h| {
                if (best_hit == null or h.t < best_hit.?.t) best_hit = .{ .idx = i, .t = h.t, .head = k == 2 };
            }
        }
    }
    return best_hit;
}

/// The first thing on a shot ray: the map, a remote player, a practice
/// plate or a dummy, within `reach`.
const ShotRay = struct {
    t: f32,
    normal: V3 = v3(0, 1, 0),
    world: bool = false,
    remote: ?RemoteHit = null,
    plate: ?usize = null,
    bull: bool = false,
    dummy: ?range.Hit = null,
};

fn traceShot(o: V3, d: V3, reach: f32) ShotRay {
    var out: ShotRay = .{ .t = reach };
    if (map.raycast(o, d, reach)) |h| {
        out.t = h.t;
        out.normal = h.normal;
        out.world = true;
    }
    if (mode == .deathmatch) {
        if (rayRemotes(o, d)) |rh| {
            if (rh.t < out.t) out = .{ .t = rh.t, .remote = rh };
        }
    } else if (mode == .practice) {
        for (&targets, 0..) |*t, i| {
            if (!t.up) continue;
            const pl = targetPlate(t);
            const denom = vec.dot(d, pl.n);
            if (@abs(denom) < 1e-4) continue;
            const tt = vec.dot(pl.c - o, pl.n) / denom;
            if (tt <= 0 or tt >= out.t) continue;
            const dist = vec.len(o + d * vec.s(tt) - pl.c);
            if (dist < 0.42) out = .{ .t = tt, .plate = i, .bull = dist < 0.12 };
        }
        if (range.ray(o, d)) |dh| {
            if (dh.t < out.t) out = .{ .t = dh.t, .dummy = dh };
        }
    }
    return out;
}

/// Knock down a practice plate and score it.
fn knockPlate(i: usize, bull: bool, at: V3, d: V3) void {
    const t = &targets[i];
    if (!t.up) return;
    if (practice_phase == .idle) startRound();
    t.up = false;
    t.down_time = 0;
    hits += 1;
    score += if (bull) 150 else 100;
    hit_marker = 0.18;
    hit_marker_kill = bull;
    addSparks(at, -d, v3(1.0, 0.8, 0.5), 8);
    sound(if (bull) 1900 else 1400, null, 0.05, .sine, 0.2);
}

/// The hits of one shot on one remote player: body and head pellets.
const ShotHit = struct { idx: usize, body: u32 = 0, head: u32 = 0 };

/// The damage of one pellet (or one cut) on a dummy: the stats of the held
/// weapon, as the server applies them to a player (server/index.ts WEAPONS).
fn pelletDamage(st: *const weapon.Stats, head: bool) f32 {
    return @floatFromInt(if (head) st.head else st.body);
}

/// A shot, a cut or a blast on a practice dummy: the damage and its
/// numbers (range.zig), the hit marker and the sound. `body` and `head` are
/// the damage of all the pellets.
fn dummyHit(i: usize, body: f32, head: f32) void {
    const killed = range.hit(i, body, head);
    hit_marker = if (killed) 0.35 else 0.18;
    hit_marker_kill = killed;
    if (killed) {
        sound(900, null, 0.06, .sine, 0.25);
        sound(1350, null, 0.12, .sine, 0.2);
    } else if (head > 0) {
        // A head hit rings higher.
        sound(2100, null, 0.07, .sine, 0.22);
    } else sound(1500, 1300, 0.04, .square, 0.12);
}

/// A gun shot: one ray for each pellet in the cone. In deathmatch one
/// "fire" message carries the hits of all the pellets. The server takes
/// the damage of each pellet from its own table.
fn fire() void {
    const it = loadout.held() orelse return;
    const st = weapon.stats(it.class);
    shots += 1;
    const moving = @min(1, @sqrt(me.vel[0] * me.vel[0] + me.vel[2] * me.vel[2]) / 6);
    const sp = loadout.hands.spread(it.class, moving, !me.grounded);
    const f = vec.forward(me.yaw, me.pitch);
    const right = vec.norm(vec.cross(f, v3(0, 1, 0)));
    const up = vec.cross(right, f);
    const o = me.eyePos();
    const pose = loadout.hands.pose(it.*, me.stride * 1.7, 0);
    const muzzle = vec.xform(cameraMatrix().mul(pose.gun), pose.muzzle);

    var hit_list: [8]ShotHit = undefined;
    var nh: usize = 0;
    // The damage of this shot on each dummy: body, head.
    var dummy_dmg: [range.dummies.len][2]f32 = @splat(.{ 0, 0 });
    var first_end = o + f * vec.s(st.range);
    for (0..st.pellets) |pi| {
        const a = rand() * std.math.tau;
        const r = @sqrt(rand()) * sp;
        const d = vec.norm(f + right * vec.s(@cos(a) * r) + up * vec.s(@sin(a) * r));
        const ray = traceShot(o, d, st.range);
        const end = o + d * vec.s(ray.t);
        if (pi == 0) first_end = end;
        // A tracer for each of the first 4 pellets. More fill the view.
        if (pi < 4) addTracer(muzzle, end);
        if (ray.remote) |rh| {
            addSparks(end, -d, v3(0.7, 0.05, 0.03), if (st.pellets > 1) 3 else 10);
            var slot: ?*ShotHit = null;
            for (hit_list[0..nh]) |*h| {
                if (h.idx == rh.idx) slot = h;
            }
            if (slot == null and nh < hit_list.len) {
                hit_list[nh] = .{ .idx = rh.idx };
                slot = &hit_list[nh];
                nh += 1;
            }
            if (slot) |h| {
                if (rh.head) h.head += 1 else h.body += 1;
            }
        } else if (ray.plate) |i| {
            knockPlate(i, ray.bull, end, d);
        } else if (ray.dummy) |dh| {
            addSparks(end, -d, v3(0.7, 0.05, 0.03), if (st.pellets > 1) 3 else 10);
            dummy_dmg[dh.idx][@intFromBool(dh.head)] += pelletDamage(st, dh.head);
        } else if (ray.world and (pi < 3 or rand() < 0.3)) {
            addSparks(end, ray.normal, v3(1.0, 0.75, 0.4), if (st.pellets > 1) 2 else 6);
        }
    }
    gunshotSound(1, it.class);
    for (dummy_dmg, 0..) |dd, i| {
        if (dd[0] + dd[1] > 0) dummyHit(i, dd[0], dd[1]);
    }
    if (nh > 0) {
        hit_marker = 0.18;
        hit_marker_kill = false;
        sound(1500, 1300, 0.04, .square, 0.12);
    }
    if (mode == .deathmatch) {
        // The hits: {"id":n,"b":n,"h":n} for each player.
        var list: [300]u8 = undefined;
        var len: usize = 0;
        for (hit_list[0..nh]) |h| {
            const item = std.fmt.bufPrint(list[len..], "{s}{{\"id\":{d},\"b\":{d},\"h\":{d}}}", .{
                if (len > 0) "," else "", remotes[h.idx].id, h.body, h.head,
            }) catch break;
            len += item.len;
        }
        client.send("{{\"t\":\"fire\",\"w\":{d},\"o\":[{d:.2},{d:.2},{d:.2}],\"e\":[{d:.2},{d:.2},{d:.2}],\"hits\":[{s}]}}", .{
            @backingInt(it.class), muzzle[0], muzzle[1], muzzle[2], first_end[0], first_end[1], first_end[2], list[0..len],
        });
    }
}

/// A knife swing: short rays from the eye, the centre and four around it,
/// so a near miss still cuts. The first player, plate or dummy that a ray
/// finds takes the hit.
fn stab() void {
    const st = weapon.stats(.knife);
    const o = me.eyePos();
    const f = vec.forward(me.yaw, me.pitch);
    const right = vec.norm(vec.cross(f, v3(0, 1, 0)));
    const up = vec.cross(right, f);
    sound(1, null, 0.09, .noise, 0.1);
    sound(500, 900, 0.08, .sine, 0.04);
    const offsets = [_][2]f32{ .{ 0, 0 }, .{ 0.15, 0 }, .{ -0.15, 0 }, .{ 0, 0.15 }, .{ 0, -0.15 } };
    var centre: ?ShotRay = null;
    for (offsets, 0..) |k, i| {
        const d = vec.norm(f + right * vec.s(k[0]) + up * vec.s(k[1]));
        const ray = traceShot(o, d, st.range);
        if (i == 0) centre = ray;
        const end = o + d * vec.s(ray.t);
        if (ray.remote) |rh| {
            addSparks(end, -d, v3(0.7, 0.05, 0.03), 8);
            hit_marker = 0.18;
            hit_marker_kill = false;
            sound(180, 90, 0.08, .sawtooth, 0.2);
            client.send("{{\"t\":\"fire\",\"w\":{d},\"hits\":[{{\"id\":{d},\"b\":{d},\"h\":{d}}}]}}", .{
                @backingInt(weapon.Class.knife), remotes[rh.idx].id, @intFromBool(!rh.head), @intFromBool(rh.head),
            });
            return;
        }
        if (ray.plate) |p| {
            knockPlate(p, false, end, d);
            return;
        }
        if (ray.dummy) |dh| {
            addSparks(end, -d, v3(0.7, 0.05, 0.03), 8);
            sound(180, 90, 0.08, .sawtooth, 0.2);
            const dmg = pelletDamage(st, dh.head);
            dummyHit(dh.idx, if (dh.head) 0 else dmg, if (dh.head) dmg else 0);
            return;
        }
    }
    if (centre) |c| if (c.world) {
        addSparks(o + f * vec.s(c.t), c.normal, v3(1.0, 0.85, 0.6), 4);
        sound(2400, 1800, 0.05, .square, 0.06);
    };
}

fn recoilKick(st: *const weapon.Stats) void {
    const h = loadout.hands;
    me.pitch = @min(1.5, me.pitch + st.kick * (1 + 0.5 * h.heat) * (1 - 0.5 * h.ads));
    me.yaw += (rand() - 0.5) * st.kick * 0.7;
}

// ---- Grenades --------------------------------------------------------------
// grenade.zig has the flight, the smoke and the damage model. This part
// connects it to the players, the plates, the HUD and the lobby.

/// The id of the practice plates and of the dummies as grenade bodies (no
/// player has them).
const plate_id: u32 = 0xFFFF_FFFF;
const dummy_id: u32 = 0xFFFF_FFFE;

/// The boxes that stop a grenade: the remote players (the hit boxes, as in
/// rayRemotes), this player in deathmatch (for the grenades of others), the
/// practice plates and the dummies (their hit boxes).
fn grenadeBodies(buf: []grenade.Body) []grenade.Body {
    var n: usize = 0;
    for (remotes[0..remote_n]) |r| {
        if (!r.alive or n + 3 > buf.len) continue;
        for (player_mod.hitBoxes(r.pos, r.yaw, r.lean)) |b| {
            buf[n] = .{ .min = b.min, .max = b.max, .id = r.id };
            n += 1;
        }
    }
    if (mode == .deathmatch and alive and n + 3 <= buf.len) {
        for (player_mod.hitBoxes(me.pos, me.yaw, me.lean)) |b| {
            buf[n] = .{ .min = b.min, .max = b.max, .id = my_id };
            n += 1;
        }
    }
    if (mode == .practice) for (&targets) |*t| {
        if (!t.up or n == buf.len) continue;
        const c = targetPlate(t).c;
        buf[n] = .{ .min = c - vec.s(0.4), .max = c + vec.s(0.4), .id = plate_id };
        n += 1;
    };
    if (mode == .practice) for (&range.dummies) |*dm| {
        if (!dm.alive or n + 3 > buf.len) continue;
        for (dm.hitBoxes()) |b| {
            buf[n] = .{ .min = b.min, .max = b.max, .id = dummy_id };
            n += 1;
        }
    };
    return buf[0..n];
}

/// Throw a grenade: G from any slot, or a left click with the grenade in
/// the hand (slot 4).
fn throwGrenade() void {
    if (nade_cd > 0) return;
    const nade = loadout.item(.grenade) orelse return;
    if (mode == .deathmatch and nade.ammo == 0) {
        sound(1200, 900, 0.03, .square, 0.1);
        return;
    }
    if (mode == .deathmatch) nade.ammo -= 1;
    nade_cd = grenade.cooldown;
    // With the grenade in the hand, the next one comes up. After the last
    // one, the hand goes back to the weapon before it.
    if (loadout.current == .grenade) {
        if (mode == .deathmatch and nade.ammo == 0) {
            _ = loadout.select(loadout.last);
        } else loadout.hands.takeOut(weapon.stats(.grenade).draw);
    }
    const th = grenade.throwFrom(me.eyePos(), me.yaw, me.pitch, me.vel);
    grenade.spawn(th.o, th.v, my_id, true);
    if (mode == .deathmatch) {
        client.send("{{\"t\":\"nade\",\"o\":[{d:.3},{d:.3},{d:.3}],\"v\":[{d:.3},{d:.3},{d:.3}]}}", .{
            th.o[0], th.o[1], th.o[2], th.v[0], th.v[1], th.v[2],
        });
    }
    sound(1, null, 0.14, .noise, 0.1);
    sound(420, 180, 0.12, .sine, 0.08);
}

/// The aimed throw, flown ahead for the debug view. Null when no throw is
/// possible.
fn aimPrediction() ?grenade.Prediction {
    if (mode == .menu or (mode == .deathmatch and !alive)) return null;
    const th = grenade.throwFrom(me.eyePos(), me.yaw, me.pitch, me.vel);
    var buf: [64]grenade.Body = undefined;
    return grenade.predict(th.o, th.v, dt, grenadeBodies(&buf), my_id);
}

/// A blast: the sound for all grenades (grenade.zig draws the flash, the
/// streaks and the smoke). For a grenade of this client also the damage:
/// practice applies it here, deathmatch sends it to the server, which
/// applies it as it does a hit.
fn onBlast(b: grenade.Blast) void {
    const dist = vec.len(b.pos - me.eyePos());
    const vol = std.math.clamp(8 / (dist + 4), 0.08, 1);
    sound(1, null, 0.8, .noise, 0.75 * vol);
    sound(110, 28, 0.7, .sine, 0.9 * vol);
    if (!b.mine) return;
    switch (mode) {
        .practice => {
            for (&targets) |*t| {
                if (!t.up or !grenade.reaches(b, targetPlate(t).c)) continue;
                if (practice_phase == .idle) startRound();
                t.up = false;
                t.down_time = 0;
                hits += 1;
                score += 100;
                hit_marker = 0.18;
                hit_marker_kill = false;
            }
            // The dummies: the same damage as a player gets (rounded, as in
            // deathmatch).
            for (&range.dummies, 0..) |*dm, i| {
                if (!dm.alive) continue;
                const dd = @round(grenade.damageTo(b, dm.blastPoints()));
                if (dd >= 1) dummyHit(i, dd, 0);
            }
            const d = grenade.damageTo(b, player_mod.blastPoints(me.pos, me.yaw, me.lean));
            if (d >= 1) {
                hp -= @intFromFloat(@round(d));
                damage_flash = @min(1, damage_flash + 0.6);
                sound(220, 90, 0.12, .sawtooth, 0.25);
                if (hp <= 0) {
                    // No death in practice: back to the start.
                    spawnRange();
                    sound(300, 60, 0.6, .sawtooth, 0.3);
                }
            }
        },
        .deathmatch => {
            // The hits: {"id":n,"dmg":n} for each player in the blast, this
            // player too. The list stays inside the 512-byte send buffer.
            var list: [400]u8 = undefined;
            var len: usize = 0;
            var any = false;
            for (remotes[0..remote_n]) |r| {
                if (!r.alive) continue;
                const d = grenade.damageTo(b, player_mod.blastPoints(r.pos, r.yaw, r.lean));
                if (d < 1) continue;
                const item = std.fmt.bufPrint(list[len..], "{s}{{\"id\":{d},\"dmg\":{d}}}", .{
                    if (len > 0) "," else "", r.id, @as(u32, @intFromFloat(@round(d))),
                }) catch break;
                len += item.len;
                any = true;
            }
            if (alive) {
                const d = grenade.damageTo(b, player_mod.blastPoints(me.pos, me.yaw, me.lean));
                if (d >= 1) {
                    if (std.fmt.bufPrint(list[len..], "{s}{{\"id\":{d},\"dmg\":{d}}}", .{
                        if (len > 0) "," else "", my_id, @as(u32, @intFromFloat(@round(d))),
                    })) |item| {
                        len += item.len;
                    } else |_| {}
                }
            }
            client.send("{{\"t\":\"blast\",\"p\":[{d:.2},{d:.2},{d:.2}],\"hits\":[{s}]}}", .{
                b.pos[0], b.pos[1], b.pos[2], list[0..len],
            });
            if (any) {
                hit_marker = 0.18;
                hit_marker_kill = false;
                sound(1500, 1300, 0.04, .square, 0.12);
            }
        },
        .menu => {},
    }
}

fn stepGrenades() void {
    nade_cd = @max(0, nade_cd - dt);
    var buf: [64]grenade.Body = undefined;
    for (grenade.step(dt, grenadeBodies(&buf))) |b| onBlast(b);
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
        rem.lean_target = std.math.clamp(p.lean, -1, 1);
        rem.w = weapon.classFromId(p.w) orelse .rifle;
        rem.m = @intCast(@min(p.m, 255));
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

/// The pings of the players, each 2 s (server/ping.ts).
fn handlePings(m: net.Msg) void {
    for (m.ms orelse &.{}) |row| {
        const id: u32 = @intCast(@max(0, row[0]));
        const ms = @max(-1, row[1]);
        const stale = row[2] != 0;
        if (id == my_id) {
            my_ping = ms;
            my_ping_stale = stale;
        } else if (findRemote(id)) |r| {
            r.ping = ms;
            r.ping_stale = stale;
        }
    }
}

fn handleNet() void {
    client.beginFrame();
    if (client.state() == .open and !sent_hello) {
        sendChoice("hello");
        sent_hello = true;
    }
    while (client.poll()) |m| {
        if (std.mem.eql(u8, m.t, "welcome")) {
            my_id = m.id orelse 0;
        } else if (std.mem.eql(u8, m.t, "snap")) {
            handleSnap(m);
        } else if (std.mem.eql(u8, m.t, "pings")) {
            handlePings(m);
        } else if (std.mem.eql(u8, m.t, "spawn")) {
            // The spawn carries the weapons of the new life.
            if (choiceFrom(m.p, m.s)) |c| applied = c;
            spawnAt(m.x orelse 0, m.y orelse 0, m.z orelse 0, m.yaw orelse 0);
            dead_time = 0;
        } else if (std.mem.eql(u8, m.t, "loadout")) {
            // The answer to a pick: the weapons of this life. They change
            // at once when the player is still at the spawn point.
            if (choiceFrom(m.p, m.s)) |c| {
                if (!c.eql(applied)) {
                    applied = c;
                    if (alive) loadout.rearm(applied, false);
                }
            }
        } else if (std.mem.eql(u8, m.t, "shot")) {
            if (m.o != null and m.e != null) {
                const a = v3(m.o.?[0], m.o.?[1], m.o.?[2]);
                const b = v3(m.e.?[0], m.e.?[1], m.e.?[2]);
                addTracer(a, b);
                addSparks(b, vec.norm(a - b), v3(1.0, 0.75, 0.4), 4);
                remote_flash = .{ .p = a, .life = 0.05 };
                if (findRemote(m.id orelse 0)) |r| r.shot_t = time;
                const dist = vec.len(a - me.eyePos());
                const c = weapon.classFromId(m.w orelse 0) orelse .rifle;
                gunshotSound(std.math.clamp(6 / (dist + 4), 0.05, 0.6), c);
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
        } else if (std.mem.eql(u8, m.t, "nade")) {
            // Another player threw: fly the same path, for the visuals.
            if (m.o != null and m.v != null) {
                grenade.spawn(v3(m.o.?[0], m.o.?[1], m.o.?[2]), v3(m.v.?[0], m.v.?[1], m.v.?[2]), m.id orelse 0, false);
            }
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
    const frozen = mode == .deathmatch and (phase_end or !alive);
    const look: f32 = 0.0022 * settings.v.sens * (1 - 0.35 * loadout.hands.ads);
    me.yaw -= in.mouse.delta_x * look;
    me.pitch = std.math.clamp(me.pitch - in.mouse.delta_y * look, -1.5, 1.5);

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
    // The held weapon sets the walk speed (weapon.zig table).
    const speed_scale: f32 = (1 - 0.45 * loadout.hands.ads) * loadout.heldStats().speed;
    if (mode != .deathmatch or alive) me.step(dt, wish, jump, speed_scale);
    // Q leans left and E leans right while held.
    var lean_want: f32 = 0;
    if (!frozen and !shortcut) {
        if (in.keyDown(.Q)) lean_want -= 1;
        if (in.keyDown(.E)) lean_want += 1;
    }
    me.updateLean(dt, lean_want);

    // F is the use key: lift buttons, and each target that a player presses.
    if (!frozen and !shortcut and in.keyPressed(.F)) {
        if (aimedButton()) |b| pressButton(b);
    }
    // B: the weapon menu. It frees the mouse.
    if (!shortcut and in.keyPressed(.B)) {
        weapon_menu.show();
        ctx.setMouseCapture(false);
        return;
    }
    // The weapon slots: 1 primary, 2 secondary, 3 knife, 4 grenade. With
    // Shift and the debug screen, the number keys teleport instead.
    if (!frozen and !shortcut and !in.mods.shift) {
        const keys = [_]core.KeyCode{ .Num1, .Num2, .Num3, .Num4 };
        for (keys, 0..) |k, i| {
            if (!in.keyPressed(k)) continue;
            if (loadout.select(@fromBackingInt(@intCast(i)))) {
                sound(650, 480, 0.04, .square, 0.05);
            } else if (i == 3 and loadout.grenades() == 0 and mode == .deathmatch) {
                sound(1200, 900, 0.03, .square, 0.1);
            }
        }
    }

    const can_shoot = !frozen;
    // G: a quick throw from any slot.
    if (can_shoot and !shortcut and in.keyPressed(.G)) throwGrenade();
    const it = loadout.held() orelse return;
    const st = weapon.stats(it.class);
    if (can_shoot and in.keyPressed(.R)) {
        if (loadout.hands.startReload(it)) sound(500, 380, 0.05, .square, 0.08);
    }
    // A short click can press and release inside one tick.
    const trigger = can_shoot and (in.buttonDown(.left) or in.buttonPressed(.left));
    const pressed = can_shoot and in.buttonPressed(.left);
    const ev = loadout.hands.update(it, dt, trigger, pressed, can_shoot and in.buttonDown(.right));
    switch (ev) {
        .fired => {
            fire();
            recoilKick(st);
        },
        .swung => stab(),
        .empty => {
            sound(1200, 900, 0.03, .square, 0.1);
            _ = loadout.hands.startReload(it);
        },
        .mag_out => sound(700, 420, 0.06, .square, 0.12),
        .mag_in => sound(950, 600, 0.05, .square, 0.15),
        .racked => {
            sound(1400, 700, 0.04, .square, 0.12);
            sound(600, 300, 0.07, .square, 0.1);
        },
        .ready, .none => {},
    }
    // The grenade in the hand: a left click throws it.
    if (it.class == .grenade and pressed and loadout.hands.ready()) throwGrenade();
    if (st.mag > 0 and it.ammo == 0 and loadout.hands.ready() and it.reserve > 0 and !trigger) _ = loadout.hands.startReload(it);
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
        r.lean += (r.lean_target - r.lean) * k;
        r.fall = if (r.alive) 0 else @min(1, r.fall + dt * 3);
    }
}

fn practiceTick() void {
    range.step(dt, rng.random());
    // A plate that is down comes up at a new place, also after the round.
    for (&targets, 0..) |*t, i| {
        if (t.up) {
            t.fall = @max(0, t.fall - dt * 4);
        } else {
            t.fall = @min(1, t.fall + dt * 5);
            t.down_time += dt;
            if (t.down_time > 0.8) placeTarget(t, i + @as(usize, @intCast(ticks % 1000)));
        }
    }
    switch (practice_phase) {
        .idle => result_t -= dt,
        .running => {
            practice_t -= dt;
            if (practice_t <= 0) {
                practice_phase = .idle;
                practice_t = 0;
                result_t = 8;
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
    }
}

fn tick(ctx: *sw.Context) void {
    ticks += 1;
    time += dt;
    const in = ctx.input();

    captured = jsPointerLocked() != 0;
    // The engine default master volume is 0.5: a setting of 100% keeps it.
    audio.setMasterVolume(0.5 * settings.v.master);

    // Cmd+D (macOS) / Ctrl+D: the debug screen, as in the voxel example.
    if (in.keyPressed(.D) and (in.mods.super or in.mods.ctrl)) show_debug = !show_debug;

    switch (mode) {
        .menu => {
            if (settings.open) {
                const l = logical(ctx);
                settings.update(in, l.w, l.h);
            } else {
                if (in.keyPressed(.Num1)) enterDeathmatch(ctx);
                if (in.keyPressed(.Num2)) enterPractice(ctx);
                if (in.keyPressed(.Num3)) settings.show();
                if (in.buttonPressed(.left)) {
                    const b = menuButtons(ctx);
                    for (b, 0..) |r, i| {
                        if (!inRect(r, in.mouse.x, in.mouse.y)) continue;
                        switch (i) {
                            0 => enterDeathmatch(ctx),
                            1 => enterPractice(ctx),
                            else => {
                                settings.show();
                                return;
                            },
                        }
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
                // w and m: the class and the model of the held weapon, so
                // the others see it.
                client.send("{{\"t\":\"st\",\"x\":{d:.3},\"y\":{d:.3},\"z\":{d:.3},\"yaw\":{d:.3},\"pitch\":{d:.3},\"lean\":{d:.2},\"w\":{d},\"m\":{d}}}", .{
                    me.pos[0], me.pos[1], me.pos[2], me.yaw, me.pitch, me.lean, @backingInt(loadout.heldClass()), loadout.heldModel(),
                });
            }
        },
        .practice => practiceTick(),
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

    // Debug teleport: with the debug screen open, Shift+1 to 9 go to a
    // spawn. The number keys alone stay free for the weapon slots.
    if (show_debug and mode != .menu and in.mods.shift) {
        const keys = [_]core.KeyCode{ .Num1, .Num2, .Num3, .Num4, .Num5, .Num6, .Num7, .Num8, .Num9 };
        for (keys, 0..) |k, i| {
            if (in.keyPressed(k) and i < map.spawn_count) {
                me.pos = map.spawns[i].pos;
                me.vel = v3(0, 0, 0);
                me.yaw = map.spawns[i].yaw;
            }
        }
    }

    if (!captured or weapon_menu.open) {
        // Paused, or in the weapon menu: the lean comes back.
        me.updateLean(dt, 0);
        if (settings.open) {
            const l = logical(ctx);
            settings.update(in, l.w, l.h);
        } else if (weapon_menu.open) {
            const l = logical(ctx);
            switch (weapon_menu.update(in, l.w, l.h, &choice)) {
                .changed => pickChanged(),
                // B and DONE are user gestures: the lock request is allowed.
                .close_play => ctx.setMouseCapture(true),
                .close_pause, .none => {},
            }
        } else {
            if (in.keyPressed(.M)) {
                enterMenu(ctx);
                return;
            }
            if (in.keyPressed(.B)) weapon_menu.show();
            if (in.buttonPressed(.left)) {
                if (pauseScreenShows() and inRect(pauseSettingsButton(ctx), in.mouse.x, in.mouse.y)) {
                    settings.show();
                } else ctx.setMouseCapture(true);
            }
        }
    } else {
        gameplayTick(ctx);
    }
    stepGrenades();
    effectsTick();
}

// ---- Scene building --------------------------------------------------------

/// The pose of a player model: a remote player or a practice dummy. `m` is
/// the model of the held gun.
const Body = struct {
    pos: V3,
    yaw: f32,
    pitch: f32,
    lean: f32,
    fall: f32,
    stride: f32,
    color: V3,
    w: weapon.Class,
    m: u8,
};

fn buildRemote(r: *const Remote) void {
    buildBody(.{
        .pos = r.pos,
        .yaw = r.yaw,
        .pitch = r.pitch,
        .lean = r.lean,
        .fall = r.fall,
        .stride = r.stride,
        .color = colorFor(r.id),
        .w = r.w,
        .m = remoteModel(r),
    });
}

/// A practice dummy: the player model with a rifle, in the orange of a
/// range target.
fn buildDummy(d: *const range.Dummy) void {
    buildBody(.{
        .pos = d.body.pos,
        .yaw = d.body.yaw,
        .pitch = 0,
        .lean = d.body.lean,
        .fall = d.fall,
        .stride = d.body.stride,
        .color = v3(0.85, 0.42, 0.16),
        .w = .rifle,
        .m = weapon.firstOf(.rifle),
    });
}

fn buildBody(r: Body) void {
    const col = r.color;
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
    // The upper body turns about the hips with the lean (player.zig
    // leanOffset). Local +X is the right of the player.
    const hip = player_mod.hip;
    const upper = base.mul(vec.translate(v3(0, hip, 0)).mul(Mat4.rotationZ(-player_mod.leanAngle(r.lean)).mul(vec.translate(v3(0, -hip, 0)))));
    dyn.orientedBox(upper, v3(-0.23, 0.84, -0.14), v3(0.23, 1.45, 0.14), col, 6);
    dyn.orientedBox(upper, v3(-0.25, 1.0, -0.16), v3(0.25, 1.38, 0.16), dark, 6);
    dyn.orientedBox(upper, v3(-0.12, 1.47, -0.12), v3(0.12, 1.74, 0.12), skin, 6);
    dyn.orientedBox(upper, v3(-0.14, 1.66, -0.15), v3(0.14, 1.8, 0.15), dark, 3);
    dyn.orientedBox(upper, v3(-0.1, 1.56, -0.135), v3(0.1, 1.62, -0.11), v3(0.05, 0.05, 0.06), 3);
    // Arms and the held weapon, turned with the look pitch.
    const aim = upper.mul(vec.translate(v3(0, 1.38, 0)).mul(Mat4.rotationX(r.pitch * (1 - r.fall))));
    dyn.orientedBox(aim, v3(0.16, -0.1, -0.45), v3(0.26, 0.02, 0.0), col, 6);
    dyn.orientedBox(aim, v3(-0.2, -0.12, -0.5), v3(-0.1, -0.02, -0.05), col, 6);
    switch (r.w) {
        // A one-hand weapon sits in the right hand, further out.
        .grenade => grenade.addBody(&dyn, aim.mul(vec.translate(v3(0.21, -0.05, -0.5))), 0),
        .knife => weapon.addModel(&dyn, weapon.knife_model, aim.mul(vec.translate(v3(0.21, -0.06, -0.47)).mul(Mat4.rotationX(0.5))), Mat4.identity(), 0),
        .pistol, .revolver => weapon.addModel(&dyn, r.m, aim.mul(vec.translate(v3(0.06, -0.06, -0.44))), Mat4.identity(), 0),
        else => weapon.addModel(&dyn, r.m, aim.mul(vec.translate(v3(0.08, -0.1, -0.24))), Mat4.identity(), 0),
    }
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
    if (mode == .menu or weapon_menu.open) return;
    if (mode == .deathmatch and !alive) return;
    const it = loadout.held() orelse return;
    const hands = &loadout.hands;
    const speed = @min(1, @sqrt(me.vel[0] * me.vel[0] + me.vel[2] * me.vel[2]) / 6);
    const pose = hands.pose(it.*, me.stride * 1.7, if (me.grounded) speed else 0);
    const gm = cameraMatrix().mul(grenade.viewDip()).mul(pose.gun);
    if (it.class == .grenade) {
        grenade.addBody(&dyn, gm, 100);
        return;
    }
    weapon.addModel(&dyn, it.model, gm, pose.mag, 100);
    if (hands.flash > 0) {
        // A star of two crossed emissive blades at the muzzle.
        const fm = gm.mul(vec.translate(pose.muzzle).mul(Mat4.rotationZ(hands.flash_roll)));
        const s: f32 = 0.05 + rand() * 0.03;
        dyn.orientedBox(fm, v3(-s, -0.006, -s * 2.6), v3(s, 0.006, 0), v3(1.0, 0.7, 0.3), 104);
        dyn.orientedBox(fm, v3(-0.006, -s, -s * 2.6), v3(0.006, s, 0), v3(1.0, 0.7, 0.3), 104);
    }
}

/// True when the grenade is out in the hand (slot 4, the draw done): the
/// aim view shows.
fn grenadeAimShows() bool {
    if (mode == .menu or weapon_menu.open or (mode == .deathmatch and !alive)) return false;
    return loadout.heldClass() == .grenade and loadout.hands.drawing <= 0 and nade_cd <= 0;
}

/// The model under the mouse in the weapon menu, in 3D, in the window of
/// the panel (weapon_menu.previewRect), on a dark backdrop. It turns a
/// little from side to side.
fn buildPreview(ctx: *sw.Context, eye: V3, yaw: f32, pitch: f32, roll: f32, fov: f32) void {
    const l = logical(ctx);
    const pr = weapon_menu.previewRect(l.w, l.h);
    const th = @tan(fov / 2);
    const aspect = l.w / l.h;
    // The window centre and half size at a depth of 1 m, in camera space.
    const cx = ((pr.x + pr.w / 2) / l.w * 2 - 1) * th * aspect;
    const cy = (1 - (pr.y + pr.h / 2) / l.h * 2) * th;
    const hw = pr.w / l.w * th * aspect;
    const hh = pr.h / l.h * th;
    const cam = vec.ypr(eye, yaw, pitch, roll);
    const d: f32 = 0.6;
    const model = weapon_menu.previewModel(choice);
    const mdl = weapon.models[model];
    const size = mdl.max - mdl.min;
    const k = @min(hw * d * 1.5 / size[2], hh * d * 1.3 / size[1]);
    const mid = (mdl.min + mdl.max) * vec.s(0.5);
    // The muzzle to the right of the window.
    const turn = -std.math.pi / 2.0 + 0.35 * @sin(time * 0.8);
    const m = cam.mul(vec.translate(v3(cx * d, cy * d, -d))).mul(Mat4.rotationY(turn)).mul(Mat4.scaling(k)).mul(vec.translate(-mid));
    weapon.addModel(&dyn, model, m, Mat4.identity(), 100);
    const bd: f32 = 0.9;
    const back = cam.mul(vec.translate(v3(cx * bd, cy * bd, -bd)));
    dyn.orientedBox(back, v3(-hw * bd * 1.05, -hh * bd * 1.05, -0.01), v3(hw * bd * 1.05, hh * bd * 1.05, 0), v3(0.03, 0.033, 0.04), 100);
}

fn eyeForRender() struct { eye: V3, yaw: f32, pitch: f32, roll: f32 = 0 } {
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
    const pv = playerView();
    return .{ .eye = pv.eye, .yaw = me.yaw, .pitch = me.pitch, .roll = pv.roll };
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

fn menuButtons(ctx: *sw.Context) [3]gfx.Rect {
    const l = logical(ctx);
    const w: f32 = 340;
    const x = l.w / 2 - w / 2;
    const y = l.h * 0.45;
    return .{
        .{ .x = x, .y = y, .w = w, .h = 64 },
        .{ .x = x, .y = y + 80, .w = w, .h = 64 },
        .{ .x = x, .y = y + 160, .w = w, .h = 64 },
    };
}

fn inRect(r: gfx.Rect, x: f32, y: f32) bool {
    return x >= r.x and x <= r.x + r.w and y >= r.y and y <= r.y + r.h;
}

/// True when the pause screen ("CLICK TO PLAY") shows. Deathmatch hides it
/// while it connects and while the score board shows.
fn pauseScreenShows() bool {
    if (captured or settings.open or weapon_menu.open) return false;
    return switch (mode) {
        .menu => false,
        .practice => true,
        .deathmatch => client.state() == .open and !phase_end,
    };
}

/// The SETTINGS button of the pause screen.
fn pauseSettingsButton(ctx: *sw.Context) gfx.Rect {
    const l = logical(ctx);
    return .{ .x = l.w / 2 - 110, .y = l.h / 2 + 48, .w = 220, .h = 44 };
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
    const c_held = loadout.heldClass();
    // The grenade has its aim line, the knife a dot. A gun shows its cone.
    if (c_held != .grenade and c_held != .knife) {
        const moving = @min(1, @sqrt(me.vel[0] * me.vel[0] + me.vel[2] * me.vel[2]) / 6);
        const gap = 5 + loadout.hands.spread(c_held, moving, !me.grounded) * 700;
        const a: u8 = @intFromFloat(230 * (1 - loadout.hands.ads));
        const c = gfx.Color.rgba8(255, 255, 255, a);
        const len: f32 = 8;
        try r.fillRect(.{ .x = cx - 1, .y = cy - gap - len, .w = 2, .h = len }, c);
        try r.fillRect(.{ .x = cx - 1, .y = cy + gap, .w = 2, .h = len }, c);
        try r.fillRect(.{ .x = cx - gap - len, .y = cy - 1, .w = len, .h = 2 }, c);
        try r.fillRect(.{ .x = cx + gap, .y = cy - 1, .w = len, .h = 2 }, c);
    }
    if (c_held != .grenade) try r.fillRect(.{ .x = cx - 1, .y = cy - 1, .w = 2, .h = 2 }, gfx.Color.rgba8(255, 255, 255, 200));
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

/// The weapon panel: the rounds of the held gun (or its name), the
/// grenades, and the four slots above them.
fn drawAmmo(r: *gfx.Renderer, w: f32, h: f32) !void {
    var buf: [32]u8 = undefined;
    const hands = &loadout.hands;
    const nades = loadout.grenades();
    try r.fillRect(.{ .x = w - 210, .y = h - 86, .w = 190, .h = 66 }, panel);
    if (loadout.held()) |it| {
        const st = weapon.stats(it.class);
        if (st.mag > 0) {
            const s = std.fmt.bufPrint(&buf, "{d}", .{it.ammo}) catch "";
            txtRight(r, s, w - 100, h - 82, 44, if (it.ammo * 6 <= st.mag) red else white);
            if (it.reserve > 999) {
                txt(r, "/ inf", w - 92, h - 64, 20, dim);
            } else {
                const rs = std.fmt.bufPrint(&buf, "/ {d}", .{it.reserve}) catch "";
                txt(r, rs, w - 92, h - 64, 20, dim);
            }
            if (hands.reloading >= 0) {
                const k = hands.reloading / st.reload;
                try r.fillRect(.{ .x = w - 210, .y = h - 20, .w = 190 * k, .h = 4 }, accent);
                txtCenter(r, "RELOADING", w / 2, h / 2 + 40, 16, accent);
            } else if (it.ammo == 0 and hands.drawing <= 0) {
                txtCenter(r, "R TO RELOAD", w / 2, h / 2 + 40, 16, red);
            }
        } else {
            txtCenter(r, st.label, w - 115, h - 70, 26, white);
            if (it.class == .grenade) txtCenter(r, "CLICK TO THROW", w - 115, h - 38, 12, dim);
        }
    }
    // The grenades, in a small panel to the left.
    try r.fillRect(.{ .x = w - 290, .y = h - 86, .w = 72, .h = 66 }, panel);
    const gs = if (mode == .practice) "inf" else std.fmt.bufPrint(&buf, "{d}", .{nades}) catch "";
    txtCenter(r, gs, w - 254, h - 80, 30, if (mode == .deathmatch and nades == 0) red else white);
    txtCenter(r, "G  NADE", w - 254, h - 40, 12, dim);

    // The slots, right to left: 4 GRENADE, 3 KNIFE, 2 and 1.
    var x = w - 20;
    var i: usize = 4;
    while (i > 0) {
        i -= 1;
        const slot: weapon.Slot = @fromBackingInt(@intCast(i));
        const name = if (loadout.slots[i]) |s| (if (s.class == .grenade) "GRENADE" else weapon.label(&buf, s.model)) else "-";
        var line: [40]u8 = undefined;
        const t = std.fmt.bufPrint(&line, "{d} {s}", .{ i + 1, name }) catch "";
        const m = text.?.measure(t, 13);
        const on = slot == loadout.current;
        if (on) try r.fillRect(.{ .x = x - m.w - 8, .y = h - 112, .w = m.w + 12, .h = 20 }, gfx.Color.rgba8(255, 166, 77, 60));
        txt(r, t, x - m.w - 2, h - 110, 13, if (on) accent else dim);
        x -= m.w + 18;
    }
    // The pick that waits for the next spawn.
    if (mode == .deathmatch and !choice.eql(applied)) {
        var la: [32]u8 = undefined;
        var lb: [32]u8 = undefined;
        var line: [80]u8 = undefined;
        const t = std.fmt.bufPrint(&line, "NEXT SPAWN: {s} + {s}", .{ weapon.label(&la, choice.primary), weapon.label(&lb, choice.secondary) }) catch "";
        txtRight(r, t, w - 20, h - 134, 13, accent);
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

/// A ping cell: whole ms, "-" with no value yet, and a "?" after a stale
/// value.
fn pingText(buf: []u8, ms: i32, stale: bool) []const u8 {
    if (ms < 0) return "-";
    return std.fmt.bufPrint(buf, "{d}{s}", .{ ms, if (stale) "?" else "" }) catch "";
}

fn drawScoreboard(r: *gfx.Renderer, w: f32, h: f32, title: []const u8) !void {
    const pw: f32 = 600;
    const rows = remote_n + 1;
    const ph: f32 = 110 + @as(f32, @floatFromInt(rows)) * 34;
    const x = w / 2 - pw / 2;
    const y = h / 2 - ph / 2;
    try r.fillRect(.{ .x = x, .y = y, .w = pw, .h = ph }, gfx.Color.rgba8(10, 12, 18, 215));
    try r.fillRect(.{ .x = x, .y = y, .w = pw, .h = 3 }, accent);
    txtCenter(r, title, w / 2, y + 18, 26, white);
    txt(r, "PLAYER", x + 24, y + 66, 13, dim);
    txtRight(r, "KILLS", x + pw - 200, y + 66, 13, dim);
    txtRight(r, "DEATHS", x + pw - 110, y + 66, 13, dim);
    txtRight(r, "PING (ms)", x + pw - 24, y + 66, 13, dim);

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
        txtRight(r, std.fmt.bufPrint(&buf, "{d}", .{kills(idx)}) catch "", x + pw - 200, ry, 18, white);
        txtRight(r, std.fmt.bufPrint(&buf, "{d}", .{d}) catch "", x + pw - 110, ry, 18, dim);
        // The ping: a smaller font than the stats, on the same baseline.
        const ping = if (is_me) my_ping else remotes[idx].ping;
        const stale = if (is_me) my_ping_stale else remotes[idx].ping_stale;
        txtRight(r, pingText(&buf, ping, stale), x + pw - 24, ry + 3, 14, if (stale and ping >= 0) red else dim);
    }
}

fn drawMenu(ctx: *sw.Context, r: *gfx.Renderer, w: f32, h: f32) !void {
    const cx = w / 2;
    txtCenter(r, "ACTION", cx, h * 0.2, 96, white);
    txtCenter(r, "a swindowzig shooter", cx, h * 0.2 + 104, 18, dim);
    const b = menuButtons(ctx);
    const labels = [_][]const u8{ "1   DEATHMATCH", "2   TARGET PRACTICE", "3   SETTINGS" };
    const subs = [_][]const u8{ "always-on lobby, 5 minute matches", "offline: the range, and 60 second plate rounds", "head bob, volume, field of view, mouse" };
    const in = ctx.input();
    for (b, 0..) |rect, i| {
        const hover = inRect(rect, in.mouse.x, in.mouse.y);
        try r.fillRect(rect, if (hover) gfx.Color.rgba8(255, 166, 77, 230) else panel);
        txt(r, labels[i], rect.x + 22, rect.y + 10, 22, if (hover) gfx.Color.rgba8(20, 14, 8, 255) else white);
        txt(r, subs[i], rect.x + 22, rect.y + 38, 13, if (hover) gfx.Color.rgba8(40, 26, 14, 255) else dim);
    }
    if (best > 0) {
        var buf: [32]u8 = undefined;
        txtCenter(r, std.fmt.bufPrint(&buf, "practice best: {d}", .{best}) catch "", cx, b[2].y + 84, 14, dim);
    }
    txtCenter(r, "WASD move  -  SPACE jump  -  MOUSE aim  -  RIGHT CLICK sights  -  R reload  -  G grenade  -  Q / E lean  -  F use  -  TAB scores", cx, h - 66, 14, dim);
    txtCenter(r, "1 primary  -  2 secondary  -  3 knife  -  4 grenade (click throws)  -  B weapon menu", cx, h - 46, 14, dim);
    txtCenter(r, "Gun models: Quaternius Ultimate Gun Pack (CC0)", cx, h - 24, 12, dim);
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

/// The plate round at the top: the clock and the score while it runs, the
/// result of the last round for a moment after it, else how to start one.
fn drawPractice(r: *gfx.Renderer, w: f32) !void {
    const cx = w / 2;
    var buf: [96]u8 = undefined;
    if (practice_phase == .running) {
        try r.fillRect(.{ .x = cx - 160, .y = 14, .w = 320, .h = 50 }, panel);
        txt(r, timeText(&buf, @max(0, practice_t)), cx - 145, 22, 28, if (practice_t < 10) red else white);
        var sbuf: [16]u8 = undefined;
        txtRight(r, std.fmt.bufPrint(&sbuf, "{d}", .{score}) catch "", cx + 145, 22, 28, accent);
        txtCenter(r, "SCORE", cx + 40, 30, 12, dim);
        return;
    }
    try r.fillRect(.{ .x = cx - 220, .y = 14, .w = 440, .h = 50 }, panel);
    if (result_t > 0) {
        const acc: u32 = if (shots > 0) hits * 100 / shots else 0;
        txtCenter(r, std.fmt.bufPrint(&buf, "ROUND OVER: {d}  -  {d} hits  -  {d}% accuracy", .{ score, hits, acc }) catch "", cx, 20, 17, white);
        const bt = if (new_best) "NEW BEST!" else std.fmt.bufPrint(&buf, "best {d}", .{best}) catch "";
        txtCenter(r, bt, cx, 42, 14, if (new_best) accent else dim);
    } else {
        txtCenter(r, "THE RANGE  -  in the arena, hit a plate to start a 60 s round", cx, 20, 15, white);
        const bt = if (best > 0) std.fmt.bufPrint(&buf, "best {d}  -  the red centre scores more", .{best}) catch "" else "the red centre scores more";
        txtCenter(r, bt, cx, 42, 13, dim);
    }
}

/// The camera of the frame, for the HUD parts that follow a point in the
/// world (the health bars). gameRender sets it.
var hud_cam: struct { view: Mat4 = Mat4.identity(), th: f32 = 1, eye: V3 = v3(0, 0, 0) } = .{};

/// A world point on the HUD, in logical pixels. Null behind the camera.
fn toScreen(p: V3, w: f32, h: f32) ?[2]f32 {
    const c = vec.xform(hud_cam.view, p);
    if (c[2] > -0.3) return null;
    const x = c[0] / -c[2] / (hud_cam.th * w / h);
    const y = c[1] / -c[2] / hud_cam.th;
    return .{ (x + 1) / 2 * w, (1 - y) / 2 * h };
}

/// A health bar on the HUD: its bottom centre, the health, the white part
/// (range.drawBar) and the distance from the eye to the chest.
const Bar = struct { x: f32, y: f32, hp: f32, trail: f32, dist: f32 };

/// Add the bar over a body at `feet`, if the point over its head is in
/// front of the camera.
fn addBar(bars: []Bar, n: *usize, w: f32, h: f32, feet: V3, yaw: f32, lean: f32, hp_now: f32, trail: f32) void {
    if (n.* == bars.len) return;
    const top = feet + v3(0, 2.0, 0) + player_mod.leanOffset(yaw, lean, 2.0);
    const sp = toScreen(top, w, h) orelse return;
    bars[n.*] = .{ .x = sp[0], .y = sp[1] - 6, .hp = hp_now, .trail = trail, .dist = vec.len(feet + v3(0, 1.2, 0) - hud_cam.eye) };
    n.* += 1;
}

fn nearerBar(_: void, a: Bar, b: Bar) bool {
    return a.dist < b.dist;
}

/// The health bars over the dummies (practice), and over the other players
/// while the debug screen shows (deathmatch). A bar has a fixed size on the
/// screen, so it reads at the longest range.
fn drawHealthBars(r: *gfx.Renderer, w: f32, h: f32) !void {
    var bars: [range.dummies.len + remotes.len]Bar = undefined;
    var n: usize = 0;
    if (mode == .practice) for (&range.dummies) |*d| {
        addBar(&bars, &n, w, h, d.body.pos, d.body.yaw, d.body.lean, d.hp, d.trail);
    };
    if (mode == .deathmatch and show_debug) for (remotes[0..remote_n]) |*rm| {
        if (!rm.alive) continue;
        const v: f32 = @floatFromInt(@max(0, rm.hp));
        addBar(&bars, &n, w, h, rm.pos, rm.yaw, rm.lean, v, v);
    };
    // The nearest bar keeps its place. A bar that covers a nearer one
    // moves up above it, with a thin line down to its body.
    std.mem.sort(Bar, bars[0..n], {}, nearerBar);
    for (0..n) |i| {
        const b = &bars[i];
        const anchor = b.y;
        var moved = true;
        while (moved) {
            moved = false;
            for (bars[0..i]) |o| {
                if (@abs(o.x - b.x) < range.bar_w + 4 and b.y > o.y - range.bar_h - 2 and b.y - range.bar_h - 2 < o.y) {
                    b.y = o.y - range.bar_h - 2;
                    moved = true;
                }
            }
        }
        if (b.y < anchor - 1) try r.fillRect(.{ .x = @round(b.x), .y = b.y, .w = 1, .h = anchor - b.y }, gfx.Color.rgba8(255, 255, 255, 110));
        try range.drawBar(r, &text.?, b.x, b.y, b.hp, b.trail, b.dist);
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
    L.add(&lines, &n, "yaw {d:.3}  pitch {d:.3}  lean {d:.2}  bob {d:.2}", .{ me.yaw, me.pitch, me.lean, me.bob });
    L.add(&lines, &n, "mouse {d:.0},{d:.0}  delta {d:.1},{d:.1}", .{ in.mouse.x, in.mouse.y, in.mouse.delta_x, in.mouse.delta_y });
    L.add(&lines, &n, "mods ctrl {}  cmd {}  shift {}  alt {}", .{ @intFromBool(in.mods.ctrl), @intFromBool(in.mods.super), @intFromBool(in.mods.shift), @intFromBool(in.mods.alt) });
    {
        const h = loadout.hands;
        const ammo = if (loadout.slots[@backingInt(loadout.current)]) |it| it.ammo else 0;
        L.add(&lines, &n, "{s} ammo {d}  reload {d:.2}  draw {d:.2}  ads {d:.2}  heat {d:.2}", .{ @tagName(loadout.heldClass()), ammo, h.reloading, h.drawing, h.ads, h.heat });
    }
    L.add(&lines, &n, "grenades live {d}  left {d}  smoke {d}  blast cells {d}", .{ grenade.count, loadout.grenades(), grenade.puffCount(), grenade.debug_cells });
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
    if (settings.open) {
        const in = ctx.input();
        return settings.draw(r, &text.?, in.mouse.x, in.mouse.y, w, h);
    }
    if (mode == .menu) return drawMenu(ctx, r, w, h);
    if (weapon_menu.open) {
        const in = ctx.input();
        const note = switch (mode) {
            .deathmatch => "the pick applies at once at your spawn point, else on your next spawn",
            else => "the pick applies at once",
        };
        return weapon_menu.draw(r, &text.?, in.mouse.x, in.mouse.y, w, h, choice, note);
    }
    var crosshair = true;
    if (mode == .deathmatch) {
        if (!try drawDeathmatch(ctx, r, w, h)) return;
        crosshair = alive;
    }
    if (mode == .practice) try drawPractice(r, w);
    try drawHealthBars(r, w, h);
    if (crosshair) try drawCrosshair(r, w / 2, h / 2);
    if (mode == .practice) range.drawNumbers(r, &text.?, w / 2, h / 2);
    if (captured) if (aimedButton()) |bi| {
        const b = map.buttons[bi];
        const label = if (b.in_cab) (if (b.level == 0) "F   GO DOWN" else "F   GO UP") else "F   CALL LIFT";
        txtCenter(r, label, w / 2, h / 2 + 22, 15, white);
    };
    try drawMinimap(r, h);
    try drawHealth(r, h);
    try drawAmmo(r, w, h);

    if (!captured) {
        try r.fillRect(.{ .x = 0, .y = 0, .w = w, .h = h }, gfx.Color.rgba8(5, 6, 10, 140));
        txtCenter(r, "CLICK TO PLAY", w / 2, h / 2 - 30, 34, white);
        txtCenter(r, "M for the main menu  -  B for the weapon menu", w / 2, h / 2 + 14, 16, dim);
        const sb = pauseSettingsButton(ctx);
        const in = ctx.input();
        const hover = inRect(sb, in.mouse.x, in.mouse.y);
        try r.fillRect(sb, if (hover) gfx.Color.rgba8(255, 166, 77, 230) else panel);
        txtCenter(r, "SETTINGS", w / 2, sb.y + 12, 17, if (hover) gfx.Color.rgba8(20, 14, 8, 255) else white);
    }
}

// ---- Callbacks -------------------------------------------------------------

fn gameInit(ctx: *sw.Context) !void {
    alloc = ctx.allocator();
    rng = .init(ctx.timeNs());
    map.init(alloc);
    try weapon.loadModels(alloc);
    choice = weapon.Choice.default();
    applied = choice;
    static_mesh = mesh.Mesh.init(alloc);
    dyn = mesh.Mesh.init(alloc);
    trans = mesh.Mesh.init(alloc);
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
    settings.load(alloc);
    loadChoice();
    applied = choice;
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
    if (mode == .practice) {
        for (&targets) |*t| buildTarget(t);
        for (&range.dummies) |*d| buildDummy(d);
    }
    buildEffects();
    grenade.buildOpaque(&dyn);
    buildViewmodel();
    const cam = eyeForRender();
    // The smoke faces the camera. The debug view adds the throw path and
    // the blast volumes.
    trans.clear();
    const cam_f = vec.forward(cam.yaw, cam.pitch);
    const cam_r = v3(@cos(cam.yaw), 0, -@sin(cam.yaw));
    grenade.buildTranslucent(&trans, cam_r, vec.cross(cam_r, cam_f));
    if (show_debug) {
        grenade.buildDebug(alloc, &dyn, &trans, aimPrediction());
    } else if (grenadeAimShows()) {
        // The grenade in the hand (slot 4): the same aim view as the debug
        // screen.
        if (aimPrediction()) |pr| grenade.buildAim(alloc, &dyn, &trans, pr);
    }

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
    if (loadout.hands.flash > 0 and mode != .menu and n < render.max_lights) {
        const p = me.eyePos() + vec.forward(me.yaw, me.pitch) * vec.s(0.8);
        lights[n] = .{ .pos = p, .color = v3(9, 5.5, 2.5), .radius = 9 };
        n += 1;
    }
    // The weapon menu: a lamp for the model in its window.
    if (weapon_menu.open and n < render.max_lights) {
        lights[n] = .{ .pos = cam.eye + vec.forward(cam.yaw, cam.pitch) * vec.s(0.3) + v3(0, 0.3, 0), .color = v3(2.2, 2.1, 2.0), .radius = 2.5 };
        n += 1;
    }
    if (remote_flash.life > 0 and n < render.max_lights) {
        lights[n] = .{ .pos = remote_flash.p, .color = v3(9, 5.5, 2.5), .radius = 8 };
        n += 1;
    }
    n += grenade.lights(lights[n..]);
    // Underground the eye opens up: about 2.4 times the outdoor exposure.
    const out_k = vec.smooth((cam.eye[1] - (map.underground_y - 5)) / 5);
    const target_exposure = 0.68 * (2.4 - 1.4 * out_k);
    exposure += (target_exposure - exposure) * @min(1, frame_ms / 1000 * 1.5);
    // The field of view setting is at the hip. The sights make it narrower
    // in the same ratio as the default, 74 to 52 degrees.
    const fov: f32 = settings.v.fov * (1 - 22.0 / 74.0 * loadout.hands.ads) * std.math.pi / 180;
    if (weapon_menu.open and mode != .menu) buildPreview(ctx, cam.eye, cam.yaw, cam.pitch, cam.roll, fov);
    hud_cam = .{ .view = render.viewMatrix(cam.eye, cam.yaw, cam.pitch, cam.roll), .th = @tan(fov / 2), .eye = cam.eye };
    if (hud) |*r| try drawHud(ctx, r);
    try render.draw(ctx, .{
        .eye = cam.eye,
        .yaw = cam.yaw,
        .pitch = cam.pitch,
        .roll = cam.roll,
        .fov = fov,
        .time = time,
        .damage = damage_flash,
        .exposure = exposure,
        .lights = lights[0..n],
        .translucent = trans.verts.items,
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
