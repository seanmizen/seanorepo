// Where: apps/action/server/moped.ts
// When: index.ts makes one Mopeds at start and gives it each "mp" message,
// the moped hits of each "fire" and "blast", and each spawn and leave.
// moped.test.ts tests it.
// Why: the server side of the moped thieves of Warwick Road
// (game/src/moped.zig). The client of a player decides the approach of
// its moped. The server owns the stolen gun and the health of the two
// riders, and it sends each event, with its place, to the players.
//
// - "go": only for a player who is alive and on the street of Warwick
//   Road (the position of the last "st", with SLACK), with a primary, and
//   with no visit in this life.
// - "snatch": only during the approach, with both riders alive, and with
//   the moped STEAL_REACH m or less from the player. The gun of the
//   primary slot goes to the thief. The slot of the player is empty for
//   the rest of the life: no shot of that class, and a pick in the weapon
//   menu does not change the weapons of the life.
// - "away": the approach ends with no gun.
// - A hit: the damage of a shot, a cut or a blast on a rider. At 0 health
//   a "die" goes to all the players. The driver death is a crash. The
//   thief death puts a gun that he holds on the ground.
// - "pick": the gun on the ground goes to a live player with an empty
//   primary slot, PICK_REACH m or less from it.
// - A spawn and a leave of the player end the visit: an "end" goes to all.

/** The street of Warwick Road between the terraces (x), the exit (z), the
 * street height and the fences (game/src/maps/earls_court.zig, moped.zig
 * onStreet). */
export const STREET_X: [number, number] = [-99, -84];
export const EXIT_Z = -2;
export const STREET_Y = 4.8;
export const FENCE = 150;
/** The band where a moped or a thief can be: the alleys too. */
const BAND_X: [number, number] = [-106, -77];
/** The lag of the positions. */
const SLACK = 3;
/** The health of each rider (moped.zig hp_full). */
export const RIDER_HP = 100;
/** A snatch: the moped at most this far from the server position of the
 * player. */
export const STEAL_REACH = 8;
/** A pick: the player at most this far from the gun. */
export const PICK_REACH = 4;
/** The kill feed names of the riders (moped.zig names). */
export const RIDERS = ['moped driver', 'moped thief'];

export interface Where {
  x: number;
  y: number;
  z: number;
  alive: boolean;
}

/** A message, and who gets it: the other players, or all of them. */
export interface Out {
  to: 'others' | 'all';
  msg: object;
}

/** A gun as [class, model]. */
export type Gun = [number, number];

interface Ride {
  stage: 'ride' | 'away' | 'crash';
  hp: [number, number];
  gun: Gun | null;
  /** Who has the gun: the thief, the ground, or a player id. */
  holder: 'thief' | 'ground' | number | null;
  drop: [number, number, number] | null;
}

/** True on the street of Warwick Road, `slack` metres or less outside. */
export function onStreet(p: Where, slack = 0): boolean {
  return (
    p.x > STREET_X[0] - slack &&
    p.x < STREET_X[1] + slack &&
    p.y > STREET_Y - 1 &&
    p.y < STREET_Y + 3 &&
    Math.abs(p.z - EXIT_Z) < FENCE
  );
}

/** A moped state of `n` numbers or more (game/src/moped.zig State) in
 * the band of Warwick Road, or null. Returns at most 10 numbers. */
