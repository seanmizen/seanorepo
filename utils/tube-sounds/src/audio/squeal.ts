// Flange and curve squeal. On a tight curve the wheels slip sideways across
// the rail head. The friction locks onto a bending mode of the wheel web
// (1-5 kHz for a 750 mm wheel). The pitch is unstable: it wavers, and it
// jumps between modes, and the sound comes and goes in bursts.
//
// The model: two oscillators at two wheel modes. A random walk moves the
// pitch. A random on/off process (a telegraph process) gates the
// amplitude. A fast vibrato adds the rasp of the stick-slip cycle.

import { smoothstep } from '../core/math';
import { gainNode, oscillator, Track } from './automation';
import type { CarFrame, Voice } from './frame';

/** Wheel web modes, Hz. A worn wheel rings a little lower. */
const MODES = [1180, 2140, 3290, 4410];

export class SquealVoice implements Voice {
  readonly output: GainNode;
  private readonly aF: Track;
  private readonly aG: Track;
  private readonly bF: Track;
  private readonly bG: Track;
  private readonly vibD: Track;
  private mode = 0;
  private walk = 0;
  private burst = 0;
  private gate = false;

  constructor(
    ctx: BaseAudioContext,
    private readonly level: number,
    private readonly rand: () => number,
    /** How prone this car is to squeal, 0..1. */
    private readonly propensity: number,
  ) {
    const t = ctx.currentTime;
    this.output = gainNode(ctx, 1);
    const a = oscillator(ctx, 'sine', 2000);
    const aG = gainNode(ctx);
    const b = oscillator(ctx, 'triangle', 4000);
    const bG = gainNode(ctx);
    const vib = oscillator(ctx, 'sine', 37);
    const vibD = gainNode(ctx);
    vib.connect(vibD);
    vibD.connect(a.frequency);
    vibD.connect(b.frequency);
    a.connect(aG).connect(this.output);
    b.connect(bG).connect(this.output);
    this.aF = new Track(a.frequency, 2000, t);
    this.aG = new Track(aG.gain, 0, t);
    this.bF = new Track(b.frequency, 4000, t);
    this.bG = new Track(bG.gain, 0, t);
    this.vibD = new Track(vibD.gain, 0, t);
    this.mode = Math.floor(rand() * MODES.length);
    for (const o of [a, b, vib]) o.start(t);
  }

  update(f: CarFrame): void {
    const t = f.time;
    const dt = f.dt;
    const v = f.speed;
    const drive =
      f.curvature *
      this.propensity *
      smoothstep(1.5, 6, v) *
      (1 - 0.6 * smoothstep(16, 26, v));
    // Telegraph process: switch on and off at random. More drive = more on.
    const rate = this.gate ? 0.9 * (1.2 - drive) : 2.5 * drive;
    if (this.rand() < rate * dt) this.gate = !this.gate;
    const target = this.gate ? drive : 0;
    this.burst += (target - this.burst) * Math.min(1, dt / 0.12);
    // Mode hop, now and then.
    if (this.rand() < 0.25 * dt) {
      this.mode =
        (this.mode + (this.rand() < 0.5 ? 1 : MODES.length - 1)) % MODES.length;
    }
    this.walk += (this.rand() - 0.5) * dt * 0.06;
    this.walk *= 0.995;
    const base = (MODES[this.mode] ?? 2000) * (1 + this.walk);
    const jumpTone = this.rand() < 0.25 * dt;
    if (jumpTone) this.aF.jump(base, t);
    else this.aF.ramp(base, t);
    this.bF.ramp(base * 1.97, t);
    const g = this.level * this.burst;
    this.aG.ramp(g * 0.22, t);
    this.bG.ramp(g * 0.05, t);
    this.vibD.ramp(base * 0.004 * this.burst, t);
  }
}
