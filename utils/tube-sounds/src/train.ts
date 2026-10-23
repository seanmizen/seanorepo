// TubeTrain: one train, as a set of cars with their own voices.
//
// Each car is a separate sound source on the track, with its own delay
// line (Doppler), distance gain and pan. Each car has its own noise, its
// own wheel wear (so its own whine pitch) and, on the 1973 Stock, its own
// camshaft. The small differences between cars are what make a train
// sound like a train, as the small differences between cylinders make an
// engine sound like an engine.
//
// Control: set speed, throttle, brake and position directly (a game loop
// does this), or play a script (`playArrival`, `playDeparture`,
// `playService`). A script overrides the direct controls while it runs.

import { gainNode } from './audio/automation';
import { loopNoise, pick, playBuffer, type SoundBank } from './audio/bank';
import { BrakeVoice } from './audio/brakes';
import { CompressorVoice } from './audio/compressor';
import type { CarFrame, Voice } from './audio/frame';
import { DcMotorVoice } from './audio/motor-dc';
import { VvvfMotorVoice } from './audio/motor-vvvf';
import { RollingVoice } from './audio/rolling';
import { SpatialChain } from './audio/spatial';
import { SquealVoice } from './audio/squeal';
import { TunnelVoice } from './audio/wind';
import { BrakeCylinder, Reservoir } from './core/air';
import { type CamEvent, Camshaft } from './core/camshaft';
import { sourcePath } from './core/geometry';
import { jointHits } from './core/joints';
import { stepDynamics } from './core/kinematics';
import { clamp, lerp, mulberry32, smoothstep } from './core/math';
import {
  type ArrivalOptions,
  arrivalScript,
  type DepartureOptions,
  departureScript,
  type Script,
  type ServiceOptions,
  serviceScript,
} from './core/script';
import {
  axleOffsets,
  carOffsets,
  gearRatio,
  type MotorType,
  STOCKS,
  type StockId,
  type StockSpec,
  trainLength,
  wheelHz,
} from './core/stock';
import { DOOR_WARNING, warningBeeps } from './core/synth';
import { curvatureAt, DEFAULT_TRACK, type TrackLayout } from './core/track';
import { GTO_SCHEDULE, IGBT_SCHEDULE } from './core/vvvf';
import type { TubeStation } from './station';

export interface TrainOptions {
  stock?: StockId | StockSpec;
  /** Override the stock's motor type. */
  motor?: MotorType;
  track?: Partial<TrackLayout>;
  /** Overall train level. */
  level?: number;
  /** True: throttle and brake drive the speed (setSpeed is then ignored). */
  physics?: boolean;
  /** Main reservoir pressure at the start, 0..1. */
  reservoir?: number;
  /** Level of each sound component, 1 = default. 0 mutes it. */
  mix?: Partial<Mix>;
  seed?: number;
}

export type MixComponent =
  | 'rolling'
  | 'joints'
  | 'motor'
  | 'control'
  | 'brakes'
  | 'squeal'
  | 'compressor'
  | 'doors'
  | 'tunnel';

export type Mix = Record<MixComponent, number>;

export const DEFAULT_MIX: Mix = {
  rolling: 1,
  joints: 1,
  motor: 1,
  control: 1,
  brakes: 1,
  squeal: 1,
  compressor: 1,
  doors: 1,
  tunnel: 1,
};

export interface TrainState {
  speed: number;
  accel: number;
  frontX: number;
  /** Distance of the train front before the listener, metres. Negative = past. */
  distance: number;
  throttle: number;
  brake: number;
  scripted: boolean;
  motor: MotorType;
  /** DC: camshaft notch of the first motor car (-1 = off). */
  notch: number;
  /** DC: motor current of the first motor car, per unit. */
  current: number;
  /** VVVF: inverter fundamental and carrier of the first motor car, Hz. */
  f1: number;
  carrier: number;
  meshHz: number;
  cylinder: number;
  reservoir: number;
  compressorOn: boolean;
  doorsOpen: boolean;
}

interface Car {
  index: number;
  /** Distance from the train front to the car front, m. */
  offset: number;
  length: number;
  wheelDiameter: number;
  spatial: SpatialChain;
  voices: Voice[];
  motor: DcMotorVoice | VvvfMotorVoice | null;
  camshaft: Camshaft | null;
  cylinder: BrakeCylinder;
  compressor: CompressorVoice | null;
  motored: boolean;
  noise: AudioBufferSourceNode;
}

