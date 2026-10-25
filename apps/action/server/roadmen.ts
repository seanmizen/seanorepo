// Where: apps/action/server/roadmen.ts
// When: index.ts makes one Roadmen at start and gives it each "rm"
// message. roadmen.test.ts tests it.
// Why: the server side of the roadmen of Warwick Road
// (game/src/roadmen.zig). The client of a player decides: it starts the
// gang when the player goes past the roadman line, and it stops it when
// the player goes back. The server checks each event, sends "go" and "off"
// to the other players, and applies the damage of each stab. A death by a
// stab credits "roadman" in the kill feed (index.ts).
//
// - "go": only for a player who is alive and past the line (the position
//   of the last "st" message, with SLACK for its lag), and with no chase.
//   `at` must hold two places on Warwick Road.
// - "off": the end of the chase of that player.
// - "stab": only during a chase, MIN_STAB_MS or more after the go, and
//   STAB_GAP_MS or more after the last stab. Each one does STAB_DAMAGE.
// - A death, a spawn and a leave end the chase.

/// The roadman line: the distance along Warwick Road from the station exit
/// (game/src/roadmen.zig line).
export const LINE = 50;
/// The exit (z) and the x band of Warwick Road, and the street height
/// (game/src/maps/earls_court.zig warwick_exit_z, warwick_band, street_y).
export const EXIT_Z = -2;
export const BAND_X: [number, number] = [-106, -77];
export const STREET_Y = 4.8;
/// The lag of the positions: a "go" may come this far before the line.
const SLACK = 4;
/// The fence across the street (warwick_fence): no place past it.
const FENCE = 150;
/// The damage of one stab (roadmen.zig damage).
export const STAB_DAMAGE = 25;
/// The first stab comes this long after the go at the soonest.
export const MIN_STAB_MS = 400;
/// Two stabs (the two roadmen take turns) come this far apart at least.
export const STAB_GAP_MS = 150;
/// The kill feed name.
export const ROADMAN = 'roadman';

export interface Where {
  x: number;
  y: number;
  z: number;
  alive: boolean;
}

/** A message, and who gets it: the other players. */
export interface Out {
  to: 'others';
  msg: object;
}

interface Chase {
  at: number;
  lastStab: number;
}

/** True on Warwick Road, `slack` metres or less short of the line. */
export function pastLine(p: Where, slack = 0): boolean {
  return (
    p.x > BAND_X[0] &&
    p.x < BAND_X[1] &&
    p.y > STREET_Y - 1 &&
    p.y < STREET_Y + 4 &&
    Math.abs(p.z - EXIT_Z) > LINE - slack
  );
}

/** Two places on Warwick Road, short of the fence, or null. */
function places(v: unknown): number[][] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const out: number[][] = [];
  for (const q of v) {
    if (!Array.isArray(q) || q.length !== 3) return null;
    if (!q.every((x) => typeof x === 'number' && Number.isFinite(x)))
      return null;
    const [x, y, z] = q as number[];
    if (x < BAND_X[0] || x > BAND_X[1] || Math.abs(y - STREET_Y) > 1)
      return null;
    if (Math.abs(z - EXIT_Z) > FENCE) return null;
    out.push([x, y, z]);
  }
  return out;
}

export class Roadmen {
  private readonly chases = new Map<number, Chase>();

  /** True while player `id` has a chase. */
  chasing(id: number): boolean {
    return this.chases.has(id);
  }

  /** The end of the chase of player `id`: a death, a spawn or a leave. */
  end(id: number): void {
    this.chases.delete(id);
  }

  /**
   * An "rm" message of player `id` at `p`. Returns the messages for the
   * other players, and the damage of a stab to apply to the player.
   */
  onMessage(
    id: number,
    p: Where,
    msg: Record<string, unknown>,
    now: number,
  ): { out: Out[]; damage: number } {
    const none = { out: [], damage: 0 };
    if (!p.alive) return none;
    const chase = this.chases.get(id);
    if (msg.k === 'go') {
      const at = places(msg.at);
      if (!at || chase || !pastLine(p, SLACK)) return none;
      this.chases.set(id, { at: now, lastStab: 0 });
      return {
        out: [{ to: 'others', msg: { t: 'rm', k: 'go', at, id } }],
        damage: 0,
      };
    }
    if (msg.k === 'off') {
      if (!chase) return none;
      this.chases.delete(id);
      return {
        out: [{ to: 'others', msg: { t: 'rm', k: 'off', id } }],
        damage: 0,
      };
    }
    if (msg.k === 'stab') {
      if (!chase || now - chase.at < MIN_STAB_MS) return none;
      if (now - chase.lastStab < STAB_GAP_MS) return none;
      chase.lastStab = now;
      return { out: [], damage: STAB_DAMAGE };
    }
    return none;
  }
}
