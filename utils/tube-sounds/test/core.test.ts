import { describe, expect, test } from 'bun:test';
import { BrakeCylinder, Reservoir } from '../src/core/air';
import {
  Camshaft,
  FULL_SERIES,
  maxNotchFor,
  POWER_NOTCHES,
  powerCurrent,
} from '../src/core/camshaft';
import {
  DEFAULT_GEOMETRY,
  dopplerRatio,
  slewDelay,
  sourcePath,
} from '../src/core/geometry';
import { generateImpulse, tubeModes } from '../src/core/impulse';
import { jointHits, timeToTravel } from '../src/core/joints';
import {
  brakingProfile,
  departureProfile,
  hermiteProfile,
  stepDynamics,
} from '../src/core/kinematics';
import { besselJ, clamp, mulberry32, smoothstep } from '../src/core/math';
import { arrivalScript, serviceScript } from '../src/core/script';
import {
  axleOffsets,
  STOCK_1973,
  STOCK_S7,
  trainLength,
  wheelHz,
} from '../src/core/stock';
import {
  DOOR_TRAVEL,
  DOOR_WARNING,
  doorCloseTime,
  doorWarning,
  electricDoor,
  pneumaticDoor,
  railJointImpact,
  warningBeeps,
  whiteNoise,
} from '../src/core/synth';
import { curvatureAt, DEFAULT_TRACK } from '../src/core/track';
import {
  type CarrierStep,
  carrierHz,
  GTO_ASYNC_HZ,
  GTO_SCHEDULE,
  IGBT_SCHEDULE,
  inverterTones,
  pulseModeAt,
  pulseModeIndex,
} from '../src/core/vvvf';

const SR = 48000;

describe('math', () => {
  test('clamp and smoothstep', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(smoothstep(0, 1, -1)).toBe(0);
  });

  test('mulberry32 is repeatable and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  test('besselJ matches tabulated values', () => {
    expect(besselJ(0, 1)).toBeCloseTo(0.7651977, 6);
    expect(besselJ(1, 1)).toBeCloseTo(0.4400506, 6);
    expect(besselJ(2, 2.5)).toBeCloseTo(0.4460591, 6);
  });
});

describe('stock', () => {
  test('1973 Stock is six cars, 2 DM + 4 UNDM/T body lengths', () => {
    expect(STOCK_1973.cars.length).toBe(6);
    expect(trainLength(STOCK_1973)).toBeCloseTo(2 * 17.473 + 4 * 17.676, 6);
  });

  test('four axles per car, in order from the front, inside the train', () => {
    const ax = axleOffsets(STOCK_1973);
    expect(ax.length).toBe(24);
    for (let i = 1; i < ax.length; i++)
      expect(ax[i]).toBeGreaterThan(ax[i - 1] ?? 0);
    expect(ax[0]).toBeGreaterThan(0);
    expect(ax[23]).toBeLessThan(trainLength(STOCK_1973));
    // Two axles of one bogie are one wheelbase apart.
    expect((ax[1] ?? 0) - (ax[0] ?? 0)).toBeCloseTo(
      STOCK_1973.cars[0]?.wheelbase ?? 0,
    );
  });

  test('gear mesh at 20 m/s on a 750 mm wheel is about 640 Hz', () => {
    expect(wheelHz(20, 0.75) * STOCK_1973.gearTeeth).toBeCloseTo(636.6, 0);
    expect(STOCK_S7.motor).toBe('vvvf-igbt');
  });
});

