// AC traction motor fed by a VVVF inverter (S7 Stock IGBT, or the GTO
// "singing" style).
//
// The inverter makes the motor's electrical frequency f1:
//   f1 = pole pairs x motor rev/s + slip
// Slip is positive under power and negative in regenerative braking, and
// it grows with torque. The pulse mode (asynchronous, synchronous N-pulse,
// one pulse) comes from the carrier schedule. The four strongest current
// harmonics drive four oscillators. When the mode changes, the pitches jump.
// While the inverter gates off (coasting), its tones stop and only the gear
// mesh is left.
//
// The motor core also hums at 2 f1 (magnetostriction).

import { smoothstep } from '../core/math';
import {
  type CarrierStep,
  carrierHz,
  INVERTER_TONES,
  inverterTones,
  modulationIndex,
  pulseModeAt,
  pulseModeIndex,
} from '../core/vvvf';
import { gainNode, oscillator, Track } from './automation';
import type { CarFrame, Voice } from './frame';

export interface VvvfOptions {
  schedule: CarrierStep[];
  polePairs: number;
  /** Electrical frequency at which the inverter reaches full voltage, Hz. */
  baseHz: number;
  level: number;
  /** Rated slip at full torque, Hz. */
  slipHz?: number;
}

export interface InverterState {
  f1: number;
  carrier: number;
  modeIndex: number;
  active: boolean;
}

export class VvvfMotorVoice implements Voice {
  readonly output: GainNode;
  private readonly sources: OscillatorNode[];
  private readonly toneF: Track[] = [];
  private readonly toneG: Track[] = [];
  private readonly humF: Track;
  private readonly humG: Track;
  private readonly mesh1F: Track;
  private readonly mesh1G: Track;
  private readonly mesh2F: Track;
  private readonly mesh2G: Track;
  private lastMode = -1;
  state: InverterState = { f1: 0, carrier: 0, modeIndex: -1, active: false };

  constructor(
    ctx: BaseAudioContext,
    private readonly opts: VvvfOptions,
  ) {
    const t = ctx.currentTime;
    this.output = gainNode(ctx, 1);
    const oscs: OscillatorNode[] = [];
    for (let i = 0; i < INVERTER_TONES; i++) {
      const o = oscillator(ctx, 'sine', 1000);
      const g = gainNode(ctx);
      o.connect(g).connect(this.output);
      this.toneF.push(new Track(o.frequency, 1000, t));
      this.toneG.push(new Track(g.gain, 0, t));
      oscs.push(o);
    }
    const hum = oscillator(ctx, 'sine', 50);
    const humG = gainNode(ctx);
    hum.connect(humG).connect(this.output);
    this.humF = new Track(hum.frequency, 50, t);
    this.humG = new Track(humG.gain, 0, t);
    const m1 = oscillator(ctx, 'sine', 100);
    const m1G = gainNode(ctx);
    const m2 = oscillator(ctx, 'sine', 200);
    const m2G = gainNode(ctx);
    m1.connect(m1G).connect(this.output);
    m2.connect(m2G).connect(this.output);
    this.mesh1F = new Track(m1.frequency, 100, t);
    this.mesh1G = new Track(m1G.gain, 0, t);
    this.mesh2F = new Track(m2.frequency, 200, t);
    this.mesh2G = new Track(m2G.gain, 0, t);
    this.sources = [...oscs, hum, m1, m2];
    for (const o of this.sources) o.start(t);
  }

  /** Stop the oscillators and disconnect. The voice is then unusable. */
  dispose(): void {
    for (const o of this.sources) o.stop();
    this.output.disconnect();
  }

  update(f: CarFrame): void {
    const t = f.time;
    const L = this.opts.level;
    const torque = f.load;
    const absT = Math.abs(torque);
    const active = absT > 0.02 && (f.speed > 0.01 || torque > 0);
    const slip = (this.opts.slipHz ?? 2.2) * torque;
    const f1 = Math.max(0.3, this.opts.polePairs * f.motorHz + slip);
    const modeIndex = pulseModeIndex(this.opts.schedule, f1);
    const mode = pulseModeAt(this.opts.schedule, f1);
    const m = modulationIndex(f1, this.opts.baseHz);
    const tones = inverterTones(mode, f1, m);
    const jump = modeIndex !== this.lastMode;
    this.lastMode = modeIndex;
    const drive = active ? L * absT ** 0.6 : 0;
    tones.forEach((tone, i) => {
      const freq = Math.min(tone.freq, 15000);
      if (jump) this.toneF[i]?.jump(freq, t);
      else this.toneF[i]?.ramp(freq, t);
      this.toneG[i]?.ramp(drive * tone.amp * 1.6, t);
    });
    this.humF.ramp(2 * f1, t);
    this.humG.ramp(drive * 0.12 * Math.min(1, f1 / 30), t);
    const spin = smoothstep(0.2, 2.5, f.speed);
    const whine =
      L * spin * (0.1 + 0.6 * absT ** 0.7) * Math.min(1, f.meshHz / 250);
    this.mesh1F.ramp(f.meshHz, t);
    this.mesh1G.ramp(whine * 0.3, t);
    this.mesh2F.ramp(f.meshHz * 2, t);
    this.mesh2G.ramp(whine * 0.08, t);
    this.state = { f1, carrier: carrierHz(mode, f1), modeIndex, active };
  }
}
