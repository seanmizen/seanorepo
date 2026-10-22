// The air compressor under a car. A two-cylinder reciprocating compressor
// thumps once per stroke. When it starts, the motor runs up and the strokes
// speed up to their running rate. When the governor cuts out, the unloader
// valve blows off.
//
// The strokes are events, scheduled ahead like rail joints. The motor hum is
// continuous.

import { mulberry32 } from '../core/math';
import { biquad, gainNode, oscillator, Track } from './automation';
import { pick, playBuffer, type SoundBank } from './bank';

export interface CompressorOptions {
  /** Strokes per second at running speed. */
  strokeRate: number;
  level: number;
  seed: number;
}

export class CompressorVoice {
  readonly output: GainNode;
  private readonly humF: Track;
  private readonly humG: Track;
  private nextStroke = Number.POSITIVE_INFINITY;
  private runTime = 0;
  private running = false;
  private stopTime = 0;
  private readonly rand: () => number;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly bank: SoundBank,
    private readonly opts: CompressorOptions,
  ) {
    const t = ctx.currentTime;
    this.rand = mulberry32(opts.seed);
    this.output = gainNode(ctx, 1);
    const hum = oscillator(ctx, 'sawtooth', 50);
    const lp = biquad(ctx, 'lowpass', 400, 1);
    const g = gainNode(ctx);
    hum.connect(lp).connect(g).connect(this.output);
    this.humF = new Track(hum.frequency, 50, t);
    this.humG = new Track(g.gain, 0, t);
    hum.start(t);
  }

  start(time: number): void {
    this.running = true;
    this.runTime = 0;
    this.nextStroke = time + 0.25;
  }

  stop(time: number): void {
    if (!this.running) return;
    this.running = false;
    this.stopTime = time;
    playBuffer(
      this.ctx,
      pick(this.bank.blowoff, this.rand),
      this.output,
      time + 0.1,
      this.opts.level * 0.5,
    );
  }

  /** Schedule strokes up to `until`, and set the hum for time `time`. */
  update(time: number, dt: number, until: number): void {
    const L = this.opts.level;
    if (this.running) this.runTime += dt;
    // Run-up takes 1.5 s. Run-down takes 1 s after the stop.
    const up = this.running
      ? Math.min(1, this.runTime / 1.5)
      : Math.max(0, 1 - (time - this.stopTime) / 1);
    const rate = this.opts.strokeRate * (0.35 + 0.65 * up);
    this.humF.ramp(28 + 22 * up, time);
    this.humG.ramp(L * 0.08 * up, time);
    if (up <= 0) {
      this.nextStroke = Number.POSITIVE_INFINITY;
      return;
    }
    while (this.nextStroke < until) {
      playBuffer(
        this.ctx,
        pick(this.bank.stroke, this.rand),
        this.output,
        this.nextStroke,
        L * (0.5 + 0.5 * up) * (0.85 + this.rand() * 0.3),
        0.95 + this.rand() * 0.1,
      );
      this.nextStroke += 1 / Math.max(rate, 0.5);
    }
  }
}
