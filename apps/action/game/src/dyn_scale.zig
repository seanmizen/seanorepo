// The dynamic render scale: the scale of the 3D passes (render.zig), so
// that a frame takes one display interval or less. The HUD does not scale.
//
// The signal is the interval between frames (main.zig wasm frame). A frame
// that waits for the GPU takes two or more display intervals. Chrome then
// drops frames in groups.
//
// - The display interval: the `low_q` quantile (the median) of the frame
//   intervals of a window. It is not the minimum or a low quantile: Chrome
//   can give two frames 1 ms apart after a late frame, and its frame pacing
//   can make short and long intervals in turn. A heavy scene can take two intervals in each
//   frame, so the first `probe_windows` windows run at `min_scale` to
//   learn it (`probe`, also at each map load). After the probe, a window
//   whose quantile is less than `faster_k` times the interval sets it (a
//   faster display). When the scale is at `min_scale` and frames are still
//   slow, the display can be slower than the learned interval (another
//   monitor). Then after `relearn_s` the smallest quantile of that time
//   replaces it.
// - Each `window_s` of frames: a frame is slow when it takes more than
//   `slow_k` display intervals. More than `drop_frac` slow frames: the
//   scale goes down one step. `calm_windows` windows in a row with less
//   than `calm_frac` slow frames: the scale goes up one step.
// - Hysteresis: the scaler blocks a scale that was too high for `hold_s`.
//   Each failure at the same scale doubles the time, to `hold_max_s`.
const std = @import("std");

pub const min_scale: f32 = 0.6;
pub const max_scale: f32 = 1.0;
pub const step: f32 = 0.05;
pub const window_s: f32 = 0.5;
pub const slow_k: f32 = 1.4;
pub const drop_frac: f32 = 0.1;
pub const calm_frac: f32 = 0.02;
pub const calm_windows: u32 = 4;
pub const hold_s: f32 = 8;
pub const hold_max_s: f32 = 64;
pub const relearn_s: f32 = 10;
pub const probe_windows: u32 = 3;
pub const low_q: f32 = 0.5;
pub const faster_k: f32 = 0.9;
/// The frame intervals of one window that the quantile uses: 0.5 s at
/// 500 Hz.
pub const max_window_frames = 256;
/// A longer interval is not a frame of the game (a background tab, a
/// pause of the browser). It does not count.
pub const max_frame_ms: f32 = 100;

pub const Scaler = struct {
    scale: f32 = min_scale,
    /// The windows left of the probe at min_scale.
    probe_left: u32 = probe_windows,
    /// The display interval in ms. 0 until the first window.
    refresh_ms: f32 = 0,
    /// The frame intervals of this window.
    dts: [max_window_frames]f32 = undefined,
    frames: u32 = 0,
    window_ms: f32 = 0,
    calm: u32 = 0,
    /// A scale that was too high, and the time it stays blocked.
    blocked: f32 = 2,
    blocked_ms: f32 = 0,
    hold_ms: f32 = hold_s * 1000,
    /// The smallest window quantile while the scale is at min_scale with
    /// slow frames, and that time.
    stuck_low_ms: f32 = std.math.inf(f32),
    stuck_ms: f32 = 0,

    /// Learn the display interval again: min_scale for the probe windows,
    /// then the full scale. The game calls it when a map loads.
    pub fn probe(s: *Scaler) void {
        s.* = .{};
    }

    /// One frame of `dt_ms`. Returns true when the scale changed.
    pub fn frame(s: *Scaler, dt_ms: f32) bool {
        if (!(dt_ms > 0) or dt_ms > max_frame_ms) return false;
        if (s.frames < max_window_frames) {
            s.dts[s.frames] = dt_ms;
            s.frames += 1;
        }
        s.window_ms += dt_ms;
        if (s.blocked_ms > 0) s.blocked_ms -= dt_ms;
        if (s.window_ms < window_s * 1000) return false;

        const dts = s.dts[0..s.frames];
        std.mem.sort(f32, dts, {}, std.sort.asc(f32));
        const low = dts[@min(dts.len - 1, @as(usize, @intFromFloat(low_q * @as(f32, @floatFromInt(dts.len)))))];
        const window = s.window_ms;
        s.frames = 0;
        s.window_ms = 0;
        const old = s.scale;

        if (s.probe_left > 0) {
            s.refresh_ms = if (s.refresh_ms == 0) low else @min(s.refresh_ms, low);
            s.probe_left -= 1;
            if (s.probe_left == 0) s.scale = max_scale;
            return s.scale != old;
        }
        if (low < faster_k * s.refresh_ms) s.refresh_ms = low;
        var slow: u32 = 0;
        for (dts) |d| {
            if (d > slow_k * s.refresh_ms) slow += 1;
        }
        const frac = @as(f32, @floatFromInt(slow)) / @as(f32, @floatFromInt(dts.len));
        if (frac > drop_frac) {
            s.calm = 0;
            if (s.scale > min_scale + 0.001) {
                // The same scale failed again: block it for longer.
                s.hold_ms = if (@abs(s.blocked - s.scale) < 0.001) @min(s.hold_ms * 2, hold_max_s * 1000) else hold_s * 1000;
                s.blocked = s.scale;
                s.blocked_ms = s.hold_ms;
                s.scale = @max(min_scale, s.scale - step);
            } else {
                // At the floor and still slow: the display can be slower.
                s.stuck_ms += window;
                s.stuck_low_ms = @min(s.stuck_low_ms, low);
                if (s.stuck_ms >= relearn_s * 1000) {
                    s.refresh_ms = s.stuck_low_ms;
                    s.stuck_ms = 0;
                }
            }
        } else {
            s.stuck_ms = 0;
            if (frac < calm_frac) s.calm += 1 else s.calm = 0;
            const up = @min(max_scale, s.scale + step);
            const free = s.blocked_ms <= 0 or up < s.blocked - 0.001;
            if (s.calm >= calm_windows and up > s.scale + 0.001 and free) {
                s.scale = up;
                s.calm = 0;
            }
        }
        if (s.stuck_ms == 0) s.stuck_low_ms = std.math.inf(f32);
        return s.scale != old;
    }
};

