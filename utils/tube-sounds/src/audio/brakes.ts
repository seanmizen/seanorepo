// Friction brakes and brake air.
//
// - Air hiss: read from the flow into or out of the brake cylinders (see
//   core/air.ts). Exhaust (pressure falling) is loud and bright. Supply
//   (pressure rising) is soft.
// - Block friction: composition blocks on the wheel treads. Broad band
//   scrape whose level follows cylinder pressure and whose centre rises
//   with speed.
// - Groan: at low speed the friction coefficient rises as speed falls. That
//   negative slope makes stick-slip unstable, and the bogie groans at a low,
//   rough pitch in the last metre or two before the stop.
// - Judder: the stick-slip also shakes the bogie at 6-12 Hz. It modulates
//   the groan.

import { bell, smoothstep } from '../core/math';
import { biquad, gainNode, oscillator, Track } from './automation';
import type { CarFrame, Voice } from './frame';

export class BrakeVoice implements Voice {
  readonly output: GainNode;
  private readonly hissG: Track;
  private readonly hissF: Track;
  private readonly scrapeF: Track;
  private readonly scrapeG: Track;
  private readonly grindG: Track;
  private readonly groanF: Track;
  private readonly groanG: Track;
  private readonly judderF: Track;
  private readonly judderD: Track;
  private readonly rand: () => number;

  constructor(
    ctx: BaseAudioContext,
    noise: AudioNode,
    private readonly level: number,
    rand: () => number,
  ) {
    this.rand = rand;
    const t = ctx.currentTime;
    this.output = gainNode(ctx, 1);

    const hissHp = biquad(ctx, 'highpass', 2200, 0.7);
    const hissPk = biquad(ctx, 'peaking', 5200, 1.1);
    hissPk.gain.value = 7;
    const hissG = gainNode(ctx);
    noise.connect(hissHp).connect(hissPk).connect(hissG).connect(this.output);
    this.hissG = new Track(hissG.gain, 0, t);
    this.hissF = new Track(hissPk.frequency, 5200, t);

    const scrape = biquad(ctx, 'bandpass', 1800, 0.8);
    const scrapeG = gainNode(ctx);
    noise.connect(scrape).connect(scrapeG).connect(this.output);
    this.scrapeF = new Track(scrape.frequency, 1800, t);
    this.scrapeG = new Track(scrapeG.gain, 0, t);

    const grind = biquad(ctx, 'bandpass', 380, 1.6);
    const grindG = gainNode(ctx);
    noise.connect(grind).connect(grindG).connect(this.output);
    this.grindG = new Track(grindG.gain, 0, t);

    const groan = oscillator(ctx, 'sawtooth', 70);
    const groanLp = biquad(ctx, 'lowpass', 520, 2.5);
    const groanG = gainNode(ctx);
    groan.connect(groanLp).connect(groanG).connect(this.output);
    const judder = oscillator(ctx, 'triangle', 8);
    const judderD = gainNode(ctx);
    judder.connect(judderD).connect(groanG.gain);
    this.groanF = new Track(groan.frequency, 70, t);
    this.groanG = new Track(groanG.gain, 0, t);
    this.judderF = new Track(judder.frequency, 8, t);
    this.judderD = new Track(judderD.gain, 0, t);
    groan.start(t);
    judder.start(t);
  }

  update(f: CarFrame): void {
    const t = f.time;
    const L = this.level;
    const v = Math.max(0, f.speed);
    const p = f.cylinder;
    const exhaust = Math.max(0, -f.airFlow);
    const supply = Math.max(0, f.airFlow);
    this.hissG.ramp(
      L * (0.55 * Math.min(1.5, exhaust) ** 0.8 + 0.12 * Math.min(1.5, supply)),
      t,
    );
    this.hissF.ramp(4200 + 2400 * Math.min(1, exhaust), t);
    const moving = smoothstep(0.03, 0.6, v);
    this.scrapeF.ramp(1300 + 70 * v, t);
    this.scrapeG.ramp(
      L * 0.35 * p * moving * (0.35 + 0.65 * smoothstep(0, 12, v)),
      t,
    );
    this.grindG.ramp(
      L * 0.5 * p * moving * (0.5 + 0.5 * smoothstep(0, 6, v)),
      t,
    );
    // Stick-slip groan near the stop, rough pitch that falls with speed.
    const g = L * 0.32 * p * bell(v, 0.9, 0.85) * moving;
    const wobble = 1 + (this.rand() - 0.5) * 0.08;
    this.groanF.ramp((46 + 38 * v) * wobble, t);
    this.groanG.ramp(g, t);
    this.judderF.ramp(6 + 5 * v + this.rand() * 2, t);
    this.judderD.ramp(g * 0.7, t);
  }
}