export function stateOf(v: unknown, n: number): number[] | null {
  if (!Array.isArray(v) || v.length < n || v.length > 10) return null;
  if (!v.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const q = v as number[];
  if (q[0] < BAND_X[0] || q[0] > BAND_X[1]) return null;
  if (Math.abs(q[1] - STREET_Y) > 2) return null;
  if (Math.abs(q[2] - EXIT_Z) > FENCE + 10) return null;
  return q;
}

const dist = (p: Where, q: number[]): number =>
  Math.hypot(p.x - q[0], p.y - q[1], p.z - q[2]);

export class Mopeds {
  private readonly rides = new Map<number, Ride>();
  /** The players with a visit in this life. */
  private readonly visited = new Set<number>();
  /** The players with an empty primary slot. */
  private readonly empty = new Set<number>();
  /** The players robbed in this life. */
  private readonly robbedSet = new Set<number>();

  /** True while the primary slot of player `id` is empty. */
  stolen(id: number): boolean {
    return this.empty.has(id);
  }

  /** True when a thief took the primary of player `id` in this life. */
  robbed(id: number): boolean {
    return this.robbedSet.has(id);
  }

  /** The end of the visit of player `id`: a spawn or a leave. */
  end(id: number): Out[] {
    this.visited.delete(id);
    this.empty.delete(id);
    this.robbedSet.delete(id);
    if (!this.rides.delete(id)) return [];
    return [{ to: 'all', msg: { t: 'mp', k: 'end', id } }];
  }

  /**
   * An "mp" message of player `id` at `p`, whose primary is `primary`.
   * Returns the messages, and a gun to give to a player (a pick).
   */
  onMessage(
    id: number,
    p: Where,
    primary: Gun,
    msg: Record<string, unknown>,
  ): { out: Out[]; give?: { id: number; gun: Gun } } {
    const none = { out: [] };
    if (!p.alive) return none;
    if (msg.k === 'pick') return this.pick(id, p, msg.id);
    const ride = this.rides.get(id);
    if (msg.k === 'go') {
      const q = stateOf(msg.q, 6);
      if (!q || ride || this.visited.has(id) || this.empty.has(id)) return none;
      if (!onStreet(p, SLACK)) return none;
      this.visited.add(id);
      this.rides.set(id, {
        stage: 'ride',
        hp: [RIDER_HP, RIDER_HP],
        gun: null,
        holder: null,
        drop: null,
      });
      return {
        out: [
          { to: 'others', msg: { t: 'mp', k: 'go', id, q: q.slice(0, 6) } },
        ],
      };
    }
    if (msg.k === 'snatch') {
      const q = stateOf(msg.q, 6);
      if (!q || !ride || ride.stage !== 'ride' || this.empty.has(id))
        return none;
      if (ride.hp[0] <= 0 || ride.hp[1] <= 0) return none;
      if (dist(p, q) > STEAL_REACH) return none;
      ride.stage = 'away';
      ride.gun = [...primary];
      ride.holder = 'thief';
      this.empty.add(id);
      this.robbedSet.add(id);
      const out = { t: 'mp', k: 'snatch', id, q: q.slice(0, 6), p: ride.gun };
      return { out: [{ to: 'all', msg: out }] };
    }
    if (msg.k === 'away') {
      const q = stateOf(msg.q, 6);
      if (!q || !ride || ride.stage !== 'ride') return none;
      ride.stage = 'away';
      return {
        out: [
          { to: 'others', msg: { t: 'mp', k: 'away', id, q: q.slice(0, 6) } },
        ],
      };
    }
    return none;
  }

  /** F on the gun of the visit of player `owner`, by player `id` at p. */
  private pick(
    id: number,
    p: Where,
    owner: unknown,
  ): { out: Out[]; give?: { id: number; gun: Gun } } {
    const ride = typeof owner === 'number' ? this.rides.get(owner) : undefined;
    if (!ride || ride.holder !== 'ground' || !ride.drop || !ride.gun)
      return { out: [] };
    if (!this.empty.has(id) || dist(p, ride.drop) > PICK_REACH)
      return { out: [] };
    ride.holder = id;
    ride.drop = null;
    this.empty.delete(id);
    return {
      out: [{ to: 'all', msg: { t: 'mp', k: 'pick', id: owner, who: id } }],
      give: { id, gun: ride.gun },
    };
  }

  /**
   * A hit of player `who` on rider `rider` (0 the driver, 1 the thief) of
   * the visit of player `owner`: `dmg` damage, with the state `q` of the
   * rider. Returns the "die" at 0 health.
   */
  hit(
    who: number,
    owner: unknown,
    rider: unknown,
    dmg: number,
    q: unknown,
  ): Out[] {
    if (typeof owner !== 'number' || (rider !== 0 && rider !== 1)) return [];
    const ride = this.rides.get(owner);
    const s = stateOf(q, 10);
    if (!ride || !s || ride.hp[rider] <= 0 || !(dmg > 0)) return [];
    ride.hp[rider] = Math.max(0, ride.hp[rider] - dmg);
    if (ride.hp[rider] > 0) return [];
    if (rider === 0) {
      ride.stage = 'crash';
    } else {
      if (ride.stage === 'ride') ride.stage = 'away';
      if (ride.holder === 'thief') {
        ride.holder = 'ground';
        ride.drop = [s[0], s[1], s[2]];
      }
    }
    return [
      {
        to: 'all',
        msg: { t: 'mp', k: 'die', id: owner, r: rider, q: s, who },
      },
    ];
  }

  /** The health of the riders of the visit of player `owner`: tests. */
  health(owner: number): [number, number] | null {
    return this.rides.get(owner)?.hp ?? null;
  }
}