export interface DoorsCloseOptions {
  /** Audio time at which the warning starts. Default: now. */
  at?: number;
  /** Seconds of warning beeps before the doors move. Default 2 s (12 beeps). */
  warning?: number;
}

export class TubeTrain {
  readonly station: TubeStation;
  readonly stock: StockSpec;
  readonly track: TrackLayout;
  readonly output: GainNode;
  private readonly ctx: BaseAudioContext;
  private readonly bank: SoundBank;
  private readonly rand: () => number;
  private readonly cars: Car[] = [];
  private readonly axles: { offset: number; car: number }[];
  private readonly lastJoint: number[];
  private readonly flat: { axle: number; phase: number; lastHit: number };
  private readonly reservoir: Reservoir;
  private readonly tunnel: TunnelVoice;
  private readonly level: number;
  private readonly mix: Mix;
  private motorType: MotorType;
  private physics: boolean;

  // Direct controls.
  private speed = 0;
  private accel = 0;
  private frontX: number;
  private throttle = 0;
  private brake = 0;
  private curveOverride: number | null = null;
  private script: Script | null = null;
  private scriptResolve: (() => void) | null = null;
  private scriptEvent = 0;
  private doorsAreOpen = false;

  constructor(station: TubeStation, opts: TrainOptions = {}) {
    this.station = station;
    this.ctx = station.ctx;
    this.bank = station.bank;
    const stock = opts.stock ?? '1973';
    this.stock = typeof stock === 'string' ? STOCKS[stock] : stock;
    this.track = { ...DEFAULT_TRACK, ...opts.track };
    this.motorType = opts.motor ?? this.stock.motor;
    this.physics = opts.physics ?? false;
    this.level = opts.level ?? 1;
    this.mix = { ...DEFAULT_MIX, ...opts.mix };
    const mix = this.mix;
    this.rand = mulberry32(opts.seed ?? station.seed + 17);
    this.reservoir = new Reservoir({ pressure: opts.reservoir });
    // Park the train far up the tunnel, silent.
    this.frontX = station.geometry.platformStart - 3000;

    this.output = gainNode(this.ctx, this.level);
    this.output.connect(station.dry);

    const tunnelNoise = loopNoise(this.ctx, this.bank.noise, this.rand);
    this.tunnel = new TunnelVoice(
      this.ctx,
      tunnelNoise,
      station.geometry,
      this.level * mix.tunnel,
    );
    this.tunnel.output.connect(station.dry);
    this.tunnel.reverbSend.connect(station.stationSend);

    const offsets = carOffsets(this.stock);
    this.stock.cars.forEach((spec, index) => {
      const noise = loopNoise(this.ctx, this.bank.noise, this.rand);
      const spatial = new SpatialChain(this.ctx, {
        dry: this.output,
        station: station.stationSend,
        tunnel: station.tunnelSend,
      });
      const car: Car = {
        index,
        offset: offsets[index] ?? 0,
        length: spec.length,
        wheelDiameter: lerp(
          this.stock.wheelDiameterWorn,
          this.stock.wheelDiameterNew,
          this.rand(),
        ),
        spatial,
        voices: [],
        motor: null,
        camshaft: null,
        cylinder: new BrakeCylinder(
          0.5 + this.rand() * 0.12,
          0.75 + this.rand() * 0.15,
        ),
        compressor: null,
        motored: spec.motored,
        noise,
      };
      const rolling = new RollingVoice(this.ctx, noise, {
        corrugation: this.track.corrugation * (0.6 + this.rand() * 0.8),
        corrugationWavelength: this.track.corrugationWavelength,
        level: 0.5 * mix.rolling,
      });
      const brakes = new BrakeVoice(
        this.ctx,
        noise,
        0.55 * mix.brakes,
        this.rand,
      );
      car.voices.push(rolling, brakes);
      if (index % 2 === 0) {
        car.voices.push(
          new SquealVoice(
            this.ctx,
            0.5 * mix.squeal,
            this.rand,
            0.4 + this.rand() * 0.6,
          ),
        );
      }
      for (const v of car.voices) v.output.connect(spatial.input);
      if (spec.compressor) {
        car.compressor = new CompressorVoice(this.ctx, this.bank, {
          strokeRate: 11 + this.rand() * 2,
          level: 0.35 * mix.compressor,
          seed: Math.floor(this.rand() * 1e6),
        });
        car.compressor.output.connect(spatial.input);
      }
      this.cars.push(car);
    });
    this.buildMotors();

    const axleOff = axleOffsets(this.stock);
    this.axles = axleOff.map((offset, i) => ({
      offset,
      car: Math.floor(i / 4),
    }));
    this.lastJoint = axleOff.map(() => Number.NEGATIVE_INFINITY);
    this.flat = {
      axle: Math.floor(this.rand() * axleOff.length),
      phase: this.rand() * 3,
      lastHit: Number.NEGATIVE_INFINITY,
    };
    station.attach(this);
  }

