// Where: apps/action/server/ping.ts
// When: index.ts calls pingRound every PING_INTERVAL_MS and onPong for each
// "pong" message. ping.test.ts tests it (yarn workspace action test).
// Why: the server measures the round-trip time to each player with its own
// ping messages, not from game traffic. The Tab score board shows the
// smoothed value.
//
// The round: the server sends {t:"ping", n} to each player that has no
// ping on the way. The client sends {t:"pong", n} back. The sample is the
// time from the ping to the pong. A WebSocket does not lose a message, so
// the server waits for the answer and does not send the ping again. A slow
// link gets fewer pings.
//
// Each round also sends {t:"pings", ms:[[id, ms, stale], ...]} to all
// players: ms is the smoothed time in whole milliseconds (-1 before the
// first answer). stale is 1 when the player gave no answer for
// PING_STALE_MS. The player stays in the lobby. The score board shows its
// last value, marked as stale.

/** The time between two ping rounds, in ms. One list of a few bytes per
 * player every 2 s is much less traffic than a value in each snapshot
 * (20 a second). */
export const PING_INTERVAL_MS = 2000;
/** A player with no answer for this long shows its last value as stale. */
export const PING_STALE_MS = 10_000;
/** The value is the median of this many recent samples (10 s of pings). */
export const PING_SAMPLES = 5;

export interface PingState {
  /** The number of the last ping sent, and its send time. */
  seq: number;
  sentAt: number;
  /** True while the last ping has no answer. */
  waiting: boolean;
  /** The recent samples in ms, the oldest first. */
  samples: number[];
  /** The time of the last answer, or of the join. */
  answeredAt: number;
}

export function newPing(now: number): PingState {
  return { seq: 0, sentAt: 0, waiting: false, samples: [], answeredAt: now };
}

/** The median of the samples, or null when there is none. For an even
 * count it is the lower of the two middle samples. The median ignores one
 * late answer (a background tab, a pause of the client), and it changes
 * little from one sample to the next. */
export function median(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const s = [...samples].sort((a, b) => a - b);
  return s[(s.length - 1) >> 1];
}

/** The number of the next ping, or null while the last one has no answer. */
export function nextPing(s: PingState, now: number): number | null {
  if (s.waiting) return null;
  s.seq++;
  s.sentAt = now;
  s.waiting = true;
  return s.seq;
}

/** An answer to ping n. It counts only for the last ping, one time.
 * Returns true when it counts. */
export function onPong(s: PingState, n: unknown, now: number): boolean {
  if (!s.waiting || n !== s.seq) return false;
  s.waiting = false;
  s.answeredAt = now;
  s.samples.push(Math.max(0, now - s.sentAt));
  if (s.samples.length > PING_SAMPLES) s.samples.shift();
  return true;
}

export function isStale(s: PingState, now: number): boolean {
  return now - s.answeredAt >= PING_STALE_MS;
}

/** One row of the "pings" message: [id, ms, stale]. */
export function pingRow(
  id: number,
  s: PingState,
  now: number,
): [number, number, number] {
  const ms = median(s.samples);
  return [id, ms === null ? -1 : Math.round(ms), isStale(s, now) ? 1 : 0];
}

interface Pinged {
  id: number;
  joined: boolean;
  ping: PingState;
}

/** One ping round over the joined players. `send` sends a message to one
 * player. Returns the "pings" message for all players. */
export function pingRound<P extends Pinged>(
  players: Iterable<P>,
  now: number,
  send: (p: P, msg: object) => void,
): object {
  const rows: [number, number, number][] = [];
  for (const p of players) {
    if (!p.joined) continue;
    const n = nextPing(p.ping, now);
    if (n !== null) send(p, { t: 'ping', n });
    rows.push(pingRow(p.id, p.ping, now));
  }
  return { t: 'pings', ms: rows };
}
