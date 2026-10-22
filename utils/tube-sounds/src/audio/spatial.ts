// Spatial chain for one sound source on the track:
//   input -> delay (path length / c) -> low-pass (absorption) -> gain (1/r)
//         -> pan -> dry out
//   after the low-pass -> sends to the station and tunnel reverbs
//
// The delay line gives the Doppler shift. As the source approaches, the
// delay shortens, and the delay line plays faster: the pitch rises. As it
// passes, the pitch falls. The delay moves with a limited rate, so a jump
// in position gives a glide, not a click.

import { type SourcePath, slewDelay } from '../core/geometry';
import { biquad, gainNode, Track } from './automation';

export interface SpatialTargets {
  dry: AudioNode;
  station: AudioNode;
  tunnel: AudioNode;
}

export class SpatialChain {
  readonly input: GainNode;
  private readonly delay: Track;
  private readonly cutoff: Track;
  private readonly gain: Track;
  private readonly pan: Track;
  private readonly stationSend: Track;
  private readonly tunnelSend: Track;
  private delayValue: number | null = null;

  constructor(ctx: BaseAudioContext, out: SpatialTargets, maxDelay = 4) {
    const t = ctx.currentTime;
    this.input = gainNode(ctx, 1);
    const delay = ctx.createDelay(maxDelay);
    const lp = biquad(ctx, 'lowpass', 18000, 0.6);
    const g = gainNode(ctx);
    const pan = ctx.createStereoPanner();
    const sSend = gainNode(ctx);
    const tSend = gainNode(ctx);
    this.input
      .connect(delay)
      .connect(lp)
      .connect(g)
      .connect(pan)
      .connect(out.dry);
    lp.connect(sSend).connect(out.station);
    lp.connect(tSend).connect(out.tunnel);
    this.delay = new Track(delay.delayTime, 0.1, t);
    this.cutoff = new Track(lp.frequency, 18000, t);
    this.gain = new Track(g.gain, 0, t);
    this.pan = new Track(pan.pan, 0, t);
    this.stationSend = new Track(sSend.gain, 0, t);
    this.tunnelSend = new Track(tSend.gain, 0, t);
  }

  update(p: SourcePath, time: number, dt: number, maxDelay = 3.9): void {
    const target = Math.min(p.delay, maxDelay);
    if (this.delayValue === null) {
      this.delayValue = target;
      this.delay.jump(target, time);
    } else {
      this.delayValue = slewDelay(this.delayValue, target, dt);
      this.delay.ramp(this.delayValue, time);
    }
    // The other parameters belong to the sound emitted now. That sound comes
    // out of the delay line `delay` seconds later, so apply them then. The
    // delay slews at less than 1 s/s, so these times always increase.
    const at = time + this.delayValue;
    this.cutoff.ramp(p.cutoff, at);
    this.gain.ramp(p.gain, at);
    this.pan.ramp(p.pan, at);
    this.stationSend.ramp(p.stationSend * 0.5, at);
    this.tunnelSend.ramp(p.tunnelSend * 0.9, at);
  }
}