  // ---- Direct controls ----------------------------------------------------

  /** Train speed, m/s. Ignored in physics mode and while a script plays. */
  setSpeed(mps: number): void {
    this.speed = Math.max(0, mps);
  }

  /** Throttle (master controller), 0..1. */
  setThrottle(x: number): void {
    this.throttle = clamp(x, 0, 1);
  }

  /** Brake demand, 0..1. */
  setBrake(x: number): void {
    this.brake = clamp(x, 0, 1);
  }

  /** Put the train front `metres` before the listener (negative = past it). */
  setDistance(metres: number): void {
    this.frontX = this.station.geometry.listener.x - metres;
  }

  /** Put the train front at track position x, metres. */
  setPosition(x: number): void {
    this.frontX = x;
  }

  /** Force the curve amount (0..1) for every car. null = use the track layout. */
  setCurve(amount: number | null): void {
    this.curveOverride = amount === null ? null : clamp(amount, 0, 1);
  }

  /** True: throttle and brake drive the speed through a simple dynamics model. */
  setPhysics(on: boolean): void {
    this.physics = on;
  }

  /** Change the traction equipment. The motor voices are rebuilt. */
  setMotorType(type: MotorType): void {
    if (type === this.motorType) return;
    this.motorType = type;
    this.buildMotors();
  }

  get motor(): MotorType {
    return this.motorType;
  }

  get length(): number {
    return trainLength(this.stock);
  }

  get state(): TrainState {
    const m = this.cars.find((c) => c.motor);
    const vvvf = m?.motor instanceof VvvfMotorVoice ? m.motor.state : null;
    const d = this.cars[0]?.wheelDiameter ?? 0.75;
    return {
      speed: this.speed,
      accel: this.accel,
      frontX: this.frontX,
      distance: this.station.geometry.listener.x - this.frontX,
      throttle: this.throttle,
      brake: this.brake,
      scripted: this.script !== null,
      motor: this.motorType,
      notch: m?.camshaft?.state.notch ?? -1,
      current: m?.camshaft?.state.current ?? 0,
      f1: vvvf?.active ? vvvf.f1 : 0,
      carrier: vvvf?.active ? vvvf.carrier : 0,
      meshHz: wheelHz(this.speed, d) * this.stock.gearTeeth,
      cylinder: this.cars[0]?.cylinder.pressure ?? 0,
      reservoir: this.reservoir.pressure,
      compressorOn: this.reservoir.compressorOn,
      doorsOpen: this.doorsAreOpen,
    };
  }

  // ---- Doors --------------------------------------------------------------

  /** Open all doors on the platform side. */
  doorsOpen(at = this.station.now + 0.05): void {
    const kind = this.stock.doors;
    for (const car of this.cars) {
      const t0 = at + this.rand() * 0.12;
      if (this.stock.openChime) {
        playBuffer(
          this.ctx,
          this.bank.chime,
          car.spatial.input,
          t0,
          0.18 * this.mix.doors,
        );
      }
      const chimeLead = this.stock.openChime ? 0.6 : 0;
      for (let d = 0; d < this.stock.doorsPerSide; d++) {
        const buf = pick(this.bank.doorOpen[kind], this.rand);
        const gain = this.doorGain(car, d) * 0.55 * this.mix.doors;
        playBuffer(
          this.ctx,
          buf,
          car.spatial.input,
          t0 + chimeLead + this.rand() * 0.15,
          gain,
          0.96 + this.rand() * 0.08,
        );
      }
    }
    this.reservoir.useDoors(this.cars.length * this.stock.doorsPerSide);
    this.doorsAreOpen = true;
  }

