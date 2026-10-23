// The live gain points (station ambience, train level, component mix) and
// the distance lock, on a fake AudioContext.

import { describe, expect, test } from 'bun:test';
import { carOffsets, STOCK_1973, STOCK_S7 } from '../src/core/stock';
import { TubeStation } from '../src/station';
import { DEFAULT_MIX, type TrainOptions, TubeTrain } from '../src/train';
import { FakeContext } from './fake-audio';

const STEP = 0.04;

const setup = (opts: TrainOptions = {}) => {
  const ctx = new FakeContext();
  const station = new TubeStation(ctx.audio, { distantTrainEvery: 0 });
  const train = new TubeTrain(station, { seed: 7, ...opts });
  /** Run the station clock for `seconds`. */
  const run = (seconds: number) => {
    const end = ctx.currentTime + seconds;
    while (ctx.currentTime < end - 1e-9) {
      ctx.currentTime += STEP;
      station.tick();
    }
  };
  return { ctx, station, train, run };
};

/** Gain nodes whose gain value is v. */
const gainsAt = (ctx: FakeContext, v: number) =>
  ctx.all('gain').filter((n) => Math.abs(n.gain.value - v) < 1e-9);

describe('station ambience fader', () => {
  test('setAmbient makes the ambience on a station that started without it', () => {
    const ctx = new FakeContext();
    const station = new TubeStation(ctx.audio, { ambient: 0 });
    expect(station.ambientLevel).toBe(0);
    const oscillators = ctx.all('oscillator').length;
    station.setAmbient(0.6);
    expect(station.ambientLevel).toBe(0.6);
    expect(ctx.all('oscillator').length).toBeGreaterThan(oscillators);
    // A second call does not make a second ambience.
    const after = ctx.all('oscillator').length;
    station.setAmbient(0.2);
    expect(ctx.all('oscillator').length).toBe(after);
  });

  test('setAmbient clamps negative levels and ignores NaN', () => {
    const ctx = new FakeContext();
    const station = new TubeStation(ctx.audio);
    expect(station.ambientLevel).toBe(1);
    station.setAmbient(-2);
    expect(station.ambientLevel).toBe(0);
    station.setAmbient(Number.NaN);
    expect(station.ambientLevel).toBe(0);
  });
});

describe('train level and mix', () => {
  test('setLevel moves the dry output and both reverb sends', () => {
    const { ctx, train } = setup();
    expect(train.level).toBe(1);
    train.setLevel(0.37);
    expect(train.level).toBe(0.37);
    expect(train.output.gain.value).toBeCloseTo(0.37);
    // The dry output, the station send and the tunnel send.
    expect(gainsAt(ctx, 0.37)).toHaveLength(3);
  });

  test('setMix sets one gain per car for a car component', () => {
    const { ctx, train } = setup({ stock: 'S7' });
    train.setMix({ joints: 0.29 });
    expect(train.mixLevels.joints).toBe(0.29);
    expect(train.mixLevels.motor).toBe(1);
    expect(gainsAt(ctx, 0.29)).toHaveLength(STOCK_S7.cars.length);
  });

  test('setMix sets the tunnel component once for the train', () => {
    const { ctx, train } = setup();
    train.setMix({ tunnel: 0.31 });
    expect(gainsAt(ctx, 0.31)).toHaveLength(1);
  });

  test('setMix clamps negative levels, ignores NaN and keeps unnamed levels', () => {
    const { train } = setup();
    train.setMix({ brakes: -1, doors: Number.NaN });
    expect(train.mixLevels).toEqual({ ...DEFAULT_MIX, brakes: 0 });
  });

  test('the mix option sets the start level of each component', () => {
    const { ctx, train } = setup({ mix: { doors: 0.43 } });
    expect(train.mixLevels.doors).toBe(0.43);
    expect(gainsAt(ctx, 0.43)).toHaveLength(STOCK_1973.cars.length);
  });
});

