// Where: apps/action/server/pigeons.ts
// When: index.ts makes one Flock at start. pigeons.test.ts tests it.
// Why: the server side of the pigeons of Earl's Court
// (game/src/pigeons.zig). The server owns the state of each pigeon and of
// each body. It does not fly the pigeons: each client flies them from the
// seed of each event, with the same result.
//
// - A pigeon is here (0: on a perch, or on a joyride or a return to it),
//   flown off (1) or dead (2). A pigeon that is not here comes back
//   RETURN_MS later: the server picks a free perch and a seed ("back"),
//   and the generation goes up by one.
// - Now and then the server sends a pigeon that is here on a joyride to a
//   new perch ("joy").
// - A perch is [rod, u]: the tie rod (0 to RODS - 1) and the place along it
//   (0 to 1). The client turns it into a place (pigeons.zig perchAt).
// - The client that startles or kills a pigeon decides. The server checks
//   the state and sends the event to the other players: "up" (here to flown
//   off), "die" (to dead, a new body).
// - A body is [bird, gen]. "push" (a shot, a blast, a kick, a place of
//   rest) and "drop" go to the other players. "grab" goes to the first
//   player only: the server sends the holder to all, or to a late player
//   only. A player who leaves drops what it holds.
// - Each FLOCK_MS the server sends the state of the flock. On join it also
//   sends the seed (the tints) and the bodies.

/// The pigeons: pigeons.zig max_birds.
export const BIRDS = 12;
/// The tie rods of the train shed roof: the same as pigeons.zig rodCount()
/// on Earl's Court (pigeons_test.zig checks it).
export const RODS = 14;
/// Two perches on one rod are at least this far apart along it (about 0.6 m).
const MIN_GAP_U = 0.025;
/// From a leave or a death to the return (pigeons.zig return_delay). A
/// pigeon that flew off gets LEAVE_MS more: its flight out of the shed.
export const RETURN_MS: [number, number] = [60_000, 180_000];
export const LEAVE_MS = 20_000;
/// The time between two joyrides.
const JOY_MS: [number, number] = [15_000, 45_000];
/// No joyride for a pigeon this long after its last joyride or return: it
/// may still be in the air.
const BUSY_MS = 20_000;
/// The interval of the flock message.
export const FLOCK_MS = 10_000;
const MAX_BODIES = 12;

export const HERE = 0;
export const FLOWN = 1;
export const DEAD = 2;

export interface Bird {
  st: number;
  g: number;
  rod: number;
  u: number;
  /** Not here: the time of the return. */
  ret: number;
  /** The end of the last joyride or return. */
  busy: number;
}

export interface Body {
  i: number;
  g: number;
  p: number[];
  /** The id of the player who holds it, or 0. */
  holder: number;
}

/** A message, and who gets it: the other players, all players, or the
 * sender only. */
export interface Out {
  to: 'others' | 'all' | 'sender';
  msg: object;
}

const KINDS = new Set(['up', 'die', 'push', 'grab', 'drop']);

const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