  /** Sound the warning, then close all doors. */
  doorsClose(opts: DoorsCloseOptions = {}): void {
    const at = opts.at ?? this.station.now + 0.05;
    const warning = opts.warning ?? DOOR_WARNING.seconds;
    // Stop on a whole beep, not in the middle of one.
    const beepTime = warningBeeps(warning).end;
    const kind = this.stock.doors;
    for (const car of this.cars) {
      if (warning > 0) {
        const lag = this.rand() * 0.02;
        playBuffer(
          this.ctx,
          this.bank.warning,
          car.spatial.input,
          at + lag,
          0.12 * this.mix.doors,
          1,
          beepTime,
        );
      }
      const t0 = at + warning + this.rand() * 0.1;
      for (let d = 0; d < this.stock.doorsPerSide; d++) {
        const buf = pick(this.bank.doorClose[kind], this.rand);
        const gain = this.doorGain(car, d) * 0.6 * this.mix.doors;
        playBuffer(
          this.ctx,
          buf,
          car.spatial.input,
          t0 + this.rand() * 0.18,
          gain,
          0.96 + this.rand() * 0.08,
        );
      }
    }
    this.reservoir.useDoors(this.cars.length * this.stock.doorsPerSide);
    this.doorsAreOpen = false;
  }

  // ---- Scripts ------------------------------------------------------------

  /**
   * Scripted arrival: line speed through the tunnel, then brake to a stop
   * with the front at the platform end. Resolves when the train stops.
   */
  playArrival(opts: Partial<ArrivalOptions> = {}): Promise<void> {
    const g = this.station.geometry;
    return this.play(
      arrivalScript({
        brakeAt: opts.brakeAt ?? this.station.now + (opts.approach ?? 12),
        stopX: opts.stopX ?? g.platformStart + g.platformLength - 4,
        ...opts,
      }),
    );
  }

  /** Scripted departure from where the train stands. Resolves when it is gone. */
  playDeparture(opts: Partial<DepartureOptions> = {}): Promise<void> {
    return this.play(
      departureScript({
        at: opts.at ?? this.station.now + 1.5,
        startX: opts.startX ?? this.frontX,
        ...opts,
      }),
    );
  }

  /**
   * One full service: arrival, doors, departure. `at` is timeline t = 0,
   * when the brakes go on. The approach starts `approach` seconds earlier.
   */
  playService(opts: Partial<ServiceOptions> = {}): Promise<void> {
    const g = this.station.geometry;
    const approach = opts.approach ?? 12;
    return this.play(
      serviceScript({
        at: opts.at ?? this.station.now + approach,
        stopX: opts.stopX ?? g.platformStart + g.platformLength - 4,
        ...opts,
      }),
    );
  }

  /** Play any script. A new script replaces the current one. */
  play(script: Script): Promise<void> {
    this.stopScript();
    this.script = script;
    this.scriptEvent = 0;
    const first = script.frameAt(Math.max(script.start, this.station.now));
    // Start the controls in the state the script expects, without clicks.
    this.speed = first.speed;
    this.frontX = first.frontX;
    for (const car of this.cars)
      car.camshaft?.prime(first.speed, first.throttle);
    return new Promise((resolve) => {
      this.scriptResolve = resolve;
    });
  }

  stopScript(): void {
    this.script = null;
    const r = this.scriptResolve;
    this.scriptResolve = null;
    r?.();
  }

  /** Disconnect the train from the station. */
  dispose(): void {
    this.stopScript();
    this.station.detach(this);
    for (const car of this.cars) {
      car.noise.stop();
      car.motor?.dispose();
    }
    this.output.disconnect();
    this.tunnel.output.disconnect();
  }

  // ---- Control step -------------------------------------------------------

