// An angelic choir: a held "aah" that swells on one chord and resolves to
// the next (IV to I, a plagal "amen"), with a high descant and a few bell
// glints, in a long hall reverb. The secret room of VAPES N MORE plays it
// when its door opens (secret_room.zig).
//
// Each voice is a band-limited sawtooth (PolyBLEP) with its own vibrato,
// drift and detune. The voices of a range share one formant bank: three
// band-pass filters at the formants of the vowel "a" (tenor and soprano
// tables of the Csound manual, appendix "Formant values"), and one wide
// low band for the chest. A Schroeder
// reverb (four combs and two all-passes for each ear) makes the hall.
//
// Nothing here imports the action game: it needs std only.
const std = @import("std");

/// The sample rate of the choir. The voices have little above 4 kHz, so
/// half of dsp.rate is enough, and the buffer is half the size.
pub const rate: f32 = 24000;
/// The length of the sound, with the tail of the reverb, in s.
pub const length: f32 = 10;
pub const frames: usize = @intFromFloat(rate * length);
/// The chord change, in s from the start.
pub const change_t: f32 = 3.0;

/// A small, fast, seeded random source (xorshift64*), the same as dsp.Rng.
const Rng = @import("dsp.zig").Rng;

/// A band-pass biquad (RBJ cookbook, 0 dB peak) at `rate`.
const Band = struct {
    b0: f32,
    a1: f32,
    a2: f32,
    z1: f32 = 0,
    z2: f32 = 0,

    fn init(freq: f32, bw: f32) Band {
        const w = 2 * std.math.pi * freq / rate;
        const alpha = @sin(w) / (2 * (freq / bw));
        const a0 = 1 + alpha;
        return .{ .b0 = alpha / a0, .a1 = -2 * @cos(w) / a0, .a2 = (1 - alpha) / a0 };
    }

    fn process(f: *Band, x: f32) f32 {
        const y = f.b0 * x + f.z1;
        f.z1 = -f.a1 * y + f.z2;
        f.z2 = -f.b0 * x - f.a2 * y;
        return y;
    }
};

/// The formants of the vowel "a": frequency, bandwidth (Hz) and gain. The
/// last band is wide and low: the chest of the voice, so the low notes
/// keep their fundamentals.
const Formant = struct { f: f32, bw: f32, g: f32 };
const tenor_a = [4]Formant{ .{ .f = 650, .bw = 80, .g = 1 }, .{ .f = 1080, .bw = 90, .g = 0.5 }, .{ .f = 2650, .bw = 120, .g = 0.45 }, .{ .f = 260, .bw = 260, .g = 0.35 } };
const soprano_a = [4]Formant{ .{ .f = 800, .bw = 80, .g = 1 }, .{ .f = 1150, .bw = 90, .g = 0.5 }, .{ .f = 2900, .bw = 120, .g = 0.12 }, .{ .f = 480, .bw = 320, .g = 0.3 } };

/// One sung line: a note before the change and a note after it, in Hz.
/// The voices glide from one to the other. `from` delays the entry.
const Part = struct { a: f32, b: f32, high: bool, from: f32 = 0, level: f32 = 1 };

// D major. Before the change: G major (IV). After: D major (I).
const parts = [_]Part{
    .{ .a = 98.0, .b = 146.8, .high = false, .level = 0.8 }, // G2 to D3
    .{ .a = 146.8, .b = 146.8, .high = false }, // D3
    .{ .a = 196.0, .b = 185.0, .high = false }, // G3 to F#3
    .{ .a = 246.9, .b = 220.0, .high = false }, // B3 to A3
    .{ .a = 392.0, .b = 370.0, .high = true }, // G4 to F#4
    .{ .a = 493.9, .b = 440.0, .high = true }, // B4 to A4
    .{ .a = 587.3, .b = 587.3, .high = true }, // D5
    .{ .a = 880.0, .b = 880.0, .high = true, .from = change_t + 0.8, .level = 0.55 }, // A5, the descant
};
/// Singers on each part. Each one has its own detune, vibrato and place.
const per_part = 3;
const voice_n = parts.len * per_part;

