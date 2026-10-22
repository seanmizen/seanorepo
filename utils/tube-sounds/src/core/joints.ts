// Rail-joint timing. Each axle strikes a joint when its track position
// crosses a multiple of the rail length. Two axles per bogie, about 2 m
// apart, give the "di-dum". The next bogie, 10-12 m back, gives the
// "di-dum" after it. The rate follows speed exactly.

export interface JointHit {
  /** Seconds after the window start. */
  time: number;
  /** Axle index from the front of the train. */
  axle: number;
  /** Joint index along the track. A caller can skip joints it already played. */
  joint: number;
}

/**
 * Time for a body at speed v and constant acceleration a to travel d metres.
 * Returns Infinity when the body stops first. The form avoids the
 * cancellation in the textbook quadratic formula when a is small.
 */
export const timeToTravel = (d: number, v: number, a: number): number => {
  if (d <= 0) return 0;
  const disc = v * v + 2 * a * d;
  if (disc < 0) return Number.POSITIVE_INFINITY;
  const denom = v + Math.sqrt(disc);
  return denom <= 0 ? Number.POSITIVE_INFINITY : (2 * d) / denom;
};

/**
 * Every joint hit in the window [0, window) seconds.
 *
 * @param axleX track position of each axle at the window start, metres
 * @param v train speed at the window start, m/s (direction +x)
 * @param a train acceleration, m/s^2
 * @param railLength distance between joints, metres
 * @param phase track position of one joint, metres
 */
export const jointHits = (
  axleX: readonly number[],
  v: number,
  a: number,
  window: number,
  railLength: number,
  phase = 0,
): JointHit[] => {
  const hits: JointHit[] = [];
  if (railLength <= 0 || window <= 0) return hits;
  // The furthest any axle can travel in the window.
  const reach = Math.max(0, v * window + 0.5 * Math.max(a, 0) * window ** 2);
  axleX.forEach((x0, axle) => {
    // First joint strictly ahead of the axle.
    let k = Math.floor((x0 - phase) / railLength) + 1;
    for (;;) {
      const d = phase + k * railLength - x0;
      if (d > reach + 1e-9) break;
      const t = timeToTravel(d, v, a);
      if (t >= window) break;
      hits.push({ time: t, axle, joint: k });
      k++;
    }
  });
  return hits.sort((p, q) => p.time - q.time);
};
