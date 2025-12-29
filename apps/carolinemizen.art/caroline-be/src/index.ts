import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import { routes } from './controllers';

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
  logger: { level: process.env.NODE_ENV === 'production' ? 'error' : 'info' },
});

fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || 'http://localhost:4020',
  credentials: true,
});
fastify.register(formbody);
fastify.register(cookie, {
  secret: COOKIE_SECRET,
  hook: 'onRequest',
  parseOptions: {},
});
fastify.register(jwt, { secret: JWT_SECRET });

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

start();
