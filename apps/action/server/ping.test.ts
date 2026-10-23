// Where: apps/action/server/ping.test.ts
// When: yarn workspace action test (bun test server).
// Why: the ping calculation of the server: the samples, the median, the
// stale mark and one round over the players.
import { describe, expect, test } from 'bun:test';
import {
  isStale,
  median,
  newPing,
  nextPing,
  onPong,
  PING_INTERVAL_MS,
  PING_SAMPLES,
  PING_STALE_MS,
  type PingState,
  pingRound,
  pingRow,
} from './ping';

/** One ping at `at`, answered `rtt` ms later. */
function answer(s: PingState, at: number, rtt: number): void {
  const n = nextPing(s, at);
  expect(n).not.toBeNull();
  expect(onPong(s, n, at + rtt)).toBe(true);
}

describe('median', () => {
  test('no samples gives null', () => {
    expect(median([])).toBeNull();
  });
  test('an odd count gives the middle sample', () => {
    expect(median([90, 30, 50])).toBe(50);
  });
  test('an even count gives the lower middle sample', () => {
    expect(median([40, 10, 30, 20])).toBe(20);
    expect(median([30, 8000])).toBe(30);
  });
});

describe('ping state', () => {
  test('a new player has no value and is not stale', () => {
    const s = newPing(0);
    expect(pingRow(7, s, 0)).toEqual([7, -1, 0]);
  });

  test('the first answer sets the value in whole ms', () => {
    const s = newPing(0);
    answer(s, 1000, 42.6);
    expect(pingRow(3, s, 1100)).toEqual([3, 43, 0]);
  });

  test('one late answer does not move the value', () => {
    const s = newPing(0);
    let t = 0;
    for (const rtt of [50, 52, 48, 51]) {
      answer(s, t, rtt);
      t += PING_INTERVAL_MS;
    }
    // A background tab: the client answers 6 s late.
    answer(s, t, 6000);
    expect(pingRow(1, s, t + 6000)[1]).toBe(51);
  });

  test('the value follows a change of the link in a few rounds', () => {
    const s = newPing(0);
    let t = 0;
    for (let i = 0; i < PING_SAMPLES; i++) {
      answer(s, t, 40);
      t += PING_INTERVAL_MS;
    }
    for (let i = 0; i < 3; i++) {
      answer(s, t, 140);
      t += PING_INTERVAL_MS;
    }
    expect(pingRow(1, s, t)[1]).toBe(140);
    expect(s.samples.length).toBe(PING_SAMPLES);
  });

  test('no second ping while the first one has no answer', () => {
    const s = newPing(0);
    expect(nextPing(s, 0)).toBe(1);
    expect(nextPing(s, PING_INTERVAL_MS)).toBeNull();
    expect(nextPing(s, PING_STALE_MS * 3)).toBeNull();
    expect(onPong(s, 1, 100)).toBe(true);
    expect(nextPing(s, PING_INTERVAL_MS)).toBe(2);
  });

  test('a wrong, a repeated or a non-number answer does not count', () => {
    const s = newPing(0);
    const n = nextPing(s, 0);
    expect(onPong(s, 99, 10)).toBe(false);
    expect(onPong(s, String(n), 10)).toBe(false);
    expect(onPong(s, n, 20)).toBe(true);
    expect(onPong(s, n, 30)).toBe(false);
    expect(s.samples).toEqual([20]);
  });

  test('no answer for PING_STALE_MS marks the last value as stale', () => {
    const s = newPing(0);
    answer(s, 0, 30);
    nextPing(s, PING_INTERVAL_MS);
    expect(isStale(s, 30 + PING_STALE_MS - 1)).toBe(false);
    expect(pingRow(2, s, 30 + PING_STALE_MS)).toEqual([2, 30, 1]);
    // The late answer clears the mark. The median keeps the old value.
    expect(onPong(s, s.seq, 30 + PING_STALE_MS + 500)).toBe(true);
    expect(pingRow(2, s, 30 + PING_STALE_MS + 500)).toEqual([2, 30, 0]);
  });
});

describe('pingRound', () => {
  test('pings the joined players and lists them for all', () => {
    const players = [
      { id: 1, joined: true, ping: newPing(0) },
      { id: 2, joined: false, ping: newPing(0) },
      { id: 3, joined: true, ping: newPing(0) },
    ];
    const sent: [number, object][] = [];
    const send = (p: { id: number }, msg: object) => sent.push([p.id, msg]);

    expect(pingRound(players, 0, send)).toEqual({
      t: 'pings',
      ms: [
        [1, -1, 0],
        [3, -1, 0],
      ],
    });
    expect(sent).toEqual([
      [1, { t: 'ping', n: 1 }],
      [3, { t: 'ping', n: 1 }],
    ]);

    // Player 1 answers. Player 3 does not, so it gets no new ping.
    onPong(players[0].ping, 1, 35);
    sent.length = 0;
    expect(pingRound(players, PING_INTERVAL_MS, send)).toEqual({
      t: 'pings',
      ms: [
        [1, 35, 0],
        [3, -1, 0],
      ],
    });
    expect(sent).toEqual([[1, { t: 'ping', n: 2 }]]);
  });
});
