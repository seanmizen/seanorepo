// action.seanmizen.com: a first-person shooter on swindowzig.
//
// Modes:
//   - menu: the camera turns slowly over the arena. 1, 2 or a click on a
//     button picks a mode. 3 opens the settings (settings.zig).
//   - deathmatch: the always-on lobby on the server (/api/ws). A match is
//     5 minutes, then the score board shows, then the next match starts.
//   - practice: offline. The range (range.zig): dummies behind waist-high
//     walls, with health bars and damage numbers, and the NPC shooter
//     (shooter.zig) with its control panel. In the arena, a hit on a plate
//     starts a 60 second round, with a best score.
//
// Controls: WASD move, Space jump, mouse look, left click fire, right click
// aim, R reload, G grenade, F use (the lift buttons, the panel of the NPC
// shooter), Q and E lean, 1 to 4 the
// weapon slots (primary, secondary, knife, grenade), B the weapon menu,
// Tab scores, Esc release the mouse, M menu (while paused), Y chat, T team
// chat. These keys are the default binds (game_console.zig): the game reads
// the actions, not the keys. The backtick key opens the console, and "/"
// opens the chat with "/" typed (console/).
//
// The connection (session/): the server sends a welcome first, with its
// instance id, build and protocol. The game sends its hello only when the
// protocol is the same. A lost connection shows on the HUD, and the game
// tries again with a growing wait. The session compares each new welcome
// with the last one: the same server, a restart, a new build (a reload
// notice) or a new protocol (no join: reload to play). See handleNet and
// onWelcome.
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
const body_mod = @import("body.zig");
const arena = @import("maps/arena.zig");
const gcon = @import("game_console.zig");
const session_mod = @import("session/root.zig");
const build_options = @import("build_options");
const sounds = @import("sounds.zig");
const shooter = @import("shooter.zig");
const shooter_hud = @import("shooter_hud.zig");
const impact_fx = @import("impact_fx.zig");
const pigeons = @import("pigeons.zig");
const vapes = @import("vapes.zig");
const secret = @import("secret_room.zig");
const train_sound = @import("train_sound.zig");
const train_car = @import("train_car.zig");
const gates = @import("gates.zig");
const vault_mod = @import("vault.zig");
const platform_display = @import("platform_display.zig");
const dyn_scale = @import("dyn_scale.zig");
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
// The local time of day in seconds (src/boot.ts): the clock of the train
// indicators.
extern fn jsLocalSeconds() f64;

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
/// The dynamic render scale (dyn_scale.zig).
var scaler: dyn_scale.Scaler = .{};
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
/// True when the last death was an environment death of the die message
/// (a kill with `by`): the death screen says DIED OF.
var died_of = false;
// The time to the next grenade throw. The grenades left are in the
// grenade slot of the loadout.
var nade_cd: f32 = 0;
/// The treads under the feet of your body (body.zig Feet).
var own_feet: body_mod.Feet = .{};

var static_mesh: mesh.Mesh = undefined;
var map_loaded = false;
var door_reopened: [4]bool = @splat(false);
/// The moving platform under the feet at the start of this tick, before
/// anything moves (map.Platform): a lift cab floor.
var under_feet: ?map.Platform = null;
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
/// The connection to the lobby: the handshake, the retries, the versions.
var session: session_mod.Session = .init(.{ .build = build_options.build_version, .protocol = net.protocol_version });
var my_id: u32 = 0;
var phase_end = false;
var time_left: f32 = 0;
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
    /// The velocity of the interpolation, smoothed: the walk of the legs.
    vel: V3 = v3(0, 0, 0),
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
    /// The lift whose cab the player stands in, or -1. The feet then stay
    /// on the cab floor of this client.
    lift: i32 = -1,
    /// The seconds left of a blessing of MORE (secret_room.zig), or 0.
    blessed: f32 = 0,
    /// A rider of the deep train: the feet x from the train centre, and
    /// its smoothed value. The player then stands in the train of this
    /// client.
    tx: ?f32 = null,
    tx_now: f32 = 0,
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
    ambient(freq, freq_end, dur, wave, vol * settings.sfx_volume.float());
}

/// A sound of the world (the trains): it follows the master volume only.
fn ambient(freq: f32, freq_end: ?f32, dur: f32, wave: audio_mod.Waveform, vol: f32) void {
    audio.play(.{ .frequency = freq, .frequency_end = freq_end, .duration = dur, .waveform = wave, .volume = vol });
}

