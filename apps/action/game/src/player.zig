// First-person movement: walk, jump, gravity, and box collision with a
// small step up (stairs).
const std = @import("std");
const vec = @import("vec.zig");
const map = @import("map.zig");
const V3 = vec.V3;
const v3 = vec.v3;

pub const radius: f32 = 0.32;
pub const height: f32 = 1.75;
pub const eye: f32 = 1.6;
const step_up: f32 = 0.45;
const gravity: f32 = 19.0;
const jump_speed: f32 = 6.2;
const walk_speed: f32 = 6.4;
const ground_accel: f32 = 70.0;
const air_accel: f32 = 14.0;

pub const Player = struct {
    pos: V3 = v3(0, 0, 0), // feet
    vel: V3 = v3(0, 0, 0),
    yaw: f32 = 0,
    pitch: f32 = 0,
    grounded: bool = false,
    /// The distance walked, for the view bob.
    stride: f32 = 0,

    pub fn eyePos(self: *const Player) V3 {
        return self.pos + v3(0, eye, 0);
    }

    fn boundsAt(p: V3) [2]V3 {
        return .{ p - v3(radius, 0, radius), p + v3(radius, height, radius) };
    }

    fn blocked(p: V3) bool {
        const b = boundsAt(p);
        return map.overlaps(b[0], b[1]);
    }

    /// Move along one axis. On a horizontal axis, step up onto a low box.
    fn moveAxis(self: *Player, comptime axis: usize, amount: f32) bool {
        var next = self.pos;
        next[axis] += amount;
        if (!blocked(next)) {
            self.pos = next;
            return true;
        }
        if (axis != 1 and self.grounded) {
            const up = next + v3(0, step_up, 0);
            if (!blocked(up) and !blocked(self.pos + v3(0, step_up, 0))) {
                // Settle down onto the step.
                var p = up;
                var i: usize = 0;
                while (i < 10 and !blocked(p - v3(0, 0.05, 0))) : (i += 1) p[1] -= 0.05;
                self.pos = p;
                return true;
            }
        }
        // Slide to the contact in small steps.
        const n: usize = 8;
        var i: usize = 0;
        while (i < n) : (i += 1) {
            var p = self.pos;
            p[axis] += amount / @as(f32, @floatFromInt(n));
            if (blocked(p)) break;
            self.pos = p;
        }
        return false;
    }

    /// One fixed step. `wish` is the input direction in world XZ (length 0
    /// to 1).
    pub fn step(self: *Player, dt: f32, wish: V3, jump: bool, speed_scale: f32) void {
        const target = wish * vec.s(walk_speed * speed_scale);
        const accel = if (self.grounded) ground_accel else air_accel;
        inline for (.{ 0, 2 }) |a| {
            const diff = target[a] - self.vel[a];
            const max_d = accel * dt;
            self.vel[a] += std.math.clamp(diff, -max_d, max_d);
        }
        if (jump and self.grounded) {
            self.vel[1] = jump_speed;
            self.grounded = false;
        }
        self.vel[1] -= gravity * dt;

        const before = self.pos;
        if (!self.moveAxis(0, self.vel[0] * dt)) self.vel[0] = 0;
        if (!self.moveAxis(2, self.vel[2] * dt)) self.vel[2] = 0;
        const falling = self.vel[1] <= 0;
        if (!self.moveAxis(1, self.vel[1] * dt)) {
            self.grounded = falling;
            self.vel[1] = 0;
        } else {
            // Still on the ground when a small probe down hits.
            self.grounded = falling and blocked(self.pos - v3(0, 0.04, 0));
        }
        if (self.pos[1] < -5) self.pos = v3(0, 2, 0);
        const moved = self.pos - before;
        if (self.grounded) self.stride += @sqrt(moved[0] * moved[0] + moved[2] * moved[2]);
    }
};
