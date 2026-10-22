// The rifle: fire rate, magazine, reload, spread, recoil, and the view-model
// pose for each state. The reload is a procedural animation: the gun tilts,
// the magazine drops out, a new one goes in, and the gun comes back.
const std = @import("std");
const vec = @import("vec.zig");
const mesh = @import("mesh.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;

const rifle_bin = @embedFile("assets/rifle.bin");

pub const mag_size: u32 = 30;
pub const fire_interval: f32 = 0.1; // 600 rounds per minute
pub const reload_time: f32 = 2.1;
pub const body_damage: u32 = 26;
pub const head_damage: u32 = 100;

/// The rifle vertices. `mat` holds the part: 0 body, 1 magazine.
pub var model: []mesh.Vertex = &.{};

pub fn loadModel(alloc: std.mem.Allocator) !void {
    const count = std.mem.readInt(u32, rifle_bin[0..4], .little);
    model = try alloc.alloc(mesh.Vertex, count);
    @memcpy(std.mem.sliceAsBytes(model), rifle_bin[4 .. 4 + count * @sizeOf(mesh.Vertex)]);
}

pub const Event = enum { none, fired, empty, mag_out, mag_in, racked };

pub const Gun = struct {
    ammo: u32 = mag_size,
    reserve: u32 = 120,
    cooldown: f32 = 0,
    reloading: f32 = -1, // seconds into the reload, or -1
    recoil: f32 = 0, // the kick of the view-model, 0..1
    heat: f32 = 0, // grows while the trigger is held, makes the spread wider
    ads: f32 = 0, // 0 hip, 1 aim down sights
    flash: f32 = 0, // the muzzle flash time left
    sway_t: f32 = 0,
    flash_roll: f32 = 0,

    pub fn reset(self: *Gun) void {
        self.* = .{};
    }

    pub fn canReload(self: *const Gun) bool {
        return self.reloading < 0 and self.ammo < mag_size and self.reserve > 0;
    }

    pub fn startReload(self: *Gun) bool {
        if (!self.canReload()) return false;
        self.reloading = 0;
        return true;
    }

    /// Advance one step. Returns the event of this step for the sound and
    /// the shot.
    pub fn update(self: *Gun, dt: f32, trigger: bool, trigger_pressed: bool, aim: bool) Event {
        self.cooldown = @max(0, self.cooldown - dt);
        self.recoil = @max(0, self.recoil - dt * 7);
        self.flash = @max(0, self.flash - dt);
        self.heat = if (trigger) @min(1, self.heat) else @max(0, self.heat - dt * 3);
        const want_ads: f32 = if (aim and self.reloading < 0) 1 else 0;
        self.ads += (want_ads - self.ads) * @min(1, dt * 14);
        self.sway_t += dt;

        if (self.reloading >= 0) {
            const before = self.reloading;
            self.reloading += dt;
            const t = self.reloading;
            if (before < 0.45 and t >= 0.45) return .mag_out;
            if (before < 1.25 and t >= 1.25) return .mag_in;
            if (t >= reload_time) {
                const take = @min(mag_size - self.ammo, self.reserve);
                self.ammo += take;
                self.reserve -= take;
                self.reloading = -1;
                return .racked;
            }
            return .none;
        }
        if (trigger and self.cooldown <= 0) {
            if (self.ammo == 0) {
                if (trigger_pressed) return .empty;
                return .none;
            }
            self.ammo -= 1;
            self.cooldown = fire_interval;
            self.recoil = 1;
            self.heat = @min(1, self.heat + 0.12);
            self.flash = 0.05;
            self.flash_roll += 2.1;
            return .fired;
        }
        return .none;
    }

    /// The cone half angle of the next shot, in radians.
    pub fn spread(self: *const Gun, moving: f32, airborne: bool) f32 {
        var a: f32 = 0.004 + self.heat * 0.03 + moving * 0.018;
        if (airborne) a += 0.05;
        return a * (1 - 0.75 * self.ads);
    }

    /// The view-model pose in camera space: the gun matrix and the
    /// magazine offset (relative to the gun).
    pub fn pose(self: *const Gun, bob: f32, speed: f32) struct { gun: Mat4, mag: Mat4, muzzle: V3 } {
        const hip = v3(0.16, -0.2, -0.46);
        // The sight tops are 0.124 m above the grip.
        const ads_pos = v3(0.0, -0.126, -0.3);
        var pos = vec.lerp(hip, ads_pos, self.ads);
        var pitch: f32 = 0;
        var roll: f32 = 0;
        var yaw: f32 = 0;

        // Walk bob and idle sway, smaller when aiming.
        const sway = (1 - 0.8 * self.ads);
        pos += v3(@sin(bob) * 0.012 * speed, -@abs(@cos(bob)) * 0.01 * speed, 0) * vec.s(sway);
        pos += v3(@sin(self.sway_t * 0.9) * 0.002, @sin(self.sway_t * 1.7) * 0.002, 0) * vec.s(sway);

        // Recoil: back and up.
        const r = self.recoil * self.recoil;
        pos[2] += r * 0.05;
        pitch += r * 0.06;

        var mag = Mat4.identity();
        if (self.reloading >= 0) {
            const t = self.reloading;
            // Tilt in, hold, tilt out.
            const tilt = vec.smooth(t / 0.3) * (1 - vec.smooth((t - 1.7) / 0.35));
            // Lift the gun to the centre and cant its top away, so the
            // underside and the magazine well turn toward the camera.
            roll -= tilt * 0.75;
            pitch += tilt * 0.12;
            yaw += tilt * 0.1;
            pos += v3(-0.08, 0.1, 0.06) * vec.s(tilt);
            // The magazine: out (0.3..0.65), away, in (0.95..1.3), then a
            // small seat bump.
            var drop: f32 = 0;
            var turn: f32 = 0;
            if (t < 0.95) {
                const k = vec.smooth((t - 0.3) / 0.35);
                drop = k * 0.35;
                turn = k * 0.4;
            } else {
                const k = 1 - vec.smooth((t - 0.95) / 0.35);
                drop = k * 0.3;
                turn = k * 0.25;
            }
            // The rack at the end pulls the gun back a little.
            const rack = vec.smooth((t - 1.55) / 0.08) * (1 - vec.smooth((t - 1.68) / 0.12));
            pos[2] += rack * 0.025;
            if (t > 1.27 and t < 1.37) pos[1] += 0.008;
            // The magazine pivots at its top front corner.
            const pivot = v3(0, 0.0, -0.17);
            mag = vec.translate(pivot + v3(0, -drop, drop * 0.25)).mul(Mat4.rotationX(-turn).mul(vec.translate(-pivot)));
        }
        const gun = vec.ypr(pos, yaw, pitch, roll);
        return .{ .gun = gun, .mag = mag, .muzzle = v3(0, 0.05, -0.65) };
    }
};

/// Add the rifle to a mesh. `m` is the world matrix of the gun, `mag` the
/// magazine offset. `mat` is the material id (100 for the view-model).
pub fn addRifle(out: *mesh.Mesh, m: Mat4, mag: Mat4, mat: f32) void {
    out.model(model, m, 0, mat);
    out.model(model, m.mul(mag), 1, mat);
}
