// Sample-by-sample filters for offline buffer synthesis. The formulas are
// the RBJ Audio EQ Cookbook biquads, the same ones that BiquadFilterNode
// uses, so a buffer made here matches a live node graph.

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking';

export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    type: BiquadType,
    freq: number,
    q: number,
    sampleRate: number,
    gainDb = 0,
  ) {
    this.set(type, freq, q, sampleRate, gainDb);
  }

  set(
    type: BiquadType,
    freq: number,
    q: number,
    sampleRate: number,
    gainDb = 0,
  ): void {
    const w = (2 * Math.PI * Math.min(freq, sampleRate * 0.49)) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number;
    let b1: number;
    let b2: number;
    let a0: number;
    let a1: number;
    let a2: number;
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else if (type === 'highpass') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else if (type === 'bandpass') {
      // Constant 0 dB peak gain.
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else {
      const A = 10 ** (gainDb / 40);
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(x: number): number {
    const y =
      this.b0 * x +
      this.b1 * this.x1 +
      this.b2 * this.x2 -
      this.a1 * this.y1 -
      this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Filter a whole buffer in place. Returns the same buffer. */
export const filterBuffer = (buf: Float32Array, f: Biquad): Float32Array => {
  for (let i = 0; i < buf.length; i++) buf[i] = f.process(buf[i] ?? 0);
  return buf;
};

/** One-pole low-pass coefficient for a time constant in seconds. */
export const onePoleCoeff = (tau: number, sampleRate: number): number =>
  1 - Math.exp(-1 / (Math.max(tau, 1e-6) * sampleRate));
