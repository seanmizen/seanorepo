// The sound of the deep train (map.zig Train): the procedural tube train of
// utils/tube-sounds, a 1973 Stock train on the Piccadilly line. This file
// sends the train state and the listener to JS (src/tube.ts) on each tick.
// The page makes the sound with the Web Audio API.
//
// The game timeline (map.zig trainX): the train comes along the east
// tunnel at line speed, brakes into the platform from +X, waits with its
// doors open, pulls out to -X, runs at line speed, and brakes to a stop far
// down the west tunnel. The sound follows it there. Then the sound changes
// to the next train (`swap_t`), which comes along the east tunnel at line
// speed. At the change the train level fades to zero. A rider in the
// train hears the same train.
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

/// Line speed, m/s (map.zig).
const line_speed: f32 = map.train_line_speed;
/// The time in the cycle where the sound changes from the train that left
/// to the next train, s: the train that left stops.
const swap_t: f32 = map.train_parked;
/// The time of the door warning before the doors move, s (tube.ts).
const door_warning: f32 = 2;

const Motion = struct { x: f32, speed: f32, throttle: f32, brake: f32 };

/// The centre offset of the train from its stop position on X, the speed
/// to -X, and the driver controls: the curve of map.trainX, and after
/// swap_t the next train.
fn motion(t: f32) Motion {
    const x = map.trainX(t);
    if (t < map.train_brake_in) return .{ .x = x, .speed = line_speed, .throttle = 0, .brake = 0 };
    if (t < map.train_stop) {
        const k = 1 - (t - map.train_brake_in) / map.train_brake_t;
        return .{ .x = x, .speed = line_speed * k, .throttle = 0, .brake = 0.8 };
    }
    if (t < map.train_depart) return .{ .x = 0, .speed = 0, .throttle = 0, .brake = 0.3 };
    if (t < map.train_full_speed) {
        const k = (t - map.train_depart) / map.train_brake_t;
        return .{ .x = x, .speed = line_speed * k, .throttle = 1, .brake = 0 };
    }
    // Notch up to line speed, then coast.
    if (t < map.train_brake_out) return .{ .x = x, .speed = line_speed, .throttle = if (t < map.train_full_speed + 3) 1 else 0, .brake = 0 };
    if (t < swap_t) {
        const k = (t - map.train_brake_out) / map.train_brake_t;
        return .{ .x = x, .speed = line_speed * (1 - k), .throttle = 0, .brake = 0.8 };
    }
    return .{ .x = map.trainX(0) + line_speed * (map.train_cycle - t), .speed = line_speed, .throttle = 0, .brake = 0 };
}

/// Send the train sound for this tick. `hear` is false where the player
/// cannot hear the deep level: the menu, or above ground. With no train
/// on the map, the sound is silent.
pub fn update(train: ?map.Train, eye: V3, yaw: f32, hear: bool) void {
    const tr = train orelse return jsTubeTrain(-3000, 0, 0, 0, 0, 0, 3, 1, 0, 0, 0);
    const m = motion(tr.t);
    const front = -(tr.stop_x + m.x - tr.body.half_len);
    const doors: f32 = if (map.trainDoors(tr.t) > 0.01 and map.trainDoors(tr.t + door_warning) > 0.5) 1 else 0;

    // The listener: the eye, measured from the track centre line at the
    // height of the motors and the wheels.
    const dz = eye[2] - (tr.body.z0 + tr.body.z1) / 2;
    const dy = eye[1] - (tr.body.floor_y + 0.25);
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

test "the sound motion meets the game curve" {
    // The game curve is continuous, and the sound follows it.
    var t: f32 = 0;
    while (t < swap_t) : (t += 0.25) {
        try std.testing.expectApproxEqAbs(map.trainX(t), motion(t).x, 1e-3);
        try std.testing.expect(@abs(map.trainX(t + 0.01) - map.trainX(t)) < 0.01 * line_speed + 1e-3);
    }
    // The speed is the slope of the curve.
    for ([_]f32{ 3, 10, 30, 50, 60, 70 }) |ts| {
        const slope = (map.trainX(ts - 0.05) - map.trainX(ts + 0.05)) / 0.1;
        try std.testing.expectApproxEqAbs(slope, motion(ts).speed, 0.05);
    }
    // The next train comes in at line speed to the start of the cycle.
    try std.testing.expectApproxEqAbs(map.trainX(0), motion(map.train_cycle).x, 1e-3);
    // The doors are closed before the train moves.
    try std.testing.expectEqual(@as(f32, 0), map.trainDoors(map.train_depart));
    try std.testing.expectEqual(@as(f32, 0), map.trainDoors(map.train_stop));
}
