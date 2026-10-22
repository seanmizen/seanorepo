// Generated impulse responses for the ConvolverNode reverbs.
//
// An impulse response here has three parts:
// 1. Early reflections: discrete echoes from the nearest surfaces. A deep
//    tube platform is a tiled cylinder, so add a flutter echo between the
//    two curved walls.
// 2. Tube modes: a long tunnel of diameter D rings at its cross modes. For a
//    rigid circular duct the first modes are at 1.841, 3.054 and 3.832
//    times c / (pi D) (Kinsler, "Fundamentals of Acoustics", ch. 9). For a
//    3.56 m running tunnel that is 56, 94 and 117 Hz: the "boom".
// 3. The late tail: noise with a decay time per frequency band. High
//    frequencies decay first, because air and soot absorb them.

import { Biquad } from './filters';
import { mulberry32, SPEED_OF_SOUND } from './math';

export interface Reflection {
  /** Delay after the direct sound, s. */
  delay: number;
  gain: number;
}

export interface ImpulseOptions {
  seconds: number;
  /** Decay time (-60 dB) below 300 Hz, 300-2500 Hz, and above 2500 Hz, s. */
  rt60: [number, number, number];
  early?: Reflection[];
  /** Flutter echo: repeat period (s) and gain per repeat. */
  flutter?: { period: number; gain: number; count: number };
  /** Resonant modes of a tube: frequency (Hz) and decay (s). */
  modes?: { freq: number; t60: number; amp: number }[];
  /** Delay before the late tail starts, s. */
  predelay?: number;
  seed?: number;
  channels?: number;
}

/** Cross-mode frequencies of a circular duct of diameter d, Hz. */
export const tubeModes = (diameter: number): number[] =>
  [1.841, 3.054, 3.832].map((k) => (k * SPEED_OF_SOUND) / (Math.PI * diameter));

export const generateImpulse = (
  sampleRate: number,
  opts: ImpulseOptions,
): Float32Array[] => {
  const n = Math.ceil(opts.seconds * sampleRate);
  const channels = opts.channels ?? 2;
  const out: Float32Array[] = [];
  const pre = opts.predelay ?? 0.012;
  for (let c = 0; c < channels; c++) {
    const rand = mulberry32((opts.seed ?? 1) * 977 + c * 131);
    const buf = new Float32Array(n);
    // Late tail, split into three bands with their own decay rates.
    const low = new Biquad('lowpass', 300, Math.SQRT1_2, sampleRate);
    const midHp = new Biquad('highpass', 300, Math.SQRT1_2, sampleRate);
    const midLp = new Biquad('lowpass', 2500, Math.SQRT1_2, sampleRate);
    const high = new Biquad('highpass', 2500, Math.SQRT1_2, sampleRate);
    const [rLow, rMid, rHigh] = opts.rt60;
    const kL = Math.log(1000) / rLow;
    const kM = Math.log(1000) / rMid;
    const kH = Math.log(1000) / rHigh;
    const onset = Math.floor(pre * sampleRate);
    const fade = Math.floor(0.03 * sampleRate);
    for (let i = onset; i < n; i++) {
      const t = (i - onset) / sampleRate;
      const w = rand() * 2 - 1;
      const env = Math.min(1, (i - onset) / fade);
      buf[i] =
        env *
        (low.process(w) * Math.exp(-kL * t) +
          midLp.process(midHp.process(w)) * Math.exp(-kM * t) +
          high.process(w) * Math.exp(-kH * t) * 0.8) *
        0.35;
    }
    const tap = (delay: number, gain: number) => {
      // Smear each reflection over a few samples: a real wall is not flat.
      const i0 = Math.floor(delay * sampleRate);
      for (let k = 0; k < 6; k++) {
        const i = i0 + k;
        if (i < n)
          buf[i] = (buf[i] ?? 0) + gain * (1 - k / 6) * (rand() > 0.5 ? 1 : -1);
      }
    };
    buf[0] = 0; // the dry path carries the direct sound
    for (const r of opts.early ?? []) {
      tap(r.delay * (1 + (rand() - 0.5) * 0.06), r.gain);
    }
    if (opts.flutter) {
      const f = opts.flutter;
      for (let k = 1; k <= f.count; k++) {
        tap(k * f.period * (1 + (rand() - 0.5) * 0.02), f.gain ** k);
      }
    }
    for (const m of opts.modes ?? []) {
      const k = Math.log(1000) / m.t60;
      const w = (2 * Math.PI * m.freq) / sampleRate;
      const ph = rand() * Math.PI * 2;
      for (let i = onset; i < n; i++) {
        const t = (i - onset) / sampleRate;
        buf[i] =
          (buf[i] ?? 0) + m.amp * Math.exp(-k * t) * Math.sin(w * i + ph);
      }
    }
    out.push(buf);
  }
  // Normalise to unit energy per channel, so the send gains mean the same
  // thing for every impulse.
  for (const buf of out) {
    let e = 0;
    for (const v of buf) e += v * v;
    const g = e > 0 ? 1 / Math.sqrt(e) : 1;
    for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] ?? 0) * g;
  }
  return out;
};

/**
 * A deep-level platform tunnel: about 6.5 m diameter, tiled walls, 120 m
 * long. Reflections from the floor, the curved wall behind the listener and
 * the far wall across the track. A flutter echo between the curved walls.
 */
export const stationImpulse = (sampleRate: number, seed = 7): Float32Array[] =>
  generateImpulse(sampleRate, {
    seconds: 2.8,
    rt60: [2.6, 2.0, 1.1],
    predelay: 0.01,
    early: [
      { delay: 0.008, gain: 0.5 }, // floor
      { delay: 0.019, gain: 0.42 }, // wall behind the listener
      { delay: 0.027, gain: 0.35 }, // vault
      { delay: 0.041, gain: 0.38 }, // far wall across the track
      { delay: 0.063, gain: 0.22 },
    ],
    flutter: { period: 0.038, gain: 0.62, count: 9 },
    modes: tubeModes(6.5).map((freq, i) => ({
      freq,
      t60: 0.9 - i * 0.2,
      amp: 0.006,
    })),
    seed,
  });

/**
 * A 3.56 m running tunnel: dark, long and boomy. Its cross modes ring
 * clearly, and the tail is mostly low frequency.
 */
export const tunnelImpulse = (sampleRate: number, seed = 11): Float32Array[] =>
  generateImpulse(sampleRate, {
    seconds: 3.6,
    rt60: [3.4, 1.8, 0.6],
    predelay: 0.02,
    early: [
      { delay: 0.011, gain: 0.45 },
      { delay: 0.022, gain: 0.4 },
      { delay: 0.033, gain: 0.3 },
    ],
    flutter: { period: 0.0105, gain: 0.7, count: 14 },
    modes: tubeModes(3.56).map((freq, i) => ({
      freq,
      t60: 1.1 - i * 0.25,
      amp: 0.012,
    })),
    seed,
  });
