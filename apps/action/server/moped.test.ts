// Where: apps/action/server/moped.test.ts
// When: `yarn workspace action test` (bun test server).
// Why: the server side of the moped thieves (moped.ts): a "go" only on the
// street with a primary, once in each life. A "snatch" only near the
// player and with both riders alive: the gun goes to the thief and the
// primary slot is empty. A rider dies at 100 damage, and the thief death
// puts the gun on the ground. Only a player with an empty primary slot
// near the gun gets it. A spawn ends the visit.

import { describe, expect, test } from 'bun:test';
import {
  EXIT_Z,
  Mopeds,
  onStreet,
  PICK_REACH,
  RIDER_HP,
  STEAL_REACH,
  STREET_Y,
} from './moped';

const rifle: [number, number] = [0, 1];
const on = { x: -85.5, y: STREET_Y + 0.12, z: EXIT_Z - 20, alive: true };
const q6 = [-86.4, STREET_Y, EXIT_Z - 20.2, 0, 1.5, 0];
const q10 = [...q6, 0.3, 0, -0.9, 0];
const go = { t: 'mp', k: 'go', q: [-89.3, STREET_Y, EXIT_Z + 50, 0, 13, 0] };
const snatch = { t: 'mp', k: 'snatch', q: q6 };

describe('the moped thieves', () => {
  test('the street: Warwick Road between the terraces, short of the fences', () => {
    expect(onStreet(on)).toBe(true);
    expect(onStreet({ ...on, x: -80 })).toBe(false);
    expect(onStreet({ ...on, y: 0 })).toBe(false);
    expect(onStreet({ ...on, z: EXIT_Z - 160 })).toBe(false);
  });

  test('a go on the street goes to the others, once in each life', () => {
    const m = new Mopeds();
    expect(m.onMessage(1, { ...on, x: 40 }, rifle, go).out).toEqual([]);
    expect(m.onMessage(1, { ...on, alive: false }, rifle, go).out).toEqual([]);
    expect(m.onMessage(1, on, rifle, { ...go, q: [1, 2] }).out).toEqual([]);
    expect(m.onMessage(1, on, rifle, go).out).toEqual([
      { to: 'others', msg: { t: 'mp', k: 'go', id: 1, q: go.q } },
    ]);
    expect(m.onMessage(1, on, rifle, go).out).toEqual([]);
    // A spawn ends the visit, and a new one can come.
    expect(m.end(1)).toEqual([
      { to: 'all', msg: { t: 'mp', k: 'end', id: 1 } },
    ]);
    expect(m.onMessage(1, on, rifle, go).out).toHaveLength(1);
  });

  test('a snatch near the player takes the primary, once', () => {
    const m = new Mopeds();
    expect(m.onMessage(1, on, rifle, snatch).out).toEqual([]);
    m.onMessage(1, on, rifle, go);
    const far = {
      ...snatch,
      q: [...q6.slice(0, 2), on.z - STEAL_REACH - 2, 0, 0, 0],
    };
    expect(m.onMessage(1, on, rifle, far).out).toEqual([]);
    expect(m.stolen(1)).toBe(false);
    expect(m.onMessage(1, on, rifle, snatch).out).toEqual([
      { to: 'all', msg: { t: 'mp', k: 'snatch', id: 1, q: q6, p: rifle } },
    ]);
    expect(m.stolen(1) && m.robbed(1)).toBe(true);
    expect(m.onMessage(1, on, rifle, snatch).out).toEqual([]);
    // No second visit in this life, also with a gun again.
    expect(m.onMessage(1, on, rifle, go).out).toEqual([]);
  });

  test('no snatch after a rider died; an away goes to the others', () => {
    const m = new Mopeds();
    m.onMessage(1, on, rifle, go);
    expect(m.hit(2, 1, 0, RIDER_HP, q10)).toEqual([
      { to: 'all', msg: { t: 'mp', k: 'die', id: 1, r: 0, q: q10, who: 2 } },
    ]);
    expect(m.onMessage(1, on, rifle, snatch).out).toEqual([]);
    expect(m.stolen(1)).toBe(false);
    const n = new Mopeds();
    n.onMessage(1, on, rifle, go);
    expect(
      n.onMessage(1, on, rifle, { t: 'mp', k: 'away', q: q6 }).out,
    ).toEqual([{ to: 'others', msg: { t: 'mp', k: 'away', id: 1, q: q6 } }]);
    expect(n.onMessage(1, on, rifle, snatch).out).toEqual([]);
  });

  test('the riders have the health of a player; the thief drops the gun', () => {
    const m = new Mopeds();
    m.onMessage(1, on, rifle, go);
    m.onMessage(1, on, rifle, snatch);
    expect(m.hit(2, 1, 1, 60, q10)).toEqual([]);
    expect(m.health(1)).toEqual([RIDER_HP, RIDER_HP - 60]);
    // Bad hits do nothing.
    expect(m.hit(2, 1, 2, 60, q10)).toEqual([]);
    expect(m.hit(2, 1, 1, 60, [1, 2, 3])).toEqual([]);
    expect(m.hit(2, 9, 1, 60, q10)).toEqual([]);
    expect(m.hit(2, 1, 1, 60, q10)).toHaveLength(1);
    expect(m.hit(2, 1, 1, 60, q10)).toEqual([]);
    // Player 2 has a primary: no pick. Player 1 is too far: no pick.
    const pick = { t: 'mp', k: 'pick', id: 1 };
    expect(m.onMessage(2, on, rifle, pick).out).toEqual([]);
    const away = { ...on, z: on.z - PICK_REACH - 2 };
    expect(m.onMessage(1, away, rifle, pick).out).toEqual([]);
    // Player 1, near the gun: it gets the gun back, once.
    const r = m.onMessage(1, on, rifle, pick);
    expect(r.out).toEqual([
      { to: 'all', msg: { t: 'mp', k: 'pick', id: 1, who: 1 } },
    ]);
    expect(r.give).toEqual({ id: 1, gun: rifle });
    expect(m.stolen(1)).toBe(false);
    expect(m.robbed(1)).toBe(true);
    expect(m.onMessage(1, on, rifle, pick).out).toEqual([]);
  });

  test('a spawn ends the visit and the empty slot', () => {
    const m = new Mopeds();
    m.onMessage(1, on, rifle, go);
    m.onMessage(1, on, rifle, snatch);
    m.end(1);
    expect(m.stolen(1) || m.robbed(1)).toBe(false);
    expect(m.end(1)).toEqual([]);
  });
});