/// The camera of the live player: the eye with the lean, the head bob and
/// the roll. The view model hangs from it. The shots and the throws start
/// at me.eyePos(), which has the lean but not the bob.
fn playerView() struct { eye: V3, roll: f32 } {
    var eye = me.eyePos();
    var roll = -me.lean * player_mod.lean_roll;
    // The head bob: the amount follows the speed on the ground (me.bob is 0
    // in the air and when standing still), times the setting (0 is off).
    const amp = me.bob * settings.head_bob.float() * (1 - 0.7 * loadout.hands.ads);
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

/// A vault in progress (vault.zig), or null.
var vault: ?vault_mod.Vault = null;
/// A fare dodge (gates.zig): the seconds to the death by guilt, or < 0.
var guilt_t: f32 = -1;

/// A fare dodge: death by guilt 2 s later (deathmatch only: the server
/// makes the death).
fn startGuilt() void {
    if (guilt_t < 0 and mode == .deathmatch and alive) guilt_t = 2;
}

/// The Oyster reader under the crosshair, within reach (gates.zig).
fn aimedReader() ?usize {
    if (mode == .menu or (mode == .deathmatch and !alive)) return null;
    return gates.pick(me.eyePos(), vec.forward(me.yaw, me.pitch));
}

/// The fare messages of the gates, at the crosshair, like the damage
/// numbers of the range.
fn drawFares(r: *gfx.Renderer, cx: f32, cy: f32) void {
    for (gates.pops[0..gates.pop_n], 0..) |p, i| {
        const a = vec.clamp01((gates.pop_life - p.age) / 0.5);
        const slot: f32 = @floatFromInt(gates.pop_n - 1 - i);
        const y = cy - 70 - slot * 26 - p.age * 8;
        const col = if (p.good) gfx.Color{ .r = 0.4, .g = 1, .b = 0.5, .a = a } else gfx.Color{ .r = 0.95, .g = 0.25, .b = 0.2, .a = a };
        txt(r, p.text[0..p.len], cx + 27.5, y + 1.5, 20, .{ .r = 0, .g = 0, .b = 0, .a = 0.6 * a });
        txt(r, p.text[0..p.len], cx + 26, y, 20, col);
    }
}

fn spawnAt(x: f32, y: f32, z: f32, yaw: f32) void {
    vault = null;
    guilt_t = -1;
    shocked = false;
    vapes.stop();
    me = .{ .pos = v3(x, y, z), .yaw = yaw };
    // Practice has no end of rounds.
    loadout.equip(applied, grenade.per_life, mode == .practice);
    alive = true;
    hp = 100;
    nade_cd = 0;
    own_feet = .{};
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
    // A new scene: learn the display interval again.
    scaler.probe();
    // The choir of the secret room: made now, not on the first open.
    if (id == .earls_court) sounds.prepareChoir();
    pigeons.reset(@intFromFloat(rand() * 1e6));
    static_mesh.clear();
    for (map.boxes[0..map.box_count]) |b| {
        if (!b.dynamic and b.visible) static_mesh.box(b.min, b.max, b.color, @floatFromInt(@backingInt(b.mat)));
    }
    for (map.decor.items) |d| {
        const m: f32 = @floatFromInt(@backingInt(d.mat));
        if (d.disc) static_mesh.disc(d.m, d.min[0], d.min[1], d.color, m) else static_mesh.orientedBox(d.m, d.min, d.max, d.color, m);
    }
    render.loadMap(ctx.gpu(), alloc, static_mesh.verts.items, map.lights[0..map.light_count]) catch |err| std.log.err("action: map upload: {s}", .{@errorName(err)});
}

/// The sink of train_car.details for the deep train: boxes of this frame,
/// moved to the train centre.
const TrainDetails = struct {
    x: f32,
    pub fn box(self: TrainDetails, min: V3, max: V3, color: V3, mat: map.Mat, _: map.Surface) void {
        const off = v3(self.x, 0, 0);
        dyn.box(min + off, max + off, color, @floatFromInt(@backingInt(mat)));
    }
    pub fn slab(self: TrainDetails, m: Mat4, min: V3, max: V3, color: V3, mat: map.Mat, _: map.Surface) void {
        dyn.orientedBox(vec.translate(v3(self.x, 0, 0)).mul(m), min, max, color, @floatFromInt(@backingInt(mat)));
    }
};

/// The details of the deep train (train_car.zig): the door leaves, the
/// windows, the cab fronts, the seat backs, the poles and the lights. Its
/// parts are dynamic boxes: the loop over the boxes draws them. Only when
/// the eye is in the deep level and near the train.
fn buildTrain(tr: *const map.Train, eye: V3) void {
    const c = tr.centre();
    if (eye[1] > map.underground_y or @abs(eye[0] - c) > tr.body.half_len + 150) return;
    train_car.details(&tr.body, TrainDetails{ .x = c }, map.trainDoors(tr.t));
}

/// The light inside a train (train_car.Body) whose centre is at x = c:
/// under the ceiling, at the place in the car nearest the eye.
fn trainLight(b: *const train_car.Body, c: f32, color: V3) map.Light {
    const x = std.math.clamp(me.eyePos()[0] - c, -b.half_len + 2, b.half_len - 2);
    return .{ .pos = v3(c + x, b.ceil_y - 0.25, (b.z0 + b.z1) / 2), .color = color, .radius = 9 };
}

/// The escalator steps are static boxes. The yellow line at the front of
/// each step and the dark gap behind it slide along each tread and each
/// flat step, so the steps look as if they move: down in the north unit,
/// up in the south unit (maps/earls_court.zig escalators, the same speed).
fn buildEscalatorSteps() void {
    const ec = @import("maps/earls_court.zig");
    const k = @mod(time * 0.65 / ec.esc_run, 1.0);
    const half = ec.esc_step_w / 2 - 0.005;
    const first: i32 = -ec.esc_flat;
    const last: i32 = ec.esc_steps + ec.esc_flat;
    for (ec.esc_lane_z, [_]f32{ 1, -1 }) |zl, dir| {
        const f = if (dir > 0) k else 1 - k;
        var i = first;
        while (i < last) : (i += 1) {
            const fi: f32 = @floatFromInt(i);
            // The flat steps are on the floors (with a plate 4 mm thick).
            const top = if (i < 0) ec.mid_y + 0.004 else if (i >= ec.esc_steps) ec.deep_y + 0.004 else ec.mid_y - ec.esc_rise * (fi + 1);
            const x = ec.esc_top_x + ec.esc_run * (fi + f);
            dyn.box(v3(x, top, zl - half), v3(x + 0.05, top + 0.006, zl + half), v3(0.85, 0.68, 0.08), 0);
            dyn.box(v3(x - 0.012, top, zl - half), v3(x, top + 0.004, zl + half), v3(0.02, 0.02, 0.02), 0);
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

/// The vape under the crosshair, within reach (vapes.zig). Only in
/// deathmatch: the death goes through the server. The menu and practice
/// have no use for it.
fn aimedVape() ?usize {
    if (mode != .deathmatch or !alive or vapes.since != null) return null;
    return vapes.pick(me.eyePos(), vec.forward(me.yaw, me.pitch), 2.6);
}

/// The GET MORE pack on the back shelf of VAPES N MORE, under the
/// crosshair (secret_room.zig). It opens the door of the secret room.
fn aimedGetMore() bool {
    if (mode == .menu or !alive) return false;
    return secret.pickGetMore(me.eyePos(), vec.forward(me.yaw, me.pitch));
}

/// The golden vape on the plinth of the secret room, under the crosshair.
fn aimedMore() bool {
    if (mode == .menu or !alive) return false;
    return secret.pickMore(me.eyePos(), vec.forward(me.yaw, me.pitch));
}

/// Open the door of the secret room: the choir and a heavy click of the
/// lock. `local`: this player pressed GET MORE, so the other players get it
/// too.
fn openSecret(local: bool) void {
    if (!secret.open()) return;
    sounds.choir(secret.doorCentre());
    sound(70, 45, 0.35, .square, 0.12);
    sound(1, null, 0.5, .noise, 0.05);
    if (local and mode == .deathmatch) client.send("{{\"t\":\"more\",\"k\":\"open\"}}", .{});
}

/// The dead pigeon under the crosshair, within reach (pigeons.zig).
fn aimedPigeon() ?usize {
    if (mode == .menu or (mode == .deathmatch and !alive)) return null;
    return pigeons.pick(me.eyePos(), vec.forward(me.yaw, me.pitch), 2.6);
}

/// The place of a pigeon in the hand: in front of the eye, low and to the
/// right.
fn pigeonHand() V3 {
    return handAt(me.eyePos(), me.yaw, me.pitch);
}

/// The hand of a player with this eye, yaw and pitch: also the hand of a
/// remote player who holds a pigeon (deathmatch).
fn handAt(eye: V3, yaw: f32, pitch: f32) V3 {
    const f = vec.forward(yaw, pitch);
    const right = v3(@cos(yaw), 0, -@sin(yaw));
    const up = vec.cross(right, f);
    return eye + f * vec.s(0.6) + right * vec.s(0.18) - up * vec.s(0.12);
}

/// Deathmatch: send the pigeon events of this client (pigeons.outbox) to
/// the server. The places and the velocities go with all their digits, so
/// that each client flies the same path.
fn sendPigeons() void {
    defer pigeons.out_n = 0;
    if (mode != .deathmatch or !session.joined()) return;
    for (pigeons.outbox[0..pigeons.out_n]) |e| {
        client.send("{{\"t\":\"pg\",\"k\":\"{s}\",\"i\":{d},\"g\":{d},\"sd\":{d},\"o\":[{d},{d},{d}],\"v\":[{d},{d},{d}]}}", .{
            @tagName(e.kind), e.bird, e.gen, e.seed, e.p[0], e.p[1], e.p[2], e.v[0], e.v[1], e.v[2],
        });
    }
}

/// A pigeon event or the flock from the server (server/pigeons.ts).
fn handlePigeon(m: net.Msg) void {
    const k = m.k orelse "";
    const i: usize = m.i orelse 99;
    const gen: u16 = @intCast(@min(m.g orelse 0, 65535));
    const o = if (m.o) |a| v3(a[0], a[1], a[2]) else null;
    const v = if (m.v) |a| v3(a[0], a[1], a[2]) else v3(0, 0, 0);
    const perch = if (m.pr) |pr| pigeons.perchAt(@intFromFloat(@max(0, pr[0])), pr[1]) else null;
    if (std.mem.eql(u8, k, "up")) {
        if (o) |p| pigeons.applyUp(i, m.sd orelse 0, p, v);
    } else if (std.mem.eql(u8, k, "die")) {
        if (o) |p| pigeons.applyDie(i, gen, p, v);
    } else if (std.mem.eql(u8, k, "push")) {
        if (o) |p| pigeons.applyPush(i, gen, p, v);
    } else if (std.mem.eql(u8, k, "grab")) {
        pigeons.applyGrab(i, gen, m.id orelse 0, my_id);
    } else if (std.mem.eql(u8, k, "drop")) {
        pigeons.applyDrop(i, gen, o, v);
    } else if (std.mem.eql(u8, k, "joy")) {
        if (perch) |p| pigeons.applyJoy(i, m.sd orelse 0, p);
    } else if (std.mem.eql(u8, k, "back")) {
        if (perch) |p| pigeons.applyBack(i, gen, m.sd orelse 0, p);
    }
}

fn handleFlock(m: net.Msg) void {
    // The seed comes on join: the tints, and a new flock for a new server.
    const join = m.sd != null;
    if (m.sd) |sd| {
        if (pigeons.seed_now != sd) pigeons.reset(sd);
    }
    var list: [pigeons.max_birds]pigeons.Remote = undefined;
    var n: usize = 0;
    for (m.b orelse &.{}) |row| {
        if (n == list.len) break;
        list[n] = .{
            .st = @intFromFloat(std.math.clamp(row[0], 0, 2)),
            .gen = @intFromFloat(std.math.clamp(row[1], 0, 65535)),
            .rod = @intFromFloat(@max(0, row[2])),
            .u = row[3],
        };
        n += 1;
    }
    pigeons.applyFlock(list[0..n], join);
    if (m.c) |c| pigeons.applyBodies(c);
}

/// F with a pigeon in the hand: a throw, with the speed of the player.
fn throwPigeon() void {
    pigeons.release(me.vel + vec.forward(me.yaw, me.pitch) * vec.s(4.5) + v3(0, 1, 0));
    sound(300, 180, 0.06, .triangle, 0.1);
}

/// The sounds of the pigeons (pigeons.events) at their places.
fn pigeonSounds() void {
    defer pigeons.event_n = 0;
    if (mode == .menu) return;
    for (pigeons.events[0..pigeons.event_n]) |e| switch (e.kind) {
        // The clatter of the wings.
        .takeoff => for (0..7) |k| sounds.toneAt(e.p, 1, null, 0.03, .noise, 0.5, @as(f32, @floatFromInt(k)) * 0.045 + rand() * 0.01),
        .flutter => for (0..4) |k| sounds.toneAt(e.p, 1, null, 0.025, .noise, 0.25, @as(f32, @floatFromInt(k)) * 0.05),
        .coo => {
            sounds.toneAt(e.p, 380, 300, 0.22, .triangle, 0.18, 0);
            sounds.toneAt(e.p, 330, 260, 0.4, .triangle, 0.16, 0.27);
        },
        .hit => {
            sounds.toneAt(e.p, 1, null, 0.08, .noise, 0.4, 0);
            sounds.toneAt(e.p, 900, 400, 0.06, .square, 0.08, 0);
        },
        .bonk => {
            sounds.toneAt(e.p, 240, 110, 0.07, .sine, 0.5, 0);
            sounds.toneAt(e.p, 1, null, 0.03, .noise, 0.2, 0);
        },
        .thud => sounds.toneAt(e.p, 150, 70, 0.06, .sine, 0.35, 0),
    };
}

/// The button of the NPC shooter panel under the crosshair, within reach.
fn aimedPanel() ?shooter.Button {
    if (mode != .practice) return null;
    return shooter.pick(me.eyePos(), vec.forward(me.yaw, me.pitch), 2.6);
}

/// Press a button of the panel: a click, or a dull click when the press
/// changes nothing.
fn pressPanel(b: shooter.Button) void {
    if (shooter.press(b)) sound(1100, null, 0.05, .sine, 0.15) else sound(380, null, 0.05, .square, 0.06);
}

// ---- Modes -----------------------------------------------------------------

fn enterMenu(ctx: *sw.Context) void {
    if (mode == .deathmatch) {
        client.close();
        session.stop(time);
        gcon.leftServer();
    }
    mode = .menu;
    remote_n = 0;
    pigeons.net = false;
    pigeons.held = null;
    grenade.reset();
    impact_fx.reset();
    weapon_menu.close();
    ctx.setMouseCapture(false);
    loadMap(ctx, .earls_court);
}

fn enterPractice(ctx: *sw.Context) void {
    loadMap(ctx, .arena);
    mode = .practice;
    pigeons.net = false;
    grenade.reset();
    impact_fx.reset();
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
    shooter.reset();
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
    // The server owns the pigeons (pigeons.zig): the flock comes after the
    // hello.
    pigeons.net = true;
    pigeons.held = null;
    resetMatch();
    const s = map.spawns[@intFromFloat(rand() * (@as(f32, @floatFromInt(map.spawn_count)) - 0.01))];
    spawnAt(s.pos[0], s.pos[1], s.pos[2], s.yaw);
    alive = false;
    onStep(session.start(time));
}

/// Forget the match: at the start of deathmatch, and at each join, so the
/// state of the match comes from the server. The player waits for a spawn.
fn resetMatch() void {
    grenade.reset();
    impact_fx.reset();
    remote_n = 0;
    feed_n = 0;
    my_id = 0;
    my_k = 0;
    my_d = 0;
    my_ping = -1;
    my_ping_stale = false;
    phase_end = false;
    alive = false;
    dead_time = 0;
    killed_by_len = 0;
    died_of = false;
    vapes.stop();
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
    /// The box of a world hit (its surface sets the impact sound).
    box: ?usize = null,
    remote: ?RemoteHit = null,
    plate: ?usize = null,
    bull: bool = false,
    dummy: ?range.Hit = null,
    /// The NPC shooter: a body that takes no damage.
    npc: bool = false,
    /// A pigeon, or the body of one (pigeons.zig).
    pigeon: ?pigeons.Hit = null,
};

fn traceShot(o: V3, d: V3, reach: f32) ShotRay {
    var out: ShotRay = .{ .t = reach };
    if (map.raycast(o, d, reach)) |h| {
        out.t = h.t;
        out.normal = h.normal;
        out.world = true;
        out.box = h.box;
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
        if (shooter.ray(o, d)) |t| {
            if (t < out.t) out = .{ .t = t, .npc = true };
        }
    }
    if (pigeons.ray(o, d, out.t)) |ph| out = .{ .t = ph.t, .pigeon = ph };
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

/// The damage of one pellet (or one cut) on a dummy at `dist` m: the stats
/// of the held weapon with its fall-off, as the server applies them to a
/// player (server/guns.ts pelletDamage).
fn pelletDamage(st: *const weapon.Stats, head: bool, dist: f32) f32 {
    return st.damageAt(head, dist);
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

/// A round of the NPC shooter (shooter.zig). It looks and sounds as the
/// shot of another player: the tracer, the flash, the muzzle report, the
/// crack or the whiz, and the impact with the effect of its material. It
/// hurts nothing: shooter.zig traces it against the map only.
fn npcShot(s: shooter.Shot) void {
    addTracer(s.o, s.e);
    remote_flash = .{ .p = s.o, .life = 0.05 };
    impact_fx.flash(s.o);
    sounds.shotTo(s.o, s.e, shooter.gun, s.surface);
    if (s.surface) |surf| impact_fx.spawn(s.e, s.normal, surf, if (shooter.stats().pellets > 1) 0.7 else 1, s.flight);
}

/// The impact sound of one pellet (sounds.zig): the surface material of
/// the map at the hit point, a body (a player or a dummy), or a steel
/// plate. Nothing when the pellet hit nothing.
fn pelletImpact(ray: ShotRay, end: V3, st: *const weapon.Stats) void {
    const surface: map.Surface = if (ray.box) |bi|
        map.surfaceAt(end, bi)
    else if (ray.remote != null or ray.dummy != null or ray.npc or ray.pigeon != null)
        .flesh
    else if (ray.plate != null)
        .metal
    else
        return;
    sounds.impact(end, surface, st, ray.t);
}

/// A shot or a cut hit a pigeon or the body of one: a kill shows the kill
/// marker, and in deathmatch a line in the kill feed of this client.
fn pigeonHit(h: pigeons.Hit, d: V3) void {
    if (!pigeons.shoot(h, d)) return;
    hit_marker = 0.35;
    hit_marker_kill = true;
    sound(1350, null, 0.08, .sine, 0.15);
    if (mode == .deathmatch) {
        var line: [64]u8 = undefined;
        pushFeed(std.fmt.bufPrint(&line, "{s}  >  Pigeon", .{my_name[0..my_name_len]}) catch "Pigeon", true);
    }
}

/// A gun shot: one ray for each pellet in the cone. In deathmatch one
/// "fire" message carries the hits of all the pellets. The server takes
/// the damage of each pellet from its own table (server/guns.json), with
/// the fall-off at its own distance between the two players.
fn fire() void {
    const it = loadout.held() orelse return;
    const st = weapon.statsOf(it.*);
    shots += 1;
    const moving = @min(1, @sqrt(me.vel[0] * me.vel[0] + me.vel[2] * me.vel[2]) / 6);
    const sp = shotSpread(st, moving);
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
        // The impact sound of the first 3 pellets.
        if (pi < 3) pelletImpact(ray, end, st);
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
            dummy_dmg[dh.idx][@intFromBool(dh.head)] += pelletDamage(st, dh.head, ray.t);
        } else if (ray.npc) {
            addSparks(end, -d, v3(0.7, 0.05, 0.03), if (st.pellets > 1) 3 else 10);
        } else if (ray.pigeon) |ph| {
            pigeonHit(ph, d);
        } else if (ray.box != null and (pi < 3 or rand() < 0.3)) {
            // The effect of the material (impact_fx.zig).
            impact_fx.spawn(end, ray.normal, map.surfaceAt(end, ray.box.?), if (st.pellets > 1) 0.5 else 1, 0);
        }
    }
    sounds.muzzle(1, it.class, 0, 0);
    // The pigeons near the path or the muzzle take off.
    pigeons.shot(muzzle, first_end);
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
        if (ray.pigeon) |ph| {
            pigeonHit(ph, d);
            return;
        }
        if (ray.dummy) |dh| {
            addSparks(end, -d, v3(0.7, 0.05, 0.03), 8);
            sound(180, 90, 0.08, .sawtooth, 0.2);
            const dmg = pelletDamage(st, dh.head, ray.t);
            dummyHit(dh.idx, if (dh.head) 0 else dmg, if (dh.head) dmg else 0);
            return;
        }
    }
    if (centre) |c| if (c.world) {
        addSparks(o + f * vec.s(c.t), c.normal, v3(1.0, 0.85, 0.6), 4);
        sound(2400, 1800, 0.05, .square, 0.06);
    };
}

/// The cone half angle of the next shot. A blessing of MORE
/// (secret_room.zig) has no spread, also on the move and in the air.
fn shotSpread(st: *const weapon.Stats, moving: f32) f32 {
    if (secret.blessed != null) return 0;
    return loadout.hands.spread(st, moving, !me.grounded);
}

/// A blessing of MORE (secret_room.zig): the aim locks on the head of the
/// live enemy nearest the middle of the screen, in sight and within
/// secret.aim_cone. The crosshair and the gun follow the aim.
fn autoAim() void {
    if (secret.blessed == null or mode != .deathmatch or !alive) return;
    const eye = me.eyePos();
    const f = vec.forward(me.yaw, me.pitch);
    var aim_at: ?V3 = null;
    var best_a: f32 = secret.aim_cone;
    for (remotes[0..remote_n]) |*r| {
        if (!r.alive) continue;
        const hb = player_mod.hitBoxes(r.pos, r.yaw, r.lean)[2];
        const head = (hb.min + hb.max) * vec.s(0.5);
        const d = head - eye;
        const l = vec.len(d);
        if (l < 0.3) continue;
        const a = std.math.acos(std.math.clamp(vec.dot(f, d / vec.s(l)), -1, 1));
        if (a >= best_a) continue;
        if (map.raycast(eye, d / vec.s(l), l - 0.2) != null) continue;
        best_a = a;
        aim_at = head;
    }
    const h = aim_at orelse return;
    const d = vec.norm(h - eye);
    me.yaw = std.math.atan2(-d[0], -d[2]);
    me.pitch = std.math.asin(std.math.clamp(d[1], -1, 1));
}

/// The camera kick of a shot: the recoil pattern of the held gun
/// (weapon.zig Hands.kickShot).
fn recoilKick(st: *const weapon.Stats) void {
    const k = loadout.hands.kickShot(st, rand());
    me.pitch = @min(1.5, me.pitch + k[0]);
    // Yaw 0 looks to -Z. A kick to the right makes the yaw smaller.
    me.yaw -= k[1];
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
    for (grenade.step(dt, grenadeBodies(&buf))) |b| {
        onBlast(b);
        // In deathmatch the thrower decides the pigeons of a blast.
        if (mode != .deathmatch or b.mine) pigeons.blast(b.pos, grenade.radius);
    }
}

// ---- Networking ------------------------------------------------------------

fn findRemote(id: u32) ?*Remote {
    for (remotes[0..remote_n]) |*r| if (r.id == id) return r;
    return null;
}

/// The lift whose cab the player stands in, or -1: the `lift` field of the
/// st message.
fn cabIndex() i32 {
    const p = under_feet orelse return -1;
    if (@reduce(.Or, p.feet != me.pos)) return -1;
    const i = map.liftOfBox(p.box) orelse return -1;
    return @intCast(i);
}

/// The feet x from the centre of the deep train for a rider of the train,
/// or null: the `tx` field of the st message.
fn trainOffset() ?f32 {
    const p = under_feet orelse return null;
    if (@reduce(.Or, p.feet != me.pos) or !map.trainPartOf(p.box)) return null;
    const tr = &(map.train orelse return null);
    return me.pos[0] - tr.centre();
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
        rem.lift = p.lift;
        if (rem.tx == null) rem.tx_now = p.tx orelse 0;
        rem.tx = p.tx;
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

/// Do what a session step asks.
fn onStep(step: session_mod.Step) void {
    switch (step) {
        .none => {},
        .connect => client.connect(),
        .lost => if (session.attempt == 1) gcon.notice("Connection lost. Trying again."),
        .timed_out => {
            client.close();
            if (session.attempt == 1) gcon.notice("No answer from the server. Trying again.");
        },
    }
}

/// The first message on each connection: who the server is. The session
/// compares it with the client and with the last server.
fn onWelcome(ctx: *sw.Context, m: net.Msg) void {
    const verdict = session.welcome(time, .{
        .instance = m.instance orelse "",
        .build = m.build orelse "",
        .protocol = m.protocol orelse 0,
        .started = m.started orelse "",
    }) orelse return;
    if (verdict == .new_protocol) {
        // Do not join. Free the mouse for the RELOAD button.
        client.close();
        ctx.setMouseCapture(false);
        gcon.notice("A new version is live. Reload the page to play.");
        return;
    }
    resetMatch();
    my_id = m.id orelse 0;
    sendChoice("hello");
    switch (verdict) {
        .first, .new_protocol => {},
        .same_instance => gcon.notice("Connected again."),
        .restarted => gcon.notice("The server restarted."),
        .new_build => gcon.notice("A new version is live. Reload the page to update."),
    }
}

fn socketState() session_mod.Socket {
    return switch (client.state()) {
        .idle => .idle,
        .connecting => .connecting,
        .open => .open,
        .closed => .closed,
    };
}

fn handleNet(ctx: *sw.Context) void {
    client.beginFrame();
    // The messages first: a bye comes just before the close.
    while (client.poll()) |m| {
        if (std.mem.eql(u8, m.t, "welcome")) {
            onWelcome(ctx, m);
        } else if (std.mem.eql(u8, m.t, "bye")) {
            const reason = m.reason orelse "";
            session.bye(reason);
            if (reason.len > 0) gcon.notice(reason);
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
                remote_flash = .{ .p = a, .life = 0.05 };
                const c = weapon.classFromId(m.w orelse 0) orelse .rifle;
                // The gun: the model that the shooter holds (the snapshots),
                // else the first gun of the class.
                var model = weapon.firstOf(c);
                if (findRemote(m.id orelse 0)) |r| {
                    r.shot_t = time;
                    if (r.w == c) model = remoteModel(r);
                }
                // The muzzle report, the crack or the whiz, and the impact
                // with the effect of its material.
                if (sounds.remoteShot(a, b, c, model)) |h| impact_fx.spawn(b, h.normal, h.surface, 1, 0);
                // No startle of the pigeons here: the shooter decides
                // them, and the server sends them (pigeons.zig).
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
                died_of = m.by != null;
                vapes.stop();
                secret.blessed = null;
                sound(300, 60, 0.6, .sawtooth, 0.3);
            }
            if (killer == my_id and victim != my_id) {
                hit_marker = 0.35;
                hit_marker_kill = true;
                sound(900, null, 0.06, .sine, 0.25);
                sound(1350, null, 0.12, .sine, 0.2);
            }
            if (findRemote(victim)) |r| {
                r.alive = false;
                r.blessed = 0;
            }
        } else if (std.mem.eql(u8, m.t, "nade")) {
            // Another player threw: fly the same path, for the visuals.
            if (m.o != null and m.v != null) {
                grenade.spawn(v3(m.o.?[0], m.o.?[1], m.o.?[2]), v3(m.v.?[0], m.v.?[1], m.v.?[2]), m.id orelse 0, false);
            }
        } else if (std.mem.eql(u8, m.t, "lift")) {
            map.callLift(m.i orelse 99, m.l orelse 0);
        } else if (std.mem.eql(u8, m.t, "gate")) {
            // Another player tapped a reader, or walked through a lane.
            const lane: usize = m.i orelse 99;
            if (std.mem.eql(u8, m.k orelse "", "pass")) gates.pass(lane) else gates.open(lane);
        } else if (std.mem.eql(u8, m.t, "pg")) {
            handlePigeon(m);
        } else if (std.mem.eql(u8, m.t, "flock")) {
            handleFlock(m);
        } else if (std.mem.eql(u8, m.t, "match")) {
            pushFeed("NEW MATCH", false);
            secret.shut();
            secret.blessed = null;
            for (remotes[0..remote_n]) |*r| r.blessed = 0;
        } else if (std.mem.eql(u8, m.t, "more")) {
            // Another player opened the secret room, or it was open
            // before this player joined ("now").
            const k = m.k orelse "";
            if (std.mem.eql(u8, k, "now")) {
                secret.openNow();
            } else if (std.mem.eql(u8, k, "bless")) {
                if (findRemote(m.id orelse 0)) |r| r.blessed = secret.bless_time;
            } else openSecret(false);
        } else if (std.mem.eql(u8, m.t, "cvars")) {
            // The server cvars: on join and on each change.
            if (m.cv) |list| gcon.onServerCvars(list);
        } else if (std.mem.eql(u8, m.t, "print")) {
            if (m.text) |t| gcon.onServerPrint(t);
        } else if (std.mem.eql(u8, m.t, "chat")) {
            // The colour of the player, lighter, so the name reads on the
            // dark panel.
            const base = colorFor(m.id orelse 0);
            const c = (base + (v3(1, 1, 1) - base) * vec.s(0.35)) * vec.s(255);
            const rgb = [3]u8{ @intFromFloat(c[0]), @intFromFloat(c[1]), @intFromFloat(c[2]) };
            gcon.onChat(m.ch orelse "all", m.name orelse "?", m.text orelse "", rgb);
        }
    }
    onStep(session.step(time, socketState()));
}

// ---- Tick ------------------------------------------------------------------

/// The play input of one tick. The keys come through the binds as actions
/// (game_console.zig); `in` gives the mouse movement and the modifiers.
fn gameplayTick(ctx: *sw.Context, in: *const core.InputSnapshot) void {
    const act = &gcon.act;
    const frozen = mode == .deathmatch and (phase_end or !alive or !session.joined());
    const look: f32 = 0.0022 * settings.sensitivity.float() * (1 - 0.35 * loadout.hands.ads);
    const look_up = -in.mouse.delta_y * look;
    me.yaw -= in.mouse.delta_x * look;
    me.pitch = std.math.clamp(me.pitch + look_up, -1.5, 1.5);
    // The recoil recovery: the camera goes back to the aim.
    const back = loadout.hands.recover(loadout.heldStats(), dt, look_up);
    me.pitch = std.math.clamp(me.pitch + back[0], -1.5, 1.5);
    me.yaw -= back[1];
    autoAim();

    var wish = v3(0, 0, 0);
    // Ctrl and Cmd start a shortcut (Cmd+D debug): no movement while held.
    const shortcut = in.mods.ctrl or in.mods.super;
    if (!frozen and !shortcut) {
        const fwd = v3(-@sin(me.yaw), 0, -@cos(me.yaw));
        const right = v3(@cos(me.yaw), 0, -@sin(me.yaw));
        if (act.down(.forward)) wish += fwd;
        if (act.down(.back)) wish -= fwd;
        if (act.down(.moveright)) wish += right;
        if (act.down(.moveleft)) wish -= right;
        if (vec.len(wish) > 0) wish = vec.norm(wish);
    }
    const jump = !frozen and act.down(.jump);
    // The held weapon sets the walk speed (weapon.zig table).
    // A blessing of MORE (secret_room.zig) is faster.
    const bless_k: f32 = if (secret.blessed != null) secret.bless_speed else 1;
    const speed_scale: f32 = (1 - 0.45 * loadout.hands.ads) * loadout.heldStats().speed * bless_k;
    if (mode != .deathmatch or alive) {
        // Space while walking forward, into a waist-high shape: a vault
        // onto it. A vault onto the gates is a fare dodge.
        if (vault == null and !frozen and !shortcut and act.pressed(.jump) and act.down(.forward) and me.grounded) {
            if (vault_mod.find(me)) |to| {
                vault = .{ .from = me.pos, .to = to };
                sound(1, null, 0.12, .noise, 0.08);
                if (gates.onGates(to)) startGuilt();
            }
        }
        if (vault) |*v| {
            if (v.step(&me, dt)) vault = null;
        } else me.step(dt, wish, jump, speed_scale);
    }
    // Q leans left and E leans right while held.
    var lean_want: f32 = 0;
    if (!frozen and !shortcut) {
        if (act.down(.leanleft)) lean_want -= 1;
        if (act.down(.leanright)) lean_want += 1;
    }
    me.updateLean(dt, lean_want);

    // F is the use key: the lift buttons, the panel of the NPC shooter, and
    // each target that a player presses.
    if (!frozen and !shortcut and act.pressed(.use)) {
        if (pigeons.held != null) {
            throwPigeon();
        } else if (aimedPanel()) |b| {
            pressPanel(b);
        } else if (aimedButton()) |b| {
            pressButton(b);
        } else if (aimedReader()) |g| {
            // The beep of a good tap, or the low tone of a refusal.
            switch (gates.tap(g, me.pos)) {
                .tapped_in, .tapped_out => {
                    sound(1850, null, 0.12, .sine, 0.2);
                    // The paddles open for the other players too.
                    if (mode == .deathmatch) client.send("{{\"t\":\"gate\",\"k\":\"open\",\"i\":{d}}}", .{g});
                },
                .wrong_side => sound(320, null, 0.25, .square, 0.1),
            }
        } else if (aimedPigeon()) |i| {
            pigeons.grab(i);
            sound(420, 300, 0.05, .triangle, 0.1);
        } else if (aimedGetMore()) {
            openSecret(true);
        } else if (aimedMore()) {
            // MORE: a bright chord, and the blessing (secret_room.zig).
            secret.bless();
            sound(1174.7, null, 1.4, .sine, 0.1);
            sound(1480, null, 1.4, .sine, 0.08);
            sound(1760, null, 1.8, .sine, 0.08);
            sound(2349.3, null, 2.2, .sine, 0.05);
            if (mode == .deathmatch) client.send("{{\"t\":\"more\",\"k\":\"bless\"}}", .{});
        } else if (aimedVape() != null) {
            // A long drag: a hiss, and a crackle of the coil.
            vapes.start();
            sound(1, null, 1.2, .noise, 0.12);
            sound(160, 120, 0.9, .triangle, 0.08);
        }
    }
    // B: the weapon menu. It frees the mouse.
    if (!shortcut and act.pressed(.weaponmenu)) {
        weapon_menu.show();
        ctx.setMouseCapture(false);
        return;
    }
    // The weapon slots: 1 primary, 2 secondary, 3 knife, 4 grenade. With
    // Shift and the debug screen, the number keys teleport instead.
    if (!frozen and !shortcut and !in.mods.shift) {
        const slots = [_]gcon.Action{ .slot1, .slot2, .slot3, .slot4 };
        for (slots, 0..) |a, i| {
            if (!act.pressed(a)) continue;
            if (loadout.select(@fromBackingInt(@intCast(i)))) {
                sound(650, 480, 0.04, .square, 0.05);
            } else if (i == 3 and loadout.grenades() == 0 and mode == .deathmatch) {
                sound(1200, 900, 0.03, .square, 0.1);
            }
        }
    }

    const can_shoot = !frozen;
    // G: a quick throw from any slot.
    if (can_shoot and !shortcut and act.pressed(.grenade)) throwGrenade();
    const it = loadout.held() orelse return;
    const st = weapon.statsOf(it.*);
    if (can_shoot and act.pressed(.reload)) {
        if (loadout.hands.startReload(it)) sound(500, 380, 0.05, .square, 0.08);
    }
    // A short click can press and release inside one tick.
    const trigger = can_shoot and (act.down(.attack) or act.pressed(.attack));
    const pressed = can_shoot and act.pressed(.attack);
    const ev = loadout.hands.update(it, dt, trigger, pressed, can_shoot and act.down(.aim));
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
    impact_fx.step(dt);
    damage_flash = @max(0, damage_flash - dt * 1.4);
    hit_marker = @max(0, hit_marker - dt);
    for (feed[0..feed_n]) |*f| f.life -= dt;
    while (feed_n > 0 and feed[0].life <= 0) {
        for (1..feed_n) |i| feed[i - 1] = feed[i];
        feed_n -= 1;
    }
    for (remotes[0..remote_n]) |*r| {
        const k = @min(1, dt * 14);
        var before = r.pos;
        r.pos = vec.lerp(r.pos, r.target, k);
        // A rider of the deep train stands in the train of this client.
        // The legs walk only with the move in the train.
        if (r.tx) |tx| if (map.train) |*tr| {
            const was = r.tx_now;
            r.tx_now += (tx - r.tx_now) * k;
            r.pos[0] = tr.centre() + r.tx_now;
            before[0] = r.pos[0] - (r.tx_now - was);
        };
        // A player in a cab stands on the cab of this client. The reported
        // height comes later than the cab (the network and the smoothing).
        if (r.lift >= 0) if (map.cabFloorAt(@intCast(r.lift), r.pos)) |y| {
            r.pos[1] = y;
        };
        const mv = r.pos - before;
        r.stride += @sqrt(mv[0] * mv[0] + mv[2] * mv[2]);
        r.vel += (mv / vec.s(dt) - r.vel) * vec.s(@min(1, dt * 10));
        r.lean += (r.lean_target - r.lean) * k;
        r.fall = if (r.alive) 0 else @min(1, r.fall + dt * 3);
    }
}

fn practiceTick() void {
    range.step(dt, rng.random());
    if (shooter.step(dt, me.pos)) |s| npcShot(s);
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

/// The input of the game while the console has the keys: no keys, the
/// mouse position only.
var no_input: core.InputSnapshot = .{};
var text_input_on = false;

/// The console and chat part of a tick. The backtick key opens the
/// console: it arrives as Unknown (game_console.zig). "/" opens the chat
/// with "/" typed: it arrives as the text "/". A bind opens the chat (Y,
/// T). While the console or the chat is open, it takes the keys and text
/// input is on. Else the binds run. Returns the input for the rest of the
/// tick: no keys while the console or the chat is open, and in the tick
/// that closes it.
fn consoleTick(ctx: *sw.Context) *const core.InputSnapshot {
    const raw = ctx.input();
    const con = &gcon.con;
    const chat = &gcon.chat;
    con.tick();
    chat.tick(dt);
    const events = ctx.bus().eventsForTick(ctx.tickId());
    const had_keys = con.hasKeys();
    // The panel and the chat read the events in order: text, then Enter.
    if (con.open) {
        gcon.view.update(con, events);
    } else if (chat.isOpen()) {
        chat.update(con, events);
    } else if (raw.keyPressed(.Unknown) and !raw.mods.ctrl and !raw.mods.super) {
        con.setOpen(true);
    } else if (gcon.slashTyped(events)) {
        chat.open(con, .all, "/");
    } else {
        // A bind can open the chat or the console.
        con.processBinds(raw);
    }
    const typing = con.hasKeys();
    if (typing != text_input_on) {
        text_input_on = typing;
        if (typing) ctx.startTextInput() else ctx.stopTextInput();
    }
    if (had_keys or typing) {
        no_input.mouse.x = raw.mouse.x;
        no_input.mouse.y = raw.mouse.y;
        return &no_input;
    }
    return raw;
}

fn tick(ctx: *sw.Context) void {
    ticks += 1;
    time += dt;
    // The feet at the start of the tick: the gates check the crossing.
    const feet_before = me.pos;
    // Before the server corrections and the lift steps move a cab.
    under_feet = map.platformUnder(me.pos) orelse map.trainInside(me.pos);
    // A press or a release of an action lasts one tick.
    defer gcon.act.endTick();
    const in = consoleTick(ctx);

    captured = jsPointerLocked() != 0;
    // The engine default master volume is 0.5: a volume of 1 keeps it.
    audio.setMasterVolume(0.5 * settings.volume.float());
    sounds.setListener(me.eyePos(), me.yaw);
    // The pause action frees the mouse. On Esc the browser frees it first.
    if (captured and gcon.act.pressed(.pause)) ctx.setMouseCapture(false);

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
            // The pigeons fly behind the menu too.
            pigeons.step(dt);
            pigeonSounds();
            effectsTick();
            return;
        },
        .deathmatch => {
            handleNet(ctx);
            if (!alive) dead_time += dt;
            if (!session.joined()) {
                // No connection: Enter tries again at once, or reloads for
                // a new protocol. The menu key works with or without the
                // pause screen.
                const incompatible = session.state == .incompatible;
                if (in.keyPressed(.Enter)) {
                    if (incompatible) gcon.reloadPage() else session.retryNow(time);
                }
                if (incompatible and in.buttonPressed(.left) and inRect(reloadButton(ctx), in.mouse.x, in.mouse.y)) gcon.reloadPage();
                if (gcon.act.pressed(.menu)) {
                    enterMenu(ctx);
                    return;
                }
            }
            if (ticks % 6 == 0 and alive and session.joined()) {
                // w and m: the class and the model of the held weapon, so
                // the others see it. lift: the cab that the player stands
                // in, so the others draw the player on their own cab. tx:
                // only for a rider of the deep train, the feet x from the
                // train centre, so the others draw the player in their own
                // train.
                var tx_buf: [24]u8 = undefined;
                const tx = if (trainOffset()) |o| std.fmt.bufPrint(&tx_buf, ",\"tx\":{d:.3}", .{o}) catch "" else "";
                client.send("{{\"t\":\"st\",\"x\":{d:.3},\"y\":{d:.3},\"z\":{d:.3},\"yaw\":{d:.3},\"pitch\":{d:.3},\"lean\":{d:.2},\"w\":{d},\"m\":{d},\"lift\":{d}{s}}}", .{
                    me.pos[0], me.pos[1], me.pos[2], me.yaw, me.pitch, me.lean, @backingInt(loadout.heldClass()), loadout.heldModel(), cabIndex(), tx,
                });
            }
        },
        .practice => practiceTick(),
    }

    // The deep train moves. Its riders move with it below (map.Platform).
    map.stepTrain(dt);
    secret.step(dt);
    for (remotes[0..remote_n]) |*r| r.blessed = @max(0, r.blessed - dt);
    // The sound of the train (train_sound.zig, utils/tube-sounds).
    train_sound.update(map.train, me.eyePos(), me.yaw, mode != .menu and me.pos[1] < map.underground_y - 4);

    // A vape (vapes.zig): at the end of the effect, popcorn lung kills.
    // The server makes it a death, with the cause in the kill feed.
    if (mode == .deathmatch and alive and vapes.step(dt)) {
        client.send("{{\"t\":\"die\",\"by\":\"{s}\"}}", .{vapes.cause});
        sound(90, 40, 0.8, .sawtooth, 0.3);
        damage_flash = 1;
    }

    // A player in a cab moves with it: the lift step and the server
    // corrections of this tick (map.Platform).
    map.stepLifts(dt);
    if (under_feet) |p| me.ride(p);
    // The deep train (map.trainPush): a closing door puts a player in the
    // doorway into the car or onto the platform. The train shoves a player
    // on the track onto the platform. A rider inside does not touch it.
    if (mode != .menu) if (map.trainPush(me.pos, player_mod.radius, player_mod.height)) |push| {
        me.pos = push.feet;
        if (push.hit) me.vel = v3(0, 2, 4);
    };

    // The live rail kills on the tracks past the ends of the platforms
    // (maps/earls_court.zig liveRail). The floor of a train is above the
    // track bed, so a rider is safe. The server makes it a death.
    if (map.id == .earls_court and mode == .deathmatch and alive and !shocked and
        @import("maps/earls_court.zig").liveRail(me.pos))
    {
        shocked = true;
        client.send("{{\"t\":\"shock\"}}", .{});
        addSparks(me.pos + v3(0, 0.2, 0), v3(0, 1, 0), v3(0.5, 0.7, 1.0), 30);
        sound(1, null, 0.5, .noise, 0.5);
        sound(120, 60, 0.6, .square, 0.25);
        damage_flash = 1;
    }
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
            switch (weapon_menu.update(in, l.w, l.h, &choice, gcon.act.pressed(.weaponmenu))) {
                .changed => pickChanged(),
                // B and DONE are user gestures: the lock request is allowed.
                .close_play => ctx.setMouseCapture(true),
                .close_pause, .none => {},
            }
        } else {
            if (gcon.act.pressed(.menu)) {
                enterMenu(ctx);
                return;
            }
            if (gcon.act.pressed(.weaponmenu)) weapon_menu.show();
            if (in.buttonPressed(.left)) {
                if (pauseScreenShows() and inRect(pauseSettingsButton(ctx), in.mouse.x, in.mouse.y)) {
                    settings.show();
                } else if (pauseScreenShows() and session.update and inRect(reloadButton(ctx), in.mouse.x, in.mouse.y)) {
                    gcon.reloadPage();
                } else if (mode != .deathmatch or session.state != .incompatible) {
                    // The new protocol screen keeps the mouse for its
                    // RELOAD button.
                    ctx.setMouseCapture(true);
                }
            }
        }
    } else {
        gameplayTick(ctx, in);
    }
    if (ownBodyShows()) own_feet.update(ownPose(), dt, me.grounded);
    stepGrenades();
    // The gates: the paddles, the fares, a fare dodge. A move of more than
    // 2 m in a tick is a spawn or a teleport, not a crossing.
    const play = ownBodyShows() and vec.len(me.pos - feet_before) < 2;
    // The paddles do not close on a remote player in the lane either.
    var others: [remotes.len]V3 = undefined;
    var other_n: usize = 0;
    if (mode == .deathmatch) for (remotes[0..remote_n]) |r| {
        if (!r.alive) continue;
        others[other_n] = r.pos;
        other_n += 1;
    };
    if (gates.step(dt, if (play) feet_before else null, if (play) me.pos else null, others[0..other_n], player_mod.radius, player_mod.height) == .dodged) startGuilt();
    if (gates.passed) |lane| {
        if (mode == .deathmatch) client.send("{{\"t\":\"gate\",\"k\":\"pass\",\"i\":{d}}}", .{lane});
    }
    if (guilt_t >= 0) {
        guilt_t -= dt;
        if (guilt_t < 0 and mode == .deathmatch and alive) {
            client.send("{{\"t\":\"die\",\"by\":\"Guilt\"}}", .{});
            sound(110, 55, 0.8, .sawtooth, 0.25);
        }
    }
    // The pigeons: the flights, the bodies, the one in the hand, the kicks.
    pigeons.step(dt);
    if (pigeons.held != null) {
        if (ownBodyShows()) pigeons.holdAt(me.eyePos(), pigeonHand(), me.yaw, dt) else pigeons.release(v3(0, 0, 0));
    }
    if (ownBodyShows()) pigeons.kick(me.pos, me.vel);
    // A pigeon in the hand of another player.
    if (mode == .deathmatch) for (remotes[0..remote_n]) |r| {
        const eye = r.pos + v3(0, player_mod.eye, 0);
        pigeons.carryFor(r.id, eye, handAt(eye, r.yaw, r.pitch), r.yaw, dt);
    };
    sendPigeons();
    pigeonSounds();
    effectsTick();
}