describe('kinematics', () => {
  test('hermite profile meets its boundary values', () => {
    const p = hermiteProfile(10, 4, -1, 0.5, 5);
    expect(p.speedAt(0)).toBeCloseTo(10);
    expect(p.speedAt(5)).toBeCloseTo(4);
    expect(p.accelAt(0)).toBeCloseTo(-1);
    expect(p.accelAt(5)).toBeCloseTo(0.5);
  });

  test('distanceAt is the integral of speedAt', () => {
    const p = hermiteProfile(3, 12, 2, -1, 7);
    let d = 0;
    const n = 7000;
    for (let i = 0; i < n; i++) d += p.speedAt(((i + 0.5) / n) * 7) * (7 / n);
    expect(p.distanceAt(7)).toBeCloseTo(d, 3);
  });

  test('the game arrival: 100 m from 20 m/s in 9 s, stopping exactly', () => {
    const p = brakingProfile(20, 100, 9);
    expect(p.distanceAt(9)).toBeCloseTo(100, 6);
    expect(p.speedAt(9)).toBeCloseTo(0, 6);
    expect(p.accelAt(0)).toBeCloseTo(0, 6); // the brake builds from zero
    for (let t = 0; t <= 9; t += 0.05) {
      expect(p.speedAt(t)).toBeGreaterThanOrEqual(-1e-9);
      expect(p.accelAt(t)).toBeLessThanOrEqual(1e-9); // never speeds up
    }
  });

  test('a short stop brakes at once and ends gently', () => {
    const p = brakingProfile(20, 60, 9);
    expect(p.distanceAt(9)).toBeCloseTo(60, 6);
    expect(p.accelAt(0)).toBeLessThan(0);
    expect(p.accelAt(9)).toBeCloseTo(0, 6);
  });

  test('departure covers its distance and never slows', () => {
    const p = departureProfile(90, 9);
    expect(p.distanceAt(9)).toBeCloseTo(90, 6);
    for (let t = 0.05; t <= 9; t += 0.05)
      expect(p.speedAt(t)).toBeGreaterThan(p.speedAt(t - 0.05));
  });

  test('dynamics: full throttle speeds up, full brake stops, nothing goes negative', () => {
    let v = 0;
    for (let i = 0; i < 100; i++) v = stepDynamics(v, 1, 0, STOCK_1973, 0.1);
    expect(v).toBeGreaterThan(8);
    for (let i = 0; i < 400; i++) v = stepDynamics(v, 0, 1, STOCK_1973, 0.1);
    expect(v).toBe(0);
  });
});

describe('rail joints', () => {
  test('timeToTravel handles constant speed, acceleration and stopping', () => {
    expect(timeToTravel(10, 5, 0)).toBeCloseTo(2);
    expect(timeToTravel(10, 0, 5)).toBeCloseTo(2);
    expect(timeToTravel(10, 5, -1)).toBeCloseTo(5 - Math.sqrt(5), 9);
    expect(timeToTravel(20, 5, -1)).toBe(Number.POSITIVE_INFINITY);
  });

  test('hit rate is speed / rail length per axle', () => {
    const hits = jointHits([0.5], 20, 0, 10, 18.288);
    expect(hits.length).toBe(
      Math.floor((20 * 10 - (18.288 - 0.5)) / 18.288) + 1,
    );
  });

  test('two axles of a bogie strike one wheelbase / speed apart', () => {
    const hits = jointHits([5, 5 - 1.905], 10, 0, 2, 18.288);
    const a = hits.find((h) => h.axle === 0);
    const b = hits.find((h) => h.axle === 1 && h.joint === a?.joint);
    expect((b?.time ?? 0) - (a?.time ?? 0)).toBeCloseTo(1.905 / 10, 6);
  });

  test('windows that join give each joint once', () => {
    const L = 18.288;
    let x = 0.3;
    const v = 15;
    const seen = new Set<number>();
    let last = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < 250; i++) {
      for (const h of jointHits([x], v, 0, 0.04, L)) {
        if (h.joint <= last) continue;
        last = h.joint;
        expect(seen.has(h.joint)).toBe(false);
        seen.add(h.joint);
      }
      x += v * 0.04;
    }
    expect(seen.size).toBe(Math.floor((x - 0.3) / L));
  });
});

