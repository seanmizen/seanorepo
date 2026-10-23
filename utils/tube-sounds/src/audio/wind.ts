// Train-level sounds that come from the tunnel, not from one car.
//
// Piston wind: in a deep tube the train fills about half the tunnel. It
// pushes a column of air ahead of it, so the platform feels the wind and
// hears it rush from the tunnel mouth before the train arrives. After the
// train enters the station the air keeps moving for some seconds. A
// departing train pulls a weaker draught after it.
//
// Rail singing: vibration runs along the rails ahead of the train, faster
// than the sound in the air. A high hiss from the rail beside the platform
// tells of a train well before the rumble arrives.

import { type StationGeometry, trackPan } from '../core/geometry';
import { clamp, smoothstep } from '../core/math';
import { biquad, gainNode, oscillator, Track } from './automation';

export interface TunnelInputs {
  time: number;
  dt: number;
  frontX: number;
  rearX: number;
  speed: number;
}

export class TunnelVoice {
  readonly output: GainNode;
  readonly reverbSend: GainNode;
  private readonly windG: Track;
  private readonly windF: Track;
  private readonly windPan: Track;
  private readonly singG: Track;
  private readonly gustD: Track;
  private wind = 0;

  constructor(
    ctx: BaseAudioContext,
    noise: AudioNode,
    private readonly geometry: StationGeometry,
    private readonly level: number,
  ) {
    const t = ctx.currentTime;
    this.output = gainNode(ctx, 1);
    this.reverbSend = gainNode(ctx, 0.35);

    const bp = biquad(ctx, 'bandpass', 220, 0.45);
    const lp = biquad(ctx, 'lowpass', 1100, 0.7);
    const g = gainNode(ctx);
    const pan = ctx.createStereoPanner();
    noise.connect(bp).connect(lp).connect(g).connect(pan).connect(this.output);
    pan.connect(this.reverbSend);
    // Gusts: slow amplitude modulation.
    const gust = oscillator(ctx, 'sine', 0.37);
    const gustD = gainNode(ctx);
    gust.connect(gustD).connect(g.gain);
    gust.start(t);
    this.windG = new Track(g.gain, 0, t);
    this.windF = new Track(bp.frequency, 220, t);
    this.windPan = new Track(pan.pan, -0.8, t);
    this.gustD = new Track(gustD.gain, 0, t);

    const sing = biquad(ctx, 'bandpass', 3600, 2.2);
    const singG = gainNode(ctx);
    noise.connect(sing).connect(singG).connect(this.output);
    this.singG = new Track(singG.gain, 0, t);
  }

  update(x: TunnelInputs): void {
    const g = this.geometry;
    const start = g.platformStart;
    const end = g.platformStart + g.platformLength;
    const v = Math.max(0, x.speed);
    const push = (v / 20) ** 2;
    let target = 0;
    let fromEntry = true;
    if (x.frontX < start) {
      target = push * Math.exp(-(start - x.frontX) / 220);
    } else if (x.frontX < end + 20) {
      target = push * Math.exp(-(x.frontX - start) / 70);
    } else {
      // Departure draught towards the exit tunnel.
      fromEntry = x.rearX < end;
      target = 0.35 * push * Math.exp(-Math.max(0, x.rearX - end) / 120);
    }
    // The air column has inertia.
    const tau = target > this.wind ? 1.5 : 3.5;
    this.wind += (target - this.wind) * Math.min(1, x.dt / tau);
    const t = x.time;
    const w = this.level * this.wind;
    this.windG.ramp(w * 0.9, t);
    this.gustD.ramp(w * 0.3, t);
    this.windF.ramp(160 + 260 * clamp(this.wind, 0, 1), t);
    const mouth = fromEntry ? start : end;
    // A listener with a right-ear direction (a game) hears the mouth from
    // its true side.
    const pan = g.listener.right
      ? trackPan(mouth, g)
      : clamp((mouth - g.listener.x) / 40, -0.9, 0.9);
    this.windPan.ramp(pan, t);

    // Rail singing is strongest before the train is near. The train masks it
    // when it arrives.
    const gap = Math.abs(x.frontX - g.listener.x);
    const ahead = x.frontX < g.listener.x ? 1 : 0;
    const sing =
      ahead * (v / 20) ** 1.5 * smoothstep(20, 120, gap) * Math.exp(-gap / 600);
    this.singG.ramp(this.level * 0.025 * sing, t);
  }
}
