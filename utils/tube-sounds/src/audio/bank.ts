// The sound bank: every pre-generated buffer, made once per AudioContext.
// Events pick a random variant, so no two joint clicks or door thuds are
// the same.

import { stationImpulse, tunnelImpulse } from '../core/impulse';
import { mulberry32 } from '../core/math';
import {
  airBlowoff,
  camshaftClick,
  compressorStroke,
  contactorClunk,
  doorChime,
  doorWarning,
  electricDoor,
  pinkNoise,
  pneumaticDoor,
  railJointImpact,
  stopLurch,
  whiteNoise,
} from '../core/synth';

export interface SoundBank {
  noise: AudioBuffer;
  pink: AudioBuffer;
  joint: AudioBuffer[];
  cam: AudioBuffer[];
  contactor: AudioBuffer[];
  blowoff: AudioBuffer[];
  doorOpen: { pneumatic: AudioBuffer[]; electric: AudioBuffer[] };
  doorClose: { pneumatic: AudioBuffer[]; electric: AudioBuffer[] };
  warning: AudioBuffer;
  chime: AudioBuffer;
  lurch: AudioBuffer[];
  stroke: AudioBuffer[];
  stationIr: AudioBuffer;
  tunnelIr: AudioBuffer;
}

const banks = new WeakMap<BaseAudioContext, SoundBank>();

const toBuffer = (
  ctx: BaseAudioContext,
  chans: Float32Array[],
): AudioBuffer => {
  const first = chans[0] ?? new Float32Array(1);
  const buf = ctx.createBuffer(chans.length, first.length, ctx.sampleRate);
  chans.forEach((c, i) => {
    buf.copyToChannel(c as Float32Array<ArrayBuffer>, i);
  });
  return buf;
};

const variants = (
  ctx: BaseAudioContext,
  count: number,
  seed: number,
  make: (sr: number, seed: number) => Float32Array,
): AudioBuffer[] =>
  Array.from({ length: count }, (_, i) =>
    toBuffer(ctx, [make(ctx.sampleRate, seed + i * 17)]),
  );

export const getBank = (ctx: BaseAudioContext): SoundBank => {
  const cached = banks.get(ctx);
  if (cached) return cached;
  const sr = ctx.sampleRate;
  const rand = mulberry32(20260101);
  const bank: SoundBank = {
    // 6 s loops: long enough that the loop point is not audible in noise.
    noise: toBuffer(ctx, [whiteNoise(sr * 6, rand)]),
    pink: toBuffer(ctx, [pinkNoise(sr * 6, rand), pinkNoise(sr * 6, rand)]),
    joint: variants(ctx, 8, 100, railJointImpact),
    cam: variants(ctx, 4, 200, camshaftClick),
    contactor: variants(ctx, 3, 300, contactorClunk),
    blowoff: variants(ctx, 3, 400, (r, s) => airBlowoff(r, s, 1.1)),
    doorOpen: {
      pneumatic: variants(ctx, 4, 500, (r, s) => pneumaticDoor(r, s, 'open')),
      electric: variants(ctx, 4, 600, (r, s) => electricDoor(r, s, 'open')),
    },
    doorClose: {
      pneumatic: variants(ctx, 4, 700, (r, s) => pneumaticDoor(r, s, 'close')),
      electric: variants(ctx, 4, 800, (r, s) => electricDoor(r, s, 'close')),
    },
    warning: toBuffer(ctx, [doorWarning(sr)]),
    chime: toBuffer(ctx, [doorChime(sr, 900)]),
    lurch: variants(ctx, 3, 1000, stopLurch),
    stroke: variants(ctx, 4, 1100, compressorStroke),
    stationIr: toBuffer(ctx, stationImpulse(sr)),
    tunnelIr: toBuffer(ctx, tunnelImpulse(sr)),
  };
  banks.set(ctx, bank);
  return bank;
};

export const pick = <T>(list: readonly T[], rand: () => number): T => {
  const v = list[Math.floor(rand() * list.length) % list.length];
  if (v === undefined) throw new Error('pick: the list is empty.');
  return v;
};

/** Play a buffer once at `time` into `dest`, with gain and playback rate. */
export const playBuffer = (
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  dest: AudioNode,
  time: number,
  gain = 1,
  rate = 1,
  duration?: number,
): void => {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(dest);
  const at = Math.max(time, ctx.currentTime);
  src.start(at);
  if (duration !== undefined) src.stop(at + duration);
  src.onended = () => g.disconnect();
};

/** A looping noise source that starts at a random offset (decorrelated). */
export const loopNoise = (
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  rand: () => number,
): AudioBufferSourceNode => {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.start(ctx.currentTime, rand() * buffer.duration);
  return src;
};
