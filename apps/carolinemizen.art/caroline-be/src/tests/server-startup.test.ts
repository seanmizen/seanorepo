import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { seedDatabase } from '../services/db';

describe('Server Startup Integration Test', () => {
  let server: FastifyInstance;
  let serverUrl: string;

  beforeAll(async () => {
    // Seed test database
    await seedDatabase();

    // Import the server instance
    const { app } = await import('../index');
    server = app;

    // Start the server on a random port
    await server.listen({
      host: '127.0.0.1',
      port: 0, // Let OS assign a random available port
    });

    const address = server.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server address not available');
    }
    serverUrl = `http://localhost:${address.port}`;
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  test('server should start without errors', async () => {
    expect(server).toBeDefined();
    expect(server.server.listening).toBe(true);
  });

  test('should respond to health check', async () => {
    const response = await fetch(`${serverUrl}/api/health`);
    expect(response.ok).toBe(true);

    const data = (await response.json()) as { status: string };
    expect(data.status).toBe('ok');
  });

  test('should have no route conflicts', async () => {
    // This test passes simply by the server starting successfully
    // Route conflicts (FST_ERR_DUPLICATED_ROUTE) prevent server startup
    expect(server.server.listening).toBe(true);
  });

  test('public artworks endpoint should be accessible', async () => {
    const response = await fetch(`${serverUrl}/api/artworks`);
    expect(response.ok).toBe(true);

    const data = (await response.json()) as { artworks: unknown[] };
    expect(data).toHaveProperty('artworks');
    expect(Array.isArray(data.artworks)).toBe(true);
  });

  test('admin artworks endpoint should require auth', async () => {
    const response = await fetch(`${serverUrl}/api/admin/artworks`);
    // Should return 401 Unauthorized without credentials
    expect(response.status).toBe(401);
  });
});
