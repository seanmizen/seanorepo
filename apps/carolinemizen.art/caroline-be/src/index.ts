import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import path from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { routes } from './controllers';
import { ingestOrphanedImages } from './services/db';

// Validate required environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const COOKIE_SECRET =
  process.env.COOKIE_SECRET || 'dev-cookie-secret-change-in-production';

// Warn about insecure secrets in production (but allow for local docker testing)
if (
  process.env.NODE_ENV === 'production' &&
  (JWT_SECRET === 'dev-secret-change-in-production' ||
    COOKIE_SECRET === 'dev-cookie-secret-change-in-production')
) {
  console.warn(
    '⚠️  WARNING: Using development secrets in production mode. Set JWT_SECRET and COOKIE_SECRET environment variables for real deployments.',
  );
}

const fastify = Fastify<Server, IncomingMessage, ServerResponse>({
  logger: { level: 'error' },
  // logger: { level: process.env.NODE_ENV === 'production' ? 'error' : 'info' },
});

fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || 'http://localhost:4020',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});
fastify.register(formbody);
fastify.register(cookie, {
  secret: COOKIE_SECRET,
  hook: 'onRequest',
  parseOptions: {},
});
fastify.register(jwt, { secret: JWT_SECRET });

// File upload support
const UPLOAD_MAX_FILE_SIZE_MB = Number(
  process.env.UPLOAD_MAX_FILE_SIZE_MB || '100',
);
const UPLOAD_MAX_FILES = Number(process.env.UPLOAD_MAX_FILES || '30');

fastify.register(multipart, {
  limits: {
    fileSize: UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
    files: UPLOAD_MAX_FILES,
  },
});

console.log(
  `📁 Upload limits: ${UPLOAD_MAX_FILE_SIZE_MB}MB per file, ${UPLOAD_MAX_FILES} files max`,
);

// Serve uploaded files statically
// Default to ./uploads for local dev, /app/uploads for Docker
const UPLOADS_PATH =
  process.env.UPLOADS_PATH ||
  (process.env.NODE_ENV === 'production' ? '/app/uploads' : './uploads');
fastify.register(fastifyStatic, {
  root: path.resolve(UPLOADS_PATH),
  prefix: '/uploads/',
  decorateReply: false,
});

console.log(`📁 Serving uploads from: ${path.resolve(UPLOADS_PATH)}`);

fastify.register(routes);

const reset = '\x1b[0m';
const cyan = '\x1b[36m';
const bright = '\x1b[1m';

const start = async () => {
  // without manually listening for interrupts, this hangs in docker.
  process.on('SIGINT', async () => {
    await fastify.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await fastify.close();
    process.exit(0);
  });

  // Ingest orphaned images from filesystem on startup
  console.log('🔍 Scanning for orphaned images...');
  await ingestOrphanedImages();

  const port = process.env.PORT ? Number(process.env.PORT) : 4021;
  try {
    await fastify.listen({
      host: '0.0.0.0', // explicitly bind to all interfaces
      port,
    });
    console.debug(
      'Serving at',
      [cyan, 'http://localhost:', bright, port, reset].join(''),
    );
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

// Only start server if this file is run directly (not imported by tests)
if (import.meta.main) {
  start();
}

// Export for testing
export { fastify as app };
