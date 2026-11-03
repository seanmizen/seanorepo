import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { hash, now, safeNext, startSession } from '../../auth';
import { renderPage } from '../../render';
import { Key } from '../../ui/Key';
import { Panel } from '../../ui/Panel';

interface VerifyBody {
  token?: string;
  next?: string;
}

/**
 * The page that the email link opens. A GET only shows the "Sign in" button.
 * The button sends the POST that spends the token. Email scanners open every
 * link, so a GET must never sign in.
 */
export const VerifyPage = ({
  token,
  next,
  error,
}: {
  token: string;
  next: string;
  error?: string;
}) => (
  <Panel label="Email link">
    {error && <p role="alert">{error}</p>}
    {token && !error ? (
      <form method="post" action="/login/verify">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="next" value={next} />
        <p>
          <Key>Sign in</Key>
        </p>
      </form>
    ) : (
      <p>
        <a href={`/login?${new URLSearchParams({ next })}`}>
          Send a new sign-in email
        </a>
      </p>
    )}
  </Panel>
);

/**
 * Spend the login token with this raw value. Returns the person id, or null
 * when the token is unknown, used or expired.
 */
const spendToken = (db: Database, token: string) => {
  const time = now();
  const row = db
    .query<{ person_id: string }, [string, string, string]>(
      `UPDATE login_token SET used_at = ?
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
       RETURNING person_id;`,
    )
    .get(time, hash(token), time);
  return row?.person_id ?? null;
};

/** `GET /login/verify` and `POST /login/verify` */
export const loginVerifyRoute = (app: FastifyInstance, db: Database) => {
  app.get<{ Querystring: VerifyBody }>(
    '/login/verify',
    async (request, reply) => {
      const token = String(request.query.token ?? '');
      return reply
        .type('text/html; charset=utf-8')
        .send(
          renderPage(
            'Sign in',
            <VerifyPage
              token={token}
              next={safeNext(request.query.next)}
              error={token ? undefined : 'This link has no sign-in token.'}
            />,
            request,
          ),
        );
    },
  );

  app.post<{ Body: VerifyBody }>('/login/verify', async (request, reply) => {
    const token = String(request.body?.token ?? '');
    const next = safeNext(request.body?.next);
    const personId = token ? spendToken(db, token) : null;
    if (!personId) {
      return reply
        .code(400)
        .type('text/html; charset=utf-8')
        .send(
          renderPage(
            'Sign in',
            <VerifyPage
              token=""
              next={next}
              error="This link is used or expired."
            />,
            request,
          ),
        );
    }
    startSession(db, request, reply, personId, 'link');
    return reply.redirect(next, 303);
  });
};