// ---- Scene building --------------------------------------------------------

fn buildRemote(r: *const Remote) void {
    body_mod.build(&dyn, .{
        .pos = r.pos,
        .yaw = r.yaw,
        .pitch = r.pitch,
        .lean = r.lean,
        .fall = r.fall,
        .stride = r.stride,
        .vel = r.vel,
        .color = colorFor(r.id),
        .w = r.w,
        .m = remoteModel(r),
    });
}

/// A practice dummy: the player model with a rifle, in the orange of a
/// range target.
fn buildDummy(d: *const range.Dummy) void {
    body_mod.build(&dyn, .{
        .pos = d.body.pos,
        .yaw = d.body.yaw,
        .pitch = 0,
        .lean = d.body.lean,
        .fall = d.fall,
        .stride = d.body.stride,
        .vel = d.body.vel,
        .color = v3(0.85, 0.42, 0.16),
        .w = .rifle,
        .m = weapon.firstOf(.rifle),
    });
}

/// The pose of your own body (body.zig): your colour, the held weapon and
/// the feet on the treads.
fn ownPose() body_mod.Pose {
    var p: body_mod.Pose = .{
        .pos = me.pos,
        .yaw = me.yaw,
        .pitch = me.pitch,
        .lean = me.lean,
        .stride = me.stride,
        .vel = if (me.grounded) me.vel else v3(0, 0, 0),
        .color = colorFor(my_id),
        .w = loadout.heldClass(),
        .m = loadout.heldModel(),
        .view = if (body_mod.own_body.on()) .first_person else .shadow,
    };
    own_feet.apply(&p);
    return p;
}

