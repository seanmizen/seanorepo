// Where: apps/action/server/pigeons.test.ts
// When: `yarn workspace action test` (bun test server).
// Why: the server side of the pigeons (pigeons.ts): one takeoff for each
// pigeon, a kill makes a body, a dead or flown pigeon comes back after 1 to
// 3 minutes as a new generation, only one player holds a body, and a
// player who leaves drops it.

import { describe, expect, test } from 'bun:test';
import {
  BIRDS,
  DEAD,
  FLOWN,
  Flock,
  HERE,
  LEAVE_MS,
  RETURN_MS,
  RODS,
} from './pigeons';

const up = (i: number, sd = 5) => ({
  t: 'pg',
  k: 'up',
  i,
  sd,
  o: [1, 11.6, -4],
  v: [0, 0, 0],
});
const die = (i: number, g = 0) => ({
  t: 'pg',
  k: 'die',
  i,
  g,
  o: [1, 11.6, -4],
  v: [0, 1, 0],
});
type Msg = Record<string, unknown>;

describe('the flock', () => {
  test('starts with each pigeon on a perch', () => {
    const f = new Flock(0);
    const s = f.state(true) as { b: number[][]; sd: number; c: unknown[] };
    expect(s.b.length).toBe(BIRDS);
    for (const [st, g, rod, u] of s.b) {
      expect(st).toBe(HERE);
      expect(g).toBe(0);
      expect(rod >= 0 && rod < RODS).toBe(true);
      expect(u >= 0 && u <= 1).toBe(true);
    }
    expect(Number.isInteger(s.sd)).toBe(true);
    expect(s.c).toEqual([]);
  });

  test('one takeoff for each pigeon: the other players get the first', () => {
    const f = new Flock(0);
    const a = f.onMessage(1, up(3), 1000);
    expect(a).toEqual([
      {
        to: 'others',
        msg: { ...up(3), id: 1 },
      },
    ]);
    expect(f.birds[3].st).toBe(FLOWN);
    // A second startle of the same pigeon goes nowhere.
    expect(f.onMessage(2, up(3, 9), 1001)).toEqual([]);
    // A bad message goes nowhere.
    expect(f.onMessage(2, { ...up(4), i: 99 }, 1001)).toEqual([]);
    expect(f.onMessage(2, { ...up(4), k: 'fly' }, 1001)).toEqual([]);
  });

  test('a kill makes a body; the pigeon comes back as a new generation', () => {
    const f = new Flock(0);
    expect(f.onMessage(1, die(2, 1), 0)).toEqual([]); // the wrong generation
    expect(f.onMessage(1, die(2), 0).length).toBe(1);
    expect(f.birds[2].st).toBe(DEAD);
    expect(f.onMessage(2, die(2), 10)).toEqual([]);
    expect((f.state(true) as { c: number[][] }).c).toEqual([
      [2, 0, 1, 11.6, -4, 0],
    ]);
    // No return before RETURN_MS[0].
    const early = f.step(RETURN_MS[0] - 1) as Msg[];
    expect(early.some((m) => m.k === 'back')).toBe(false);
    const late = f.step(RETURN_MS[1] + 1) as Msg[];
    const back = late.find((m) => m.k === 'back' && m.i === 2);
    expect(back?.g).toBe(1);
    expect(Array.isArray(back?.pr)).toBe(true);
    expect(f.birds[2].st).toBe(HERE);
    // A flown pigeon gets LEAVE_MS more.
    f.onMessage(1, up(5), 0);
    expect(f.birds[5].ret >= LEAVE_MS + RETURN_MS[0]).toBe(true);
    expect(f.birds[5].ret <= LEAVE_MS + RETURN_MS[1]).toBe(true);
  });

  test('only one player holds a body; a leave drops it', () => {
    const f = new Flock(0);
    f.onMessage(1, die(0), 0);
    const grab = { t: 'pg', k: 'grab', i: 0, g: 0 };
    expect(f.onMessage(1, grab, 1)).toEqual([
      { to: 'all', msg: { t: 'pg', k: 'grab', i: 0, g: 0, id: 1 } },
    ]);
    // Player 2 is late: it gets the holder, the others get nothing.
    expect(f.onMessage(2, grab, 2)).toEqual([
      { to: 'sender', msg: { t: 'pg', k: 'grab', i: 0, g: 0, id: 1 } },
    ]);
    // Only the holder drops it, and nobody pushes a held body.
    const drop = { t: 'pg', k: 'drop', i: 0, g: 0, o: [2, 1, 2], v: [0, 0, 0] };
    expect(f.onMessage(2, drop, 3)).toEqual([]);
    expect(f.onMessage(2, { ...drop, k: 'push' }, 3)).toEqual([]);
    expect(f.leave(1)).toEqual([{ t: 'pg', k: 'drop', i: 0, g: 0 }]);
    expect(f.onMessage(2, grab, 4)[0].to).toBe('all');
  });

  test('joyrides and the flock message', () => {
    const f = new Flock(0);
    const out = f.step(60_000) as Msg[];
    expect(out.some((m) => m.k === 'joy')).toBe(true);
    expect(out.some((m) => m.t === 'flock' && !('sd' in m))).toBe(true);
  });
});
