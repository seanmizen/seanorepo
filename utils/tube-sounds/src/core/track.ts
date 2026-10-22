// Track layout: where the rail joints and curves are. Positions use the
// same x axis as the station geometry (the platform starts at 0).

import { clamp, smoothstep } from './math';

export interface Curve {
  from: number;
  to: number;
  /** Curve tightness, 0..1. 1 = the tightest curve on the line. */
  amount: number;
}

export interface TrackLayout {
  /** Distance between rail joints, metres. 0 = continuous welded rail. */
  railLength: number;
  /** Track position of one joint, metres. */
  jointPhase: number;
  curves: Curve[];
  /** Rail corrugation depth, 0..1. Corrugated rail "roars" at v / wavelength. */
  corrugation: number;
  /** Corrugation wavelength, metres. Typical tube values are 4-8 cm. */
  corrugationWavelength: number;
}

/**
 * Deep-tube defaults. Bullhead rail in 60 ft (18.288 m) lengths with square
 * joints. A tight curve in the tunnel before the platform, and a gentle one
 * after it.
 */
export const DEFAULT_TRACK: TrackLayout = {
  railLength: 18.288,
  jointPhase: 3.1,
  curves: [
    { from: -420, to: -140, amount: 0.8 },
    { from: 230, to: 520, amount: 0.45 },
  ],
  corrugation: 0.35,
  corrugationWavelength: 0.055,
};

/** Curve amount at track position x, with 15 m transition spirals. */
export const curvatureAt = (x: number, track: TrackLayout): number => {
  let k = 0;
  for (const c of track.curves) {
    const inside =
      smoothstep(c.from - 15, c.from + 15, x) *
      (1 - smoothstep(c.to - 15, c.to + 15, x));
    k = Math.max(k, inside * c.amount);
  }
  return clamp(k, 0, 1);
};
