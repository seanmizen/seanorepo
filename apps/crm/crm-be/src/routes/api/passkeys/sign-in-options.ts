import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { rateLimiter } from '../../../auth';
import { CHALLENGE_MINUTES, signInOptions } from '../../../passkeys';

/**
 * `POST /api/passkeys/sign-in-options`. Open to a signed-out visitor. Returns
 * the options for `startAuthentication()`. Each call adds a challenge row, so
 * a limit by IP keeps the table small.
 */
export const passkeySignInOptionsRoute = (
  app: FastifyInstance,
  db: Database,
) => {
  const limit = rateLimiter(20, CHALLENGE_MINUTES * 60 * 1000);
  app.post('/api/passkeys/sign-in-options', async (request, reply) => {
    if (!limit(request.ip)) {
      return reply.code(429).send({
        error: `Too many attempts. Wait ${CHALLENGE_MINUTES} minutes, then try again.`,
      });
    }
    return signInOptions(db);
  });
};
