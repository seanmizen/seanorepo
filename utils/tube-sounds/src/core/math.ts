// Small numeric helpers. All functions are pure.

export const SPEED_OF_SOUND = 343;

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

/** Hermite smoothstep from edge0 to edge1. */
export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const dbToGain = (db: number): number => 10 ** (db / 20);

export const gainToDb = (gain: number): number =>
  20 * Math.log10(Math.max(gain, 1e-12));

/**
 * Seeded PRNG (mulberry32). The same seed gives the same sounds, so offline
 * renders and tests are repeatable.
 */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Bessel function of the first kind, integer order n, by its power series.
 * The series is accurate for |x| < 8, which covers PWM sideband maths
 * (x = m * pi / 2 with m <= 1.3).
 */
export const besselJ = (n: number, x: number): number => {
  let sum = 0;
  let term = (x / 2) ** n;
  for (let k = 1; k <= n; k++) term /= k;
  for (let k = 0; k < 40; k++) {
    sum += term;
    term *= -((x / 2) ** 2) / ((k + 1) * (k + 1 + n));
    if (Math.abs(term) < 1e-14) break;
  }
  return sum;
};

/** Bell curve: 1 at centre, falls to ~0.37 at centre +/- width. */
export const bell = (x: number, centre: number, width: number): number =>
  Math.exp(-(((x - centre) / width) ** 2));
