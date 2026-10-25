// Where: apps/action/server/bikes.ts
// When: index.ts makes one Bikes at start. It adds a moped at each "die"
// of a moped driver, gives it each "mp" message of a moped to ride
// ("mount", "off", "hit"), the `bk` field of each "st", each death and
// leave of a player, and each new match. bikes.test.ts tests it.
// Why: the server side of the moped that a player rides
// (game/src/moped_ride.zig, REQ-MOPED-005). The crash of a thief moped
// leaves one moped. The client of the rider drives it, and the server
// checks each event and sends it, with its place, to the players.
//
// - A new moped: at the death of a moped driver, with a new id. Each
//   player has at most one moped to ride: a newer moped of the visit of
//   the same player makes the old one a wreck.
// - "mount": a live player with no moped, MOUNT_REACH m or less from the
//   moped (the place in the message), and the moped with no rider and no
//   wreck. The place of the moped must be near the last place that the
//   server knows: FRESH_REACH m for a moped that nobody rode (it slid
//   after the crash), MOVED_REACH m for one that a player left.
// - "off": only from the rider. The death or the leave of a rider: an
//   "off" to all the players, with the last place of the rider.
// - "hit": only from a live rider, on another live player, HIT_REACH m or
//   less away, at HIT_SPEED to MAX_SPEED m/s, once each HIT_GAP_MS for a
//   player. The damage grows with the speed (`hitDamage`).
// - The `bk` field of an "st": only for the moped of the rider.

/** A moped hits a player at this speed or more, m/s (moped_ride.zig). */
export const HIT_SPEED = 3;
/** The top speed of a moped and some slack, m/s. */
export const MAX_SPEED = 20;
/** A hit: the rider at most this far from the player (the lag too). */
export const HIT_REACH = 5;
/** The time between two hits on one player, ms. */
export const HIT_GAP_MS = 400;
/** A mount: the player at most this far from the moped. */
export const MOUNT_REACH = 4;
/** The moped at most this far from its last known place: after a crash,
 * and after a player left it. */
export const FRESH_REACH = 45;
export const MOVED_REACH = 12;
/** The kill feed name of a moped hit. */
export const MOPED = 'moped';

/** The damage of a moped hit at `speed` m/s (moped_ride.zig hitDamage). */
export function hitDamage(speed: number): number {
  return Math.round(Math.min(100, Math.max(0, (speed - HIT_SPEED) * 7)));
}

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

/** The pose of a moped in an "st": yaw, roll, pitch, speed. */
export type Pose = [number, number, number, number];

interface Bike {
  id: number;
  owner: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  rider: number | null;
  wreck: boolean;
  /** A player left it: it moved from the place of the crash. */
  moved: boolean;
}

/** A moped state (moped_ride.zig State): 7 numbers, in the map. */
export function bikeState(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length !== 7) return null;
  if (!v.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const q = v as number[];
  if (Math.abs(q[0]) > 420 || Math.abs(q[1]) > 30 || Math.abs(q[2]) > 260)
    return null;
  return q;
}

const dist = (p: Where, q: { x: number; y: number; z: number }): number =>
  Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

export class Bikes {
  private readonly bikes = new Map<number, Bike>();
  private nextId = 1;
  /** The pose of each rider from its last "st". */
  private readonly poses = new Map<number, Pose>();
  /** The time of the last hit on each player, ms. */
  private readonly lastHit = new Map<number, number>();

  /** A new moped of the visit of player `owner` at the place of the crash
   * of its driver. Returns its id. */
  add(owner: number, q: number[]): number {
    for (const b of this.bikes.values()) if (b.owner === owner) b.wreck = true;
    const id = this.nextId++;
    this.bikes.set(id, {
      id,
      owner,
      x: q[0],
      y: q[1],
      z: q[2],
      yaw: q[3],
      rider: null,
      wreck: false,
      moved: false,
    });
    return id;
  }

  /** The moped that player `id` rides, or null. */
  ridden(id: number): number | null {
    for (const b of this.bikes.values()) if (b.rider === id) return b.id;
    return null;
  }

