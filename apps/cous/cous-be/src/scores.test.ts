import { afterAll, describe, expect, test } from 'bun:test';
import { buildApp } from './app';
import { openScoreStore } from './db';
import { createRateLimiter } from './rate-limit';
import { maxBirdsFor, maxScoreFor, validateScore } from './validation';

const valid = { name: 'cous', score: 100, durationMs: 60_000 };

describe('validateScore', () => {
  test('accepts a valid score and trims the name', () => {
    const result = validateScore({ ...valid, name: '  cous  ' });
    expect(result).toEqual({ ok: true, value: { ...valid, name: 'cous' } });
  });

  test('rejects a body that is not an object', () => {
    expect(validateScore(null).ok).toBe(false);
    expect(validateScore('cous').ok).toBe(false);
  });

  test('rejects an empty name or a name of only spaces', () => {
    expect(validateScore({ ...valid, name: '' }).ok).toBe(false);
    expect(validateScore({ ...valid, name: '   ' }).ok).toBe(false);
  });

  test('accepts 10 characters and rejects 11', () => {
    expect(validateScore({ ...valid, name: 'a'.repeat(10) }).ok).toBe(true);
    expect(validateScore({ ...valid, name: 'a'.repeat(11) }).ok).toBe(false);
  });

  test('counts characters, not UTF-16 units', () => {
    expect(validateScore({ ...valid, name: '🐈'.repeat(10) }).ok).toBe(true);
  });

  test('rejects control and format characters', () => {
    expect(validateScore({ ...valid, name: 'co\nus' }).ok).toBe(false);
    expect(validateScore({ ...valid, name: 'co\u0000us' }).ok).toBe(false);
    expect(validateScore({ ...valid, name: 'co‮us' }).ok).toBe(false);
    expect(validateScore({ ...valid, name: 'co us' }).ok).toBe(false);
  });

  test('accepts a space inside the name', () => {
    expect(validateScore({ ...valid, name: 'cous cous' }).ok).toBe(true);
  });

  test('rejects a name that is not a string', () => {
    expect(validateScore({ ...valid, name: 42 }).ok).toBe(false);
  });

  test('accepts scores from 0 to 999999999 only', () => {
    expect(validateScore({ ...valid, score: 0 }).ok).toBe(true);
    // A long run with many birds can pass 99999.
    const long = { ...valid, durationMs: 86_400_000, birds: 100_000 };
    expect(validateScore({ ...long, score: 6_000_000 }).ok).toBe(true);
    const tooBig = validateScore({ ...long, score: 1_000_000_000 });
    expect(tooBig.ok).toBe(false);
    expect(!tooBig.ok && tooBig.error).toContain('whole number');
    expect(validateScore({ ...valid, score: -1 }).ok).toBe(false);
  });

  test('rejects a score that is not a whole number', () => {
    expect(validateScore({ ...valid, score: 1.5 }).ok).toBe(false);
    expect(validateScore({ ...valid, score: '100' }).ok).toBe(false);
    expect(validateScore({ ...valid, score: Number.NaN }).ok).toBe(false);
  });

  test('rejects a missing or bad duration', () => {
    const { durationMs: _, ...noDuration } = valid;
    expect(validateScore(noDuration).ok).toBe(false);
    expect(validateScore({ ...valid, durationMs: -1 }).ok).toBe(false);
    expect(validateScore({ ...valid, durationMs: Infinity }).ok).toBe(false);
    expect(validateScore({ ...valid, durationMs: 86_400_001 }).ok).toBe(false);
  });

  test('rejects a score that is too high for the duration', () => {
    // 13 px per frame × 60 fps × 0.025 = 19.5 points each second.
    expect(maxScoreFor(10_000)).toBe(196);
    expect(validateScore({ ...valid, score: 196, durationMs: 10_000 }).ok).toBe(
      true,
    );
    expect(validateScore({ ...valid, score: 197, durationMs: 10_000 }).ok).toBe(
      false,
    );
    expect(validateScore({ ...valid, score: 5000, durationMs: 1000 }).ok).toBe(
      false,
    );
  });

  test('permits 50 points for each bird eaten', () => {
    expect(maxScoreFor(10_000, 2)).toBe(296);
    const run = { ...valid, durationMs: 10_000 };
    expect(validateScore({ ...run, score: 296, birds: 2 }).ok).toBe(true);
    expect(validateScore({ ...run, score: 297, birds: 2 }).ok).toBe(false);
    // With no birds field, the run has no bonus.
    expect(validateScore({ ...run, score: 246 }).ok).toBe(false);
  });

  test('rejects a bad or impossible number of birds', () => {
    const run = { ...valid, durationMs: 10_000 };
    expect(maxBirdsFor(10_000)).toBe(20);
    expect(validateScore({ ...run, birds: 20 }).ok).toBe(true);
    expect(validateScore({ ...run, birds: 21 }).ok).toBe(false);
    expect(validateScore({ ...run, birds: -1 }).ok).toBe(false);
    expect(validateScore({ ...run, birds: 1.5 }).ok).toBe(false);
    expect(validateScore({ ...run, birds: '3' }).ok).toBe(false);
  });
});

