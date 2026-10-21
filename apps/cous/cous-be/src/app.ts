import Fastify from 'fastify';
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

/** Makes the Fastify app. The tests use it with an in-memory store. */
const buildApp = ({
  store,
  logger = false,
  postLimit = 10,
  postWindowMs = 60_000,
}: AppOptions) => {
  const app = Fastify({
    logger,
    // cloudflared is in front of the app. Without this, every request has
    // the IP address of the tunnel, and the rate limit counts all players
    // as one.
    trustProxy: true,
    bodyLimit: 1024,
  });
  const limiter = createRateLimiter(postLimit, postWindowMs);

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/scores', async () => ({ scores: store.top() }));

  app.post('/api/scores', async (request, reply) => {
    if (!limiter.allow(request.ip)) {
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
