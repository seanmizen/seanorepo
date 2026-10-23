// Buffer synthesis for short events: rail-joint impacts, camshaft clicks,
// door mechanisms, chimes. Every function is pure and seeded. The audio
// layer copies the result into an AudioBuffer once, at start-up.
//
// Impacts use modal synthesis. A strike excites a set of resonant modes, and
// each mode is a decaying sinusoid. A short noise burst adds the contact
// "click". This is the same method as physical models of struck bars.

import { Biquad, filterBuffer } from './filters';
import { mulberry32 } from './math';

export type Rand = () => number;

export interface Mode {
  freq: number;
  /** Time for the mode to fall by 60 dB, s. */
  t60: number;
  amp: number;
}

export const whiteNoise = (n: number, rand: Rand): Float32Array => {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rand() * 2 - 1;
  return out;
};

/** Pink noise (-3 dB/octave), Paul Kellet's economy filter. */
export const pinkNoise = (n: number, rand: Rand): Float32Array => {
  const out = new Float32Array(n);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  return out;
};

/** Sum of decaying sinusoids, with a random phase per mode. */
export const modalBuffer = (
  sampleRate: number,
  seconds: number,
  modes: readonly Mode[],
  rand: Rand,
): Float32Array => {
  const n = Math.ceil(seconds * sampleRate);
  const out = new Float32Array(n);
  for (const m of modes) {
    const k = Math.log(1000) / m.t60; // 60 dB
    const w = (2 * Math.PI * m.freq) / sampleRate;
    const phase = rand() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      out[i] =
        (out[i] ?? 0) + m.amp * Math.exp(-k * t) * Math.sin(w * i + phase);
    }
  }
  return out;
};

/** Add `src` into `dst` at sample offset `at`, times `gain`. */
export const mixInto = (
  dst: Float32Array,
  src: Float32Array,
  at = 0,
  gain = 1,
): Float32Array => {
  const start = Math.max(0, Math.floor(at));
  for (let i = 0; i < src.length && start + i < dst.length; i++) {
    dst[start + i] = (dst[start + i] ?? 0) + (src[i] ?? 0) * gain;
  }
  return dst;
};

/** Multiply by an attack-decay envelope: linear attack, exponential decay. */
export const envelope = (
  buf: Float32Array,
  sampleRate: number,
  attack: number,
  t60: number,
): Float32Array => {
  const k = Math.log(1000) / t60;
  const a = Math.max(1, attack * sampleRate);
  for (let i = 0; i < buf.length; i++) {
    const t = i / sampleRate;
    const atk = i < a ? i / a : 1;
    buf[i] = (buf[i] ?? 0) * atk * Math.exp(-k * t);
  }
  return buf;
};

/** Noise through a band-pass, with an envelope. */
export const noiseBurst = (
  sampleRate: number,
  seconds: number,
  centre: number,
  q: number,
  attack: number,
  t60: number,
  rand: Rand,
): Float32Array => {
  const buf = whiteNoise(Math.ceil(seconds * sampleRate), rand);
  filterBuffer(buf, new Biquad('bandpass', centre, q, sampleRate));
  return envelope(buf, sampleRate, attack, t60);
};

export const normalise = (buf: Float32Array, peak = 0.9): Float32Array => {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max > 0)
    for (let i = 0; i < buf.length; i++) buf[i] = ((buf[i] ?? 0) / max) * peak;
  return buf;
};

const jitter = (rand: Rand, x: number, spread: number) =>
  x * (1 + (rand() * 2 - 1) * spread);

/**
 * A wheel striking a rail joint. Parts, from high to low:
 * 1. The contact crack: 1-2 ms of bright noise.
 * 2. Rail and wheel modes: the metallic "clack" (0.5-3 kHz).
 * 3. The unsprung mass (wheelset and axlebox) bounce: a thump near 90 Hz.
 * 4. The car body and the tunnel floor: a low "dum" near 40 Hz.
 */
