import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import {
  hash,
  LOGIN_TOKEN_MINUTES,
  type LoginLimits,
  normalizeEmail,
  now,
  safeNext,
  startSession,
} from '../../auth';
import { renderPage } from '../../render';
import { Field } from '../../ui/Field';
import { Key } from '../../ui/Key';
import { Panel } from '../../ui/Panel';

interface CodeBody {
  email?: string;
  code?: string;
  next?: string;
}

/**
 * The page after the email form. It says that an email went out, and it has
 * the code form. The text is the same for a known and an unknown email.
 */
export const CodePage = ({
  email,
  next,
  error,
}: {
  email: string;
  next: string;
  error?: string;
}) => (
  <Panel label="Code">
    <p>
      If {email || 'this email address'} has an account, we sent it a sign-in
      link and a 6-digit code. They work for {LOGIN_TOKEN_MINUTES} minutes.
    </p>
    {error && <p role="alert">{error}</p>}
    <form method="post" action="/login/code">
      <input type="hidden" name="next" value={next} />
      <p>
        <Field label="Email address">
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={email}
          />
        </Field>
      </p>
      <p>
        <Field label="6-digit code">
          <input
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            required
          />
        </Field>
      </p>
      <p>
        <Key>Sign in</Key>
      </p>
    </form>
    <p>
      <a href={`/login?${new URLSearchParams({ next })}`}>Send a new email</a>
    </p>
  </Panel>
);

/**
 * Spend the login token that has this email and code. Returns the person id,
 * or null when no unused, unexpired token matches.
 */
const spendCode = (db: Database, email: string, code: string) => {
  const time = now();
  const row = db
    .query<{ person_id: string }, [string, string, string, string]>(
      `UPDATE login_token SET used_at = ?
       WHERE id = (
         SELECT login_token.id FROM login_token
         JOIN person ON person.id = login_token.person_id
         WHERE lower(person.email) = ? AND login_token.code_hash = ?
           AND login_token.used_at IS NULL AND login_token.expires_at > ?
         LIMIT 1
       )
       RETURNING person_id;`,
    )
    .get(time, email, hash(code), time);
  return row?.person_id ?? null;
};

/** `GET /login/code` and `POST /login/code` */
export const loginCodeRoute = (
  app: FastifyInstance,
  db: Database,
  limits: LoginLimits,
) => {
  app.get<{ Querystring: CodeBody }>('/login/code', async (request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(
        renderPage(
          'Check your email',
          <CodePage
            email={normalizeEmail(request.query.email)}
            next={safeNext(request.query.next)}
          />,
          request,
        ),
      ),
  );

  app.post<{ Body: CodeBody }>('/login/code', async (request, reply) => {
    const email = normalizeEmail(request.body?.email);
    const code = String(request.body?.code ?? '').trim();
    const next = safeNext(request.body?.next);
    const fail = (status: number, error: string) =>
      reply
        .code(status)
        .type('text/html; charset=utf-8')
        .send(
          renderPage(
            'Check your email',
            <CodePage email={email} next={next} error={error} />,
            request,
          ),
        );

    if (!limits('code', email, request.ip)) {
      return fail(
        429,
        `Too many attempts. Wait ${LOGIN_TOKEN_MINUTES} minutes, then try again.`,
      );
    }
    const personId = /^\d{6}$/.test(code) ? spendCode(db, email, code) : null;
    if (!personId) {
      return fail(400, 'That code is wrong, used or expired.');
    }
    startSession(db, request, reply, personId, 'code');
    return reply.redirect(next, 303);
  });
};
