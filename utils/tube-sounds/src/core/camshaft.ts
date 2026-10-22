// DC camshaft traction control, as on the 1973 Stock (GEC pneumatic single
// camshaft, Brush LT118 series DC motors).
//
// The model is per-unit. Line voltage = 1, full-field back EMF at
// `fullSpeed` = 1, current-limit relay setting = 1. It is simple, but the
// sound comes from it in the same way that engine-sim takes its sound from
// the exhaust pressure:
//
// 1. A starting resistance limits the motor current.
// 2. As the train speeds up, back EMF rises and the current falls.
// 3. When the current falls below the relay setting, the camshaft turns one
//    notch. It cuts out resistance, and the current jumps up again.
//
// The result is the sawtooth surge in motor load and the click of each notch
// that a 1973 Stock train makes when it pulls away. Series notches come
// first, then transition to parallel, then weak field. In rheostatic braking
// the motors act as generators into the resistors. The camshaft notches
// resistance out as speed falls, until the electric brake fades.

import { clamp } from './math';

export type CamMode = 'off' | 'power' | 'brake';

export type CamEventKind =
  | 'line-on' // line contactors close
  | 'notch' // camshaft steps one notch
  | 'transition' // series to parallel changeover
  | 'runback' // camshaft runs back to the start position
  | 'line-off'; // line contactors open

export interface CamEvent {
  kind: CamEventKind;
  /** For 'runback': how many notches the camshaft passes. */
  count?: number;
}

/** Series resistance notches, per unit. The last one is full series. */
const SERIES_R = [0.78, 0.55, 0.4, 0.29, 0.21, 0.15, 0.1, 0.06, 0.03, 0];
/** Parallel resistance notches, per unit. The last one is full parallel. */
const PARALLEL_R = [0.45, 0.32, 0.23, 0.16, 0.11, 0.07, 0.04, 0];
/** Weak-field steps: field strength as a fraction of full field. */
const WEAK_FIELD = [0.93, 0.87, 0.81, 0.75];
/** Rheostatic brake resistance notches, per unit. */
const BRAKE_R = [1.2, 0.9, 0.68, 0.5, 0.37, 0.27, 0.2, 0.14, 0.1, 0.07, 0.05];
/** Armature, field and cable resistance, per unit. */
const ARMATURE_R = 0.12;

export const POWER_NOTCHES =
  SERIES_R.length + PARALLEL_R.length + WEAK_FIELD.length;
export const FULL_SERIES = SERIES_R.length - 1;
export const FULL_PARALLEL = SERIES_R.length + PARALLEL_R.length - 1;

export interface NotchCircuit {
  /** Fraction of line voltage across each motor group. */
  voltage: number;
  resistance: number;
  field: number;
}

/** The circuit at power notch n (0-based). */
export const powerCircuit = (n: number): NotchCircuit => {
  if (n < SERIES_R.length) {
    return { voltage: 0.5, resistance: SERIES_R[n] ?? 0, field: 1 };
  }
  const p = n - SERIES_R.length;
  if (p < PARALLEL_R.length) {
    return { voltage: 1, resistance: PARALLEL_R[p] ?? 0, field: 1 };
  }
  const w = p - PARALLEL_R.length;
  return { voltage: 1, resistance: 0, field: WEAK_FIELD[w] ?? 0.75 };
};

/** Motor current in power, per unit. Never negative (the diodes block). */
export const powerCurrent = (n: number, emf: number): number => {
  const c = powerCircuit(n);
  return Math.max(0, (c.voltage - c.field * emf) / (c.resistance + ARMATURE_R));
};

/** Generator current in rheostatic braking at brake notch n, per unit. */
export const brakeCurrent = (n: number, emf: number): number =>
  emf / ((BRAKE_R[n] ?? 0.05) + ARMATURE_R);

/** The highest notch the master controller allows at a throttle setting. */
export const maxNotchFor = (throttle: number): number => {
  if (throttle < 0.05) return -1; // off
  if (throttle < 0.34) return 0; // shunt
  if (throttle < 0.67) return FULL_SERIES; // series
  if (throttle < 0.97) return FULL_PARALLEL; // parallel
  return POWER_NOTCHES - 1; // weak field
};

export interface CamshaftState {
  mode: CamMode;
  notch: number;
  /** Signed motor current, per unit. Positive in power, negative in braking. */
  current: number;
  /** Field strength, 0..1. */
  field: number;
  /** Fraction of the brake demand that the electric brake supplies, 0..1. */
  electricBrakeShare: number;
}

