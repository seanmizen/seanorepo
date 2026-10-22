// Wheel-rail rolling noise. Rail and wheel roughness excite the contact.
// A roughness wavelength lambda sounds at f = v / lambda, so the whole
// spectrum slides up with speed. The level rises by about 30 log10(v) dB
// (Thompson, "Railway Noise and Vibration", ch. 5): amplitude ~ v^1.5.
//
// Four bands share one noise source:
// - roughness: broad band at v / 4 cm, the main "roar"
// - rumble: structure-borne low end, felt through the platform
// - corrugation: a narrow band at v / corrugation wavelength. Corrugated
//   tube rail "sings" with a pitched roar that follows speed
// - sizzle: high rail ring above 4 kHz

import { smoothstep } from '../core/math';
import { biquad, gainNode, Track } from './automation';
import type { CarFrame, Voice } from './frame';

export interface RollingOptions {
  corrugation: number;
  corrugationWavelength: number;
  level: number;
}

export class RollingVoice implements Voice {
  readonly output: GainNode;
  private readonly roughF: Track;
  private readonly roughG: Track;
  private readonly rumbleG: Track;
  private readonly corrF: Track;
  private readonly corrG: Track;
  private readonly sizzleG: Track;

  constructor(
    ctx: BaseAudioContext,
    noise: AudioNode,
    private readonly opts: RollingOptions,
  ) {
    const t = ctx.currentTime;
    this.output = gainNode(ctx, 1);
    const rough = biquad(ctx, 'bandpass', 400, 0.55);
    const roughGain = gainNode(ctx);
    const rumble = biquad(ctx, 'lowpass', 130, 1.1);
    const rumbleGain = gainNode(ctx);
    const corr = biquad(ctx, 'bandpass', 400, 7);
    const corrGain = gainNode(ctx);
    const sizzle = biquad(ctx, 'highpass', 4200, 0.7);
    const sizzleGain = gainNode(ctx);
    noise.connect(rough).connect(roughGain).connect(this.output);
    noise.connect(rumble).connect(rumbleGain).connect(this.output);
    noise.connect(corr).connect(corrGain).connect(this.output);
    noise.connect(sizzle).connect(sizzleGain).connect(this.output);
    this.roughF = new Track(rough.frequency, 400, t);
    this.roughG = new Track(roughGain.gain, 0, t);
    this.rumbleG = new Track(rumbleGain.gain, 0, t);
    this.corrF = new Track(corr.frequency, 400, t);
    this.corrG = new Track(corrGain.gain, 0, t);
    this.sizzleG = new Track(sizzleGain.gain, 0, t);
  }

  update(f: CarFrame): void {
    const v = Math.max(0, f.speed);
    const r = v / 20;
    const moving = smoothstep(0.05, 1.5, v);
    const L = this.opts.level * moving;
    const t = f.time;
    this.roughF.ramp(Math.min(5000, Math.max(60, v / 0.04)), t);
    this.roughG.ramp(L * 1.1 * r ** 1.5, t);
    this.rumbleG.ramp(L * 0.6 * r ** 1.25, t);
    this.corrF.ramp(
      Math.min(6000, Math.max(60, v / this.opts.corrugationWavelength)),
      t,
    );
    this.corrG.ramp(L * 1.4 * this.opts.corrugation * r ** 2, t);
    this.sizzleG.ramp(L * 0.12 * r ** 2, t);
  }
}