/// True while your body is in the world: in play, and alive.
fn ownBodyShows() bool {
    return mode != .menu and (mode != .deathmatch or alive);
}

/// The NPC shooter (shooter.zig): the player model (body.zig) with the gun
/// of the panel, in a range blue, and the muzzle flash of each round.
fn buildShooter() void {
    const c = shooter.class();
    body_mod.build(&dyn, .{
        .pos = shooter.pos,
        .yaw = shooter.yaw,
        .pitch = shooter.pitch,
        .lean = 0,
        .stride = shooter.stride,
        .vel = shooter.vel,
        .color = v3(0.06, 0.16, 0.62),
        .w = c,
        .m = shooter.gun,
    });
    if (shooter.flash > 0) {
        // The star of the view-model flash, at the muzzle of the NPC.
        const gm = shooter.gunMatrix(shooter.pos, shooter.yaw, shooter.pitch, c);
        const fm = gm.mul(vec.translate(weapon.models[shooter.gun].muzzle).mul(Mat4.rotationZ(shooter.flash_roll)));
        const sz: f32 = 0.08 + rand() * 0.05;
        dyn.orientedBox(fm, v3(-sz, -0.008, -sz * 2.6), v3(sz, 0.008, 0), v3(1.0, 0.7, 0.3), 4);
        dyn.orientedBox(fm, v3(-0.008, -sz, -sz * 2.6), v3(0.008, sz, 0), v3(1.0, 0.7, 0.3), 4);
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
        .deathmatch => session.joined() and !phase_end,
    };
}