  /** An "mp" message of player `id` at `p` for a moped to ride. */
  onMessage(id: number, p: Where, msg: Record<string, unknown>): Out[] {
    if (!p.alive) return [];
    const b = typeof msg.bk === 'number' ? this.bikes.get(msg.bk) : undefined;
    const q = bikeState(msg.q);
    if (!b || !q) return [];
    const at = { x: q[0], y: q[1], z: q[2] };
    if (msg.k === 'mount') {
      if (b.rider !== null || b.wreck || this.ridden(id) !== null) return [];
      if (dist(p, at) > MOUNT_REACH) return [];
      const reach = b.moved ? MOVED_REACH : FRESH_REACH;
      if (Math.hypot(b.x - at.x, b.y - at.y, b.z - at.z) > reach) return [];
      Object.assign(b, { ...at, yaw: q[3], rider: id });
      this.poses.set(id, [q[3], 0, 0, 0]);
      const mount = { t: 'mp', k: 'mount', bk: b.id, id, q: q.slice(0, 7) };
      return [{ to: 'all', msg: mount }];
    }
    if (msg.k === 'off') {
      if (b.rider !== id) return [];
      this.free(b, at, q[3]);
      const off: Record<string, unknown> = { t: 'mp', k: 'off', bk: b.id, id };
      off.q = q;
      if (msg.cr === 1) off.cr = 1;
      return [{ to: 'others', msg: off }];
    }
    return [];
  }

  /**
   * A "hit" of player `id` at `p` on player `victim` at `v`, at `now` ms.
   * Returns the damage, or 0.
   */
  hit(
    id: number,
    p: Where,
    msg: Record<string, unknown>,
    victim: number,
    v: Where | undefined,
    now: number,
  ): number {
    const bk = typeof msg.bk === 'number' ? msg.bk : -1;
    const b = this.bikes.get(bk);
    const sp = Number(msg.sp);
    if (!b || b.rider !== id || !p.alive || !v || !v.alive || victim === id)
      return 0;
    if (!(sp >= HIT_SPEED && sp <= MAX_SPEED)) return 0;
    if (dist(p, v) > HIT_REACH) return 0;
    if (now - (this.lastHit.get(victim) ?? -1e9) < HIT_GAP_MS) return 0;
    const dmg = hitDamage(sp);
    if (dmg < 1) return 0;
    this.lastHit.set(victim, now);
    return dmg;
  }

  /** The `bk` field of an "st" of player `id`: [moped, yaw, roll, pitch,
   * speed]. Returns the field for the snapshot, or null. */
  pose(id: number, v: unknown): number[] | null {
    if (!Array.isArray(v) || v.length !== 5) return null;
    if (!v.every((x) => typeof x === 'number' && Number.isFinite(x)))
      return null;
    const b = this.bikes.get(v[0]);
    if (!b || b.rider !== id) return null;
    const pose: Pose = [v[1], v[2], v[3], v[4]];
    this.poses.set(id, pose);
    return [b.id, ...pose];
  }

  /**
   * Player `id` at `p` died or left: its moped goes on with no rider. The
   * "off" goes to all the players, with the last place of the rider.
   * `died`: a ragdoll falls from the seat.
   */
  release(id: number, p: Where, died: boolean): Out[] {
    const bk = this.ridden(id);
    if (bk === null) return [];
    const b = this.bikes.get(bk) as Bike;
    const [yaw, roll, , speed] = this.poses.get(id) ?? [b.yaw, 0, 0, 0];
    this.free(b, p, yaw);
    const q = [p.x, p.y, p.z, yaw, speed, roll, 0];
    const off: Record<string, unknown> = { t: 'mp', k: 'off', bk, id, q };
    if (died) off.dd = 1;
    return [{ to: 'all', msg: off }];
  }

  private free(
    b: Bike,
    at: { x: number; y: number; z: number },
    yaw: number,
  ): void {
    if (b.rider !== null) this.poses.delete(b.rider);
    Object.assign(b, { x: at.x, y: at.y, z: at.z, yaw, rider: null });
    b.moved = true;
  }

  /** The mopeds for a player who joins: [id, x, y, z, yaw, rider or -1,
   * owner] each, the oldest first. */
  list(): number[][] {
    return [...this.bikes.values()].map((b) => [
      b.id,
      +b.x.toFixed(3),
      +b.y.toFixed(3),
      +b.z.toFixed(3),
      +b.yaw.toFixed(3),
      b.rider ?? -1,
      b.owner,
    ]);
  }

  /** A new match: no mopeds. */
  reset(): void {
    this.bikes.clear();
    this.poses.clear();
    this.lastHit.clear();
  }

  /** The number of mopeds: tests. */
  count(): number {
    return this.bikes.size;
  }
}
