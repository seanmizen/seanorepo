import { mkdirSync } from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { routes } from './controllers';
import { runMigrations } from './services/migrations';

const DEV_SECRET = 'dev-secret-change-in-production';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Read a secret, refusing to start in production with the dev placeholder.
 * A warning is not enough here — a deployed app signing cookies with a public
 * default is a hole, so this fails hard instead.
 */
const requireSecret = (name: 'JWT_SECRET' | 'COOKIE_SECRET'): string => {
  const value = process.env[name];
  if (IS_PRODUCTION && (!value || value === DEV_SECRET)) {
    throw new Error(
      `${name} must be set to a non-default value when NODE_ENV=production`,
    );
  }
  return value || DEV_SECRET;
};

const PORT = process.env.PORT ? Number(process.env.PORT) : 4061;
const UPLOADS_PATH = process.env.UPLOADS_PATH || './uploads';
const UPLOAD_MAX_FILE_SIZE_MB = Number(
  process.env.UPLOAD_MAX_FILE_SIZE_MB ?? 50,
);
const UPLOAD_MAX_FILES = Number(process.env.UPLOAD_MAX_FILES ?? 30);

const fastify = Fastify({
  logger: { level: IS_PRODUCTION ? 'warn' : 'info' },
  // Portfolio uploads are large; the defaults cut them off mid-transfer.
  connectionTimeout: 600000,
  requestTimeout: 600000,
});

fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || 'http://localhost:4060',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});
fastify.register(formbody);
fastify.register(cookie, {
  secret: requireSecret('COOKIE_SECRET'),
  hook: 'onRequest',
  parseOptions: {},
});
fastify.register(jwt, { secret: requireSecret('JWT_SECRET') });
fastify.register(multipart, {
  limits: {
    fileSize: UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
    files: UPLOAD_MAX_FILES,
  },
});

// Serve uploaded assets. The prefix must match UPLOADS_URL in the storage
// provider, or the URLs handed to the frontend 404.
// fastify-static refuses to register if its root is missing, which is the
// normal state on a first boot or a fresh volume.
const uploadsRoot = path.resolve(UPLOADS_PATH);
mkdirSync(uploadsRoot, { recursive: true });

fastify.register(fastifyStatic, {
  root: uploadsRoot,
  prefix: '/api/uploads/',
  decorateReply: false,
});

// Liveness probe outside /api, for the tunnel and container healthchecks.
fastify.get('/', async () => ({ service: 'inside-be', status: 'ok' }));

fastify.register(routes, { prefix: '/api' });

const start = async (): Promise<void> => {
  // Without these the container ignores `docker compose down` and hangs
  // until the stop timeout expires.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      fastify.log.info(`${signal} received, shutting down`);
      await fastify.close();
      process.exit(0);
    });
  }

  try {
    await runMigrations();
    await fastify.listen({ host: '0.0.0.0', port: PORT });
    console.log(`[inside-be] listening on http://localhost:${PORT}`);
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
};

if (import.meta.main) {
  start();
}

export { fastify as app, start };