const Voice = struct {
    part: Part,
    detune: f32,
    phase: f32,
    vib_rate: f32,
    vib_phase: f32,
    vib_depth: f32,
    drift_phase: f32,
    /// The gains to the left and the right ear.
    gl: f32,
    gr: f32,
    /// The time of the glide to the second note: each singer is a little
    /// early or late.
    glide_at: f32,
};

/// The level of all the voices over time: a slow swell, a lift at the
/// change, a hold, and a long fade.
fn envelope(t: f32) f32 {
    const swell = smooth(t / 2.6);
    const lift = 1 + 0.25 * smooth((t - change_t) / 1.2);
    const fade = 1 - smooth((t - 5.8) / 2.6);
    return swell * lift * fade;
}

fn smooth(x: f32) f32 {
    const k = std.math.clamp(x, 0, 1);
    return k * k * (3 - 2 * k);
}

/// The PolyBLEP correction of a sawtooth at phase p (0..1), step dt.
fn blep(p: f32, dt: f32) f32 {
    if (p < dt) {
        const x = p / dt;
        return x + x - x * x - 1;
    }
    if (p > 1 - dt) {
        const x = (p - 1) / dt;
        return x * x + x + x + 1;
    }
    return 0;
}

/// A comb filter with a low-pass in its loop (Freeverb), and an all-pass.
fn Comb(comptime n: usize) type {
    return struct {
        buf: [n]f32 = @splat(0),
        i: usize = 0,
        lp: f32 = 0,
        fn process(c: *@This(), x: f32, fb: f32, damp: f32) f32 {
            const y = c.buf[c.i];
            c.lp = y * (1 - damp) + c.lp * damp;
            c.buf[c.i] = x + c.lp * fb;
            c.i = (c.i + 1) % n;
            return y;
        }
    };
}

fn Allpass(comptime n: usize) type {
    return struct {
        buf: [n]f32 = @splat(0),
        i: usize = 0,
        fn process(a: *@This(), x: f32) f32 {
            const d = a.buf[a.i];
            const y = d - 0.5 * x;
            a.buf[a.i] = x + 0.5 * d;
            a.i = (a.i + 1) % n;
            return y;
        }
    };
}

/// The hall for one ear. The delays of the two ears differ a little, so
/// the tail is wide.
fn Hall(comptime s: usize) type {
    return struct {
        c0: Comb(1116 + s) = .{},
        c1: Comb(1188 + s) = .{},
        c2: Comb(1277 + s) = .{},
        c3: Comb(1356 + s) = .{},
        a0: Allpass(225 + s / 2) = .{},
        a1: Allpass(341 + s / 2) = .{},
        fn process(h: *@This(), x: f32) f32 {
            // A long tail (about 3 s) with soft highs.
            const fb = 0.86;
            const damp = 0.3;
            var y = h.c0.process(x, fb, damp) + h.c1.process(x, fb, damp) + h.c2.process(x, fb, damp) + h.c3.process(x, fb, damp);
            y = h.a0.process(y * 0.25);
            return h.a1.process(y);
        }
    };
}