describe('camshaft', () => {
  test('master controller positions', () => {
    expect(maxNotchFor(0)).toBe(-1);
    expect(maxNotchFor(0.2)).toBe(0);
    expect(maxNotchFor(0.5)).toBe(FULL_SERIES);
    expect(maxNotchFor(1)).toBe(POWER_NOTCHES - 1);
  });

  test('current falls as back EMF rises', () => {
    expect(powerCurrent(3, 0.1)).toBeGreaterThan(powerCurrent(3, 0.3));
  });

  test('notching up from a stand: clicks, current stays bounded', () => {
    const cam = new Camshaft({ fullSpeed: 17 });
    let v = 0;
    let notches = 0;
    let transitions = 0;
    // 0 to 22 m/s at 1.1 m/s^2.
    for (let i = 0; i < 500; i++) {
      for (const e of cam.step(0.04, v, 1, 0)) {
        if (e.kind === 'notch') notches++;
        if (e.kind === 'transition') transitions++;
      }
      expect(cam.state.current).toBeLessThan(1.6);
      v += 1.1 * 0.04;
    }
    expect(transitions).toBe(1);
    expect(notches).toBeGreaterThan(10);
    expect(cam.state.notch).toBe(POWER_NOTCHES - 1);
  });

  test('power off runs the cam back', () => {
    const cam = new Camshaft({ fullSpeed: 17 });
    for (let i = 0; i < 50; i++) cam.step(0.04, 5, 1, 0);
    const ev = cam.step(0.04, 5, 0, 0);
    expect(ev.some((e) => e.kind === 'runback')).toBe(true);
    expect(cam.state.mode).toBe('off');
  });

  test('rheostatic brake holds above the fade speed and fades below it', () => {
    const cam = new Camshaft({ fullSpeed: 17, brakeFade: 3.5 });
    for (let i = 0; i < 100; i++) cam.step(0.04, 15, 0, 0.8);
    expect(cam.state.mode).toBe('brake');
    expect(cam.state.electricBrakeShare).toBeGreaterThan(0.9);
    for (let i = 0; i < 100; i++) cam.step(0.04, 1, 0, 0.8);
    expect(cam.state.electricBrakeShare).toBe(0);
  });

  test('prime puts a running train on its notch without events', () => {
    const cam = new Camshaft({ fullSpeed: 17 });
    cam.prime(20, 0.7);
    expect(cam.state.mode).toBe('power');
    expect(
      cam.step(0.04, 20, 0.7, 0).filter((e) => e.kind === 'notch').length,
    ).toBeLessThan(2);
  });
});