  /** Called by the station clock. Computes and schedules one control step. */
  advance(time: number, dt: number): void {
    const prevSpeed = this.speed;
    this.updateControls(time, dt);
    const v = this.speed;
    const geo = this.station.geometry;
    const stock = this.stock;
    const ratio = gearRatio(stock);

    // Air: friction demand per car after the electric brake share.
    let used = 0;
    const frames: CarFrame[] = [];
    for (const car of this.cars) {
      const centre = this.frontX - car.offset - car.length / 2;
      const wHz = wheelHz(v, car.wheelDiameter);
      const motorHz = wHz * ratio;
      let load = 0;
      let current = 0;
      let electric = 0;
      if (car.motored) {
        if (car.camshaft) {
          const ev = car.camshaft.step(dt, v, this.throttle, this.brake);
          this.camEvents(car, ev, time);
          current = car.camshaft.state.current;
          load = clamp(current * car.camshaft.state.field, -1.3, 1.3);
          electric = car.camshaft.state.electricBrakeShare;
        } else {
          const fade = stock.electricBrakeFade;
          electric =
            this.brake > 0.05 ? smoothstep(fade * 0.4, fade * 1.4, v) : 0;
          const base = stock.maxSpeed * 0.45;
          if (this.throttle > 0.05 && this.brake < 0.05) {
            load = this.throttle * Math.min(1, base / Math.max(v, 0.1));
          } else if (electric > 0) {
            load = -this.brake * electric;
          }
        }
      }
      // Trailer cars and the electric brake fade: the friction brake fills in.
      const friction = this.brake * (1 - electric * 0.85);
      used += car.cylinder.step(dt, friction);
      frames.push({
        time,
        dt,
        speed: v,
        accel: this.accel,
        wheelHz: wHz,
        motorHz,
        meshHz: wHz * stock.gearTeeth,
        throttle: this.throttle,
        brake: this.brake,
        load,
        current,
        cylinder: car.cylinder.pressure,
        airFlow: car.cylinder.flow,
        curvature: this.curveOverride ?? curvatureAt(centre, this.track),
      });
      car.spatial.update(sourcePath(centre, geo), time, dt);
    }

    for (const ev of this.reservoir.step(dt, used / this.cars.length)) {
      for (const car of this.cars) {
        if (!car.compressor) continue;
        const t = time + this.rand() * 0.4;
        if (ev === 'compressor-start') car.compressor.start(t);
        else car.compressor.stop(t);
      }
    }

    this.cars.forEach((car, i) => {
      const f = frames[i];
      if (!f) return;
      for (const voice of car.voices) voice.update(f);
      car.motor?.update(f);
      car.compressor?.update(time, dt, time + dt);
    });

    this.scheduleJoints(time, dt);

    // The stop lurch: the bogies stop, the bodies rock back.
    if (prevSpeed > 0.08 && v <= 0.05 && this.brake > 0.05) {
      this.cars.forEach((car, i) => {
        playBuffer(
          this.ctx,
          pick(this.bank.lurch, this.rand),
          car.spatial.input,
          time + i * 0.03,
          0.5 * this.mix.brakes,
        );
      });
    }

    this.tunnel.update({
      time,
      dt,
      frontX: this.frontX,
      rearX: this.frontX - this.length,
      speed: v,
    });
  }

  private updateControls(time: number, dt: number): void {
    const s = this.script;
    if (s) {
      const f = s.frameAt(time);
      this.speed = f.speed;
      this.accel = f.accel;
      this.frontX = f.frontX;
      this.throttle = f.throttle;
      this.brake = f.brake;
      while (this.scriptEvent < s.events.length) {
        const e = s.events[this.scriptEvent];
        if (!e || e.time >= time + dt) break;
        this.scriptEvent++;
        if (e.kind === 'doors-open') this.doorsOpen(Math.max(e.time, time));
        else
          this.doorsClose({ at: Math.max(e.time, time), warning: e.warning });
      }
      if (time >= s.end) this.stopScript();
      return;
    }
    const before = this.speed;
    if (this.physics) {
      this.speed = stepDynamics(
        this.speed,
        this.throttle,
        this.brake,
        this.stock,
        dt,
      );
    }
    // Smooth the measured acceleration: slider moves are steps.
    const a = dt > 0 ? (this.speed - before) / dt : 0;
    this.accel += (a - this.accel) * Math.min(1, dt / 0.3);
    this.frontX += this.speed * dt;
  }

  private camEvents(car: Car, events: CamEvent[], time: number): void {
    const at = time + this.rand() * 0.03;
    for (const e of events) {
      if (e.kind === 'notch') {
        playBuffer(
          this.ctx,
          pick(this.bank.cam, this.rand),
          car.spatial.input,
          at,
          0.22 * this.mix.control,
          0.95 + this.rand() * 0.1,
        );
      } else if (
        e.kind === 'transition' ||
        e.kind === 'line-on' ||
        e.kind === 'line-off'
      ) {
        playBuffer(
          this.ctx,
          pick(this.bank.contactor, this.rand),
          car.spatial.input,
          at,
          0.3 * this.mix.control,
        );
      } else if (e.kind === 'runback') {
        // The cam runs home fast: a quick ratchet of clicks.
        const n = Math.min(e.count ?? 1, 20);
        for (let k = 0; k < n; k++) {
          playBuffer(
            this.ctx,
            pick(this.bank.cam, this.rand),
            car.spatial.input,
            at + k * 0.028,
            0.1 * this.mix.control,
            1.05,
          );
        }
      }
    }
  }

