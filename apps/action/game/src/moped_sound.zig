// Where: apps/action/game/src/moped_sound.zig
// When: main.zig calls `update` in each tick on Earl's Court.
// Why: the engine of each moped (moped.zig): the buzz of a small
// two-stroke. The page (src/moped.ts) makes the sound with the Web Audio
// API. This file gives it the pitch, the level and the side of each
// engine for the ears of the player.
//
// - The pitch: the firing rate of a 50 cc two-stroke, one bang a turn.
//   The belt drive keeps the engine fast: about 4200 rpm at walking pace,
//   about 8000 rpm at the top speed. A moped that speeds up revs higher
//   and rasps.
// - Doppler: the pitch goes up while the moped comes nearer and down
//   while it goes away: f * c / (c + v), with v the speed away from the
//   ears (the moped and the player).
// - The level falls with the distance. A moped on its side, or past the
//   fence, is silent.
const std = @import("std");
const vec = @import("vec.zig");
const guns = @import("guns.zig");
const settings = @import("settings.zig");
const moped = @import("moped.zig");
const V3 = vec.V3;
const v3 = vec.v3;

/// The page (src/moped.ts) drives one engine voice for each slot:
///   slot   the ride, 0 to moped.max_rides - 1
///   freq   the pitch at the ears (the firing rate with Doppler), Hz
///   gain   the level, 0 (silent) to 1, with the volume settings
///   pan    -1 left to 1 right
///   rasp   0 to 1: the throttle, a brighter sound
/// Without an AudioContext the page ignores the call.
extern fn jsMoped(slot: u32, freq: f32, gain: f32, pan: f32, rasp: f32) void;

pub const Voice = struct { freq: f32, gain: f32, pan: f32, rasp: f32 };

/// The firing rate of the engine at a speed, Hz. `throttle` 0 to 1.
pub fn firing(speed: f32, throttle: f32) f32 {
    const rpm = std.math.clamp(4200 + 220 * speed, 4200, 8200) + 700 * throttle;
    return rpm / 60;
}

/// The voice of an engine at `src` with velocity `vel`, for ears at `eye`
/// with velocity `eye_vel` and the right `right`.
pub fn voiceFor(src: V3, vel: V3, speed: f32, throttle: f32, eye: V3, eye_vel: V3, right: V3) Voice {
    const to = src - eye;
    const dist = vec.len(to);
    const dir = if (dist > 1e-3) to / vec.s(dist) else v3(0, 0, -1);
    // The speed away from the ears, below the speed of sound.
    const away = std.math.clamp(vec.dot(vel - eye_vel, dir), -0.5 * guns.sound_speed, 0.5 * guns.sound_speed);
    return .{
        .freq = firing(speed, throttle) * guns.sound_speed / (guns.sound_speed + away),
        .gain = 0.9 * std.math.clamp(5 / (dist + 2), 0, 1),
        .pan = if (dist > 0.3) std.math.clamp(vec.dot(dir, right), -1, 1) else 0,
        .rasp = vec.clamp01(throttle),
    };
}

var was_on: [moped.max_rides]bool = @splat(false);
var last_speed: [moped.max_rides]f32 = @splat(0);

/// Silence each engine that sounds (a change to the menu).
pub fn silence() void {
    for (&was_on, 0..) |*on, i| {
        if (on.*) jsMoped(@intCast(i), 60, 0, 0, 0);
        on.* = false;
    }
}

/// Send each engine for this tick. `hear` is false in the menu.
pub fn update(dt: f32, eye: V3, eye_vel: V3, yaw: f32, hear: bool) void {
    const right = v3(@cos(yaw), 0, -@sin(yaw));
    const level = settings.volume.float() * settings.sfx_volume.float();
    for (&moped.rides, 0..) |*r, i| {
        const m = &r.moped;
        const on = hear and r.on and !m.gone and r.stage != .crash;
        if (!on) {
            if (was_on[i]) jsMoped(@intCast(i), 60, 0, 0, 0);
            was_on[i] = false;
            continue;
        }
        const throttle = vec.clamp01((m.speed - last_speed[i]) / dt / 4);
        last_speed[i] = m.speed;
        const vel = v3(-@sin(m.yaw), 0, -@cos(m.yaw)) * vec.s(m.speed);
        const v = voiceFor(m.pos + v3(0, 0.4, 0), vel, m.speed, throttle, eye, eye_vel, right);
        jsMoped(@intCast(i), v.freq, v.gain * level, v.pan, v.rasp);
        was_on[i] = true;
    }
}

test "moped sound: higher while it comes, lower while it goes" {
    const eye = v3(0, 1.6, 0);
    const right = v3(1, 0, 0);
    // A moped 20 m north, coming south at 15 m/s, then going away.
    const coming = voiceFor(v3(0, 1, -20), v3(0, 0, 15), 15, 0, eye, v3(0, 0, 0), right);
    const going = voiceFor(v3(0, 1, 20), v3(0, 0, 15), 15, 0, eye, v3(0, 0, 0), right);
    const f0 = firing(15, 0);
    try std.testing.expect(coming.freq > f0 * 1.03);
    try std.testing.expect(going.freq < f0 * 0.97);
    // Louder near, and on the side where it is.
    const near = voiceFor(v3(3, 1, 0), v3(0, 0, 15), 15, 0, eye, v3(0, 0, 0), right);
    try std.testing.expect(near.gain > coming.gain);
    try std.testing.expect(near.pan > 0.8);
    // The pitch of a small two-stroke: about 70 to 150 Hz.
    try std.testing.expect(firing(0, 0) > 60 and firing(17, 1) < 160);
}