/// The RELOAD button: under SETTINGS on the pause screen while a new
/// version is live, and on the new protocol screen.
fn reloadButton(ctx: *sw.Context) gfx.Rect {
    const l = logical(ctx);
    const y = if (session.state == .incompatible) l.h / 2 + 40 else pauseSettingsButton(ctx).y + 56;
    return .{ .x = l.w / 2 - 110, .y = y, .w = 220, .h = 44 };
}

fn drawButton(r: *gfx.Renderer, rect: gfx.Rect, label: []const u8, mx: f32, my: f32) !void {
    const hover = inRect(rect, mx, my);
    try r.fillRect(rect, if (hover) gfx.Color.rgba8(255, 166, 77, 230) else panel);
    txtCenter(r, label, rect.x + rect.w / 2, rect.y + 12, 17, if (hover) gfx.Color.rgba8(20, 14, 8, 255) else white);
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
        const gap = 5 + shotSpread(loadout.heldStats(), moving) * 700;
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
        const st = weapon.statsOf(it.*);
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
                var kb: [24]u8 = undefined;
                var line: [48]u8 = undefined;
                txtCenter(r, std.fmt.bufPrint(&line, "{s} TO RELOAD", .{gcon.keyLabel(&kb, .reload)}) catch "", w / 2, h / 2 + 40, 16, red);
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
    var kb: [24]u8 = undefined;
    var nl: [40]u8 = undefined;
    txtCenter(r, std.fmt.bufPrint(&nl, "{s}  NADE", .{gcon.keyLabel(&kb, .grenade)}) catch "", w - 254, h - 40, 12, dim);

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
    if (session.update) txtCenter(r, "A new version is live. Reload the page to update.", cx, b[2].y + 108, 15, accent);
    // The keys of the binds (game_console.zig), so a rebind shows here.
    var k: [14][24]u8 = undefined;
    var l1: [256]u8 = undefined;
    var l2: [256]u8 = undefined;
    const L = gcon.keyLabel;
    // "WASD" when the four move keys are letters, else with spaces.
    const mv = [4][]const u8{ L(&k[0], .forward), L(&k[1], .moveleft), L(&k[2], .back), L(&k[3], .moveright) };
    const short = mv[0].len == 1 and mv[1].len == 1 and mv[2].len == 1 and mv[3].len == 1;
    var mb: [100]u8 = undefined;
    const moves = (if (short)
        std.fmt.bufPrint(&mb, "{s}{s}{s}{s}", .{ mv[0], mv[1], mv[2], mv[3] })
    else
        std.fmt.bufPrint(&mb, "{s} {s} {s} {s}", .{ mv[0], mv[1], mv[2], mv[3] })) catch "";
    txtCenter(r, std.fmt.bufPrint(&l1, "{s} move  -  {s} jump  -  MOUSE aim  -  {s} sights  -  {s} reload  -  {s} grenade  -  {s} / {s} lean  -  {s} use  -  {s} scores", .{
        moves,               L(&k[4], .jump),      L(&k[5], .aim),  L(&k[6], .reload),  L(&k[7], .grenade),
        L(&k[8], .leanleft), L(&k[9], .leanright), L(&k[10], .use), L(&k[11], .scores),
    }) catch "", cx, h - 66, 14, dim);
    txtCenter(r, std.fmt.bufPrint(&l2, "{s} primary  -  {s} secondary  -  {s} knife  -  {s} grenade (click throws)  -  {s} weapon menu  -  {s} chat  -  {s} team chat  -  / command  -  ` console", .{
        L(&k[0], .slot1),                           L(&k[1], .slot2),                            L(&k[2], .slot3), L(&k[3], .slot4), L(&k[4], .weaponmenu),
        gcon.commandKeyLabel(&k[5], "messagemode"), gcon.commandKeyLabel(&k[6], "messagemode2"),
    }) catch "", cx, h - 46, 14, dim);
    txtCenter(r, "Gun models: Quaternius Ultimate Gun Pack (CC0)", cx, h - 24, 12, dim);
}

