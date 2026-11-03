import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { hash, now, RECOVERY_MINUTES, startSession } from '../../auth';
import { renderPage } from '../../render';
import { Key } from '../../ui/Key';
import { Panel } from '../../ui/Panel';

/**
 * The page that the enrolment link from `bun run admin:recover` opens. A GET
 * only shows the button. The button sends the POST that spends the token and
 * starts a recovery session. That session opens only `/account/passkeys`.
 */
export const RecoverPage = ({
  token,
  error,
}: {
  token: string;
  error?: string;
}) => (
  <Panel label="Recovery">
    {error ? (
      <p role="alert">{error}</p>
    ) : (
      <form method="post" action="/login/recover">
        <input type="hidden" name="token" value={token} />
        <p>
          This link starts a recovery session. The session can only add a
          passkey, and it ends after {RECOVERY_MINUTES} minutes.
        </p>
        <p>
          <Key>Start recovery</Key>
        </p>
      </form>
    )}
  </Panel>
);

/**
 * Spend the recovery token with this raw value. Returns the person id, or
 * null when the token is unknown, used or expired.
 */
const spendRecoveryToken = (db: Database, token: string) => {
  const time = now();
  const row = db
    .query<{ person_id: string }, [string, string, string]>(
      `UPDATE recovery_token SET used_at = ?
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
       RETURNING person_id;`,
    )
    .get(time, hash(token), time);
  return row?.person_id ?? null;
};

/** `GET /login/recover` and `POST /login/recover` */
export const loginRecoverRoute = (app: FastifyInstance, db: Database) => {
  app.get<{ Querystring: { token?: string } }>(
    '/login/recover',
    async (request, reply) => {
      const token = String(request.query.token ?? '');
      return reply
        .type('text/html; charset=utf-8')
        .send(
          renderPage(
            'Recovery',
            <RecoverPage
              token={token}
              error={token ? undefined : 'This link has no recovery token.'}
            />,
            request,
          ),
        );
    },
  );

  app.post<{ Body: { token?: string } }>(
    '/login/recover',
    async (request, reply) => {
      const token = String(request.body?.token ?? '');
      const personId = token ? spendRecoveryToken(db, token) : null;
      if (!personId) {
        return reply
          .code(400)
          .type('text/html; charset=utf-8')
          .send(
            renderPage(
              'Recovery',
              <RecoverPage
                token=""
                error="This link is used or expired. Run admin:recover again."
              />,
              request,
            ),
          );
      }
      startSession(db, request, reply, personId, 'recovery');
      return reply.redirect('/account/passkeys', 303);
    },
  );
};
