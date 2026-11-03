import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  type Auth,
  audit,
  hasPasskey,
  isAdmin,
  RECOVERY_MINUTES,
  type SessionMethod,
} from '../../auth';
import { canChangePasskeys, NAME_MAX } from '../../passkeys';
import { renderPage } from '../../render';
import { Field } from '../../ui/Field';
import { Key } from '../../ui/Key';
import { Panel } from '../../ui/Panel';

interface PasskeyRow {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

const METHOD_TEXT: Record<SessionMethod, string> = {
  email: 'an email link or code',
  passkey: 'a passkey',
  recovery: 'an enrolment link',
};

/** One line that tells this session what it can do on this page. */
const Notice = ({
  method,
  admin,
  firstPasskey,
  canChange,
}: {
  method: SessionMethod;
  admin: boolean;
  firstPasskey: boolean;
  canChange: boolean;
}) => {
  if (method === 'recovery') {
    return (
      <p>
        This is a recovery session. It can only add a passkey, and it ends{' '}
        {RECOVERY_MINUTES} minutes after it started. After you add a passkey,
        sign out and sign in with the passkey.
      </p>
    );
  }
  if (admin && firstPasskey) {
    return (
      <p>
        You are the admin. The admin pages need a passkey sign-in. Add a
        passkey, then sign out and sign in with the passkey.
      </p>
    );
  }
  if (!canChange) {
    return <p>To add or delete a passkey, sign in with a passkey.</p>;
  }
  return null;
};

/**
 * The passkeys page: the list (name, added, last used), a delete button for
 * each one, and the form that adds a passkey. The add form needs JavaScript
 * (WebAuthn). With no JavaScript the page says so (REQ-CRM-BARE-001).
 */
export const PasskeysPage = ({
  email,
  method,
  admin,
  firstPasskey,
  canChange,
  passkeys,
  error,
}: {
  email: string;
  method: SessionMethod;
  admin: boolean;
  firstPasskey: boolean;
  canChange: boolean;
  passkeys: PasskeyRow[];
  error?: string;
}) => (
  <>
    <Panel label="Passkeys">
      <p>
        Signed in as {email}. This session started with {METHOD_TEXT[method]}.
      </p>
      <Notice
        method={method}
        admin={admin}
        firstPasskey={firstPasskey}
        canChange={canChange}
      />
      {error && <p role="alert">{error}</p>}
      {passkeys.length === 0 ? (
        <p>You have no passkeys.</p>
      ) : (
        <form method="post" action="/account/passkeys">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Added</th>
                <th scope="col">Last used</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {passkeys.map((passkey) => (
                <tr key={passkey.id}>
                  <td>{passkey.name}</td>
                  <td>
                    <time dateTime={passkey.created_at}>
                      {passkey.created_at}
                    </time>
                  </td>
                  <td>
                    {passkey.last_used_at ? (
                      <time dateTime={passkey.last_used_at}>
                        {passkey.last_used_at}
                      </time>
                    ) : (
                      'Never'
                    )}
                  </td>
                  <td>
                    {canChange ? (
                      <Key name="delete" value={passkey.id}>
                        Delete
                      </Key>
                    ) : (
                      'Sign in with a passkey to delete'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </form>
      )}
    </Panel>
    {canChange && (
      <Panel label="Add a passkey">
        <p data-passkey-note="">
          Passkeys need JavaScript. Turn on JavaScript to add a passkey.
        </p>
        <form hidden data-passkey="register">
          <p>
            <Field label="Name">
              <input
                name="name"
                required
                maxLength={NAME_MAX}
                placeholder="iPhone"
              />
            </Field>
          </p>
          <p role="alert" hidden data-passkey-error="" />
          <p>
            <Key>Add a passkey</Key>
          </p>
        </form>
      </Panel>
    )}
    <p>
      <a href="/account/sessions">Sessions</a>
    </p>
  </>
);

/** Render the page for this session, with `error` if there is one. */
const sendPage = (
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  error?: string,
) => {
  const auth = request.auth as Auth;
  const passkeys = db
    .query<PasskeyRow, [string]>(
      `SELECT id, name, created_at, last_used_at FROM passkey
       WHERE person_id = ? ORDER BY created_at, rowid;`,
    )
    .all(auth.personId);
  return reply
    .type('text/html; charset=utf-8')
    .send(
      renderPage(
        'Passkeys',
        <PasskeysPage
          email={auth.email}
          method={auth.method}
          admin={isAdmin(auth)}
          firstPasskey={!hasPasskey(db, auth.personId)}
          canChange={canChangePasskeys(db, auth)}
          passkeys={passkeys}
          error={error}
        />,
        request,
        ['passkeys'],
      ),
    );
};

/**
 * `GET /account/passkeys` and `POST /account/passkeys` (`delete=<id>`). The
 * add flow is in `routes/api/passkeys/register*.ts`.
 */
export const accountPasskeysRoute = (app: FastifyInstance, db: Database) => {
  app.get('/account/passkeys', async (request, reply) =>
    sendPage(db, request, reply),
  );

  app.post<{ Body: { delete?: string } }>(
    '/account/passkeys',
    async (request, reply) => {
      const auth = request.auth as Auth;
      if (!canChangePasskeys(db, auth)) {
        reply.code(403);
        return sendPage(
          db,
          request,
          reply,
          'Sign in with a passkey to delete a passkey.',
        );
      }
      const row = db
        .query<{ id: string; name: string }, [string, string]>(
          'DELETE FROM passkey WHERE id = ? AND person_id = ? RETURNING id, name;',
        )
        .get(String(request.body?.delete ?? ''), auth.personId);
      if (row) {
        audit(db, auth.personId, 'passkey_delete', 'passkey', row.id, {
          name: row.name,
          session: auth.sessionId,
        });
      }
      return reply.redirect('/account/passkeys', 303);
    },
  );
};
