// The disposable vapes on the counter of VAPES N MORE, the vape shop on
// Earls Court Road (maps/earls_court.zig vapeShop). A player aims at one
// and presses the use key. The field of view then pulses and widens for
// effect_time seconds. At the end, popcorn lung kills the player: main.zig
// sends {t:"die", by:"Popcorn lung"} and the server makes it a death.
//
// The vapes are decoration: they cost no box. The map adds the place of
// each one here, and the pick tests a small box around it.
const std = @import("std");
const map = @import("map.zig");
const vec = @import("vec.zig");
const V3 = vec.V3;
const v3 = vec.v3;

/// The cause of the death, for the kill feed. The server has the same
/// name on its list of environment deaths (server/index.ts).
pub const cause = "Popcorn lung";
/// The time from the use to the death, in seconds.
pub const effect_time: f32 = 15;
/// The half size of a vape, and the pad of the pick round it.
pub const half = v3(0.018, 0.06, 0.028);
const pad: f32 = 0.05;

/// The base centre of each vape (the point on the counter top).
pub var spots: [12]V3 = undefined;
pub var count: usize = 0;

/// The time since the use, or null when no effect runs.
pub var since: ?f32 = null;

/// Called by the map before it adds the vapes.
pub fn clear() void {
    count = 0;
}

pub fn add(base: V3) void {
    if (count >= spots.len) return;
    spots[count] = base;
    count += 1;
}

pub fn bounds(i: usize) [2]V3 {
    const p = spots[i];
    return .{ p - v3(half[0], 0, half[2]), p + v3(half[0], 2 * half[1], half[2]) };
}

/// The vape that the ray points at within reach, if no wall is nearer.
/// Only Earl's Court has the shop.
pub fn pick(o: V3, d: V3, reach: f32) ?usize {
    if (map.id != .earls_court) return null;
    var best: ?usize = null;
    var best_t: f32 = reach;
    for (0..count) |i| {
        const bb = bounds(i);
        if (map.rayBox(o, d, bb[0] - vec.s(pad), bb[1] + vec.s(pad))) |h| {
            if (h.t < best_t) {
                best_t = h.t;
                best = i;
            }
        }
    }
    if (best == null) return null;
    if (map.raycast(o, d, best_t)) |wall| if (wall.t < best_t - 0.08) return null;
    return best;
}

pub fn start() void {
    since = 0;
}

/// Stop the effect: a respawn, a death, the end of the mode.
pub fn stop() void {
    since = null;
}

/// Advance the effect. True on the tick that the effect ends: the player
/// dies of it.
pub fn step(dt: f32) bool {
    const t = since orelse return false;
    since = t + dt;
    if (t + dt < effect_time) return false;
    since = null;
    return true;
}

/// The factor on the field of view: 1 with no effect. It widens to about
/// 1.45 over the effect, and pulses faster and deeper as it goes.
pub fn fovScale() f32 {
    const t = since orelse return 1;
    const k = std.math.clamp(t / effect_time, 0, 1);
    const pulse = @sin(t * std.math.tau * (0.6 + 1.2 * k));
    return 1 + 0.3 * k + (0.06 + 0.12 * k) * pulse * @min(1, t * 2);
}