// ---- Tests: a simulated GPU and display ------------------------------------

const testing = std.testing;

/// A frame of a GPU that needs `full_ms` at scale 1 (the cost goes with the
/// pixel count): it takes whole display intervals.
fn sim(full_ms: f32, refresh: f32, scale: f32, jitter: f32) f32 {
    const gpu = full_ms * scale * scale + jitter;
    return @max(1, @ceil(gpu / refresh - 0.02)) * refresh;
}

fn run(s: *Scaler, full_ms: f32, refresh: f32, seconds: f32, rand: std.Random) struct { slow_frac: f32, changes: u32 } {
    var t: f32 = 0;
    var slow: u32 = 0;
    var frames: u32 = 0;
    var changes: u32 = 0;
    while (t < seconds * 1000) {
        const dt = sim(full_ms, refresh, s.scale, (rand.float(f32) - 0.5) * 0.4);
        if (s.frame(dt)) changes += 1;
        if (dt > slow_k * refresh) slow += 1;
        frames += 1;
        t += dt;
    }
    return .{ .slow_frac = @as(f32, @floatFromInt(slow)) / @as(f32, @floatFromInt(frames)), .changes = changes };
}

test "dyn scale: a heavy scene goes down to a scale that fits the display interval" {
    var prng = std.Random.DefaultPrng.init(1);
    var s: Scaler = .{};
    // 16 ms at scale 1, display 7.8 ms: a frame fits at scale 0.69 or less.
    _ = run(&s, 16, 7.8, 20, prng.random());
    try testing.expect(s.scale <= 0.7 + 0.001);
    try testing.expect(s.scale >= min_scale);
    try testing.expectApproxEqAbs(@as(f32, 7.8), s.refresh_ms, 0.3);
    // Then it holds: few slow frames, few changes.
    const r = run(&s, 16, 7.8, 60, prng.random());
    try testing.expect(r.slow_frac < 0.03);
    try testing.expect(r.changes <= 6);
}

test "dyn scale: a light scene stays at full scale" {
    var prng = std.Random.DefaultPrng.init(2);
    var s: Scaler = .{};
    const r = run(&s, 4, 6.94, 30, prng.random());
    try testing.expectEqual(max_scale, s.scale);
    // One change only: the end of the probe.
    try testing.expectEqual(@as(u32, 1), r.changes);
}

test "dyn scale: the scale goes up again when the scene gets lighter" {
    var prng = std.Random.DefaultPrng.init(3);
    var s: Scaler = .{};
    _ = run(&s, 16, 7.8, 20, prng.random());
    try testing.expect(s.scale < 0.75);
    _ = run(&s, 5, 7.8, 90, prng.random());
    try testing.expectEqual(max_scale, s.scale);
}

test "dyn scale: a slower display than learned (another monitor)" {
    var prng = std.Random.DefaultPrng.init(4);
    var s: Scaler = .{};
    // It learns 6.94 ms on a light menu, then the window goes to a 60 Hz
    // display with a scene that fits at 0.8.
    _ = run(&s, 3, 6.94, 5, prng.random());
    _ = run(&s, 25, 16.67, 60, prng.random());
    try testing.expectApproxEqAbs(@as(f32, 16.67), s.refresh_ms, 0.3);
    const r = run(&s, 25, 16.67, 60, prng.random());
    try testing.expect(s.scale >= 0.75);
    try testing.expect(r.slow_frac < 0.03);
}

test "dyn scale: a late frame and an early frame do not change the display interval" {
    var s: Scaler = .{};
    // 7.8 ms frames. Each 20th frame is late (14.4 ms) and the next one
    // comes 1.2 ms after it, as Chrome does.
    var t: f32 = 0;
    var i: u32 = 0;
    while (t < 20_000) : (i += 1) {
        const dt: f32 = switch (i % 20) {
            0 => 14.4,
            1 => 1.2,
            else => 7.8,
        };
        _ = s.frame(dt);
        t += dt;
    }
    try testing.expectApproxEqAbs(@as(f32, 7.8), s.refresh_ms, 0.05);
    try testing.expectEqual(max_scale, s.scale);
}

test "dyn scale: short and long intervals in turn give the mean interval" {
    var s: Scaler = .{};
    // Frame pacing at 7.8 ms that gives 6.3 ms and 9.3 ms in turn, with
    // one 7.8 ms frame between each pair.
    const seq = [_]f32{ 6.3, 9.3, 7.8 };
    var t: f32 = 0;
    var i: usize = 0;
    while (t < 20_000) : (i += 1) {
        _ = s.frame(seq[i % seq.len]);
        t += seq[i % seq.len];
    }
    try testing.expectApproxEqAbs(@as(f32, 7.8), s.refresh_ms, 0.05);
    try testing.expectEqual(max_scale, s.scale);
}

test "dyn scale: a long pause does not count" {
    var s: Scaler = .{};
    try testing.expect(!s.frame(500));
    try testing.expectEqual(@as(f32, 0), s.refresh_ms);
}