  private scheduleJoints(time: number, dt: number): void {
    const v = this.speed;
    if (v < 0.3) return;
    const geo = this.station.geometry;
    const a = this.accel;
    const intensity = Math.min(1.6, (v / 20) ** 1.2);
    if (this.track.railLength > 0) {
      const xs = this.axles.map((ax) => this.frontX - ax.offset);
      for (const hit of jointHits(
        xs,
        v,
        a,
        dt,
        this.track.railLength,
        this.track.jointPhase,
      )) {
        if (hit.joint <= (this.lastJoint[hit.axle] ?? Number.NEGATIVE_INFINITY))
          continue;
        this.lastJoint[hit.axle] = hit.joint;
        this.playImpact(hit.axle, time + hit.time, intensity, xs, geo);
      }
    }
    // A wheel flat: one thump per wheel revolution on one axle.
    const flatAxle = this.axles[this.flat.axle];
    if (flatAxle) {
      const car = this.cars[flatAxle.car];
      const circ = Math.PI * (car?.wheelDiameter ?? 0.75);
      const x = this.frontX - flatAxle.offset;
      for (const hit of jointHits([x], v, a, dt, circ, this.flat.phase)) {
        if (hit.joint <= this.flat.lastHit) continue;
        this.flat.lastHit = hit.joint;
        const xs = this.axles.map((ax) => this.frontX - ax.offset);
        this.playImpact(
          this.flat.axle,
          time + hit.time,
          intensity * 0.22,
          xs,
          geo,
        );
      }
    }
  }

  private playImpact(
    axle: number,
    at: number,
    intensity: number,
    xs: number[],
    geo: TubeStation['geometry'],
  ): void {
    const info = this.axles[axle];
    const car = info ? this.cars[info.car] : undefined;
    if (!info || !car) return;
    // The car chain carries the car-centre gain. Correct it for this axle.
    const centre = this.frontX - car.offset - car.length / 2;
    const near =
      sourcePath(xs[axle] ?? centre, geo).gain / sourcePath(centre, geo).gain;
    // The leading axle of each bogie strikes harder than the trailing one.
    const lead = axle % 2 === 0 ? 1 : 0.78;
    const gain =
      0.55 *
      this.mix.joints *
      intensity *
      lead *
      clamp(near, 0.4, 3) *
      (0.8 + this.rand() * 0.4);
    const rate =
      (0.9 + 0.12 * Math.min(1, this.speed / 20)) * (0.97 + this.rand() * 0.06);
    playBuffer(
      this.ctx,
      pick(this.bank.joint, this.rand),
      car.spatial.input,
      at,
      gain,
      rate,
    );
  }

  /** Gain correction for door d of a car, relative to the car centre. */
  private doorGain(car: Car, d: number): number {
    const geo = this.station.geometry;
    const centre = this.frontX - car.offset - car.length / 2;
    const x =
      this.frontX -
      car.offset -
      ((d + 0.5) * car.length) / this.stock.doorsPerSide;
    return clamp(
      sourcePath(x, geo).gain / sourcePath(centre, geo).gain,
      0.4,
      3,
    );
  }

  private buildMotors(): void {
    const type = this.motorType;
    const stock = this.stock;
    const ratio = gearRatio(stock);
    for (const car of this.cars) {
      car.motor?.dispose();
      car.motor = null;
      car.camshaft = null;
      if (!car.motored) continue;
      if (type === 'dc-camshaft') {
        car.motor = new DcMotorVoice(this.ctx, {
          commutatorSegments: stock.commutatorSegments || 135,
          level: 0.42 * this.mix.motor,
        });
        car.camshaft = new Camshaft({
          // At line speed on the last weak-field notch the current is about
          // 0.5 p.u.: the train still pulls, but gently.
          fullSpeed: stock.maxSpeed * 0.8,
          stepTime: 0.19 + this.rand() * 0.07,
          brakeFade: stock.electricBrakeFade,
        });
      } else {
        const baseSpeed = stock.maxSpeed * 0.45;
        car.motor = new VvvfMotorVoice(this.ctx, {
          schedule: type === 'vvvf-gto' ? GTO_SCHEDULE : IGBT_SCHEDULE,
          polePairs: stock.polePairs,
          baseHz:
            wheelHz(baseSpeed, car.wheelDiameter) * ratio * stock.polePairs,
          level: 0.4 * this.mix.motor,
        });
      }
      car.motor.output.connect(car.spatial.input);
    }
  }
}
