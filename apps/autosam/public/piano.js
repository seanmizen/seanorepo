// Where: apps/autosam/public/piano.js. app.js imports it for the "Grand"
// sound. test/piano.test.ts checks the spectrum.
// When: app.js calls grandSamples() one time for each note, before the
// note first plays or when it first plays. It keeps the result as an
// AudioBuffer and plays that buffer each time after.
// Why: a modelled grand piano. A struck piano string is stiff, so its
// partials are sharper than whole multiples of the fundamental. High
// partials die first. Each note has one, two or three strings that are
// tuned a little apart, so they beat. A harder blow gives more high
// partials. This file makes those features from first principles, with no
// samples. app.js adds the soundboard (the convolution reverb) and the
// damper.

// Where the hammer strikes, as a part of the string length. The partials
// near a multiple of 1 / X0 are weak.
const X0 = 0.12;
// The aftersound: the part of each partial that decays slowly, and how
// much slower it decays than the prompt sound.
const AFTER = 0.2;
const AFTER_SLOW = 3;
// The highest partial frequency, in Hz.
const TOP = 10000;
// The loudness of each buffer: the RMS of its first 0.2 seconds.
const LEVEL = 0.25;

export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// The inharmonicity coefficient B of the string. B is smallest near E2 and
// rises toward the treble, where the strings are short and stiff.
export function stiffness(midi) {
  return midi >= 40
    ? 1e-4 * 2 ** ((midi - 40) / 12)
    : 1e-4 * 2 ** ((40 - midi) / 24);
}

// The frequency of partial n of a stiff string: n * f0 * sqrt(1 + B n²).
export const partialFreq = (f0, n, B) => n * f0 * Math.sqrt(1 + B * n * n);

// The detune of each string of the note, in cents. A grand has one wound
// string in the low bass, two strings in the bass and three above.
export function strings(midi) {
  if (midi < 29) return [0];
  if (midi < 44) return [-0.5, 0.6];
  return [0, -0.7, 0.9];
}

// The time constant of the prompt decay of a partial at f Hz, in seconds.
// The loss has a part for the note and a part that grows with f², so high
// partials die first.
export function decayTime(f0, f) {
  return 1 / (0.25 + f0 / 350 + 5e-7 * f * f);
}

// The samples of one note: midi number, hammer velocity (0 to 1), sample
// rate. The note rings to its natural end. app.js applies the damper.
export function grandSamples(midi, vel, sampleRate) {
  const f0 = mtof(midi);
  const B = stiffness(midi);
  const tau = decayTime(f0, f0);
  const sec = Math.min(3.5, Math.max(1.2, 5 * tau));
  const len = Math.floor(sec * sampleRate);
  const out = new Float64Array(len);
  const cents = strings(midi);
  // A harder blow puts more energy into the high partials.
  const reach = 2 + 10 * vel * vel;
  const top = Math.min(TOP, sampleRate * 0.45);

  for (let n = 1; n <= 60; n++) {
    const f = partialFreq(f0, n, B);
    if (f > top) break;
    const strike = Math.abs(Math.sin(Math.PI * n * X0));
    const hammer = Math.exp(-(n - 1) / reach) / n;
    // The soundboard radiates low frequencies weakly.
    const board = 1 / Math.sqrt(1 + (90 / f) ** 2);
    const a = (strike * hammer * board) / cents.length;
    if (a < 3e-4) continue;
    const t1 = decayTime(f0, f);
    const phase = (n * 2.39996) % (2 * Math.PI);
    for (const c of cents)
      addMode(out, f * 2 ** (c / 1200), phase, a, t1, sampleRate);
  }

  // Make each note equally loud before the velocity gain.
  const head = Math.min(len, Math.floor(0.2 * sampleRate));
  let sum = 0;
  for (let i = 0; i < head; i++) sum += out[i] * out[i];
  const gain = LEVEL / Math.sqrt(sum / head || 1);

  // The knock of the hammer: a short burst of filtered noise.
  let seed = midi * 7919 + Math.round(vel * 100);
  let lp = 0;
  const k = 1 - Math.exp((-2 * Math.PI * (1500 + 4000 * vel)) / sampleRate);
  const knock = (0.04 + 0.08 * vel) / gain;
  const knockLen = Math.min(len, Math.floor(0.04 * sampleRate));
  for (let i = 0; i < knockLen; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    lp += k * (seed / 2 ** 31 - 1 - lp);
    out[i] += lp * knock * Math.exp(-i / (0.006 * sampleRate));
  }

  // The hammer felt touches the string for a few milliseconds, and a soft
  // blow touches it longer. Fade the last 0.25 seconds, so the end of the
  // buffer does not click.
  const ramp = Math.max(1, Math.floor((0.004 - 0.003 * vel) * sampleRate));
  const fade = Math.floor(0.25 * sampleRate);
  const result = new Float32Array(len);
  for (let i = 0; i < len; i++)
    result[i] = out[i] * gain * Math.min(1, i / ramp, (len - i) / fade);
  return result;
}

// Add one damped partial of one string. It has two decays: the prompt
// sound, then the aftersound.
function addMode(out, f, phase, a, t1, sampleRate) {
  const w = (2 * Math.PI * f) / sampleRate;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  let re = Math.cos(phase);
  let im = Math.sin(phase);
  let e1 = a * (1 - AFTER);
  let e2 = a * AFTER;
  const r1 = Math.exp(-1 / (t1 * sampleRate));
  const r2 = Math.exp(-1 / (t1 * AFTER_SLOW * sampleRate));
  const floor = a * 1e-3;
  for (let i = 0; i < out.length; i++) {
    out[i] += im * (e1 + e2);
    const t = re * cw - im * sw;
    im = re * sw + im * cw;
    re = t;
    e1 *= r1;
    e2 *= r2;
    if (e1 + e2 < floor) break;
  }
}
