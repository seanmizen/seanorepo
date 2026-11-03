import type { Database } from 'bun:sqlite';
import type {
  PasskeySignInRequest,
  PasskeySignInResponse,
} from '@shared/types';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { FastifyInstance } from 'fastify';
import { safeNext, startSession } from '../../../auth';
import { verifySignIn } from '../../../passkeys';

/**
 * `POST /api/passkeys/sign-in`. Open to a signed-out visitor. Verifies the
 * response from `startAuthentication()`, starts a passkey session, and
 * returns the path to open. The passkey session replaces the current session
 * (for example an email session), if there is one (see `startSession`).
 */
export const passkeySignInRoute = (app: FastifyInstance, db: Database) => {
  app.post<{ Body: Partial<PasskeySignInRequest> }>(
    '/api/passkeys/sign-in',
    async (request, reply) => {
      const response = request.body?.response as AuthenticationResponseJSON;
      let personId: string;
      try {
        if (typeof response?.id !== 'string') throw new Error('No passkey.');
        personId = await verifySignIn(db, response);
      } catch (error) {
        request.log.warn(error, 'The passkey sign-in failed.');
        return reply
          .code(400)
          .send({ error: 'The passkey sign-in failed. Try again.' });
      }
      startSession(db, request, reply, personId, 'passkey');
      const body: PasskeySignInResponse = {
        next: safeNext(request.body?.next),
      };
      return body;
    },
  );
};
