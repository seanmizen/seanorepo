// Where: apps/autosam, run by `yarn test`.
// When: on each change to public/piano.js.
// Why: nobody can listen in a test. These checks read the spectrum of a
// rendered note: the partials are at the stretched frequencies of a stiff
// string, high partials decay first, and a harder blow is brighter.

import { expect, test } from 'bun:test';
import { grandSamples, mtof, partialFreq, stiffness } from '../public/piano.js';

const SR = 48000;

// The amplitude of frequency f in a Hann window from t0, w seconds long.
function amp(x: Float32Array, f: number, t0: number, w: number) {
  const a = Math.floor(t0 * SR);
  const n = Math.floor(w * SR);
  let re = 0;
  let im = 0;
  let ws = 0;
  for (let i = 0; i < n; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    const p = (2 * Math.PI * f * i) / SR;
    re += x[a + i] * h * Math.cos(p);
    im -= x[a + i] * h * Math.sin(p);
    ws += h;
  }
  return (2 * Math.hypot(re, im)) / ws;
}

const db = (r: number) => 20 * Math.log10(r);

test('the partials are at n f0 sqrt(1 + B n²)', () => {
  const midi = 48;
  const f0 = mtof(midi);
  const B = stiffness(midi);
  const x = grandSamples(midi, 1, SR);
  for (const n of [8, 10, 15]) {
    const stretched = amp(x, partialFreq(f0, n, B), 0.05, 0.5);
    const harmonic = amp(x, n * f0, 0.05, 0.5);
    expect(db(stretched / harmonic)).toBeGreaterThan(20);
  }
});

test('B rises toward the treble', () => {
  expect(stiffness(84)).toBeGreaterThan(stiffness(60));
  expect(stiffness(60)).toBeGreaterThan(stiffness(40));
});

test('high partials decay faster than the fundamental', () => {
  const midi = 48;
  const f0 = mtof(midi);
  const B = stiffness(midi);
  const x = grandSamples(midi, 1, SR);
  const drop = (n: number) => {
    const f = partialFreq(f0, n, B);
    return db(amp(x, f, 0.05, 0.3) / amp(x, f, 1.0, 0.3));
  };
  expect(drop(1)).toBeGreaterThan(0);
  expect(drop(6)).toBeGreaterThan(drop(1) + 10);
  expect(drop(10)).toBeGreaterThan(drop(1) + 10);
});

test('a harder blow has more high partials', () => {
  const midi = 60;
  const f0 = mtof(midi);
  const f = partialFreq(f0, 6, stiffness(midi));
  const tilt = (vel: number) => {
    const x = grandSamples(midi, vel, SR);
    return amp(x, f, 0.02, 0.2) / amp(x, f0, 0.02, 0.2);
  };
  expect(db(tilt(1) / tilt(0.3))).toBeGreaterThan(6);
});

test('each note is finite, starts at zero and ends at zero', () => {
  for (const midi of [21, 60, 108]) {
    const x = grandSamples(midi, 0.8, SR);
    expect(x.every(Number.isFinite)).toBe(true);
    expect(Math.abs(x[0])).toBeLessThan(1e-3);
    expect(Math.abs(x[x.length - 1])).toBeLessThan(1e-3);
  }
});