describe('createRateLimiter', () => {
  test('blocks a key after the limit and resets after the window', () => {
    const limiter = createRateLimiter(2, 1000);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 1)).toBe(true);
    expect(limiter.allow('a', 2)).toBe(false);
    expect(limiter.allow('b', 2)).toBe(true);
    expect(limiter.allow('a', 1000)).toBe(true);
  });
});

describe('the API', () => {
  const store = openScoreStore(':memory:');
  const app = buildApp({ store, postLimit: 3 });

  afterAll(async () => {
    await app.close();
    store.close();
  });

  test('GET /api/scores returns an empty list at first', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scores' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { scores: unknown[] }).scores).toHaveLength(0);
  });

  test('POST /api/scores stores a score and returns the top 10', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scores',
      payload: { name: ' sean ', score: 50, durationMs: 30_000 },
      remoteAddress: '10.0.0.1',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().scores[0]).toMatchObject({ name: 'sean', score: 50 });
  });

  test('POST /api/scores rejects a bad score with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scores',
      payload: { name: 'cheat', score: 99_999, durationMs: 1000 },
      remoteAddress: '10.0.0.2',
    });
    expect(res.statusCode).toBe(400);
  });

  test('GET /api/scores returns at most 10, highest first', async () => {
    for (let i = 0; i < 12; i++) {
      store.add({ name: `p${i}`, score: i * 10, durationMs: 60_000 });
    }
    const res = await app.inject({ method: 'GET', url: '/api/scores' });
    const scores = res.json().scores as { score: number }[];
    expect(scores).toHaveLength(10);
    expect(scores[0].score).toBe(110);
    expect(scores.map((s) => s.score)).toEqual(
      [...scores.map((s) => s.score)].sort((a, b) => b - a),
    );
  });

  test('POST /api/scores limits the rate for each IP address', async () => {
    const post = (ip: string) =>
      app.inject({
        method: 'POST',
        url: '/api/scores',
        payload: { name: 'spam', score: 1, durationMs: 1000 },
        remoteAddress: ip,
      });
    expect((await post('10.0.0.9')).statusCode).toBe(201);
    expect((await post('10.0.0.9')).statusCode).toBe(201);
    expect((await post('10.0.0.9')).statusCode).toBe(201);
    expect((await post('10.0.0.9')).statusCode).toBe(429);
    expect((await post('10.0.0.10')).statusCode).toBe(201);
  });

  test('the rate limit uses cf-connecting-ip, not X-Forwarded-For', async () => {
    const post = (forwardedFor: string) =>
      app.inject({
        method: 'POST',
        url: '/api/scores',
        payload: { name: 'spoof', score: 1, durationMs: 1000 },
        remoteAddress: '127.0.0.1',
        headers: {
          'cf-connecting-ip': '203.0.113.7',
          'x-forwarded-for': forwardedFor,
        },
      });
    expect((await post('1.1.1.1')).statusCode).toBe(201);
    expect((await post('2.2.2.2')).statusCode).toBe(201);
    expect((await post('3.3.3.3')).statusCode).toBe(201);
    expect((await post('4.4.4.4')).statusCode).toBe(429);
  });
});
