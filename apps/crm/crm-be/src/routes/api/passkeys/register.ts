import type { Database } from 'bun:sqlite';
import type {
  PasskeyRegisterRequest,
  PasskeyRegisterResponse,
} from '@shared/types';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import type { FastifyInstance } from 'fastify';
import { type Auth, hasPasskey, safeNext, upgradeSession } from '../../../auth';
import { addPasskey, canChangePasskeys } from '../../../passkeys';
import { NAME_MAX } from '../../../ui/Passkey';

/**
 * `POST /api/passkeys/register`. Verifies the response from
 * `startRegistration()` and keeps the new passkey with its name. The first
 * passkey of the person makes this session a passkey session
 * (`upgradeSession`). Returns the path to open: `next` if it is a local
 * path, else `/`.
 */
export const passkeyRegisterRoute = (app: FastifyInstance, db: Database) => {
  app.post<{ Body: Partial<PasskeyRegisterRequest> }>(
    '/api/passkeys/register',
    async (request, reply) => {
      const auth = request.auth as Auth;
      if (!canChangePasskeys(db, auth)) {
        return reply
          .code(403)
          .send({ error: 'Sign in with a passkey to add a passkey.' });
      }
      const name = String(request.body?.name ?? '').trim();
      if (!name || name.length > NAME_MAX) {
        return reply.code(400).send({
          error: `Type a name for the passkey (1 to ${NAME_MAX} characters).`,
        });
      }
      const first = !hasPasskey(db, auth.personId);
      try {
        await addPasskey(
          db,
          auth,
          name,
          request.body?.response as RegistrationResponseJSON,
        );
      } catch (error) {
        request.log.warn(error, 'The passkey was not added.');
        return reply
          .code(400)
          .send({ error: 'The passkey was not added. Try again.' });
      }
      if (first) upgradeSession(db, request, reply);
      const body: PasskeyRegisterResponse = {
        next: safeNext(request.body?.next),
      };
      return body;
    },
  );
};
