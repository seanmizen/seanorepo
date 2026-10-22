// Air system: brake cylinders, main reservoir and the compressor governor.
//
// The hiss of a brake is air that flows. The model tracks the brake
// cylinder pressure, and the sound reads the flow (the rate of change):
//
// - Pressure rises: air flows in from the reservoir. This gives a soft hiss.
// - Pressure falls: air exhausts to the atmosphere. This gives the loud
//   "pssh" of brake release.
//
// Brake applications and door movements use air from the main reservoir.
// When the reservoir falls to the cut-in pressure, the compressor starts.
// It stops at the cut-out pressure, and the unloader valve blows off.

import { clamp } from './math';

/** The brake cylinders of one car. */
export class BrakeCylinder {
  /** Pressure, 0..1 of full service. */
  pressure = 0;
  /** Rate of change of pressure, 1/s. */
  flow = 0;

  constructor(
    /** Fill time constant, s. */
    readonly applyTau = 0.55,
    /** Exhaust time constant, s. */
    readonly releaseTau = 0.8,
  ) {}

  /** Move towards `demand`. Returns the air drawn from the reservoir. */
  step(dt: number, demand: number): number {
    const target = clamp(demand, 0, 1);
    const tau = target > this.pressure ? this.applyTau : this.releaseTau;
    const next =
      this.pressure + (target - this.pressure) * (1 - Math.exp(-dt / tau));
    this.flow = dt > 0 ? (next - this.pressure) / dt : 0;
    const used = Math.max(0, next - this.pressure);
    this.pressure = next;
    return used;
  }
}

export type ReservoirEvent = 'compressor-start' | 'compressor-stop';

export interface ReservoirOptions {
  /** Pressure at the start, 0..1 (1 = cut-out). */
  pressure?: number;
  cutIn?: number;
  /** Pressure gain per second while the compressor runs. */
  compressorRate?: number;
  /** Reservoir fraction used by one full cylinder fill on every car. */
  brakeUse?: number;
}

/** The train's main reservoir and compressor governor. */
export class Reservoir {
  pressure: number;
  compressorOn = false;
  readonly cutIn: number;
  readonly compressorRate: number;
  readonly brakeUse: number;

  constructor(opts: ReservoirOptions = {}) {
    this.pressure = opts.pressure ?? 0.86;
    this.cutIn = opts.cutIn ?? 0.82;
    this.compressorRate = opts.compressorRate ?? 0.012;
    this.brakeUse = opts.brakeUse ?? 0.04;
  }

  /** Air for `doors` door operations. */
  useDoors(doors: number): void {
    this.pressure = clamp(this.pressure - 0.0012 * doors, 0, 1);
  }

  /**
   * @param used mean cylinder fill this step over all cars (sum of the
   *   values from BrakeCylinder.step, divided by the car count)
   */
  step(dt: number, used: number): ReservoirEvent[] {
    const events: ReservoirEvent[] = [];
    this.pressure -= used * this.brakeUse;
    if (this.compressorOn) {
      this.pressure += this.compressorRate * dt;
      if (this.pressure >= 1) {
        this.pressure = 1;
        this.compressorOn = false;
        events.push('compressor-stop');
      }
    } else if (this.pressure < this.cutIn) {
      this.compressorOn = true;
      events.push('compressor-start');
    }
    this.pressure = clamp(this.pressure, 0, 1);
    return events;
  }
}