describe('vvvf', () => {
  test('schedule picks async at low f1 and one-pulse at speed', () => {
    expect(pulseModeAt(IGBT_SCHEDULE, 10).kind).toBe('async');
    expect(pulseModeAt(IGBT_SCHEDULE, 200).kind).toBe('one-pulse');
    expect(pulseModeAt(GTO_SCHEDULE, 5)).toEqual({
      kind: 'async',
      carrierHz: 300,
    });
  });

  test('async sidebands sit at fc +/- 2 f1 and 2 fc +/- f1', () => {
    const t = inverterTones({ kind: 'async', carrierHz: 1000 }, 20, 0.5);
    expect(t.map((x) => x.freq)).toEqual([960, 1040, 1980, 2020]);
    for (const x of t) expect(x.amp).toBeGreaterThan(0);
  });

  test('sync carrier follows f1', () => {
    expect(carrierHz({ kind: 'sync', pulses: 9 }, 50)).toBe(450);
  });

  test('sync drops the fundamental and triplen lines', () => {
    const three = inverterTones({ kind: 'sync', pulses: 3 }, 100, 1);
    expect(three[0]?.freq).toBeCloseTo(100);
    expect(three[0]?.amp).toBe(0);
    const five = inverterTones({ kind: 'sync', pulses: 5 }, 100, 1);
    expect(five[0]?.amp).toBe(0); // 3 f1
    expect(five[1]?.amp).toBeGreaterThan(0); // 7 f1
    expect(five[2]?.amp).toBe(0); // 9 f1
  });

  test('one pulse leaves 6k +/- 1 harmonics', () => {
    const t = inverterTones({ kind: 'one-pulse' }, 100, 1);
    expect(t.map((x) => Math.round(x.freq))).toEqual([500, 700, 1100, 1300]);
  });

  /** Pulse number of a mode: async counts as more pulses than any sync mode. */
  const pulses = (step: CarrierStep): number =>
    step.mode.kind === 'async'
      ? Number.POSITIVE_INFINITY
      : step.mode.kind === 'sync'
        ? step.mode.pulses
        : 1;

  test('pulse numbers never rise with speed', () => {
    for (const schedule of [GTO_SCHEDULE, IGBT_SCHEDULE]) {
      for (let i = 1; i < schedule.length; i++) {
        const a = schedule[i - 1];
        const b = schedule[i];
        if (!a || !b) throw new Error('missing step');
        expect(b.untilHz).toBeGreaterThan(a.untilHz);
        expect(pulses(b)).toBeLessThan(pulses(a));
      }
    }
  });

  test('GTO starts asynchronous at a 300 Hz carrier, then 21 and 15 pulse', () => {
    expect(pulseModeAt(GTO_SCHEDULE, 0.3)).toEqual({
      kind: 'async',
      carrierHz: GTO_ASYNC_HZ,
    });
    expect(pulseModeAt(GTO_SCHEDULE, 14)).toEqual({
      kind: 'async',
      carrierHz: 300,
    });
    expect(pulseModeAt(GTO_SCHEDULE, 15)).toEqual({ kind: 'sync', pulses: 21 });
    expect(pulseModeAt(GTO_SCHEDULE, 21)).toEqual({ kind: 'sync', pulses: 15 });
  });

  test('GTO async to 21 pulse change is silent: the tones do not jump', () => {
    const f1 = GTO_ASYNC_HZ / 21;
    const before = inverterTones(pulseModeAt(GTO_SCHEDULE, f1 - 1e-9), f1, 0.3);
    const after = inverterTones(pulseModeAt(GTO_SCHEDULE, f1), f1, 0.3);
    expect(pulseModeAt(GTO_SCHEDULE, f1)).toEqual({ kind: 'sync', pulses: 21 });
    after.forEach((t, i) => {
      expect(t.freq).toBeCloseTo(before[i]?.freq ?? 0, 6);
      expect(t.amp).toBeCloseTo(before[i]?.amp ?? 0, 6);
    });
  });

  test('GTO below 40 Hz: one audible step, carrier at most 600 Hz', () => {
    // A real GTO carrier stays near 300-420 Hz at low speed.
    let steps = 0;
    let last = pulseModeIndex(GTO_SCHEDULE, 0.3);
    let prevCarrier = carrierHz(pulseModeAt(GTO_SCHEDULE, 0.3), 0.3);
    for (let f1 = 0.3; f1 < 40; f1 += 0.01) {
      const mode = pulseModeAt(GTO_SCHEDULE, f1);
      const fc = carrierHz(mode, f1);
      expect(fc).toBeGreaterThanOrEqual(GTO_ASYNC_HZ - 1e-6);
      expect(fc).toBeLessThanOrEqual(600);
      const i = pulseModeIndex(GTO_SCHEDULE, f1);
      if (i !== last && Math.abs(fc - prevCarrier) > 5) steps++;
      last = i;
      prevCarrier = fc;
    }
    expect(steps).toBe(1);
  });

  test('GTO above 40 Hz keeps the 15, 9, 5, 3, 1 pulse steps', () => {
    const at = (f1: number) => pulseModeAt(GTO_SCHEDULE, f1);
    expect(at(40)).toEqual({ kind: 'sync', pulses: 15 });
    expect(at(54.9)).toEqual({ kind: 'sync', pulses: 15 });
    expect(at(55)).toEqual({ kind: 'sync', pulses: 9 });
    expect(at(75)).toEqual({ kind: 'sync', pulses: 5 });
    expect(at(95)).toEqual({ kind: 'sync', pulses: 3 });
    expect(at(110)).toEqual({ kind: 'one-pulse' });
  });
});

describe('geometry', () => {
  const g = DEFAULT_GEOMETRY;

  test('gain falls with distance in the station', () => {
    const near = sourcePath(g.listener.x, g);
    const far = sourcePath(g.listener.x - 40, g);
    expect(near.gain).toBeGreaterThan(far.gain * 5);
    expect(near.tunnelDepth).toBe(0);
  });

  test('a tunnel source is dark, delayed and comes from the mouth', () => {
    const p = sourcePath(g.platformStart - 300, g);
    expect(p.tunnelDepth).toBe(300);
    expect(p.cutoff).toBeLessThan(1000);
    expect(p.delay).toBeGreaterThan(300 / 343);
    expect(p.pan).toBeLessThan(0); // the entry mouth is to the left
    expect(p.tunnelSend).toBeGreaterThan(0);
  });

  test('delay slew limit and Doppler ratio', () => {
    expect(slewDelay(1, 0, 0.1)).toBeCloseTo(0.985);
    // A source approaching at 20 m/s: delay falls at 20/343 s per s.
    expect(dopplerRatio(-20 / 343)).toBeCloseTo(1 + 20 / 343);
  });
});

