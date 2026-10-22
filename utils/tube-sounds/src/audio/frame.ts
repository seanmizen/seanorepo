// The control state of one car for one control tick. The train fills it,
// and every voice reads it. Voices never read the train directly.

export interface CarFrame {
  /** Audio-context time of this frame, s. */
  time: number;
  /** Time since the previous frame, s. */
  dt: number;
  speed: number;
  accel: number;
  /** Wheel revolutions per second (this car's wheel diameter). */
  wheelHz: number;
  /** Motor revolutions per second. */
  motorHz: number;
  /** Gear tooth mesh frequency, Hz. */
  meshHz: number;
  throttle: number;
  brake: number;
  /** Motor torque, -1..1. Negative = electric braking. */
  load: number;
  /** DC motor current, per unit, signed. 0 for VVVF. */
  current: number;
  /** Friction brake cylinder pressure, 0..1. */
  cylinder: number;
  /** Rate of change of cylinder pressure, 1/s. */
  airFlow: number;
  /** Curve tightness at this car, 0..1. */
  curvature: number;
}

/** A sound component of one car. */
export interface Voice {
  readonly output: AudioNode;
  update(f: CarFrame): void;
}