/// The screen while the game is not in the lobby: it connects, the
/// connection is lost (the wait to the next try), or the server has a new
/// protocol (the RELOAD button).
fn drawNoLobby(ctx: *sw.Context, r: *gfx.Renderer, w: f32, h: f32) !void {
    const cx = w / 2;
    const cy = h / 2;
    try r.fillRect(.{ .x = 0, .y = 0, .w = w, .h = h }, gfx.Color.rgba8(5, 6, 10, 170));
    var kb: [24]u8 = undefined;
    var line: [160]u8 = undefined;
    var hint: [80]u8 = undefined;
    const menu_key = gcon.keyLabel(&kb, .menu);
    switch (session.state) {
        .incompatible => {
            txtCenter(r, "A NEW VERSION IS LIVE", cx, cy - 90, 34, accent);
            txtCenter(r, "Reload the page to play. The server has a new protocol.", cx, cy - 40, 18, white);
            const sp = if (session.server) |*k| k.protocol else 0;
            txtCenter(r, std.fmt.bufPrint(&line, "server protocol {d}  -  this page: protocol {d}", .{ sp, net.protocol_version }) catch "", cx, cy - 12, 14, dim);
            const in = ctx.input();
            const b = reloadButton(ctx);
            try drawButton(r, b, "RELOAD", in.mouse.x, in.mouse.y);
            txtCenter(r, std.fmt.bufPrint(&hint, "ENTER to reload  -  {s} for the menu", .{menu_key}) catch "", cx, b.y + b.h + 14, 14, dim);
        },
        .lost, .connecting, .handshake => {
            if (session.attempt == 0) {
                txtCenter(r, "CONNECTING TO THE LOBBY...", cx, cy - 12, 22, white);
                txtCenter(r, std.fmt.bufPrint(&hint, "{s} for the menu", .{menu_key}) catch "", cx, cy + 22, 14, dim);
                return;
            }
            txtCenter(r, "CONNECTION LOST", cx, cy - 80, 34, red);
            if (session.reason.len > 0) txtCenter(r, session.reason.get(), cx, cy - 34, 18, white);
            const t = if (session.state == .lost)
                std.fmt.bufPrint(&line, "Reconnecting in {d:.0} s  (try {d})", .{ @ceil(session.retryIn(time)), session.attempt + 1 }) catch ""
            else
                std.fmt.bufPrint(&line, "Reconnecting...  (try {d})", .{session.attempt + 1}) catch "";
            txtCenter(r, t, cx, cy - 4, 18, white);
            txtCenter(r, std.fmt.bufPrint(&hint, "ENTER to try now  -  {s} for the menu", .{menu_key}) catch "", cx, cy + 28, 14, dim);
        },
        .joined, .offline => {},
    }
}