export const railJointImpact = (
  sampleRate: number,
  seed: number,
): Float32Array => {
  const rand = mulberry32(seed);
  const seconds = 0.35;
  const n = Math.ceil(seconds * sampleRate);
  const out = new Float32Array(n);
  mixInto(
    out,
    noiseBurst(sampleRate, 0.03, 3800, 0.8, 0.0003, 0.012, rand),
    0,
    0.9,
  );
  const ring = modalBuffer(
    sampleRate,
    seconds,
    [
      { freq: jitter(rand, 610, 0.08), t60: 0.11, amp: 0.35 },
      { freq: jitter(rand, 1270, 0.08), t60: 0.07, amp: 0.3 },
      { freq: jitter(rand, 2330, 0.1), t60: 0.05, amp: 0.2 },
      { freq: jitter(rand, 3480, 0.1), t60: 0.035, amp: 0.12 },
    ],
    rand,
  );
  mixInto(out, envelope(ring, sampleRate, 0.0004, 10), 0, 1);
  const thump = modalBuffer(
    sampleRate,
    seconds,
    [
      { freq: jitter(rand, 92, 0.1), t60: 0.09, amp: 1 },
      { freq: jitter(rand, 41, 0.1), t60: 0.22, amp: 0.8 },
    ],
    rand,
  );
  mixInto(out, envelope(thump, sampleRate, 0.002, 10), 0, 1);
  return normalise(out, 0.9);
};

/**
 * A camshaft notch: the cam follower drops and a contactor closes. A hard
 * click with small steel modes, a contact "tick", and a puff of air from the
 * pneumatic cam engine.
 */
export const camshaftClick = (
  sampleRate: number,
  seed: number,
): Float32Array => {
  const rand = mulberry32(seed);
  const seconds = 0.18;
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  const modes = modalBuffer(
    sampleRate,
    seconds,
    [
      { freq: jitter(rand, 1850, 0.05), t60: 0.03, amp: 0.5 },
      { freq: jitter(rand, 3120, 0.05), t60: 0.02, amp: 0.4 },
      { freq: jitter(rand, 640, 0.05), t60: 0.045, amp: 0.35 },
      { freq: jitter(rand, 210, 0.05), t60: 0.05, amp: 0.4 },
    ],
    rand,
  );
  mixInto(out, envelope(modes, sampleRate, 0.0002, 10), 0, 1);
  mixInto(
    out,
    noiseBurst(sampleRate, 0.01, 5000, 1, 0.0001, 0.004, rand),
    0,
    0.8,
  );
  mixInto(
    out,
    noiseBurst(sampleRate, 0.12, 2600, 0.7, 0.01, 0.08, rand),
    0.004 * sampleRate,
    0.25,
  );
  return normalise(out, 0.9);
};

/** Line contactors: a heavier, lower clunk than a notch. */
export const contactorClunk = (
  sampleRate: number,
  seed: number,
): Float32Array => {
  const rand = mulberry32(seed);
  const seconds = 0.3;
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  const modes = modalBuffer(
    sampleRate,
    seconds,
    [
      { freq: jitter(rand, 160, 0.05), t60: 0.12, amp: 0.8 },
      { freq: jitter(rand, 430, 0.05), t60: 0.08, amp: 0.5 },
      { freq: jitter(rand, 1150, 0.05), t60: 0.05, amp: 0.3 },
      { freq: jitter(rand, 2650, 0.05), t60: 0.03, amp: 0.2 },
    ],
    rand,
  );
  mixInto(out, envelope(modes, sampleRate, 0.0005, 10), 0, 1);
  mixInto(
    out,
    noiseBurst(sampleRate, 0.02, 2000, 0.8, 0.0002, 0.01, rand),
    0,
    0.5,
  );
  return normalise(out, 0.9);
};

