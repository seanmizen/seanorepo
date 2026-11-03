import type { Database } from 'bun:sqlite';
import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  hash,
  LOGIN_TOKEN_MINUTES,
  type LoginLimits,
  newToken,
  normalizeEmail,
  PUBLIC_URL,
  safeNext,
} from '../auth';
import { sendEmail } from '../email';
import { renderPage } from '../render';
import { Field } from '../ui/Field';
import { Key } from '../ui/Key';
import { Panel } from '../ui/Panel';

interface LoginBody {
  email?: string;
  next?: string;
}

/**
 * The passkey sign-in. The button needs JavaScript (WebAuthn), so it is
 * `hidden` until `crm-fe/src/passkeys.ts` shows it. With no JavaScript the
 * note shows, and the email form still works. This is the one exception to
 * REQ-CRM-BARE-001.
 */
export const PasskeySignIn = ({ next }: { next: string }) => (
  <Panel label="Passkey">
    <p data-passkey-note="">
      Passkeys need JavaScript. Use the email form, or turn on JavaScript.
    </p>
    <p role="alert" hidden data-passkey-error="" />
    <p>
      <Key type="button" hidden data-passkey="sign-in" data-next={next}>
        Sign in with a passkey
      </Key>
    </p>
  </Panel>
);

/** The sign-in page: the email form, and the passkey sign-in next to it. */
export const LoginPage = ({
  next,
  email = '',
  error,
}: {
  next: string;
  email?: string;
  error?: string;
}) => (
  <>
    <EmailForm next={next} email={email} error={error} />
    <PasskeySignIn next={next} />
  </>
);

/** The email form. One field: the email address. */
const EmailForm = ({
  next,
  email,
  error,
}: {
  next: string;
  email: string;
  error?: string;
}) => (
  <Panel label="Email link">
    {error && <p role="alert">{error}</p>}
    <form method="post" action="/login">
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
        <Key>Email me a sign-in link</Key>
      </p>
    </form>
  </Panel>
);

/**
 * Make a login token for the person with `email`, and email the link and the
 * code. An unknown email gets no token and no email.
 */
const emailLoginToken = (db: Database, email: string, next: string) => {
  const person = db
    .query<{ id: string; email: string }, [string]>(
      'SELECT id, email FROM person WHERE lower(email) = ?;',
    )
    .get(email);
  if (!person) return null;
  const token = newToken();
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  db.query(
    'INSERT INTO login_token (id, person_id, token_hash, code_hash, expires_at) VALUES (?, ?, ?, ?, ?);',
  ).run(
    crypto.randomUUID(),
    person.id,
    hash(token),
    hash(code),
    new Date(Date.now() + LOGIN_TOKEN_MINUTES * 60 * 1000).toISOString(),
  );
  const link = `${PUBLIC_URL}/login/verify?${new URLSearchParams({ token, next })}`;
  return sendEmail({
    to: person.email,
    subject: `Your crm sign-in code: ${code}`,
    text: [
      'Open this link to sign in to crm:',
      '',
      link,
      '',
      `Or type this code on the sign-in page: ${code}`,
      '',
      `The link and the code work one time, for ${LOGIN_TOKEN_MINUTES} minutes.`,
      'If you did not ask to sign in, ignore this email.',
    ].join('\n'),
  });
};

/** `GET /login` and `POST /login` */
export const loginRoute = (
  app: FastifyInstance,
  db: Database,
  limits: LoginLimits,
) => {
  app.get<{ Querystring: LoginBody }>('/login', async (request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(
        renderPage(
          'Sign in',
          <LoginPage next={safeNext(request.query.next)} />,
          request,
          ['passkeys'],
        ),
      ),
  );

  app.post<{ Body: LoginBody }>('/login', async (request, reply) => {
    const email = normalizeEmail(request.body?.email);
    const next = safeNext(request.body?.next);
    if (!email) {
      return reply
        .code(400)
        .type('text/html; charset=utf-8')
        .send(
          renderPage(
            'Sign in',
            <LoginPage next={next} error="Type your email address." />,
            request,
            ['passkeys'],
          ),
        );
    }
    if (!limits('login', email, request.ip)) {
      return reply
        .code(429)
        .type('text/html; charset=utf-8')
        .send(
          renderPage(
            'Sign in',
            <LoginPage
              next={next}
              email={email}
              error={`Too many attempts. Wait ${LOGIN_TOKEN_MINUTES} minutes, then try again.`}
            />,
            request,
            ['passkeys'],
          ),
        );
    }
    // Do not wait for the provider. A known email and an unknown email must
    // get the same response at the same speed.
    emailLoginToken(db, email, next)?.catch((error) =>
      request.log.error(error, 'The sign-in email was not sent.'),
    );
    return reply.redirect(
      `/login/code?${new URLSearchParams({ email, next })}`,
      303,
    );
  });
};
