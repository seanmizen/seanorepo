// The sound of the deep train (map.zig Train): the procedural tube train of
// utils/tube-sounds, a 1973 Stock train on the Piccadilly line. This file
// sends the train state and the listener to JS (src/tube.ts) on each tick.
// The page makes the sound with the Web Audio API.
//
// The game timeline (map.zig trainX): the train brakes into the platform
// from +X, waits with its doors open, and pulls out to -X. Between two
// trains the game parks the box out of sight. The sound continues the
// motion at line speed: the train runs away down the west tunnel, and the
// next train comes along the east tunnel. At the change (`swap_t`) both
// trains are far away, and the train level fades to zero.
//
// The track of tube-sounds runs along its x axis, and its trains travel to
// +x. Here the train travels to -X, so the track x is -X.
const std = @import("std");
const map = @import("map.zig");
const vec = @import("vec.zig");
const settings = @import("settings.zig");
const V3 = vec.V3;

/// The page (src/tube.ts) drives a TubeTrain from these values:
///   front     the track x of the train front, m
///   speed     m/s
///   throttle  0..1
///   brake     0..1
///   doors     1 = open, 0 = closed. A change from 1 to 0 starts the
///             door warning. The doors move `door_warning` s later.
///   lx        the track x of the listener, m
///   lateral   the distance from the listener to the track centre, m
///   rx, rlat  the right ear of the listener: along the track, and away
///             from the track
///   level     the station level (the train and the ambience of the
///             deep level): 0 = silent, 1 = the default level
///   train     the train level, 0..1: it fades at `swap_t`
/// Without an AudioContext the page ignores the call.
extern fn jsTubeTrain(front: f32, speed: f32, throttle: f32, brake: f32, doors: f32, lx: f32, lateral: f32, rx: f32, rlat: f32, level: f32, train: f32) void;

/// Line speed: the speed at which map.trainX starts to brake, m/s.
const line_speed: f32 = 200.0 / 9.0;
/// The time in the cycle where the sound changes from the train that left
/// to the next train, s.
const swap_t: f32 = 53;
/// The time of the door warning before the doors move, s (tube.ts).
const door_warning: f32 = 2;

const Motion = struct { x: f32, speed: f32, throttle: f32, brake: f32 };

/// The centre offset of the train from its stop position on X, the speed
/// to -X, and the driver controls. The same curve as map.trainX while the
/// train is in sight.
fn motion(t: f32) Motion {
    if (t < 9) {
        const k = 1 - t / 9;
        return .{ .x = map.trainX(t), .speed = line_speed * k, .throttle = 0, .brake = 0.8 };
    }
    if (t < 27) return .{ .x = 0, .speed = 0, .throttle = 0, .brake = 0.3 };
    if (t < 36) {
        const k = (t - 27) / 9;
        return .{ .x = map.trainX(t), .speed = line_speed * k, .throttle = 1, .brake = 0 };
    }
    if (t < swap_t) {
        // Notch up to line speed, then coast.
        const throttle: f32 = if (t < 42) 1 else 0;
        return .{ .x = -100 - line_speed * (t - 36), .speed = line_speed, .throttle = throttle, .brake = 0 };
    }
    return .{ .x = 100 + line_speed * (map.train_cycle - t), .speed = line_speed, .throttle = 0, .brake = 0 };
}

/// Send the train sound for this tick. `hear` is false where the player
/// cannot hear the deep level: the menu, or above ground. With no train
/// on the map, the sound is silent.
pub fn update(train: ?map.Train, eye: V3, yaw: f32, hear: bool) void {
    const tr = train orelse return jsTubeTrain(-3000, 0, 0, 0, 0, 0, 3, 1, 0, 0, 0);
    const m = motion(tr.t);
    const front = -(tr.stop_x + m.x - tr.half_len);
    const doors: f32 = if (map.trainDoors(tr.t) > 0.01 and map.trainDoors(tr.t + door_warning) > 0.5) 1 else 0;

    // The listener: the eye, measured from the track centre line at the
    // height of the motors and the wheels.
    const dz = eye[2] - (tr.z0 + tr.z1) / 2;
    const dy = eye[1] - (tr.y0 + 1.0);
    const lateral = @max(@sqrt(dz * dz + dy * dy), 0.5);
    const side: f32 = if (dz < 0) -1 else 1;
    // The right ear in the game is (cos yaw, 0, -sin yaw) (player.zig).
    const rx = -@cos(yaw);
    const rlat = -@sin(yaw) * side;

    // The trains follow the master volume only (settings.zig).
    const level: f32 = if (hear) settings.volume.float() else 0;
    const fade = vec.smooth(@abs(tr.t - swap_t) / 3);
    jsTubeTrain(front, m.speed, m.throttle, m.brake, doors, -eye[0], lateral, rx, rlat, level, fade);
}

test "the sound motion meets the game curve at the platform" {
    try std.testing.expectApproxEqAbs(@as(f32, 100), motion(0).x, 1e-4);
    try std.testing.expectApproxEqAbs(@as(f32, 0), motion(9).x, 1e-4);
    try std.testing.expectApproxEqAbs(@as(f32, -100), motion(36).x, 1e-4);
    // The departure continues at line speed, and the next train comes in
    // at line speed to x = 100 at the end of the cycle.
    try std.testing.expectApproxEqAbs(line_speed, motion(35.999).speed, 0.01);
    try std.testing.expectApproxEqAbs(@as(f32, 100), motion(map.train_cycle).x, 1e-3);
}
