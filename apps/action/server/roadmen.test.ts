// Where: apps/action/server/roadmen.test.ts
// When: `yarn workspace action test` (bun test server).
// Why: the server side of the roadmen (roadmen.ts): a "go" only past the
// roadman line and with two places on Warwick Road, one chase at a time,
// "go" and "off" go to the other players, and a stab does damage only
// during a chase and at the rate of the two roadmen.

import { describe, expect, test } from 'bun:test';
import {
  EXIT_Z,
  LINE,
  MIN_STAB_MS,
  pastLine,
  Roadmen,
  STAB_DAMAGE,
  STAB_GAP_MS,
  STREET_Y,
} from './roadmen';

const at = [
  [-80.7, STREET_Y, EXIT_Z - 74.45],
  [-91.5, STREET_Y, EXIT_Z - 76],
];
const past = { x: -91.5, y: STREET_Y, z: EXIT_Z - LINE - 2, alive: true };
const inside = { ...past, z: EXIT_Z - LINE + 10 };
const go = { t: 'rm', k: 'go', at };
const stab = { t: 'rm', k: 'stab' };

describe('the roadmen', () => {
  test('the line: 50 m along Warwick Road, north and south', () => {
    expect(pastLine(past)).toBe(true);
    expect(pastLine({ ...past, z: EXIT_Z + LINE + 1 })).toBe(true);
    expect(pastLine(inside)).toBe(false);
    // Earls Court Road, and the platforms under the street.
    expect(pastLine({ ...past, x: 85 })).toBe(false);
    expect(pastLine({ ...past, y: 0 })).toBe(false);
  });

  test('a go past the line goes to the other players, once', () => {
    const r = new Roadmen();
    expect(r.onMessage(1, inside, go, 0)).toEqual({ out: [], damage: 0 });
    expect(r.onMessage(1, { ...past, alive: false }, go, 0).out).toEqual([]);
    expect(r.onMessage(1, past, { ...go, at: [at[0]] }, 0).out).toEqual([]);
    expect(
      r.onMessage(1, past, { ...go, at: [at[0], [-80, 0, -70]] }, 0).out,
    ).toEqual([]);
    expect(r.onMessage(1, past, go, 0)).toEqual({
      out: [{ to: 'others', msg: { t: 'rm', k: 'go', at, id: 1 } }],
      damage: 0,
    });
    expect(r.chasing(1)).toBe(true);
    expect(r.onMessage(1, past, go, 10).out).toEqual([]);
  });

  test('a stab does damage only during a chase, at the rate of two', () => {
    const r = new Roadmen();
    expect(r.onMessage(1, past, stab, 5000).damage).toBe(0);
    r.onMessage(1, past, go, 1000);
    expect(r.onMessage(1, past, stab, 1000 + MIN_STAB_MS - 1).damage).toBe(0);
    const t = 1000 + MIN_STAB_MS;
    expect(r.onMessage(1, past, stab, t).damage).toBe(STAB_DAMAGE);
    expect(r.onMessage(1, past, stab, t + STAB_GAP_MS - 1).damage).toBe(0);
    expect(r.onMessage(1, past, stab, t + STAB_GAP_MS).damage).toBe(
      STAB_DAMAGE,
    );
    // Another player has no chase.
    expect(r.onMessage(2, past, stab, t + 1000).damage).toBe(0);
  });

  test('an off ends the chase and goes to the others; a death ends it', () => {
    const r = new Roadmen();
    r.onMessage(1, past, go, 0);
    expect(r.onMessage(1, inside, { t: 'rm', k: 'off' }, 100).out).toEqual([
      { to: 'others', msg: { t: 'rm', k: 'off', id: 1 } },
    ]);
    expect(r.onMessage(1, past, stab, 2000).damage).toBe(0);
    expect(r.onMessage(1, inside, { t: 'rm', k: 'off' }, 2100).out).toEqual([]);
    r.onMessage(1, past, go, 3000);
    r.end(1);
    expect(r.chasing(1)).toBe(false);
    expect(r.onMessage(1, past, stab, 9000).damage).toBe(0);
  });
});
