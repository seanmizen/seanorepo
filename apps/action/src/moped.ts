// The engine sound of the moped thieves: the buzz of a small two-stroke.
// The game calls jsMoped on each tick for each moped
// (game/src/moped_sound.zig). This file gives the function to the wasm
// import module "env" (boot.ts).
//
// - The AudioContext starts on the first click, touch or key press. A
//   browser starts audio only after a user gesture.
// - One voice for each moped slot. The page makes a voice at the first
//   call with a level above 0.
// - The voice: a sawtooth and a narrow pulse at the firing rate, and a
//   little noise for the rasp. A soft clip gives the snarl. A band of the
//   exhaust and a low-pass filter shape it. A stereo panner puts it on its
//   side. The game gives the pitch with the Doppler shift.
// - After 3 s of silence the context stops. It continues at the next
//   level above 0. The page catches every error. Without Web Audio the
//   game runs with no engine sound.

/** The level of a voice at a game level of 1. */
const MASTER = 0.35;
/** The time constant of each change, s. The game calls 120 times a second. */
const GLIDE = 0.03;
/** Silence after which the context stops, s. */
const IDLE_STOP = 3;

interface Voice {
  saw: OscillatorNode;
  pulse: OscillatorNode;
  noiseGain: GainNode;
  band: BiquadFilterNode;
  low: BiquadFilterNode;
  out: GainNode;
  pan: StereoPannerNode;
}

let ctx: AudioContext | null = null;
let failed = false;
let silentSince = 0;
const voices = new Map<number, Voice>();

function fail(err: unknown): void {
  failed = true;
  console.warn('[action] moped sound off:', err);
  try {
    ctx?.close();
  } catch {
    // The context is gone already.
  }
  ctx = null;
  voices.clear();
}

function onGesture(): void {
  if (failed) return;
  try {
    if (!ctx) {
      if (typeof AudioContext === 'undefined') {
        failed = true;
        return;
      }
      ctx = new AudioContext();
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  } catch (err) {
    fail(err);
  }
}
for (const type of ['pointerdown', 'keydown', 'touchend']) {
  window.addEventListener(type, onGesture, { capture: true, passive: true });
}

/** A narrow pulse wave: the sharp bang of each firing. */
function pulseWave(c: AudioContext): PeriodicWave {
  const n = 32;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  const duty = 0.18;
  for (let k = 1; k < n; k++) {
    im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  }
  return c.createPeriodicWave(re, im);
}

/** One second of white noise, in a loop. */
function noiseBuffer(c: AudioContext): AudioBuffer {
  const b = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** A soft clip curve. */
function clipCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(2.2 * x);
  }
  return curve;
}

function makeVoice(c: AudioContext): Voice {
  const mix = c.createGain();
  mix.gain.value = 0.5;
  const saw = c.createOscillator();
  saw.type = 'sawtooth';
  const sawGain = c.createGain();
  sawGain.gain.value = 0.55;
  saw.connect(sawGain).connect(mix);
  const pulse = c.createOscillator();
  pulse.setPeriodicWave(pulseWave(c));
  pulse.detune.value = 7;
  const pulseGain = c.createGain();
  pulseGain.gain.value = 0.6;
  pulse.connect(pulseGain).connect(mix);
  const noise = c.createBufferSource();
  noise.buffer = noiseBuffer(c);
  noise.loop = true;
  const noiseBand = c.createBiquadFilter();
  noiseBand.type = 'bandpass';
  noiseBand.frequency.value = 2400;
  noiseBand.Q.value = 0.8;
  const noiseGain = c.createGain();
  noiseGain.gain.value = 0.05;
  noise.connect(noiseBand).connect(noiseGain).connect(mix);
  const clip = c.createWaveShaper();
  clip.curve = clipCurve();
  const band = c.createBiquadFilter();
  band.type = 'peaking';
  band.frequency.value = 900;
  band.Q.value = 1.2;
  band.gain.value = 9;
  const low = c.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 2600;
  low.Q.value = 0.7;
  const out = c.createGain();
  out.gain.value = 0;
  const pan = c.createStereoPanner();
  mix.connect(clip).connect(band).connect(low).connect(out).connect(pan);
  pan.connect(c.destination);
  saw.start();
  pulse.start();
  noise.start();
  return { saw, pulse, noiseGain, band, low, out, pan };
}

/**
 * The engine of moped `slot` for this tick. game/src/moped_sound.zig gives
 * the meaning of each value.
 */
function jsMoped(
  slot: number,
  freq: number,
  gain: number,
  pan: number,
  rasp: number,
): undefined {
  const c = ctx;
  if (failed || !c) return undefined;
  try {
    const now = performance.now() / 1000;
    let v = voices.get(slot);
    if (gain > 0) {
      silentSince = now;
      if (c.state === 'suspended') void c.resume().catch(() => {});
      if (!v) {
        v = makeVoice(c);
        voices.set(slot, v);
      }
    } else if (now - silentSince > IDLE_STOP && c.state === 'running') {
      void c.suspend().catch(() => {});
    }
    if (!v) return undefined;
    const t = c.currentTime;
    const f = Math.min(400, Math.max(20, freq));
    v.saw.frequency.setTargetAtTime(f, t, GLIDE);
    v.pulse.frequency.setTargetAtTime(f, t, GLIDE);
    v.band.frequency.setTargetAtTime(500 + 6 * f, t, GLIDE);
    v.low.frequency.setTargetAtTime(1800 + 2600 * rasp, t, GLIDE);
    v.noiseGain.gain.setTargetAtTime(0.04 + 0.08 * rasp, t, GLIDE);
    v.out.gain.setTargetAtTime(
      MASTER * Math.min(1, Math.max(0, gain)),
      t,
      GLIDE,
    );
    v.pan.pan.setTargetAtTime(Math.min(1, Math.max(-1, pan)), t, GLIDE);
  } catch (err) {
    fail(err);
  }
  return undefined;
}

/** The functions for the wasm import module "env" (loader option `env`). */
export const mopedImports = { jsMoped };
