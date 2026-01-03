import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { seedDatabase } from '@/services/db';

export interface E2ETestContext {
  server: FastifyInstance;
  serverUrl: string;
  uploadsPath: string;
  imagesPath: string;
  dbPath: string;
  adminCookie: string;
}

/**
 * Setup for E2E tests
 * - Creates temporary directories for uploads and database
 * - Seeds database
 * - Starts server on random port
 * - Authenticates as admin and provides cookie
 */
export async function setupE2E(): Promise<E2ETestContext> {
  // Create temporary directories for this test run
  const timestamp = Date.now();
  const uploadsPath = `/tmp/caroline-e2e-${timestamp}`;
  const imagesPath = join(uploadsPath, 'images');
  const dbPath = `/tmp/caroline-e2e-${timestamp}`;

  mkdirSync(uploadsPath, { recursive: true });
  mkdirSync(imagesPath, { recursive: true });
  mkdirSync(dbPath, { recursive: true });

  // Set environment variables for this test
  process.env.UPLOADS_PATH = uploadsPath;
  process.env.DB_PATH = dbPath;
  process.env.DANGEROUS_BYPASS_EMAIL_MAGIC_LINK = 'true';
  process.env.JWT_SECRET = 'test-secret';
  process.env.COOKIE_SECRET = 'test-cookie-secret';
  process.env.ADMIN_EMAILS = 'caroline@carolinemizen.art';
  process.env.CORS_ORIGIN = 'http://localhost:4020';

  // Seed test database
  await seedDatabase();

  // Create a fresh Fastify instance for this test
  const Fastify = (await import('fastify')).default;
  const cookie = (await import('@fastify/cookie')).default;
  const cors = (await import('@fastify/cors')).default;
  const formbody = (await import('@fastify/formbody')).default;
  const jwt = (await import('@fastify/jwt')).default;
  const multipart = (await import('@fastify/multipart')).default;
  const fastifyStatic = (await import('@fastify/static')).default;
  const path = await import('node:path');
  const { routes } = await import('@/controllers');

  const server = Fastify({
    logger: { level: 'error' },
  });

  server.register(cors, {
    origin: process.env.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  server.register(formbody);
  server.register(cookie, {
    secret: process.env.COOKIE_SECRET,
    hook: 'onRequest',
    parseOptions: {},
  });
  server.register(jwt, { secret: process.env.JWT_SECRET });
  server.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024,
      files: 30,
    },
  });
  server.register(fastifyStatic, {
    root: path.resolve(uploadsPath),
    prefix: '/uploads/',
    decorateReply: false,
  });
  server.register(routes);

  await server.listen({
    host: '127.0.0.1',
    port: 0, // Let OS assign a random available port
  });

  const address = server.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server address not available');
  }
  const serverUrl = `http://localhost:${address.port}`;

  // Authenticate as admin to get JWT cookie
  const authResponse = await fetch(`${serverUrl}/auth/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'caroline@carolinemizen.art' }),
  });

  if (!authResponse.ok) {
    throw new Error('Failed to authenticate as admin');
  }

  // Extract cookie from response
  const setCookieHeader = authResponse.headers.get('set-cookie');
  if (!setCookieHeader) {
    throw new Error('No set-cookie header in auth response');
  }

  // Parse the cookie value (format: "token=VALUE; HttpOnly; ...")
  const tokenMatch = setCookieHeader.match(/token=([^;]+)/);
  if (!tokenMatch) {
    throw new Error('Failed to extract token from set-cookie header');
  }
  const adminCookie = `token=${tokenMatch[1]}`;

  return {
    server,
    serverUrl,
    uploadsPath,
    imagesPath,
    dbPath,
    adminCookie,
  };
}

/**
 * Teardown for E2E tests
 * - Closes server
 * - Cleans up temporary directories
 */
export async function teardownE2E(context: E2ETestContext): Promise<void> {
  // Close server
  if (context.server) {
    await context.server.close();
  }

  // Clean up temporary directories
  rmSync(context.uploadsPath, { recursive: true, force: true });
  rmSync(context.dbPath, { recursive: true, force: true });
}

/**
 * Helper to create test image files
 */
export function createTestImage(
  imagesPath: string,
  filename: string,
  content = 'test-image-data',
): void {
  writeFileSync(join(imagesPath, filename), content);
}

/**
 * Helper to count files in a directory
 */
export function countFilesInDirectory(dirPath: string): number {
  try {
    const { readdirSync } = require('node:fs');
    return readdirSync(dirPath).length;
  } catch {
    return 0;
  }
}
