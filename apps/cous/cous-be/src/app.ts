import Fastify, { type FastifyRequest } from 'fastify';
import type { ScoreStore } from './db';
import { createRateLimiter } from './rate-limit';
import { validateScore } from './validation';

type AppOptions = {
  store: ScoreStore;
  logger?: boolean;
  /** POST /api/scores requests for each IP address in each window. */
  postLimit?: number;
  postWindowMs?: number;
};

/**
 * The key for the rate limit. cloudflared sets `cf-connecting-ip` to the
 * player's address, and a client cannot override it. A client can write
 * its own `X-Forwarded-For`, so the app does not trust that header. With
 * no Cloudflare in front (local dev, the tests, the edge on the LAN), the
 * key is the address of the socket.
 */
const clientKey = (request: FastifyRequest): string => {
  const cf = request.headers['cf-connecting-ip'];
  const value = Array.isArray(cf) ? cf[0] : cf;
  return value?.trim() || request.ip;
};

/** Makes the Fastify app. The tests use it with an in-memory store. */
const buildApp = ({
  store,
  logger = false,
  postLimit = 10,
  postWindowMs = 60_000,
}: AppOptions) => {
  const app = Fastify({
    logger,
    // A client can write its own X-Forwarded-For. See clientKey.
    trustProxy: false,
    bodyLimit: 1024,
  });
  const limiter = createRateLimiter(postLimit, postWindowMs);

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/scores', async () => ({ scores: store.top() }));

  app.post('/api/scores', async (request, reply) => {
    if (!limiter.allow(clientKey(request))) {
      return reply
        .code(429)
        .send({ error: 'Too many scores. Wait one minute and try again.' });
    }
    const result = validateScore(request.body);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    store.add(result.value);
    return reply.code(201).send({ scores: store.top() });
  });

  return app;
};

export { buildApp };
