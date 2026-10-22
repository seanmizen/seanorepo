// Station ambience: what a deep-level platform sounds like with no train.
//
// - Mains hum: lighting ballasts and transformers hum at 100 Hz (twice the
//   50 Hz mains) with weak harmonics.
// - Ventilation: tunnel fans give a broad, low air noise and a faint blade
//   tone with a slow wobble.
// - Distant trains: now and then a train on another line or platform
//   rumbles through the rock. A slow swell of very low noise.

import { mulberry32 } from '../core/math';
import { biquad, gainNode, oscillator, Track } from './automation';
import { loopNoise, type SoundBank } from './bank';

export interface AmbientOptions {
  level: number;
  /** Mean seconds between distant trains. 0 = none. */
  distantTrainEvery: number;
  seed: number;
}

export class Ambient {
  readonly output: GainNode;
  private readonly rumbleG: Track;
  private readonly rumbleF: Track;
  private readonly rand: () => number;
  private nextDistant: number;
  private distant: { start: number; length: number; peak: number } | null =
    null;

  constructor(
    ctx: BaseAudioContext,
    bank: SoundBank,
    private readonly opts: AmbientOptions,
  ) {
    const t = ctx.currentTime;
    this.rand = mulberry32(opts.seed);
    this.output = gainNode(ctx, opts.level);

    const hum = gainNode(ctx, 0.012);
    [
      [100, 1],
      [200, 0.35],
      [300, 0.22],
      [50, 0.25],
      [400, 0.08],
    ].forEach(([f = 100, a = 0]) => {
      const o = oscillator(ctx, 'sine', f * (1 + (this.rand() - 0.5) * 0.002));
      const g = gainNode(ctx, a);
      o.connect(g).connect(hum);
      o.start(t);
    });
    hum.connect(this.output);

    const pink = loopNoise(ctx, bank.pink, this.rand);
    const vent = biquad(ctx, 'lowpass', 650, 0.6);
    const ventHp = biquad(ctx, 'highpass', 35, 0.7);
    const ventG = gainNode(ctx, 0.07);
    pink.connect(vent).connect(ventHp).connect(ventG).connect(this.output);

    const blade = oscillator(ctx, 'triangle', 87);
    const bladeLp = biquad(ctx, 'lowpass', 300, 0.7);
    const bladeG = gainNode(ctx, 0.006);
    const wob = oscillator(ctx, 'sine', 0.13);
    const wobD = gainNode(ctx, 1.2);
    wob.connect(wobD).connect(blade.frequency);
    blade.connect(bladeLp).connect(bladeG).connect(this.output);
    blade.start(t);
    wob.start(t);

    const white = loopNoise(ctx, bank.noise, this.rand);
    const rumble = biquad(ctx, 'lowpass', 90, 0.9);
    const rumbleG = gainNode(ctx);
    white.connect(rumble).connect(rumbleG).connect(this.output);
    this.rumbleG = new Track(rumbleG.gain, 0, t);
    this.rumbleF = new Track(rumble.frequency, 90, t);
    this.nextDistant = t + this.gap() * 0.4;
  }

  private gap(): number {
    const every = this.opts.distantTrainEvery;
    return every <= 0 ? Number.POSITIVE_INFINITY : every * (0.5 + this.rand());
  }

  update(time: number): void {
    if (!this.distant && time >= this.nextDistant) {
      this.distant = {
        start: time,
        length: 14 + this.rand() * 10,
        peak: 0.25 + this.rand() * 0.35,
      };
    }
    let g = 0;
    if (this.distant) {
      const u = (time - this.distant.start) / this.distant.length;
      if (u >= 1) {
        this.distant = null;
        this.nextDistant = time + this.gap();
      } else {
        g = this.distant.peak * Math.sin(Math.PI * u) ** 2;
      }
    }
    this.rumbleG.ramp(g, time);
    this.rumbleF.ramp(70 + 50 * g, time);
  }
}