/// Write the choir into `l` and `r` (each at least `frames` long) at
/// `rate`. The peak is 0.9. The same seed gives the same sound.
pub fn render(l: []f32, r: []f32, seed: u64) void {
    const n = @min(frames, @min(l.len, r.len));
    var rng = Rng.init(seed);
    var voices: [voice_n]Voice = undefined;
    for (&voices, 0..) |*v, i| {
        const part = parts[i / per_part];
        const k: f32 = @floatFromInt(i % per_part);
        // The singers of a part stand apart, and the parts spread from
        // left to right, low to high.
        const pan = std.math.clamp((@as(f32, @floatFromInt(i / per_part)) / (parts.len - 1)) * 1.2 - 0.6 + (k - 1) * 0.35 + rng.range(-0.1, 0.1), -1, 1);
        const a = (pan + 1) * std.math.pi / 4;
        v.* = .{
            .part = part,
            .detune = std.math.pow(f32, 2, ((k - 1) * 7 + rng.range(-2, 2)) / 1200),
            .phase = rng.float(),
            .vib_rate = rng.range(4.8, 6.0),
            .vib_phase = rng.float() * std.math.tau,
            .vib_depth = rng.range(0.003, 0.006),
            .drift_phase = rng.float() * std.math.tau,
            .gl = @cos(a),
            .gr = @sin(a),
            .glide_at = change_t + rng.range(-0.08, 0.12),
        };
    }
    // [range][ear][formant]
    var bands: [2][2][4]Band = undefined;
    for (0..2) |g| for (0..2) |e| for (0..4) |f| {
        const fm = if (g == 0) tenor_a[f] else soprano_a[f];
        bands[g][e][f] = Band.init(fm.f, fm.bw);
    };
    var hall_l: Hall(0) = .{};
    var hall_r: Hall(23) = .{};
    var breath = Rng.init(seed +% 1);
    const dt = 1 / rate;
    for (0..n) |si| {
        const t = @as(f32, @floatFromInt(si)) * dt;
        const env = envelope(t);
        // [range][ear]
        var acc: [2][2]f32 = .{ .{ 0, 0 }, .{ 0, 0 } };
        if (env > 0) for (&voices) |*v| {
            if (t < v.part.from) continue;
            const glide = smooth((t - v.glide_at) / 0.22);
            const base = v.part.a + (v.part.b - v.part.a) * glide;
            // The vibrato comes in after the onset of each note.
            const vib_k = smooth((t - v.part.from - 0.6) / 1.2);
            const vib = v.vib_depth * vib_k * @sin(v.vib_phase + std.math.tau * v.vib_rate * t);
            const drift = 0.002 * @sin(v.drift_phase + 0.7 * t);
            const f = base * v.detune * (1 + vib + drift);
            const step = f * dt;
            v.phase += step;
            if (v.phase >= 1) v.phase -= 1;
            // A soft breath with the tone.
            const x = (2 * v.phase - 1 - blep(v.phase, step)) + 0.15 * breath.white();
            const entry = smooth((t - v.part.from) / 1.0);
            const g = env * entry * v.part.level;
            const range: usize = if (v.part.high) 1 else 0;
            acc[range][0] += x * g * v.gl;
            acc[range][1] += x * g * v.gr;
        };
        var out: [2]f32 = .{ 0, 0 };
        for (0..2) |g| for (0..2) |e| {
            const fm = if (g == 0) tenor_a else soprano_a;
            for (0..4) |fi| out[e] += fm[fi].g * bands[g][e][fi].process(acc[g][e]);
        };
        // The dry voices and the hall. The hall takes a mix of both ears.
        const mid = (out[0] + out[1]) * 0.5;
        l[si] = out[0] * 0.55 + hall_l.process(mid * 0.7 + out[0] * 0.3) * 0.9;
        r[si] = out[1] * 0.55 + hall_r.process(mid * 0.7 + out[1] * 0.3) * 0.9;
    }
    normalise(l[0..n], r[0..n], 0.8);
    // The glints: small bells high over the chord after the change.
    const bells = [_]f32{ 1174.7, 1480.0, 1760.0, 2349.3, 2960.0 };
    for (0..14) |_| {
        const t0 = change_t + rng.range(0.1, 3.2);
        const f = bells[@min(bells.len - 1, @as(usize, @intFromFloat(rng.float() * bells.len)))];
        const amp = rng.range(0.03, 0.06);
        const pan = rng.range(0, 1);
        const start: usize = @intFromFloat(t0 * rate);
        const k = @exp(-@log(@as(f32, 1000)) / (1.6 * rate));
        var g: f32 = amp;
        var p: f32 = 0;
        var i = start;
        while (i < n and g > amp * 0.001) : (i += 1) {
            const s = g * @sin(p);
            l[i] += s * (1 - pan);
            r[i] += s * pan;
            p += std.math.tau * f / rate;
            g *= k;
        }
    }
    normalise(l[0..n], r[0..n], 0.9);
}

/// Scale both ears so the peak is `to`. A silent buffer stays silent.
fn normalise(l: []f32, r: []f32, to: f32) void {
    var peak: f32 = 0;
    for (l, r) |a, b| peak = @max(peak, @max(@abs(a), @abs(b)));
    if (peak <= 1e-9) return;
    const k = to / peak;
    for (l, r) |*a, *b| {
        a.* *= k;
        b.* *= k;
    }
}