/** The air puff and rattle of the brake valve or unloader: band noise, decaying. */
export const airBlowoff = (
  sampleRate: number,
  seed: number,
  seconds = 0.9,
): Float32Array => {
  const rand = mulberry32(seed);
  const n = Math.ceil(seconds * sampleRate);
  const hi = whiteNoise(n, rand);
  filterBuffer(hi, new Biquad('highpass', 1800, 0.7, sampleRate));
  filterBuffer(hi, new Biquad('peaking', 4800, 1.2, sampleRate, 6));
  envelope(hi, sampleRate, 0.015, seconds * 0.9);
  return normalise(hi, 0.8);
};

/** A pneumatic door slide: rumble of rollers on the track plus a rattle. */
const doorSlide = (
  sampleRate: number,
  seconds: number,
  rand: Rand,
): Float32Array => {
  const n = Math.ceil(seconds * sampleRate);
  const out = whiteNoise(n, rand);
  filterBuffer(out, new Biquad('bandpass', 260, 0.9, sampleRate));
  // Roller rattle: amplitude modulation at about 30 Hz with random depth.
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const u = t / seconds;
    // Accelerate, run, cushion to a stop.
    const shape = Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 0.7;
    phase += (2 * Math.PI * (18 + 22 * shape)) / sampleRate;
    const rattle = 0.65 + 0.35 * Math.sin(phase) * (0.5 + rand() * 0.5);
    out[i] = (out[i] ?? 0) * shape * rattle;
  }
  return out;
};

/** The leaves meeting or reaching the stop: rubber thud plus panel ring. */
const doorThud = (
  sampleRate: number,
  rand: Rand,
  heavy: boolean,
): Float32Array => {
  const seconds = 0.4;
  const modes = modalBuffer(
    sampleRate,
    seconds,
    [
      { freq: jitter(rand, heavy ? 78 : 110, 0.08), t60: 0.16, amp: 1 },
      { freq: jitter(rand, 190, 0.08), t60: 0.1, amp: 0.55 },
      { freq: jitter(rand, 520, 0.08), t60: 0.07, amp: 0.25 },
      { freq: jitter(rand, 1340, 0.1), t60: 0.05, amp: 0.12 },
    ],
    rand,
  );
  envelope(modes, sampleRate, 0.0015, 10);
  mixInto(
    modes,
    noiseBurst(sampleRate, 0.03, 900, 0.7, 0.0005, 0.02, rand),
    0,
    0.4,
  );
  return modes;
};

export type DoorAction = 'open' | 'close';

/**
 * Door leaf travel time, s: from the start of the slide to the stop. Set by
 * ear against real trains. The valve hiss, the thuds and the exhaust keep
 * their own lengths and follow the travel time.
 */
export const DOOR_TRAVEL: Record<
  'pneumatic' | 'electric',
  Record<DoorAction, number>
> = {
  pneumatic: { open: 1.26, close: 1.5 },
  electric: { open: 1.92, close: 2.28 },
};

/** Time from the valve opening to the start of the pneumatic slide, s. */
const VALVE_LEAD = 0.08;

/** Time from the start of a door close to the leaves meeting, s. */
export const doorCloseTime = (kind: 'pneumatic' | 'electric'): number =>
  kind === 'pneumatic'
    ? VALVE_LEAD + DOOR_TRAVEL.pneumatic.close
    : DOOR_TRAVEL.electric.close;

/**
 * One door operation, pneumatic (1973 Stock door engines). Valve hiss,
 * slide, then the leaves reach the stop (open) or meet (close). On close,
 * the engine exhausts after the leaves meet.
 */