const vec3 = (v: unknown, lim: number): number[] | null => {
  if (!Array.isArray(v) || v.length !== 3) return null;
  if (!v.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  return v.map((x: number) => Math.min(lim, Math.max(-lim, x)));
};

export class Flock {
  readonly seed: number;
  readonly birds: Bird[] = [];
  readonly bodies = new Map<string, Body>();
  private nextJoy: number;
  private nextSync: number;

  constructor(
    now: number,
    private readonly rand: () => number = Math.random,
  ) {
    this.seed = this.newSeed();
    for (let i = 0; i < BIRDS; i++) {
      const b: Bird = { st: HERE, g: 0, rod: 0, u: 0, ret: 0, busy: 0 };
      this.birds.push(b);
      [b.rod, b.u] = this.freePerch(i);
    }
    this.nextJoy = now + this.between(JOY_MS);
    this.nextSync = now + FLOCK_MS;
  }

  private newSeed(): number {
    return Math.floor(this.rand() * 2 ** 32) >>> 0;
  }

  private between([lo, hi]: [number, number]): number {
    return lo + (hi - lo) * this.rand();
  }

  /** A perch on a random rod, away from the other pigeons that are here. */
  private freePerch(self: number): [number, number] {
    let rod = 0;
    let u = 0;
    for (let tries = 0; tries < 40; tries++) {
      rod = Math.floor(this.rand() * RODS);
      u = +this.rand().toFixed(4);
      const busy = this.birds.some(
        (o, j) =>
          j !== self &&
          o.st === HERE &&
          o.rod === rod &&
          Math.abs(o.u - u) < MIN_GAP_U,
      );
      if (!busy) break;
    }
    return [rod, u];
  }

  /** The flock message. `join`: with the seed and the bodies. */
  state(join: boolean): object {
    return {
      t: 'flock',
      b: this.birds.map((b) => [b.st, b.g, b.rod, b.u]),
      ...(join
        ? {
            sd: this.seed,
            c: [...this.bodies.values()].map((c) => [
              c.i,
              c.g,
              ...c.p,
              c.holder,
            ]),
          }
        : {}),
    };
  }

  private addBody(i: number, g: number, p: number[]): Body {
    const key = `${i}:${g}`;
    let body = this.bodies.get(key);
    if (!body) {
      body = { i, g, p, holder: 0 };
      this.bodies.set(key, body);
      // The oldest body goes first, as on the client.
      if (this.bodies.size > MAX_BODIES) {
        const first = this.bodies.keys().next().value;
        if (first !== undefined) this.bodies.delete(first);
      }
    }
    return body;
  }

  /** A {t:"pg"} message of player `id`. Returns the messages to send. */
  onMessage(id: number, msg: Record<string, unknown>, now: number): Out[] {
    const k = msg.k;
    const i = int(msg.i, 0, BIRDS - 1);
    if (typeof k !== 'string' || !KINDS.has(k) || i === null) return [];
    const b = this.birds[i];
    const g = int(msg.g, 0, 65535) ?? 0;
    const o = vec3(msg.o, 500);
    const v = vec3(msg.v, 60) ?? [0, 0, 0];
    switch (k) {
      case 'up': {
        const sd = int(msg.sd, 0, 2 ** 32 - 1);
        if (b.st !== HERE || sd === null || !o) return [];
        b.st = FLOWN;
        b.ret = now + LEAVE_MS + this.between(RETURN_MS);
        return [{ to: 'others', msg: { t: 'pg', k, i, sd, o, v, id } }];
      }
      case 'die': {
        if (b.st === DEAD || g !== b.g || !o) return [];
        b.st = DEAD;
        b.ret = now + this.between(RETURN_MS);
        this.addBody(i, g, o);
        return [{ to: 'others', msg: { t: 'pg', k, i, g, o, v, id } }];
      }
      case 'push': {
        if (!o) return [];
        const body = this.bodies.get(`${i}:${g}`);
        if (body && body.holder !== 0) return [];
        if (body) body.p = o;
        else this.addBody(i, g, o);
        return [{ to: 'others', msg: { t: 'pg', k, i, g, o, v, id } }];
      }
      case 'grab': {
        const body = this.bodies.get(`${i}:${g}`);
        if (!body) return [];
        if (body.holder !== 0 && body.holder !== id)
          return [{ to: 'sender', msg: { t: 'pg', k, i, g, id: body.holder } }];
        body.holder = id;
        return [{ to: 'all', msg: { t: 'pg', k, i, g, id } }];
      }
      case 'drop': {
        const body = this.bodies.get(`${i}:${g}`);
        if (!body || body.holder !== id || !o) return [];
        body.holder = 0;
        body.p = o;
        return [{ to: 'others', msg: { t: 'pg', k, i, g, o, v, id } }];
      }
    }
    return [];
  }

  /** Player `id` left: it drops what it holds, where it is. */
  leave(id: number): object[] {
    const out: object[] = [];
    for (const c of this.bodies.values()) {
      if (c.holder !== id) continue;
      c.holder = 0;
      out.push({ t: 'pg', k: 'drop', i: c.i, g: c.g });
    }
    return out;
  }

  /** The returns, the joyrides and the flock message. Returns the
   * messages for all players. */
  step(now: number): object[] {
    const out: object[] = [];
    this.birds.forEach((b, i) => {
      if (b.st === HERE || now < b.ret) return;
      b.st = HERE;
      b.g++;
      [b.rod, b.u] = this.freePerch(i);
      b.busy = now + BUSY_MS;
      out.push({
        t: 'pg',
        k: 'back',
        i,
        g: b.g,
        sd: this.newSeed(),
        pr: [b.rod, b.u],
      });
    });
    if (now >= this.nextJoy) {
      this.nextJoy = now + this.between(JOY_MS);
      const free = this.birds
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => b.st === HERE && now >= b.busy);
      if (free.length > 0) {
        const { b, i } = free[Math.floor(this.rand() * free.length)];
        [b.rod, b.u] = this.freePerch(i);
        b.busy = now + BUSY_MS;
        out.push({
          t: 'pg',
          k: 'joy',
          i,
          sd: this.newSeed(),
          pr: [b.rod, b.u],
        });
      }
    }
    if (now >= this.nextSync) {
      this.nextSync = now + FLOCK_MS;
      out.push(this.state(false));
    }
    return out;
  }
}
