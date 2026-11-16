// The timelapse settings, the choices for each setting, and the estimate of
// the output.

export type StopMode = 'hand' | 'frames' | 'duration';

export type Settings = {
  /** The time between two frames, in seconds. */
  intervalS: number;
  stop: StopMode;
  /** The frame count that stops the capture, when `stop` is 'frames'. */
  stopFrames: number;
  /** The capture time that stops the capture, when `stop` is 'duration'. */
  stopDurationS: number;
  /** The frame rate of the playback and of the video file. */
  fps: number;
  /** The camera that the user selected. An empty string is the default camera. */
  cameraId: string;
};

// The interval choices: tidy values from 0.1 s to 1 h, at about the same
// distance apart on a log scale. The stepper steps through them one at a
// time, and the slider snaps to them.
export const INTERVALS_S = [
  0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 7.5,
  8, 9, 10, 12, 15, 20, 25, 30, 40, 45, 50, 60, 90, 120, 150, 180, 240, 300,
  360, 420, 480, 600, 900, 1200, 1800, 2700, 3600,
];
/** The labels under the interval slider. */
export const INTERVAL_MARKS_S = [0.1, 1, 10, 60, 600, 3600];
export const FRAME_LIMITS = [10, 25, 50, 100, 150, 200, 300, 500, 750, 1000];
export const DURATIONS_S = [
  30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800,
];
export const FPS_CHOICES = [12, 24, 30, 60];

export const DEFAULT_SETTINGS: Settings = {
  intervalS: 1,
  stop: 'hand',
  stopFrames: 100,
  stopDurationS: 300,
  fps: 30,
  cameraId: '',
};

/**
 * The frame count at which the capture stops, or null when the user stops
 * it by hand. A capture of D seconds takes a frame at 0 s and one frame
 * after each interval, so it has floor(D / interval) + 1 frames.
 */
export function targetFrames(s: Settings): number | null {
  if (s.stop === 'frames') return s.stopFrames;
  if (s.stop === 'duration')
    return Math.floor(s.stopDurationS / s.intervalS) + 1;
  return null;
}

export type Estimate = {
  /** Null when the user stops the capture by hand. */
  frames: number | null;
  captureS: number | null;
  videoS: number | null;
  /** Frames and seconds of video for each minute of capture. */
  perMinute: { frames: number; videoS: number };
  /** How many times faster than real time the video plays. */
  speedup: number;
};

export function estimate(s: Settings): Estimate {
  const frames = targetFrames(s);
  const perMinuteFrames = 60 / s.intervalS;
  return {
    frames,
    captureS: frames === null ? null : (frames - 1) * s.intervalS,
    videoS: frames === null ? null : frames / s.fps,
    perMinute: { frames: perMinuteFrames, videoS: perMinuteFrames / s.fps },
    speedup: s.intervalS * s.fps,
  };
}

/** 0.25 -> "0.25 s", 7.5 -> "7.5 s", 90 -> "1 min 30 s", 7200 -> "2 h". */
export function formatSeconds(totalS: number): string {
  if (totalS < 60) {
    const places = totalS < 1 ? 2 : totalS < 10 ? 1 : 0;
    return `${Number(totalS.toFixed(places))} s`;
  }
  const whole = Math.round(totalS);
  const h = Math.floor(whole / 3600);
  const min = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  if (h > 0) return min > 0 ? `${h} h ${min} min` : `${h} h`;
  return s > 0 ? `${min} min ${s} s` : `${min} min`;
}

/** 71000 -> "1:11", 3723000 -> "1:02:03". */
export function formatClock(ms: number): string {
  const whole = Math.floor(ms / 1000);
  const h = Math.floor(whole / 3600);
  const min = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  if (h > 0) return `${h}:${String(min).padStart(2, '0')}:${s}`;
  return `${min}:${s}`;
}