export const pneumaticDoor = (
  sampleRate: number,
  seed: number,
  action: DoorAction,
): Float32Array => {
  const rand = mulberry32(seed);
  const slide = DOOR_TRAVEL.pneumatic[action];
  // The leaves meet at VALVE_LEAD + slide. The 0.6 s exhaust starts 0.12 s
  // later.
  const seconds = slide + 0.95;
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  const sr = sampleRate;
  mixInto(out, airBlowoff(sr, seed + 1, 0.35), 0, 0.45);
  mixInto(out, doorSlide(sr, slide, rand), VALVE_LEAD * sr, 0.8);
  mixInto(
    out,
    doorThud(sr, rand, action === 'close'),
    (VALVE_LEAD + slide) * sr,
    1,
  );
  if (action === 'close') {
    // Second leaf, a few ms later, and the exhaust after the leaves meet.
    mixInto(
      out,
      doorThud(sr, rand, true),
      (VALVE_LEAD + 0.015 + slide) * sr,
      0.6,
    );
    mixInto(out, airBlowoff(sr, seed + 2, 0.6), (0.2 + slide) * sr, 0.35);
  }
  return normalise(out, 0.85);
};

/**
 * One door operation, electric (S7 Stock). A small DC motor whirs up and
 * down through the gearbox, then the leaves reach the stop.
 */
export const electricDoor = (
  sampleRate: number,
  seed: number,
  action: DoorAction,
): Float32Array => {
  const rand = mulberry32(seed);
  const run = DOOR_TRAVEL.electric[action];
  // The leaves reach the stop at `run`, and the thud rings for 0.4 s.
  const seconds = run + 0.5;
  const sr = sampleRate;
  const n = Math.ceil(seconds * sr);
  const out = new Float32Array(n);
  const runN = Math.floor(run * sr);
  let phase = 0;
  const lp = new Biquad('lowpass', 1400, 0.7, sr);
  for (let i = 0; i < runN; i++) {
    const u = i / runN;
    const speed = Math.sin(Math.PI * u) ** 0.5;
    // Motor whine with gear harmonics. The pitch follows motor speed.
    phase += (2 * Math.PI * (120 + 260 * speed)) / sr;
    const tone =
      Math.sin(phase) * 0.5 +
      Math.sin(2 * phase) * 0.3 +
      Math.sin(5 * phase) * 0.15 +
      (rand() * 2 - 1) * 0.25;
    out[i] = lp.process(tone) * speed * 0.22;
  }
  mixInto(out, doorSlide(sr, run, rand), 0, 0.45);
  mixInto(out, doorThud(sr, rand, false), run * sr, 0.9);
  return normalise(out, 0.8);
};

/** A sine beep with soft edges, plus a weak third harmonic (piezo sounder). */
export const beep = (
  sampleRate: number,
  freq: number,
  seconds: number,
): Float32Array => {
  const n = Math.ceil(seconds * sampleRate);
  const out = new Float32Array(n);
  const edge = Math.max(1, Math.floor(0.004 * sampleRate));
  for (let i = 0; i < n; i++) {
    const w = (2 * Math.PI * freq * i) / sampleRate;
    const env = Math.min(1, i / edge, (n - 1 - i) / edge);
    out[i] = (Math.sin(w) + 0.18 * Math.sin(3 * w)) * env * 0.7;
  }
  return out;
};

/**
 * The London Underground door closing warning. The cadence and pitch are
 * measured from two recordings on Wikimedia Commons (CC BY 4.0): "London
 * Underground 1995 Stock train doors closing" and "London Underground 1996
 * Stock train departing a station". Both give 6 beeps per second, with a
 * short gap, at 2.23 and 2.29 kHz. The default length is in the LU range of
 * 1.75 +/- 0.25 s from the first beep to door movement (TfL, "Increased
 * Warning Tone Duration on Victoria Line 09TS, Trial Final Report").
 */
export const DOOR_WARNING = {
  /** Beep pitch, Hz. */
  freq: 2290,
  /** Beep length, s. */
  on: 0.11,
  /** Time from the start of one beep to the start of the next, s. */
  period: 1 / 6,
  /** Default time from the first beep to door movement, s: 12 beeps. */
  seconds: 2,
};

