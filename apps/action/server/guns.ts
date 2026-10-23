// Where: apps/action/server/guns.ts
// When: index.ts uses it for each pick and each shot. guns.test.ts tests it
// (yarn workspace action test).
// Why: the server takes the damage of each hit from its own table, with
// the same fall-off as the client. The table is guns.json: `zig build guns`
// (in game/) writes it from the gun model in game/src/guns.zig, and
// `zig build test` fails when it is old.
//
// Each model id (the order of guns.bin) has its own stats: the calibre and
// the build of the gun set them. The last model is the knife.
//
// The fall-off: full damage to `near` m, then a straight line down to the
// fraction `min` at `far` m. Past `far` the damage stays at `min`. Each
// pellet does a whole number of damage (rounded), as on the client
// (weapon.zig Stats.damageAt).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type SlotName = 'primary' | 'secondary' | 'knife' | 'grenade';

export interface Gun {
  id: number;
  name: string;
  /** The class id (game/src/weapon.zig Class). */
  class: number;
  slot: SlotName;
  /** The damage of one pellet at full power, to the body and to the head. */
  body: number;
  head: number;
  pellets: number;
  /** The time from one shot (or burst) to the next, in seconds. A burst has
   * `burst` rounds `gap` seconds apart. */
  interval: number;
  burst: number;
  gap: number;
  /** The reach in metres. */
  range: number;
  near: number;
  far: number;
  min: number;
  velocity: number;
  supersonic: boolean;
  /** Samples from the client model: [distance, body, head] damage. */
  check: [number, number, number][];
}

const file = JSON.parse(
  readFileSync(join(import.meta.dir, 'guns.json'), 'utf8'),
) as { guns: Gun[] };

/** Every model, by its id. A gun with no burst has `gap` = `interval`, so
 * that two shots never come closer than half the interval. */
export const GUNS: Gun[] = file.guns.map((g) => ({
  ...g,
  gap: g.burst > 1 ? g.gap : g.interval,
}));

/** The knife model. */
export const KNIFE_GUN: Gun = GUNS[GUNS.length - 1];

/** The model `m` when it exists and is of class `c`, or null. */
export function gunOf(c: number, m: number): Gun | null {
  const g = GUNS[m];
  return g && g.class === c ? g : null;
}

/** The damage multiplier at `dist` m: 1 near, `min` far. */
export function falloff(g: Gun, dist: number): number {
  if (dist <= g.near) return 1;
  if (dist >= g.far) return g.min;
  return 1 - ((1 - g.min) * (dist - g.near)) / (g.far - g.near);
}

/** The damage of one pellet at `dist` m, a whole number. */
export function pelletDamage(g: Gun, head: boolean, dist: number): number {
  return Math.round((head ? g.head : g.body) * falloff(g, dist));
}

/** The damage of one shot at `dist` m: `body` and `head` pellets. The
 * caller checks the reach. */
export function shotDamage(
  g: Gun,
  body: number,
  head: number,
  dist: number,
): number {
  return (
    body * pelletDamage(g, false, dist) + head * pelletDamage(g, true, dist)
  );
}

/** The gun of class `w` in a pick of the primary and the secondary, or the
 * knife. Null when the class is not in the pick. */
export function gunInPick(
  w: number,
  p: [number, number],
  s: [number, number],
): Gun | null {
  if (w === p[0]) return gunOf(p[0], p[1]);
  if (w === s[0]) return gunOf(s[0], s[1]);
  if (w === KNIFE_GUN.class) return KNIFE_GUN;
  return null;
}
