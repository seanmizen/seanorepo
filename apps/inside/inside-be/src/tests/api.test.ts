import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestEnv } from './setup';

const env = createTestEnv('inside-api');

// Imported after createTestEnv so the server reads the test env at module
// scope. `app` is exported without listening, so inject() drives it in-process
// — no port, no race, no cleanup.
const { app } = await import('../index');
const { runMigrations } = await import('../services/migrations');

beforeAll(async () => {
  await runMigrations();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  env.cleanup();
});

describe('liveness', () => {
  test('GET / responds outside the /api prefix', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ service: string; status: string }>()).toEqual({
      service: 'inside-be',
      status: 'ok',
    });
  });
});

describe('GET /api/health', () => {
  test('reports ok with an uptime', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      status: string;
      uptime: number;
      version: string;
    }>();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.version).toBe('string');
  });
});

describe('GET /api/config', () => {
  test('returns site copy and upload limits', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      siteName: string;
      tagline: string;
      uploadMaxFileSizeMb: number;
      uploadMaxFiles: number;
    }>();
    expect(typeof body.siteName).toBe('string');
    expect(typeof body.tagline).toBe('string');
    expect(typeof body.uploadMaxFileSizeMb).toBe('number');
    expect(typeof body.uploadMaxFiles).toBe('number');
  });
});

describe('admin scope', () => {
  // The guard is an onRequest hook on an encapsulated scope, so every child
  // route is protected by construction. This test is the canary: if someone
  // adds an admin route that answers unauthenticated, this fails.
  test('rejects an unauthenticated request', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/whoami' });
    expect(res.statusCode).toBe(401);
  });

  test('rejects a garbage token rather than 500ing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/whoami',
      cookies: { token: 'not-a-real-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('unknown routes', () => {
  test('404s cleanly', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
  });
});
