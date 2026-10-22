// DC traction motor and gearbox of a 1973 Stock motor car.
//
// - Gear whine: the 17/75 spur gears mesh at 75 x wheel rev/s. At 20 m/s on
//   a 750 mm wheel that is about 640 Hz. Torque bends the teeth, so the
//   whine is loud under power and in rheostatic braking, and quiet when the
//   train coasts. In braking the reverse tooth flank carries the load, and
//   the second harmonic is stronger.
// - Once-per-revolution modulation: gear eccentricity gives sidebands at
//   mesh +/- wheel rev/s, a slow "warble" in the whine.
// - Magnetic growl: armature slots and poles pass at 4 x motor rev/s. Its
//   level follows motor current, so it surges at every camshaft notch.
// - Commutator: segments x motor rev/s, a faint high whistle.
// - Supply ripple: 12-pulse rectifier substations leave a 600 Hz ripple on
//   the 630 V supply (300 Hz on 6-pulse). The motors hum at it under power,
//   at a pitch that does not change with speed.

import { smoothstep } from '../core/math';
import { biquad, gainNode, oscillator, Track } from './automation';
import type { CarFrame, Voice } from './frame';

export interface DcMotorOptions {
  commutatorSegments: number;
  level: number;
}

export class DcMotorVoice implements Voice {
  readonly output: GainNode;
  private readonly sources: OscillatorNode[];
  private readonly tracks: Record<string, Track> = {};

  constructor(
    ctx: BaseAudioContext,
    private readonly opts: DcMotorOptions,
  ) {
    const t = ctx.currentTime;
    this.output = gainNode(ctx, 1);
    const add = (name: string, param: AudioParam, v: number) => {
      this.tracks[name] = new Track(param, v, t);
    };

    // Gear mesh, fundamental and second harmonic.
    const mesh1 = oscillator(ctx, 'sine', 100);
    const mesh1G = gainNode(ctx);
    const mesh2 = oscillator(ctx, 'sine', 200);
    const mesh2G = gainNode(ctx);
    const mesh3 = oscillator(ctx, 'triangle', 300);
    const mesh3G = gainNode(ctx);
    mesh1.connect(mesh1G).connect(this.output);
    mesh2.connect(mesh2G).connect(this.output);
    mesh3.connect(mesh3G).connect(this.output);
    // Eccentricity: once-per-rev amplitude modulation of the mesh.
    const ecc = oscillator(ctx, 'sine', 5);
    const eccDepth = gainNode(ctx);
    ecc.connect(eccDepth).connect(mesh1G.gain);
    add('mesh1F', mesh1.frequency, 100);
    add('mesh1G', mesh1G.gain, 0);
    add('mesh2F', mesh2.frequency, 200);
    add('mesh2G', mesh2G.gain, 0);
    add('mesh3F', mesh3.frequency, 300);
    add('mesh3G', mesh3G.gain, 0);
    add('eccF', ecc.frequency, 5);
    add('eccD', eccDepth.gain, 0);

    // Magnetic growl: sawtooth at pole passing, low-passed.
    const growl = oscillator(ctx, 'sawtooth', 40);
    const growlLp = biquad(ctx, 'lowpass', 700, 1.4);
    const growlG = gainNode(ctx);
    growl.connect(growlLp).connect(growlG).connect(this.output);
    add('growlF', growl.frequency, 40);
    add('growlLp', growlLp.frequency, 700);
    add('growlG', growlG.gain, 0);

    // Commutator whistle.
    const comm = oscillator(ctx, 'sine', 2000);
    const commG = gainNode(ctx);
    comm.connect(commG).connect(this.output);
    add('commF', comm.frequency, 2000);
    add('commG', commG.gain, 0);

    // Supply ripple hum: fixed pitch.
    const r600 = oscillator(ctx, 'sine', 600);
    const r300 = oscillator(ctx, 'sine', 300);
    const rippleG = gainNode(ctx);
    const r300G = gainNode(ctx, 0.5);
    r600.connect(rippleG);
    r300.connect(r300G).connect(rippleG);
    rippleG.connect(this.output);
    add('rippleG', rippleG.gain, 0);

    this.sources = [mesh1, mesh2, mesh3, ecc, growl, comm, r600, r300];
    for (const o of this.sources) o.start(t);
  }

  /** Stop the oscillators and disconnect. The voice is then unusable. */
  dispose(): void {
    for (const o of this.sources) o.stop();
    this.output.disconnect();
  }

  update(f: CarFrame): void {
    const t = f.time;
    const tr = this.tracks;
    const L = this.opts.level;
    const spin = smoothstep(0.2, 2.5, f.speed);
    const absLoad = Math.min(1.3, Math.abs(f.current));
    const braking = f.current < 0 ? 1 : 0;
    const mesh = f.meshHz;
    // Gear whine: present when coasting, much louder under load.
    const whine =
      L * spin * (0.12 + 0.88 * absLoad ** 0.7) * Math.min(1, mesh / 250);
    tr.mesh1F?.ramp(mesh, t);
    tr.mesh1G?.ramp(whine * 0.5, t);
    tr.mesh2F?.ramp(mesh * 2, t);
    tr.mesh2G?.ramp(whine * (0.14 + 0.16 * braking), t);
    tr.mesh3F?.ramp(mesh * 3, t);
    tr.mesh3G?.ramp(whine * 0.05, t);
    tr.eccF?.ramp(Math.max(0.1, f.wheelHz), t);
    tr.eccD?.ramp(whine * 0.5 * 0.28, t);
    // Growl follows current, and the low-pass opens as motor speed rises.
    const pole = 4 * f.motorHz;
    tr.growlF?.ramp(Math.max(8, pole), t);
    tr.growlLp?.ramp(400 + pole * 3, t);
    tr.growlG?.ramp(L * 0.3 * absLoad * smoothstep(0, 1, f.speed + 0.3), t);
    tr.commF?.ramp(Math.max(20, this.opts.commutatorSegments * f.motorHz), t);
    tr.commG?.ramp(L * 0.025 * absLoad * spin, t);
    // Ripple only flows when the motors draw from the supply (power).
    tr.rippleG?.ramp(L * 0.025 * Math.max(0, f.current), t);
  }
}
