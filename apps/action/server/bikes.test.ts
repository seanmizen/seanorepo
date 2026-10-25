// Where: apps/action/server/bikes.test.ts
// When: `yarn workspace action test` (bun test server).
// Why: the server side of the moped that a player rides (bikes.ts,
// REQ-MOPED-005): one moped for each crash, and an older moped of the same
// player is a wreck. A mount only near the moped, for a live player with
// no moped. An "off" only from the rider. A hit only from a live rider on
// a near live player, at a moped speed, once each gap, with more damage at
// more speed. The `bk` field of an "st" only for the moped of the rider. A
// death of a rider sends the "off" with its last place. A moped left at
// speed slides on, and its rider gets on again where it stops.

import { describe, expect, test } from 'bun:test';
import {
  Bikes,
  bikeState,
  FRESH_REACH,
  HIT_GAP_MS,
  HIT_REACH,
  hitDamage,
  MOUNT_REACH,
  MOVED_REACH,
  slideReach,
} from './bikes';

const crash = [-89, 4.8, -32, 0, 12, 0];
const at = { x: -89.5, y: 4.8, z: -40, alive: true };
const q = [-89, 4.8, -40.5, 0.3, 0, 1.3, 0];
const mount = { t: 'mp', k: 'mount', bk: 1, q };

describe('the mopeds to ride', () => {
  test('a moped state: 7 numbers in the map', () => {
    expect(bikeState(q)).toEqual(q);
    expect(bikeState(q.slice(0, 6))).toBeNull();
    expect(bikeState([...q.slice(0, 6), Number.NaN])).toBeNull();
    expect(bikeState([999, ...q.slice(1)])).toBeNull();
  });

  test('a crash leaves one moped; a newer one of the same player makes it a wreck', () => {
    const b = new Bikes();
    expect(b.add(7, crash)).toBe(1);
    expect(b.add(7, crash)).toBe(2);
    // Moped 1 is a wreck: nobody gets on it.
    expect(b.onMessage(3, at, mount)).toEqual([]);
    expect(b.onMessage(3, at, { ...mount, bk: 2 })).toHaveLength(1);
    expect(b.list().map((r) => r[0])).toEqual([1, 2]);
  });

  test('a mount near the moped goes to all, once', () => {
    const b = new Bikes();
    b.add(7, crash);
    expect(b.onMessage(3, { ...at, alive: false }, mount)).toEqual([]);
    const far = { ...at, z: at.z + MOUNT_REACH + 1 };
    expect(b.onMessage(3, far, mount)).toEqual([]);
    // The moped slid at most FRESH_REACH m from the crash.
    const gone = [q[0], q[1], crash[2] - FRESH_REACH - 5, 0, 0, 0, 0];
    const there = { ...at, z: gone[2] };
    expect(b.onMessage(3, there, { ...mount, q: gone })).toEqual([]);
    expect(b.onMessage(3, at, mount)).toEqual([
      { to: 'all', msg: { t: 'mp', k: 'mount', bk: 1, id: 3, q } },
    ]);
    expect(b.ridden(3)).toBe(1);
    // Taken: nobody else gets on.
    expect(b.onMessage(4, at, mount)).toEqual([]);
  });

  test('an off only from the rider goes to the others', () => {
    const b = new Bikes();
    b.add(7, crash);
    b.onMessage(3, at, mount);
    const off = { t: 'mp', k: 'off', bk: 1, q, cr: 1 };
    expect(b.onMessage(4, at, off)).toEqual([]);
    expect(b.onMessage(3, at, off)).toEqual([
      { to: 'others', msg: { t: 'mp', k: 'off', bk: 1, id: 3, q, cr: 1 } },
    ]);
    expect(b.ridden(3)).toBeNull();
    // Another player gets on it.
    expect(b.onMessage(4, at, mount)).toHaveLength(1);
  });

  test('a moped left at speed: the rider gets on again where it stopped', () => {
    const b = new Bikes();
    b.add(7, crash);
    b.onMessage(3, at, mount);
    // Off at 13 m/s: it slides about 28 m at the slowest stop.
    const fast = [q[0], q[1], q[2], 0, 13, 0, 0];
    b.onMessage(3, at, { t: 'mp', k: 'off', bk: 1, q: fast });
    expect(slideReach(13)).toBeGreaterThan(20);
    const stop = [q[0], q[1], q[2] - 22, 0, 0, 0, 0];
    const by = { ...at, z: stop[2] };
    expect(b.onMessage(3, by, { ...mount, q: stop })).toHaveLength(1);
    // A walk-speed off: the old reach only.
    b.onMessage(3, by, { t: 'mp', k: 'off', bk: 1, q: stop });
    const far = [q[0], q[1], stop[2] - MOVED_REACH - 3, 0, 0, 0, 0];
    expect(b.onMessage(3, { ...at, z: far[2] }, { ...mount, q: far })).toEqual(
      [],
    );
  });

  test('a hit from a live rider on a near player: more damage at more speed, once each gap', () => {
    const b = new Bikes();
    b.add(7, crash);
    const hit = { t: 'mp', k: 'hit', bk: 1, id: 5, sp: 13 };
    const v = { ...at, x: at.x + 1 };
    // Not a rider.
    expect(b.hit(3, at, hit, 5, v, 0)).toBe(0);
    b.onMessage(3, at, mount);
    expect(b.hit(3, at, { ...hit, sp: 2 }, 5, v, 0)).toBe(0);
    expect(b.hit(3, at, { ...hit, sp: 40 }, 5, v, 0)).toBe(0);
    const far = { ...v, x: at.x + HIT_REACH + 1 };
    expect(b.hit(3, at, hit, 5, far, 0)).toBe(0);
    expect(b.hit(3, at, hit, 5, { ...v, alive: false }, 0)).toBe(0);
    expect(b.hit(3, at, hit, 3, at, 0)).toBe(0);
    expect(b.hit(3, at, hit, 5, v, 1000)).toBe(hitDamage(13));
    expect(b.hit(3, at, hit, 5, v, 1000 + HIT_GAP_MS / 2)).toBe(0);
    expect(b.hit(3, at, hit, 5, v, 1000 + HIT_GAP_MS)).toBe(hitDamage(13));
    expect(hitDamage(8)).toBeLessThan(hitDamage(14));
    expect(hitDamage(30)).toBe(100);
  });

  test('the st pose only for the moped of the rider; a death sends the off with the last place', () => {
    const b = new Bikes();
    b.add(7, crash);
    expect(b.pose(3, [1, 0.3, -0.2, 0.05, 11])).toBeNull();
    b.onMessage(3, at, mount);
    expect(b.pose(3, [2, 0.3, -0.2, 0.05, 11])).toBeNull();
    expect(b.pose(3, [1, 0.3, -0.2, 0.05, 11])).toEqual([
      1, 0.3, -0.2, 0.05, 11,
    ]);
    const p = { ...at, z: -60 };
    expect(b.release(3, p, true)).toEqual([
      {
        to: 'all',
        msg: {
          t: 'mp',
          k: 'off',
          bk: 1,
          id: 3,
          q: [p.x, p.y, p.z, 0.3, 11, -0.2, 0],
          dd: 1,
        },
      },
    ]);
    expect(b.release(3, p, true)).toEqual([]);
    b.reset();
    expect(b.count()).toBe(0);
  });
});