describe('distance lock', () => {
  test('physics drives the train, and the heard distance stays at the lock', () => {
    const { train, run } = setup({ physics: true });
    train.setDistance(300);
    train.setDistanceLock({ distance: 12 });
    train.setThrottle(1);
    const x0 = train.state.frontX;
    run(20);
    const s = train.state;
    expect(s.locked).toBe(true);
    expect(s.speed).toBeGreaterThan(10);
    expect(s.frontX - x0).toBeGreaterThan(100);
    expect(s.distance).toBeCloseTo(12, 9);
  });

  test('a car reference holds the centre of that car', () => {
    const { train } = setup();
    train.setDistanceLock({ distance: 0, car: 2 });
    const centre =
      (carOffsets(STOCK_1973)[2] ?? 0) + (STOCK_1973.cars[2]?.length ?? 0) / 2;
    expect(train.state.distance).toBeCloseTo(-centre, 9);
    expect(train.distanceLock).toEqual({ distance: 0, car: 2 });
  });

  test('a script runs under the lock', () => {
    const { train, run } = setup();
    train.setDistanceLock({ distance: 20 });
    void train.playArrival({ approach: 2 });
    run(4);
    const s = train.state;
    expect(s.scripted).toBe(true);
    expect(s.brake).toBeGreaterThan(0);
    expect(s.distance).toBeCloseTo(20, 9);
  });

  /** The delay time of every car, after `seconds` of running at speed. */
  const delays = (lock: boolean) => {
    const { ctx, train, run } = setup({ stock: 'S7' });
    train.setDistance(60);
    if (lock) train.setDistanceLock({ distance: 60 });
    train.setSpeed(15);
    run(0.5);
    const before = ctx.all('delay').map((n) => n.delayTime.value);
    run(2);
    const after = ctx.all('delay').map((n) => n.delayTime.value);
    return { before, after };
  };

  test('no Doppler under the lock: the delay of every car stays the same', () => {
    const { before, after } = delays(true);
    expect(before).toHaveLength(STOCK_S7.cars.length);
    after.forEach((d, i) => {
      expect(d).toBeCloseTo(before[i] ?? 0, 9);
    });
  });

  test('without the lock the same run changes the delays (Doppler)', () => {
    const { before, after } = delays(false);
    const moved = after.filter((d, i) => Math.abs(d - (before[i] ?? 0)) > 1e-3);
    expect(moved.length).toBeGreaterThan(0);
  });

  test('the rail joints still play under the lock', () => {
    const { ctx, station, train, run } = setup({ stock: 'S7' });
    train.setDistanceLock({ distance: 10, car: 3 });
    train.setSpeed(15);
    run(4);
    const joints = ctx
      .all('source')
      .filter(
        (n) => n.buffer && station.bank.joint.includes(n.buffer as never),
      );
    // 28 axles over 60 m of track pass about 3 joints each.
    expect(joints.length).toBeGreaterThan(50);
  });

  test('release: the train continues from the position that was heard', () => {
    const { station, train, run } = setup();
    train.setSpeed(10);
    train.setDistanceLock({ distance: 30 });
    run(5);
    train.setDistanceLock(null);
    expect(train.state.locked).toBe(false);
    expect(train.state.frontX).toBeCloseTo(station.geometry.listener.x - 30, 9);
    run(1);
    expect(train.state.distance).toBeCloseTo(20, 0);
  });

  test('a bad lock throws a RangeError', () => {
    const { train } = setup();
    expect(() => train.setDistanceLock({ distance: 5, car: 99 })).toThrow(
      RangeError,
    );
    expect(() => train.setDistanceLock({ distance: Number.NaN })).toThrow(
      RangeError,
    );
    expect(train.distanceLock).toBeNull();
  });
});

describe('joint memory', () => {
  test('an arrival after a long run still plays its rail joints', () => {
    const { ctx, station, train, run } = setup({ stock: 'S7' });
    train.setPosition(400);
    train.setSpeed(20);
    run(10);
    const count = () =>
      ctx
        .all('source')
        .filter(
          (n) => n.buffer && station.bank.joint.includes(n.buffer as never),
        ).length;
    const before = count();
    // The arrival starts far behind the joints that the run played.
    void train.playArrival({ approach: 6 });
    run(5);
    expect(count() - before).toBeGreaterThan(50);
  });
});
