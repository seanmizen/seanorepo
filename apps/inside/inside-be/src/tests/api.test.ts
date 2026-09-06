import { describe, expect, test } from 'bun:test';
import { getApp } from './setup';

// Shared, migrated, ready instance. `app` is exported without listening, so
// inject() drives it in-process — no port, no race. Never closed by a suite:
// the module is a singleton, so closing it here would break other suites.
const app = await getApp();

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
      devMode: boolean;
      siteName: string;
      tagline: string;
      uploadMaxFileSizeMb: number;
      uploadMaxFiles: number;
    }>();
    expect(typeof body.devMode).toBe('boolean');
    expect(typeof body.siteName).toBe('string');
    expect(typeof body.tagline).toBe('string');
    expect(typeof body.uploadMaxFileSizeMb).toBe('number');
    expect(typeof body.uploadMaxFiles).toBe('number');
  });

  test('reports dev mode outside production', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json<{ devMode: boolean }>().devMode).toBe(true);
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
