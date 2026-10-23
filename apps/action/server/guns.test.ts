// Where: apps/action/server/guns.test.ts
// When: yarn workspace action test (bun test server).
// Why: the gun table of the server: its fall-off must give the same damage
// as the client model (the `check` samples that game/src/guns.zig writes),
// and the pick and shot checks must find the right gun.
import { describe, expect, test } from 'bun:test';
import {
  falloff,
  GUNS,
  gunInPick,
  gunOf,
  KNIFE_GUN,
  pelletDamage,
  shotDamage,
} from './guns';

const byName = (name: string) => {
  const g = GUNS.find((x) => x.name === name);
  if (!g) throw new Error(`no gun ${name}`);
  return g;
};

describe('the table', () => {
  test('a gun for each model id, and the knife last', () => {
    expect(GUNS.length).toBe(35);
    GUNS.forEach((g, i) => {
      expect(g.id).toBe(i);
    });
    expect(KNIFE_GUN.name).toBe('Bayonet_2');
    expect(KNIFE_GUN.slot).toBe('knife');
  });
  test('a gun with no burst has the interval as its gap', () => {
    const ak = byName('AssaultRifle_2');
    expect(ak.burst).toBe(1);
    expect(ak.gap).toBe(ak.interval);
    const bullpup = byName('Bullpup_1');
    expect(bullpup.burst).toBe(3);
    expect(bullpup.gap).toBeLessThan(bullpup.interval);
  });
});

describe('fall-off', () => {
  test('full damage to near, min at far and past it', () => {
    const g = byName('AssaultRifle2_2');
    expect(falloff(g, 0)).toBe(1);
    expect(falloff(g, g.near)).toBe(1);
    expect(falloff(g, g.far)).toBeCloseTo(g.min, 6);
    expect(falloff(g, g.far + 100)).toBeCloseTo(g.min, 6);
    const mid = falloff(g, (g.near + g.far) / 2);
    expect(mid).toBeCloseTo((1 + g.min) / 2, 5);
  });
  test('the same damage as the client model at each sample distance', () => {
    for (const g of GUNS) {
      for (const [dist, body, head] of g.check) {
        expect([g.name, dist, pelletDamage(g, false, dist)]).toEqual([
          g.name,
          dist,
          body,
        ]);
        expect([g.name, dist, pelletDamage(g, true, dist)]).toEqual([
          g.name,
          dist,
          head,
        ]);
      }
    }
  });
  test('a shot does less damage far away', () => {
    const smg = byName('SubmachineGun_2');
    expect(shotDamage(smg, 1, 0, 40)).toBeLessThan(shotDamage(smg, 1, 0, 5));
    const shotgun = byName('Shotgun_1');
    expect(shotDamage(shotgun, 9, 0, 3)).toBe(9 * shotgun.body);
    expect(shotDamage(shotgun, 6, 2, 3)).toBe(
      6 * shotgun.body + 2 * shotgun.head,
    );
    expect(shotDamage(shotgun, 9, 0, 30)).toBeLessThan(40);
  });
  test('the knife has no fall-off', () => {
    expect(pelletDamage(KNIFE_GUN, false, 1.5)).toBe(55);
  });
});

describe('picks', () => {
  test('the model must be a gun of the class', () => {
    expect(gunOf(0, 1)?.name).toBe('AssaultRifle_2');
    expect(gunOf(1, 1)).toBeNull();
    expect(gunOf(0, 99)).toBeNull();
    expect(gunOf(6, 23)?.slot).toBe('secondary');
  });
  test('a shot of a class finds the gun of the pick', () => {
    const p: [number, number] = [3, 14];
    const s: [number, number] = [7, 30];
    expect(gunInPick(3, p, s)?.name).toBe('SubmachineGun_3');
    expect(gunInPick(7, p, s)?.name).toBe('Revolver_2');
    expect(gunInPick(KNIFE_GUN.class, p, s)).toBe(KNIFE_GUN);
    expect(gunInPick(0, p, s)).toBeNull();
  });
});
