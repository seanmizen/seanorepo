import { describe, expect, test } from 'bun:test';
import Fastify from 'fastify';
import { getApp } from './setup';

const app = await getApp();

const { errorHandler, notFoundHandler, GENERIC_5XX } = await import(
  '../services/http-errors'
);

/**
 * A throwaway instance carrying the same handlers, so the 500 path can be
 * exercised without the real app owning a route whose only job is to explode.
 */
async function instanceThatThrows(thrown: Error & { statusCode?: number }) {
  const probe = Fastify({ logger: false });
  probe.setErrorHandler(errorHandler);
  probe.setNotFoundHandler(notFoundHandler);
  probe.get('/boom', async () => {
    throw thrown;
  });
  await probe.ready();
  return probe;
}

describe('an unhandled exception', () => {
  test('never returns its own message to the client', async () => {
    // The messages this guards against are real: SQLite constraint text,
    // sharp decode failures, filesystem paths.
    const leaky = new Error(
      'SQLITE_CONSTRAINT: UNIQUE constraint failed: designer_profiles.slug',
    );
    const probe = await instanceThatThrows(leaky);

    const res = await probe.inject({ method: 'GET', url: '/boom' });
    const body = res.json<{ error: string; requestId: string }>();

    expect(res.statusCode).toBe(500);
    expect(body.error).toBe(GENERIC_5XX);
    expect(res.payload).not.toContain('SQLITE_CONSTRAINT');
    expect(res.payload).not.toContain('designer_profiles');
    expect(body.requestId).toBeTruthy();

    await probe.close();
  });

  test('a 4xx keeps its message — those are written for the caller', async () => {
    const refused = Object.assign(new Error('Your studio needs a name'), {
      statusCode: 400,
    });
    const probe = await instanceThatThrows(refused);

    const res = await probe.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe(
      'Your studio needs a name',
    );

    await probe.close();
  });
});

describe('one error envelope', () => {
  test('an unmatched route answers in the app shape, not Fastify’s', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/no-such-endpoint',
    });
    const body = res.json<Record<string, unknown>>();

    expect(res.statusCode).toBe(404);
    expect(body.error).toBe('Not found');
    expect(body.requestId).toBeTruthy();
    // Fastify's default shape, which a client would otherwise have to know
    // about — and would only discover by hitting a typo in production.
    expect(body.statusCode).toBeUndefined();
    expect(body.message).toBeUndefined();
  });

  test('a hand-written 404 carries the same envelope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/designers/no-such-studio-anywhere',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBeTruthy();
  });
});

describe('request correlation', () => {
  test('every response carries an x-request-id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  test('an inbound id is honoured, so one trace spans the whole request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-request-id': 'trace-me-12345' },
    });
    expect(res.headers['x-request-id']).toBe('trace-me-12345');
  });

  test('a failure carries the id that will be in the log', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/no-such-endpoint',
      headers: { 'x-request-id': 'find-me-in-the-logs' },
    });
    expect(res.json<{ requestId: string }>().requestId).toBe(
      'find-me-in-the-logs',
    );
    expect(res.headers['x-request-id']).toBe('find-me-in-the-logs');
  });

  test('two requests without an inbound id get different ids', async () => {
    const a = await app.inject({ method: 'GET', url: '/api/health' });
    const b = await app.inject({ method: 'GET', url: '/api/health' });
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });
});