fn drawDeathmatch(ctx: *sw.Context, r: *gfx.Renderer, w: f32, h: f32) !bool {
    const cx = w / 2;
    const cy = h / 2;
    var buf: [96]u8 = undefined;
    if (!session.joined()) {
        try drawNoLobby(ctx, r, w, h);
        return false;
    }
    // A new build is live. The game goes on: the notice does not block.
    if (session.update) {
        const t = "A NEW VERSION IS LIVE  -  reload the page to update";
        const m = text.?.measure(t, 14);
        try r.fillRect(.{ .x = cx - m.w / 2 - 12, .y = h - 64, .w = m.w + 24, .h = 26 }, panel);
        txtCenter(r, t, cx, h - 59, 14, accent);
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
        var cause: [24]u8 = undefined;
        const t = if (killed_by_len == 0)
            "SPAWNING..."
        else if (died_of)
            std.fmt.bufPrint(&buf, "DIED OF {s}", .{std.ascii.upperString(&cause, killed_by[0..killed_by_len])}) catch ""
        else
            std.fmt.bufPrint(&buf, "KILLED BY {s}", .{killed_by[0..killed_by_len]}) catch "";
        if (died_of and std.mem.eql(u8, killed_by[0..killed_by_len], "Guilt")) {
            txtCenter(r, "Died of guilt. Fare dodging is a serious crime", cx, cy - 60, 28, red);
        } else txtCenter(r, t, cx, cy - 60, 30, red);
        txtCenter(r, "you respawn in a moment", cx, cy - 20, 16, dim);
    }
    if (gcon.act.down(.scores)) try drawScoreboard(r, w, h, "SCORES");
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

/// The scale of the 3D passes: the cvar render_scale when it is more than 0
/// (0.5 at least), else the dynamic scale.
fn renderScale() f32 {
    const pin = gcon.render_scale.float();
    return if (pin > 0) @max(pin, 0.5) else scaler.scale;
}

/// The debug screen (Cmd+D / Ctrl+D): frame, render, player, input, net.
fn drawDebug(ctx: *sw.Context, r: *gfx.Renderer) !void {
    const win = ctx.window();
    const in = ctx.input();
    var lines: [20][96]u8 = undefined;
    var n: usize = 0;
    const L = struct {
        fn add(buf: *[20][96]u8, count: *usize, comptime fmt: []const u8, args: anytype) void {
            if (count.* >= buf.len) return;
            _ = std.fmt.bufPrint(&buf[count.*], fmt ++ "\x00", args) catch return;
            count.* += 1;
        }
    };
    const fps = if (frame_ms > 0) 1000 / frame_ms else 0;
    L.add(&lines, &n, "{d:.0} fps   {d:.2} ms", .{ fps, frame_ms });
    L.add(&lines, &n, "canvas {d}x{d}  dpi {d:.2}  scene {d}x{d}  scale {d:.2} {s}  display {d:.2} ms", .{ win.width, win.height, win.dpi_scale, render.scene_w, render.scene_h, renderScale(), if (gcon.render_scale.float() > 0) "pinned" else "auto", scaler.refresh_ms });
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
    L.add(&lines, &n, "game build {s}  protocol {d}", .{ build_options.build_version, net.protocol_version });
    if (mode == .deathmatch) {
        L.add(&lines, &n, "net {s}  id {d}  players {d}  left {d:.1}s  {s}", .{ @tagName(session.state), my_id, remote_n + 1, time_left, if (phase_end) "end" else "play" });
        if (session.server) |*k| {
            L.add(&lines, &n, "server build {s}  protocol {d}", .{ k.build.get(), k.protocol });
            L.add(&lines, &n, "server instance {s}", .{k.instance.get()});
        }
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
        var kb: [24]u8 = undefined;
        return weapon_menu.draw(r, &text.?, in.mouse.x, in.mouse.y, w, h, choice, note, gcon.keyLabel(&kb, .weaponmenu));
    }
    var crosshair = true;
    if (mode == .deathmatch) {
        if (!try drawDeathmatch(ctx, r, w, h)) return;
        crosshair = alive;
    }
    if (mode == .practice) try drawPractice(r, w);
    try drawHealthBars(r, w, h);
    if (mode == .practice and map.id == .arena) {
        shooter_hud.draw(r, &text.?, .{ .view = hud_cam.view, .th = hud_cam.th, .eye = hud_cam.eye, .w = w, .h = h }, if (captured) aimedPanel() else null);
    }
    if (crosshair) try drawCrosshair(r, w / 2, h / 2);
    if (mode == .practice) range.drawNumbers(r, &text.?, w / 2, h / 2);
    drawFares(r, w / 2, h / 2);
    // A blessing of MORE (secret_room.zig): the seconds left.
    if (secret.blessed) |left| {
        var buf: [16]u8 = undefined;
        txtCenter(r, std.fmt.bufPrint(&buf, "MORE  {d:.0}", .{@ceil(left)}) catch "MORE", w / 2, 70, 22, .{ .r = 1, .g = 0.82, .b = 0.35, .a = 1 });
    }
    if (captured) {
        // The use hint: a pigeon in the hand, a button of the shooter panel,
        // a lift button, a dead pigeon, the GET MORE pack, the golden vape,
        // or a vape.
        const what: ?[]const u8 = if (pigeons.held != null) "THROW PIGEON" else if (aimedPanel()) |pb| shooter_hud.hint(pb) else if (aimedButton()) |bi| blk: {
            const b = map.buttons[bi];
            break :blk if (b.in_cab) (if (b.level == 0) "GO DOWN" else "GO UP") else "CALL LIFT";
        } else if (aimedReader() != null) "TAP OYSTER" else if (aimedPigeon() != null) "PICK UP PIGEON" else if (aimedGetMore()) "GET MORE" else if (aimedMore()) "MORE" else if (aimedVape() != null) "USE VAPE" else null;
        if (what) |wt| {
            var kb: [24]u8 = undefined;
            var line: [48]u8 = undefined;
            txtCenter(r, std.fmt.bufPrint(&line, "{s}   {s}", .{ gcon.keyLabel(&kb, .use), wt }) catch "", w / 2, h / 2 + 22, 15, white);
        }
    }
    try drawMinimap(r, h);
    try drawHealth(r, h);
    try drawAmmo(r, w, h);

    if (!captured) {
        try r.fillRect(.{ .x = 0, .y = 0, .w = w, .h = h }, gfx.Color.rgba8(5, 6, 10, 140));
        txtCenter(r, "CLICK TO PLAY", w / 2, h / 2 - 30, 34, white);
        var ka: [24]u8 = undefined;
        var kb: [24]u8 = undefined;
        var line: [96]u8 = undefined;
        txtCenter(r, std.fmt.bufPrint(&line, "{s} for the main menu  -  {s} for the weapon menu  -  ` for the console", .{ gcon.keyLabel(&ka, .menu), gcon.keyLabel(&kb, .weaponmenu) }) catch "", w / 2, h / 2 + 14, 16, dim);
        const in = ctx.input();
        try drawButton(r, pauseSettingsButton(ctx), "SETTINGS", in.mouse.x, in.mouse.y);
        if (session.update) try drawButton(r, reloadButton(ctx), "RELOAD TO UPDATE", in.mouse.x, in.mouse.y);
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
    sounds.init(&audio, ctx.timeNs());
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
    try gcon.init(alloc, &client, &session);
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
    // Your body (body.zig). Its vertices are one range of dyn: they also go
    // into the shadow maps of the nearest map lights (render.zig).
    var own: render.Body = .{};
    if (ownBodyShows()) {
        const first = dyn.verts.items.len;
        body_mod.build(&dyn, ownPose());
        own = .{ .first = @intCast(first), .count = @intCast(dyn.verts.items.len - first), .centre = me.pos + v3(0, 0.9, 0) };
    }
    if (map.train) |*tr| buildTrain(tr, me.eyePos());
    if (map.id == .earls_court) buildEscalatorSteps();
    pigeons.build(&dyn, time);
    gates.build(&dyn);
    secret.build(&dyn);
    platform_display.build(&dyn, eyeForRender().eye, time, @floatCast(jsLocalSeconds()));
    // The halos of MORE: yours, and those of the other players.
    if (secret.blessed) |left| secret.buildHalo(&dyn, me.eyePos(), secret.shine(left), time, 0);
    for (remotes[0..remote_n]) |*r| {
        if (!r.alive or r.blessed <= 0) continue;
        const hb = player_mod.hitBoxes(r.pos, r.yaw, r.lean)[2];
        secret.buildHalo(&dyn, (hb.min + hb.max) * vec.s(0.5), secret.shine(r.blessed), time, @floatFromInt(r.id));
    }
    if (mode == .practice) {
        for (&targets) |*t| buildTarget(t);
        for (&range.dummies) |*d| buildDummy(d);
        if (map.id == .arena) {
            buildShooter();
            shooter.buildPanel(&dyn, aimedPanel());
        }
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
    impact_fx.buildTranslucent(&trans, cam_r, vec.cross(cam_r, cam_f));
    secret.buildTranslucent(&trans, cam_r);
    for (remotes[0..remote_n]) |*r| {
        if (r.alive and r.blessed > 0) secret.buildAura(&trans, r.pos, secret.shine(r.blessed), cam_r, vec.cross(cam_r, cam_f), time);
    }
    if (show_debug) {
        grenade.buildDebug(alloc, &dyn, &trans, aimPrediction());
    } else if (grenadeAimShows()) {
        // The grenade in the hand (slot 4): the same aim view as the debug
        // screen.
        if (aimPrediction()) |pr| grenade.buildAim(alloc, &dyn, &trans, pr);
    }

    const eye_now = me.eyePos();
    var lights: [render.max_lights]map.Light = undefined;
    var n: usize = 0;
    for (map.lights[0..map.light_count], 0..) |l, i| {
        lights[n] = l;
        if (map.flicker_light == i) {
            // A tired tube: mostly on, with short drops and stutters.
            lights[n].color = l.color * vec.s(if (flickerOn()) 1.0 else 0.08);
        }
        // The secret room is dark until its door opens.
        if (secret.isRoomLight(i)) lights[n].color = l.color * vec.s(secret.glow());
        n += 1;
    }
    // The trains: a light inside, over the place in the car nearest the
    // eye. It has no shadow map, so it also lights the platform through
    // the windows. The deep train has a headlight at its front (-X).
    if (map.train) |*tr| {
        const c = tr.centre();
        const b = &tr.body;
        if (@abs(eye_now[0] - c) < b.half_len + 60 and eye_now[1] < map.underground_y and n + 2 <= render.max_lights) {
            lights[n] = trainLight(b, c, v3(1.3, 1.35, 1.4));
            lights[n + 1] = .{ .pos = v3(c - b.half_len - 1.5, b.floor_y + 0.6, (b.z0 + b.z1) / 2), .color = v3(3.0, 2.9, 2.6), .radius = 14 };
            n += 2;
        }
    }
    if (map.parked_train) |*b| {
        if (@abs(eye_now[0]) < b.half_len + 20 and @abs(eye_now[2] - (b.z0 + b.z1) / 2) < 25 and n < render.max_lights) {
            lights[n] = trainLight(b, 0, v3(1.2, 1.2, 1.15));
            n += 1;
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
    // A blessing of MORE: the player shines gold on the things near.
    if (secret.blessed) |left| if (n < render.max_lights and alive) {
        lights[n] = .{ .pos = me.pos + v3(0, 1.2, 0), .color = v3(1.8, 1.4, 0.7) * vec.s(secret.shine(left)), .radius = 5 };
        n += 1;
    };
    for (remotes[0..remote_n]) |*r| {
        if (n >= render.max_lights) break;
        if (!r.alive or r.blessed <= 0) continue;
        lights[n] = .{ .pos = r.pos + v3(0, 1.2, 0), .color = v3(2.2, 1.7, 0.8) * vec.s(secret.shine(r.blessed)), .radius = 6 };
        n += 1;
    }
    // Underground the eye opens up: about 2.4 times the outdoor exposure.
    const out_k = vec.smooth((cam.eye[1] - (map.underground_y - 5)) / 5);
    const target_exposure = 0.68 * (2.4 - 1.4 * out_k);
    exposure += (target_exposure - exposure) * @min(1, frame_ms / 1000 * 1.5);
    // The field of view setting is at the hip. The sights make it narrower
    // in the same ratio as the default, 74 to 52 degrees.
    // A vape (vapes.zig) makes it pulse and widen, to at most 150 degrees.
    const vape_k = if (mode == .deathmatch) vapes.fovScale() else 1;
    const fov: f32 = @min(150, settings.fov.float() * (1 - 22.0 / 74.0 * loadout.hands.ads) * vape_k) * std.math.pi / 180;
    if (weapon_menu.open and mode != .menu) buildPreview(ctx, cam.eye, cam.yaw, cam.pitch, cam.roll, fov);
    hud_cam = .{ .view = render.viewMatrix(cam.eye, cam.yaw, cam.pitch, cam.roll), .th = @tan(fov / 2), .eye = cam.eye };
    if (hud) |*r| {
        try drawHud(ctx, r);
        const l = logical(ctx);
        try gcon.drawChat(r, &text.?, l.w, l.h);
        // The console covers everything, the debug screen too.
        try gcon.view.draw(&gcon.con, r, &text.?, l.w, l.h);
    }
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
        .body = own,
        .scale = renderScale(),
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
    _ = scaler.frame(@as(f32, @floatFromInt(now - wasm_last_ns)) / 1e6);
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