describe('track', () => {
  test('curve amount rises through the spiral', () => {
    const c = DEFAULT_TRACK.curves[0];
    if (!c) throw new Error('no curve');
    expect(curvatureAt((c.from + c.to) / 2, DEFAULT_TRACK)).toBeCloseTo(
      c.amount,
    );
    expect(curvatureAt(c.from - 100, DEFAULT_TRACK)).toBe(0);
  });
});

describe('air', () => {
  test('cylinder fills with positive flow and exhausts with negative flow', () => {
    const c = new BrakeCylinder();
    c.step(0.1, 1);
    expect(c.flow).toBeGreaterThan(0);
    for (let i = 0; i < 50; i++) c.step(0.1, 1);
    expect(c.pressure).toBeGreaterThan(0.99);
    c.step(0.1, 0);
    expect(c.flow).toBeLessThan(0);
  });

  test('compressor cuts in and cuts out', () => {
    const r = new Reservoir({
      pressure: 0.83,
      cutIn: 0.82,
      compressorRate: 0.05,
    });
    r.useDoors(20);
    expect(r.step(0.1, 0)).toEqual(['compressor-start']);
    let stopped = false;
    for (let i = 0; i < 100 && !stopped; i++)
      stopped = r.step(0.1, 0).includes('compressor-stop');
    expect(stopped).toBe(true);
    expect(r.pressure).toBe(1);
  });
});

describe('scripts', () => {
  test('arrival stops at stopX, held by the brake', () => {
    const s = arrivalScript({ brakeAt: 10, stopX: 121 });
    const end = s.frameAt(19.5);
    expect(end.speed).toBe(0);
    expect(end.frontX).toBe(121);
    expect(end.brake).toBeGreaterThan(0.3);
    const before = s.frameAt(5);
    expect(before.speed).toBe(20);
    expect(before.frontX).toBeCloseTo(21 - 100);
  });

  test('position is continuous through the whole service', () => {
    const s = serviceScript({ at: 20, stopX: 121 });
    let prev = s.frameAt(s.start);
    for (let t = s.start; t < s.end; t += 0.01) {
      const f = s.frameAt(t);
      expect(f.frontX).toBeGreaterThanOrEqual(prev.frontX - 1e-9);
      expect(f.frontX - prev.frontX).toBeLessThan(0.5);
      prev = f;
    }
  });

  test('service door times match the game timeline', () => {
    const s = serviceScript({ at: 100, stopX: 121 });
    const open = s.events.find((e) => e.kind === 'doors-open');
    const close = s.events.find((e) => e.kind === 'doors-close');
    expect(open?.time).toBe(110);
    // Warning + close movement: the doors are shut at t = 24.
    expect(
      (close?.time ?? 0) + (close?.warning ?? 0) + doorCloseTime('pneumatic'),
    ).toBeCloseTo(124);
    expect(close?.warning).toBe(DOOR_WARNING.seconds);
    expect(s.frameAt(127.5).speed).toBeGreaterThan(0);
    expect(s.frameAt(126).speed).toBe(0);
  });
});