/**
 * The beeps in a warning of `seconds`: their number, and the time at which
 * the last beep ends. The warning always ends on a whole beep.
 */
export const warningBeeps = (
  seconds: number,
  period = DOOR_WARNING.period,
  on = DOOR_WARNING.on,
): { count: number; end: number } => {
  const count = Math.max(1, Math.round(seconds / period));
  return { count, end: (count - 1) * period + on };
};

/**
 * Door warning: `count` beeps of `on` seconds every `period` seconds. This is
 * the "doors closing" sound. The default buffer holds 5 s of beeps. A
 * player stops it after the beeps it needs (`warningBeeps`).
 */
export const doorWarning = (
  sampleRate: number,
  freq = DOOR_WARNING.freq,
  count = 30,
  on = DOOR_WARNING.on,
  period = DOOR_WARNING.period,
): Float32Array => {
  const out = new Float32Array(Math.ceil((count * period + 0.1) * sampleRate));
  const b = beep(sampleRate, freq, on);
  for (let i = 0; i < count; i++) mixInto(out, b, i * period * sampleRate);
  return out;
};

/**
 * Door-open chime: two bell-like tones, falling a major third. Bell partials
 * at 1, 2.76 and 5.4 times the fundamental (a free plate).
 */
export const doorChime = (
  sampleRate: number,
  seed: number,
  notes: readonly number[] = [1318.5, 1046.5],
): Float32Array => {
  const rand = mulberry32(seed);
  const gap = 0.32;
  const seconds = gap * notes.length + 1.4;
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  notes.forEach((f, i) => {
    const tone = modalBuffer(
      sampleRate,
      1.4,
      [
        { freq: f, t60: 1.2, amp: 0.6 },
        { freq: f * 2.76, t60: 0.5, amp: 0.2 },
        { freq: f * 5.4, t60: 0.2, amp: 0.08 },
      ],
      rand,
    );
    mixInto(out, envelope(tone, sampleRate, 0.003, 10), i * gap * sampleRate);
  });
  return normalise(out, 0.7);
};

/**
 * The stop lurch: the car body rocks back on its suspension when the brake
 * holds the bogies. A low body thump and a creak.
 */
export const stopLurch = (sampleRate: number, seed: number): Float32Array => {
  const rand = mulberry32(seed);
  const seconds = 0.9;
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  const body = modalBuffer(
    sampleRate,
    seconds,
    [
      { freq: jitter(rand, 34, 0.1), t60: 0.5, amp: 1 },
      { freq: jitter(rand, 68, 0.1), t60: 0.3, amp: 0.5 },
      { freq: jitter(rand, 240, 0.1), t60: 0.15, amp: 0.2 },
    ],
    rand,
  );
  mixInto(out, envelope(body, sampleRate, 0.03, 10), 0, 1);
  mixInto(
    out,
    noiseBurst(sampleRate, 0.4, 700, 4, 0.05, 0.3, rand),
    0.05 * sampleRate,
    0.15,
  );
  return normalise(out, 0.8);
};

/** One compressor stroke: a piston thump with valve tick. */
export const compressorStroke = (
  sampleRate: number,
  seed: number,
): Float32Array => {
  const rand = mulberry32(seed);
  const seconds = 0.12;
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  const thump = modalBuffer(
    sampleRate,
    seconds,
    [
      { freq: jitter(rand, 62, 0.05), t60: 0.08, amp: 1 },
      { freq: jitter(rand, 150, 0.05), t60: 0.06, amp: 0.6 },
      { freq: jitter(rand, 420, 0.05), t60: 0.04, amp: 0.3 },
    ],
    rand,
  );
  mixInto(out, envelope(thump, sampleRate, 0.003, 10), 0, 1);
  mixInto(
    out,
    noiseBurst(sampleRate, 0.03, 2600, 2, 0.0005, 0.015, rand),
    0.02 * sampleRate,
    0.2,
  );
  return normalise(out, 0.9);
};
