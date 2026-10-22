// TubeStation: the acoustic space and the control clock.
//
// The station owns the reverbs, the ambience, the master limiter and the
// control loop. Trains attach to a station. The control loop runs in fixed
// steps a little ahead of the audio clock (`latency`). Each step schedules
// AudioParam ramps and one-shot buffers at exact audio times. A late timer
// callback therefore does not move a sound, it only uses up some latency.

import { Ambient } from './audio/ambient';
import { gainNode } from './audio/automation';
import { getBank, type SoundBank } from './audio/bank';
import { DEFAULT_GEOMETRY, type StationGeometry } from './core/geometry';

/** tanh curve: unity gain for small signals, rounds off above about 0.5. */
const softClipCurve = (n = 2048): Float32Array<ArrayBuffer> => {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x);
  }
  return c;
};

export interface StationOptions {
  geometry?: Partial<StationGeometry>;
  /** Ambience level, 0 = off. */
  ambient?: number;
  /** Mean seconds between distant trains in the ambience. 0 = none. */
  distantTrainEvery?: number;
  /** Station reverb return level. */
  stationReverb?: number;
  /** Tunnel reverb return level. */
  tunnelReverb?: number;
  /** Master output gain. */
  volume?: number;
  /** Control step, s. 0.04 = 25 updates per second. */
  controlStep?: number;
  /** How far ahead of the audio clock the control loop runs, s. */
  latency?: number;
  seed?: number;
}

/** Anything that the station clock advances. TubeTrain implements it. */
export interface Ticked {
  advance(time: number, dt: number): void;
}

export class TubeStation {
  readonly ctx: BaseAudioContext;
  readonly bank: SoundBank;
  readonly geometry: StationGeometry;
  /** Final output, after the limiter. Connect it to a destination. */
  readonly output: GainNode;
  /** Dry bus for direct sound. */
  readonly dry: GainNode;
  /** Input of the station (platform) reverb. */
  readonly stationSend: GainNode;
  /** Input of the tunnel reverb. */
  readonly tunnelSend: GainNode;
  readonly controlStep: number;
  readonly latency: number;
  readonly seed: number;
  private readonly ambient: Ambient | null;
  private readonly master: GainNode;
  private readonly ticked = new Set<Ticked>();
  private controlTime: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: BaseAudioContext, opts: StationOptions = {}) {
    this.ctx = ctx;
    this.bank = getBank(ctx);
    this.geometry = {
      ...DEFAULT_GEOMETRY,
      ...opts.geometry,
      listener: { ...DEFAULT_GEOMETRY.listener, ...opts.geometry?.listener },
    };
    this.controlStep = opts.controlStep ?? 0.04;
    this.latency = opts.latency ?? 0.12;
    this.seed = opts.seed ?? 1973;
    this.controlTime = ctx.currentTime;

    const master = gainNode(ctx, opts.volume ?? 0.8);
    this.master = master;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    // A soft clipper after the limiter catches the fast peaks it lets by.
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = '2x';
    this.output = gainNode(ctx, 1);
    // Nothing useful lives below 25 Hz, and it uses up limiter headroom.
    const subsonic = ctx.createBiquadFilter();
    subsonic.type = 'highpass';
    subsonic.frequency.value = 25;
    master
      .connect(subsonic)
      .connect(limiter)
      .connect(clip)
      .connect(this.output);

    this.dry = gainNode(ctx, 1);
    this.dry.connect(master);

    this.stationSend = gainNode(ctx, 1);
    const stationVerb = ctx.createConvolver();
    stationVerb.normalize = false;
    stationVerb.buffer = this.bank.stationIr;
    const stationRet = gainNode(ctx, opts.stationReverb ?? 0.9);
    this.stationSend.connect(stationVerb).connect(stationRet).connect(master);

    this.tunnelSend = gainNode(ctx, 1);
    const tunnelVerb = ctx.createConvolver();
    tunnelVerb.normalize = false;
    tunnelVerb.buffer = this.bank.tunnelIr;
    const tunnelRet = gainNode(ctx, opts.tunnelReverb ?? 0.9);
    this.tunnelSend.connect(tunnelVerb).connect(tunnelRet).connect(master);

    const ambientLevel = opts.ambient ?? 1;
    if (ambientLevel > 0) {
      this.ambient = new Ambient(ctx, this.bank, {
        level: ambientLevel,
        distantTrainEvery: opts.distantTrainEvery ?? 75,
        seed: this.seed + 5,
      });
      this.ambient.output.connect(this.dry);
      const send = gainNode(ctx, 0.4);
      this.ambient.output.connect(send).connect(this.stationSend);
    } else {
      this.ambient = null;
    }
  }

  /** The audio time of the most recent control step. Events start from here. */
  get now(): number {
    return this.controlTime;
  }

  /** Master gain, ramped over 50 ms. */
  setVolume(v: number): void {
    this.master.gain.setTargetAtTime(
      Math.max(0, v),
      this.ctx.currentTime,
      0.05,
    );
  }

  attach(t: Ticked): void {
    this.ticked.add(t);
  }

  detach(t: Ticked): void {
    this.ticked.delete(t);
  }

  /**
   * Run every control step up to the audio clock plus latency. Call it from
   * a timer or a game loop, or let `start()` call it.
   */
  tick(): void {
    const horizon = this.ctx.currentTime + this.latency;
    // After a long stall, skip ahead: scheduling in the past is useless.
    if (horizon - this.controlTime > 1)
      this.controlTime = horizon - this.controlStep;
    while (this.controlTime + this.controlStep <= horizon) {
      this.controlTime += this.controlStep;
      this.ambient?.update(this.controlTime);
      for (const t of this.ticked)
        t.advance(this.controlTime, this.controlStep);
    }
  }

  /** Start a timer that calls `tick()`. A game loop can call `tick()` itself. */
  start(intervalMs = 25): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
