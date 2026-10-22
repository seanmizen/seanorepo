// Sound paths from a point on the track to the listener on the platform.
//
// The track runs along x. The train travels towards +x. The platform runs
// from `platformStart` to `platformStart + platformLength`, with a tunnel
// mouth at each end. The listener stands on the platform at `listener.x`,
// `listener.lateral` metres from the track centre line.
//
// - In the station, the path is a straight line. Gain falls as 1/r.
// - In a tunnel, the tunnel is a waveguide. Sound travels along it with little
//   spreading loss, but the walls absorb high frequencies. The sound reaches
//   the listener from the mouth. This is why a deep-tube train is audible
//   as a low rumble long before it arrives.
//
// The path length also sets a propagation delay. When the delay changes,
// the pitch changes. This is the Doppler shift, without a separate model.

import { clamp, SPEED_OF_SOUND, smoothstep } from './math';

export interface Listener {
  x: number;
  lateral: number;
}

export interface StationGeometry {
  platformStart: number;
  platformLength: number;
  listener: Listener;
}

export const DEFAULT_GEOMETRY: StationGeometry = {
  platformStart: 0,
  platformLength: 125,
  listener: { x: 55, lateral: 3.2 },
};

export interface SourcePath {
  /** Total path length, metres. */
  length: number;
  /** Propagation delay, seconds. */
  delay: number;
  /** Linear gain. 1 at the reference distance (5 m). */
  gain: number;
  /** Low-pass cutoff for air and tunnel absorption, Hz. */
  cutoff: number;
  /** Stereo pan, -1 (left) to 1 (right). The track +x is to the right. */
  pan: number;
  /** Depth into a tunnel, metres. 0 in the station. */
  tunnelDepth: number;
  /** Send level to the tunnel reverb, 0..1. */
  tunnelSend: number;
  /** Send level to the station reverb, 0..1. */
  stationSend: number;
}

const REF_DISTANCE = 5;

export const sourcePath = (x: number, g: StationGeometry): SourcePath => {
  const start = g.platformStart;
  const end = g.platformStart + g.platformLength;
  const depth = Math.max(0, start - x, x - end);
  // In a tunnel the sound leaves the mouth: put the source there.
  const apparentX = clamp(x, start, end);
  const dx = apparentX - g.listener.x;
  const direct = Math.hypot(dx, g.listener.lateral);
  const length = direct + depth;

  let gain = REF_DISTANCE / Math.max(direct, 1);
  if (depth > 0) {
    // Waveguide: weak spreading, plus wall absorption of 1.5 dB per 100 m.
    gain *= (1 + depth / 40) ** -0.5 * 10 ** ((-0.015 * depth) / 20);
  }
  const air = 18000 / (1 + direct / 400);
  const cutoff = depth > 0 ? Math.min(air, 14000 / (1 + depth / 14)) : air;

  return {
    length,
    delay: length / SPEED_OF_SOUND,
    gain: Math.min(gain, 2.5),
    cutoff: Math.max(cutoff, 120),
    pan: clamp((dx / Math.max(direct, 0.001)) * 0.85, -1, 1),
    tunnelDepth: depth,
    // The tunnel reverb is the tunnel itself ringing. It falls with depth,
    // but more slowly than the direct sound, so a deep source is mostly boom.
    tunnelSend:
      (smoothstep(0, 40, depth) *
        Math.sqrt(REF_DISTANCE / Math.max(direct, 1))) /
      (1 + depth / 60),
    stationSend: (1 - smoothstep(20, 160, depth)) / (1 + direct / 50),
  };
};

/**
 * Move a delay towards its target with a limited rate (s per s). A jump in
 * position (a slider drag, a teleport) then makes a bounded pitch glide,
 * not a glitch. maxRate 0.15 allows radial speeds up to about 50 m/s.
 */
export const slewDelay = (
  current: number,
  target: number,
  dt: number,
  maxRate = 0.15,
): number => {
  const step = maxRate * dt;
  return current + clamp(target - current, -step, step);
};

/**
 * Pitch ratio that a delay line produces while its delay changes at rate
 * dDelay/dt. Approaching sources (delay falling) sound higher.
 */
export const dopplerRatio = (delayRate: number): number => 1 - delayRate;