export interface CamshaftOptions {
  /** Speed at which full-field back EMF equals line voltage, m/s. */
  fullSpeed: number;
  /** Shortest time between notches, s. The pneumatic cam needs this long. */
  stepTime?: number;
  /** Below this speed the rheostatic brake cannot hold its current, m/s. */
  brakeFade?: number;
}

export class Camshaft {
  readonly fullSpeed: number;
  readonly stepTime: number;
  readonly brakeFade: number;
  state: CamshaftState = {
    mode: 'off',
    notch: -1,
    current: 0,
    field: 1,
    electricBrakeShare: 0,
  };
  private sinceStep = 1;

  constructor(opts: CamshaftOptions) {
    this.fullSpeed = opts.fullSpeed;
    this.stepTime = opts.stepTime ?? 0.22;
    this.brakeFade = opts.brakeFade ?? 3.5;
  }

  /** Advance the controller by dt seconds. Returns the events in the step. */
  step(dt: number, speed: number, throttle: number, brake: number): CamEvent[] {
    const events: CamEvent[] = [];
    const s = this.state;
    const emf = Math.max(0, speed) / this.fullSpeed;
    this.sinceStep += dt;

    const wantPower = throttle >= 0.05 && brake < 0.05;
    const wantBrake = brake >= 0.05 && speed > this.brakeFade * 0.5;

    if (s.mode === 'power' && !wantPower) {
      if (s.notch > 0) events.push({ kind: 'runback', count: s.notch });
      events.push({ kind: 'line-off' });
      this.reset();
    } else if (s.mode === 'brake' && !wantBrake) {
      if (s.notch > 0) events.push({ kind: 'runback', count: s.notch });
      events.push({ kind: 'line-off' });
      this.reset();
    }

    if (s.mode === 'off' && wantPower) {
      events.push({ kind: 'line-on' });
      s.mode = 'power';
      s.notch = 0;
      this.sinceStep = 0;
    } else if (s.mode === 'off' && wantBrake) {
      events.push({ kind: 'line-on' });
      s.mode = 'brake';
      s.notch = 0;
      this.sinceStep = 0;
    }

    if (s.mode === 'power') {
      const limit = maxNotchFor(throttle);
      if (s.notch > limit) {
        // The driver eased the controller back: the cam runs back.
        events.push({ kind: 'runback', count: s.notch - limit });
        s.notch = limit;
      }
      // Current-limit relay. A light throttle sets a lower current.
      const relay = 0.55 + 0.4 * throttle;
      let i = powerCurrent(s.notch, emf);
      if (i < relay && s.notch < limit && this.sinceStep >= this.stepTime) {
        s.notch++;
        this.sinceStep = 0;
        events.push({
          kind: s.notch === FULL_SERIES + 1 ? 'transition' : 'notch',
        });
        i = powerCurrent(s.notch, emf);
      }
      s.current = i;
      s.field = powerCircuit(s.notch).field;
      s.electricBrakeShare = 0;
    } else if (s.mode === 'brake') {
      const target = 0.25 + 0.85 * brake;
      let i = brakeCurrent(s.notch, emf);
      if (
        i < target * 0.88 &&
        s.notch < BRAKE_R.length - 1 &&
        this.sinceStep >= this.stepTime
      ) {
        s.notch++;
        this.sinceStep = 0;
        events.push({ kind: 'notch' });
        i = brakeCurrent(s.notch, emf);
      }
      // The brake controller weakens the field when the current is too high.
      const held = Math.min(i, target * 1.1);
      s.current = -held;
      s.field = 1;
      s.electricBrakeShare = clamp(held / target, 0, 1);
    } else {
      s.current = 0;
      s.electricBrakeShare = 0;
    }
    return events;
  }

  /**
   * Put the controller in the steady state for a train that already runs
   * at `speed` with `throttle`. No events. Use it when a script starts with
   * the train in motion, so the camshaft does not notch up from zero.
   */
  prime(speed: number, throttle: number): void {
    const limit = maxNotchFor(throttle);
    this.reset();
    if (limit < 0) return;
    const emf = Math.max(0, speed) / this.fullSpeed;
    const relay = 0.55 + 0.4 * throttle;
    let n = 0;
    while (n < limit && powerCurrent(n, emf) < relay) n++;
    this.state.mode = 'power';
    this.state.notch = n;
    this.state.current = powerCurrent(n, emf);
    this.state.field = powerCircuit(n).field;
    this.sinceStep = this.stepTime;
  }

  private reset(): void {
    this.state.mode = 'off';
    this.state.notch = -1;
    this.state.current = 0;
    this.state.field = 1;
    this.state.electricBrakeShare = 0;
    this.sinceStep = 0;
  }
}
