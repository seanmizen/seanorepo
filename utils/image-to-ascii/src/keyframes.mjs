// keyframes.mjs: the value of each animated setting at each frame.
//
// A track is one setting's keyframes, as [frame, value] pairs. Before the
// first keyframe the value holds at the first value. After the last keyframe
// it holds at the last value. Between two keyframes it moves by the easing.

export const EASINGS = {
  linear: (t) => t,
  // Smoothstep: slow out of one keyframe and slow into the next.
  smooth: (t) => t * t * (3 - 2 * t),
};

/**
 * Parses "0:100,20:250,40:80" into [[0, 100], [20, 250], [40, 80]], sorted by
 * frame. Throws on a malformed pair or a frame used twice.
 */
export const parseTrack = (text) => {
  const pairs = String(text)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [f, v] = part.split(':').map(Number);
      if (!Number.isInteger(f) || f < 0 || !Number.isFinite(v)) {
        throw new Error(`bad keyframe "${part}": use frame:value, e.g. 20:250`);
      }
      return [f, v];
    });
  return normaliseTrack(pairs);
};

/** Accepts {"0": 100, "20": 250} or [[0, 100], [20, 250]]. */
export const trackFromJson = (json) =>
  normaliseTrack(
    Array.isArray(json)
      ? json.map(([f, v]) => [Number(f), Number(v)])
      : Object.entries(json).map(([f, v]) => [Number(f), Number(v)]),
  );

const normaliseTrack = (pairs) => {
  if (pairs.length === 0)
    throw new Error('a track needs at least one keyframe');
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][0] === sorted[i - 1][0]) {
      throw new Error(`frame ${sorted[i][0]} has two keyframes`);
    }
  }
  return sorted;
};

/** The value of a track at a frame. */
export const valueAt = (track, frame, ease = EASINGS.linear) => {
  if (frame <= track[0][0]) return track[0][1];
  const last = track[track.length - 1];
  if (frame >= last[0]) return last[1];
  let i = 1;
  while (track[i][0] < frame) i++;
  const [f0, v0] = track[i - 1];
  const [f1, v1] = track[i];
  return v0 + (v1 - v0) * ease((frame - f0) / (f1 - f0));
};

/** The frame count that shows every keyframe: the last keyframe plus one. */
export const frameCount = (tracks) =>
  Math.max(1, ...Object.values(tracks).map((t) => t[t.length - 1][0] + 1));
