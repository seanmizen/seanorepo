import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import type { Auth } from '../../../auth';
import { canChangePasskeys, registrationOptions } from '../../../passkeys';

/**
 * `POST /api/passkeys/register-options`. Returns the options for
 * `startRegistration()`, for the signed-in person.
 */
export const passkeyRegisterOptionsRoute = (
  app: FastifyInstance,
  db: Database,
) => {
  app.post('/api/passkeys/register-options', async (request, reply) => {
    const auth = request.auth as Auth;
    if (!canChangePasskeys(db, auth)) {
      return reply
        .code(403)
        .send({ error: 'Sign in with a passkey to add a passkey.' });
    }
    return registrationOptions(db, auth);
  });
};