describe('synthesis buffers', () => {
  const finite = (b: Float32Array) =>
    b.every((v) => Number.isFinite(v) && Math.abs(v) <= 1);

  test('noise is zero-mean and full scale', () => {
    const n = whiteNoise(48000, mulberry32(1));
    const mean = n.reduce((a, b) => a + b, 0) / n.length;
    expect(Math.abs(mean)).toBeLessThan(0.02);
  });

  test('event buffers are finite, normalised and repeatable', () => {
    const a = railJointImpact(SR, 5);
    expect(finite(a)).toBe(true);
    expect(Math.max(...a.map(Math.abs))).toBeCloseTo(0.9, 2);
    expect(railJointImpact(SR, 5)).toEqual(a);
    expect(finite(pneumaticDoor(SR, 3, 'close'))).toBe(true);
  });

  test('door warning has the right number of beeps', () => {
    const w = doorWarning(SR, 2000, 4, 0.1, 0.25);
    // An onset is sound after at least 10 ms of silence.
    let onsets = 0;
    let silent = SR;
    for (const v of w) {
      if (Math.abs(v) > 1e-6) {
        if (silent > SR * 0.01) onsets++;
        silent = 0;
      } else {
        silent++;
      }
    }
    expect(onsets).toBe(4);
  });

  /** Start times of the beeps in a warning buffer, s. */
  const beepStarts = (w: Float32Array): number[] => {
    const out: number[] = [];
    let silent = SR;
    w.forEach((v, i) => {
      if (Math.abs(v) > 1e-6) {
        if (silent > SR * 0.01) out.push(i / SR);
        silent = 0;
      } else {
        silent++;
      }
    });
    return out;
  };

  test('door warning cadence: 6 beeps per second, 0.11 s beeps, 2.29 kHz', () => {
    const w = doorWarning(SR);
    const starts = beepStarts(w);
    for (let i = 1; i < starts.length; i++)
      expect((starts[i] ?? 0) - (starts[i - 1] ?? 0)).toBeCloseTo(1 / 6, 3);
    // The beep length: the first beep ends before the first gap.
    let end = 0;
    for (let i = 0; i < SR * 0.16; i++) if (Math.abs(w[i] ?? 0) > 1e-6) end = i;
    expect(end / SR).toBeCloseTo(DOOR_WARNING.on, 2);
    // Pitch from upward zero crossings in the first beep.
    let ups = 0;
    for (let i = 1; i < end; i++)
      if ((w[i - 1] ?? 0) < 0 && (w[i] ?? 0) >= 0) ups++;
    expect(ups / (end / SR)).toBeGreaterThan(2250);
    expect(ups / (end / SR)).toBeLessThan(2330);
  });

  test('the default warning is 12 beeps and ends on a whole beep', () => {
    const { count, end } = warningBeeps(DOOR_WARNING.seconds);
    expect(count).toBe(12);
    expect(end).toBeCloseTo(11 / 6 + 0.11, 6);
    expect(end).toBeLessThanOrEqual(DOOR_WARNING.seconds);
    // LU range: 1.75 +/- 0.25 s from the first beep to door movement.
    expect(DOOR_WARNING.seconds).toBeGreaterThanOrEqual(1.5);
    expect(DOOR_WARNING.seconds).toBeLessThanOrEqual(2);
    // The bank buffer holds enough beeps for the default warning.
    expect(beepStarts(doorWarning(SR)).length).toBeGreaterThanOrEqual(count);
  });

  /** Time of the loudest sample in a buffer, s. */
  const peakTime = (b: Float32Array): number => {
    let at = 0;
    for (let i = 0; i < b.length; i++)
      if (Math.abs(b[i] ?? 0) > Math.abs(b[at] ?? 0)) at = i;
    return at / SR;
  };

  test('door sounds follow the travel time: the leaves meet at its end', () => {
    // The thud where the leaves meet is the loudest part of a close.
    for (const seed of [3, 7, 11]) {
      const t = peakTime(pneumaticDoor(SR, seed, 'close'));
      expect(t).toBeGreaterThan(doorCloseTime('pneumatic') - 0.01);
      expect(t).toBeLessThan(doorCloseTime('pneumatic') + 0.1);
    }
    const e = electricDoor(SR, 5, 'close');
    expect(e.length / SR).toBeGreaterThan(DOOR_TRAVEL.electric.close + 0.4);
    expect(peakTime(e)).toBeGreaterThan(DOOR_TRAVEL.electric.close - 0.01);
  });
});

describe('impulse responses', () => {
  test('3.56 m tunnel cross modes are 56, 94 and 117 Hz', () => {
    const m = tubeModes(3.56).map(Math.round);
    expect(m).toEqual([56, 94, 118]);
  });

  test('impulse has unit energy and decays', () => {
    const [ir] = generateImpulse(8000, {
      seconds: 2,
      rt60: [1, 1, 1],
      channels: 1,
    });
    if (!ir) throw new Error('no channel');
    let e = 0;
    for (const v of ir) e += v * v;
    expect(e).toBeCloseTo(1, 5);
    const rms = (a: number, b: number) => {
      let s = 0;
      for (let i = a; i < b; i++) s += (ir[i] ?? 0) ** 2;
      return Math.sqrt(s / (b - a));
    };
    // RT60 = 1 s: 0.5 s later the level is about 30 dB down.
    const ratio = rms(800, 1600) / rms(4800, 5600);
    expect(20 * Math.log10(ratio)).toBeGreaterThan(20);
  });
});
