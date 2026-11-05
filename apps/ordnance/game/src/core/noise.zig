//! Deterministic hash and noise. No state and no random numbers: the same
//! inputs give the same outputs on each platform that runs IEEE floats.

/// A hash of two integers and a seed, 0 <= h < 1.
pub fn hash(ix: i32, iy: i32, seed: u32) f32 {
    var h: u32 = @as(u32, @bitCast(ix)) *% 0x27d4eb2d ^ @as(u32, @bitCast(iy)) *% 0x165667b1 ^ seed *% 0x9e3779b9;
    h ^= h >> 15;
    h *%= 0x85ebca6b;
    h ^= h >> 13;
    h *%= 0xc2b2ae35;
    h ^= h >> 16;
    return @as(f32, @floatFromInt(h & 0xffffff)) / 16777216.0;
}

pub fn smooth(t: f32) f32 {
    return t * t * (3 - 2 * t);
}

/// Value noise, 0..1, smooth.
pub fn value(x: f32, y: f32, seed: u32) f32 {
    const fx = @floor(x);
    const fy = @floor(y);
    const ix: i32 = @intFromFloat(fx);
    const iy: i32 = @intFromFloat(fy);
    const tx = smooth(x - fx);
    const ty = smooth(y - fy);
    const a = hash(ix, iy, seed);
    const b = hash(ix + 1, iy, seed);
    const c = hash(ix, iy + 1, seed);
    const d = hash(ix + 1, iy + 1, seed);
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return top + (bottom - top) * ty;
}

/// Fractal noise: `octaves` layers of value noise, each at twice the
/// frequency and half the amplitude. About 0..1.
pub fn fbm(x: f32, y: f32, octaves: u32, seed: u32) f32 {
    var sum: f32 = 0;
    var amp: f32 = 0.5;
    var f: f32 = 1;
    var norm: f32 = 0;
    for (0..octaves) |o| {
        sum += amp * value(x * f, y * f, seed +% @as(u32, @intCast(o)) *% 101);
        norm += amp;
        amp *= 0.5;
        f *= 2;
    }
    return sum / norm;
}

/// Ridged noise: high and sharp along lines. About 0..1.
pub fn ridged(x: f32, y: f32, octaves: u32, seed: u32) f32 {
    var sum: f32 = 0;
    var amp: f32 = 0.5;
    var f: f32 = 1;
    var norm: f32 = 0;
    for (0..octaves) |o| {
        const n = 1 - @abs(value(x * f, y * f, seed +% @as(u32, @intCast(o)) *% 131) * 2 - 1);
        sum += amp * n * n;
        norm += amp;
        amp *= 0.5;
        f *= 2;
    }
    return sum / norm;
}
