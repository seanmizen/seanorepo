// Offline rendering. An OfflineAudioContext renders faster than real time,
// but no timer runs during the render. The helper suspends the render at
// every control step and runs the station clock by hand. The result is the
// same sound as a live run, sample for sample, given the same seed.

import { type StationOptions, TubeStation } from './station';

export interface OfflineOptions extends StationOptions {
  sampleRate?: number;
}

/**
 * Render `seconds` of audio. `setup` receives the station before the render
 * starts. It creates trains and starts scripts.
 */
export const renderOffline = async (
  seconds: number,
  setup: (station: TubeStation) => void,
  opts: OfflineOptions = {},
): Promise<AudioBuffer> => {
  const sampleRate = opts.sampleRate ?? 48000;
  const ctx = new OfflineAudioContext(
    2,
    Math.ceil(seconds * sampleRate),
    sampleRate,
  );
  // Suspend times must fall on render-quantum (128-frame) boundaries.
  const quanta = Math.max(
    1,
    Math.round(((opts.controlStep ?? 0.04) * sampleRate) / 128),
  );
  const step = (quanta * 128) / sampleRate;
  const station = new TubeStation(ctx, {
    ...opts,
    controlStep: step,
    latency: step * 2,
  });
  station.output.connect(ctx.destination);
  setup(station);
  station.tick();
  for (let t = step; t < seconds; t += step) {
    ctx.suspend(t).then(() => {
      station.tick();
      return ctx.resume();
    });
  }
  return ctx.startRendering();
};
