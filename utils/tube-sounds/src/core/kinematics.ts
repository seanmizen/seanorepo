// Train motion: scripted speed profiles and a simple dynamics model.
//
// A profile is a cubic Hermite curve for speed v(t) over [0, T]. The four
// boundary values (start and end speed, start and end acceleration) fix it.
// The scripted arrival and departure solve one of them so that the train
// covers an exact distance in an exact time.

import { clamp } from './math';

export interface MotionProfile {
  duration: number;
  /** Speed at time t (s from profile start), m/s. Clamped to [0, duration]. */
  speedAt(t: number): number;
  /** Acceleration at time t, m/s^2. Negative while braking. */
  accelAt(t: number): number;
  /** Distance travelled from the profile start at time t, metres. */
  distanceAt(t: number): number;
}

/** Hermite speed profile from (v0, a0) to (v1, a1) over T seconds. */
export const hermiteProfile = (
  v0: number,
  v1: number,
  a0: number,
  a1: number,
  T: number,
): MotionProfile => {
  const m0 = a0 * T;
  const m1 = a1 * T;
  const u = (t: number) => clamp(t / T, 0, 1);
  const speedAt = (t: number) => {
    const x = u(t);
    const x2 = x * x;
    const x3 = x2 * x;
    return (
      (2 * x3 - 3 * x2 + 1) * v0 +
      (x3 - 2 * x2 + x) * m0 +
      (-2 * x3 + 3 * x2) * v1 +
      (x3 - x2) * m1
    );
  };
  const accelAt = (t: number) => {
    if (t < 0 || t > T) return 0;
    const x = u(t);
    const x2 = x * x;
    return (
      ((6 * x2 - 6 * x) * v0 +
        (3 * x2 - 4 * x + 1) * m0 +
        (-6 * x2 + 6 * x) * v1 +
        (3 * x2 - 2 * x) * m1) /
      T
    );
  };
  const area = (x: number) => {
    const x2 = x * x;
    const x3 = x2 * x;
    const x4 = x3 * x;
    return (
      (x4 / 2 - x3 + x) * v0 +
      (x4 / 4 - (2 * x3) / 3 + x2 / 2) * m0 +
      (-x4 / 2 + x3) * v1 +
      (x4 / 4 - x3 / 3) * m1
    );
  };
  const distanceAt = (t: number) => {
    if (t <= 0) return 0;
    if (t >= T) return area(1) * T + (t - T) * v1;
    return area(u(t)) * T;
  };
  return { duration: T, speedAt, accelAt, distanceAt };
};

/**
 * Braking profile: from speed v0 to a stop in exactly `distance` metres and
 * `duration` seconds. The brake builds from zero deceleration (the brake
 * cylinders take time to fill), so a train that must cover more than
 * v0*T/2 brakes hardest near the end. That is how a tube driver brakes
 * into a platform.
 */
export const brakingProfile = (
  v0: number,
  distance: number,
  duration: number,
): MotionProfile => {
  let a0 = 0;
  let m1 = 6 * v0 - (12 * distance) / duration;
  if (m1 > 0) {
    // A short stop: start braking at once and end with zero deceleration.
    m1 = 0;
    a0 = ((12 * distance) / duration - 6 * v0) / duration;
  }
  return hermiteProfile(v0, 0, a0, m1 / duration, duration);
};

/**
 * Departure profile: from a stand, covering `distance` metres in `duration`
 * seconds. The train starts at `startAccel` and ends at constant speed.
 */
export const departureProfile = (
  distance: number,
  duration: number,
  startAccel = 0.8,
): MotionProfile => {
  const m0 = startAccel * duration;
  const v1 = Math.max(0, (2 * distance) / duration - m0 / 6);
  return hermiteProfile(0, v1, startAccel, 0, duration);
};

// ---------------------------------------------------------------------------
// Free-running dynamics. In this mode the throttle and brake set force, and
// the train chooses its own speed. The response has lag, as on a real train.

export interface DynamicsParams {
  maxAccel: number;
  serviceDecel: number;
  maxSpeed: number;
}

/** Davis resistance as deceleration: rolling + bearing + aerodynamic, m/s^2. */
export const resistanceDecel = (v: number): number =>
  v <= 0 ? 0 : 0.012 + 0.0009 * v + 0.00035 * v * v;

/**
 * Acceleration from throttle and brake, m/s^2. Tractive effort is constant
 * up to the base speed, then falls as 1/v (constant power).
 */
export const dynamicsAccel = (
  v: number,
  throttle: number,
  brake: number,
  p: DynamicsParams,
): number => {
  const base = p.maxSpeed * 0.45;
  const tractive =
    throttle * p.maxAccel * (v < base ? 1 : base / Math.max(v, 0.1));
  const braking = v > 0 ? brake * p.serviceDecel : 0;
  return tractive - braking - resistanceDecel(v);
};

/** One explicit Euler step of the dynamics. Speed never goes negative. */
export const stepDynamics = (
  v: number,
  throttle: number,
  brake: number,
  p: DynamicsParams,
  dt: number,
): number => Math.max(0, v + dynamicsAccel(v, throttle, brake, p) * dt);
