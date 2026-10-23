// AudioParam automation for a control loop that runs ahead of the audio
// clock. Each control tick appends one point. Linear ramps join the points,
// so a frequency glides smoothly between ticks. A jump sets the value at
// once: an inverter that changes pulse mode, for example.

export class Track {
  private last = -1;

  constructor(
    readonly param: AudioParam,
    initial: number,
    time: number,
  ) {
    param.setValueAtTime(initial, time);
    this.last = time;
  }

  /** Ramp linearly from the previous point to `value` at `time`. */
  ramp(value: number, time: number): void {
    if (!Number.isFinite(value)) return;
    if (time <= this.last + 1e-5) return;
    this.param.linearRampToValueAtTime(value, time);
    this.last = time;
  }

  /** Hold the previous value until `time`, then change to `value` at once. */
  jump(value: number, time: number): void {
    if (!Number.isFinite(value)) return;
    const t = Math.max(time, this.last + 1e-5);
    this.param.setValueAtTime(value, t);
    this.last = t;
  }
}

export const gainNode = (ctx: BaseAudioContext, value = 0): GainNode => {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
};

/**
 * Move a gain to `value`, from now, with a 50 ms time constant. For live
 * faders. The control loop uses Track instead.
 */
export const fadeGain = (g: GainNode, value: number): void => {
  g.gain.setTargetAtTime(value, g.context.currentTime, 0.05);
};

export const biquad = (
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
  q = Math.SQRT1_2,
): BiquadFilterNode => {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  return f;
};

export const oscillator = (
  ctx: BaseAudioContext,
  type: OscillatorType,
  frequency: number,
): OscillatorNode => {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = frequency;
  return o;
};
