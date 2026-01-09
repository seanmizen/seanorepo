import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type E2ETestContext, setupE2E, teardownE2E } from './setup';

/**
 * Comprehensive test to verify all routes requiring authentication are properly protected
 * This test will FAIL for any route that is unprotected and should be protected
 */
describe('Route Authentication E2E Tests', () => {
  let context: E2ETestContext;

  beforeEach(async () => {
    context = await setupE2E();
  });

  afterEach(async () => {
    await teardownE2E(context);
  });

  /**
   * Protected routes that should return 401 without authentication
   * Format: [method, path, description, optional body]
   */
  const protectedRoutes: Array<[string, string, string, string?]> = [
    // Admin - Images
    ['POST', '/admin/images/upload', 'Upload images'],
    ['GET', '/admin/images/count', 'Get images count'],
    ['GET', '/admin/images', 'List images'],
    ['DELETE', '/admin/images/1', 'Delete image'],

    // Admin - Artworks
    ['GET', '/admin/artworks/count', 'Get artworks count'],
    [
      'POST',
      '/admin/artworks',
      'Create artwork',
      JSON.stringify({ title: 'Test', price_cents: 1000 }),
    ],
    [
      'PUT',
      '/admin/artworks/1',
      'Update artwork',
      JSON.stringify({ title: 'Updated' }),
    ],
    [
      'PATCH',
      '/admin/artworks/1/status',
      'Update artwork status',
      JSON.stringify({ status: 'draft' }),
    ],
    ['DELETE', '/admin/artworks/1', 'Delete artwork'],

    // Admin - Galleries
    ['GET', '/admin/galleries/count', 'Get galleries count'],
    [
      'POST',
      '/admin/galleries',
      'Create gallery',
      JSON.stringify({ name: 'Test Gallery', slug: 'test' }),
    ],
    [
      'PUT',
      '/admin/galleries/1',
      'Update gallery',
      JSON.stringify({ name: 'Updated' }),
    ],
    [
      'PUT',
      '/admin/galleries/1/artworks',
      'Set gallery artworks',
      JSON.stringify({ artwork_ids: [] }),
    ],
    ['POST', '/admin/galleries/1/move-up', 'Move gallery up'],
    ['POST', '/admin/galleries/1/move-down', 'Move gallery down'],
    [
      'PUT',
      '/admin/galleries/featured',
      'Set featured galleries',
      JSON.stringify({ gallery_ids: [] }),
    ],
    ['DELETE', '/admin/galleries/1', 'Delete gallery'],

    // Admin - Content
    [
      'PUT',
      '/admin/content/test-key',
      'Update content',
      JSON.stringify({ value: 'test' }),
    ],
    ['DELETE', '/admin/content/test-key', 'Delete content'],

    // Admin - Carousel
    [
      'PUT',
      '/admin/carousel',
      'Update carousel',
      JSON.stringify({ image_ids: [] }),
    ],

    // Admin - Nuke
    ['POST', '/admin/nuke', 'Nuke database and images'],

    // Dev/Debug routes (now protected under /admin)
    ['GET', '/admin/db/test', 'Test DB connection'],
    ['GET', '/admin/db', 'Get users from DB'],
    ['POST', '/admin/db/seed', 'Seed database'],
    ['POST', '/admin/db/reset', 'Reset database'],
    [
      'POST',
      '/admin/users',
      'Create user',
      JSON.stringify({ email: 'test@test.com', role: 'admin' }),
    ],
    ['GET', '/admin/users', 'List users'],
    ['GET', '/admin/users/1', 'Get user'],
  ];

  test('all protected routes should require authentication', async () => {
    const { serverUrl } = context;
    const failures: Array<{
      method: string;
      path: string;
      description: string;
      status: number;
    }> = [];

    for (const [method, path, description, body] of protectedRoutes) {
      const options: RequestInit = {
        method,
        headers: body
          ? {
              'Content-Type': body.startsWith('{')
                ? 'application/json'
                : 'text/plain',
            }
          : {},
      };

      if (
        body &&
        (method === 'POST' || method === 'PUT' || method === 'PATCH')
      ) {
        options.body = body;
      }

      const response = await fetch(`${serverUrl}${path}`, options);

      // Should return 401 (Unauthorized) or 403 (Forbidden)
      if (response.status !== 401 && response.status !== 403) {
        failures.push({
          method,
          path,
          description,
          status: response.status,
        });
      }
    }

    if (failures.length > 0) {
      console.error(
        '\n🚨 SECURITY VULNERABILITY: Unprotected routes detected!\n',
      );
      console.error(
        'The following routes are accessible without authentication:\n',
      );
      for (const failure of failures) {
        console.error(
          `  ❌ ${failure.method} ${failure.path} (${failure.description})`,
        );
        console.error(
          `     Returned: ${failure.status} (expected 401 or 403)\n`,
        );
      }
    }

    expect(failures).toHaveLength(0);
  });

  test('protected routes should accept valid admin authentication', async () => {
    const { serverUrl, adminCookie } = context;

    // Test a few key protected endpoints with valid auth
    const authenticatedTests: Array<[string, string, RequestInit?]> = [
      ['GET', '/admin/images/count'],
      ['GET', '/admin/artworks/count'],
      ['GET', '/admin/galleries/count'],
    ];

    for (const [method, path, extraOptions] of authenticatedTests) {
      const response = await fetch(`${serverUrl}${path}`, {
        method,
        headers: {
          Cookie: adminCookie,
        },
        ...extraOptions,
      });

      // With valid auth, should NOT be 401 or 403
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    }
  });

  test('route-level protected routes should reject unauthenticated requests', async () => {
    const { serverUrl } = context;

    // These routes use { onRequest: [requireAdmin] } at the route level
    // They should ALSO be protected (defense in depth)
    const routeLevelProtected: Array<[string, string, string?]> = [
      [
        'POST',
        '/admin/artworks',
        JSON.stringify({ title: 'Test', price_cents: 1000 }),
      ],
      ['PUT', '/admin/artworks/1', JSON.stringify({ title: 'Updated' })],
      [
        'PATCH',
        '/admin/artworks/1/status',
        JSON.stringify({ status: 'draft' }),
      ],
      ['DELETE', '/admin/artworks/1'],
      ['PUT', '/admin/carousel', JSON.stringify({ image_ids: [] })],
    ];

    for (const [method, path, body] of routeLevelProtected) {
      const options: RequestInit = {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
      };

      if (body) {
        options.body = body;
      }

      const response = await fetch(`${serverUrl}${path}`, options);

      // Should return 401 (Unauthorized) or 403 (Forbidden)
      expect(response.status).toBeOneOf([401, 403]);
    }
  });

  test('public routes should be accessible without authentication', async () => {
    const { serverUrl } = context;

    // These routes should be publicly accessible
    const publicRoutes: Array<[string, string]> = [
      ['GET', '/'],
      ['GET', '/health'],
      ['GET', '/config'],
      ['POST', '/auth/magic-link'],
      ['GET', '/content'],
      ['GET', '/artworks'],
      ['GET', '/galleries'],
      ['GET', '/carousel'],
    ];

    for (const [method, path] of publicRoutes) {
      const response = await fetch(`${serverUrl}${path}`, {
        method,
        headers:
          method === 'POST' ? { 'Content-Type': 'application/json' } : {},
        body:
          method === 'POST'
            ? JSON.stringify({ email: 'test@example.com' })
            : undefined,
      });

      // Should NOT return 401 or 403 for public routes
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    }
  });
});
