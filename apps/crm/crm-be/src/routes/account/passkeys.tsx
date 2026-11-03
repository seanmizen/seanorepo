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
import { canChangePasskeys } from '../../passkeys';
import { type PageParts, renderPage } from '../../render';
import { Device } from '../../ui/Device';
import { Key } from '../../ui/Key';
import { Lcd } from '../../ui/Lcd';
import { Module } from '../../ui/Module';
import { AddPasskey } from '../../ui/Passkey';
import { Records, RecordTable } from '../../ui/Records';
import { When } from '../../ui/When';
import { SESSION_TEXT } from '../account';

interface PasskeyRow {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

/**
 * One line under the device that tells this session what it can do on
 * this page.
 */
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
        {RECOVERY_MINUTES} minutes after it started. When you add a passkey,
        this session becomes a passkey session.
      </p>
    );
  }
  if (admin && firstPasskey) {
    return (
      <p>
        You are the admin. The admin pages need a passkey. Add one to this
        device, and the admin pages open in this session.
      </p>
    );
  }
  if (!canChange) {
    return <p>To add or delete a passkey, sign in with a passkey.</p>;
  }
  return null;
};

/**
 * The passkeys page. The LCD shows the person, the session and the count.
 * The device adds a passkey. The records list the passkeys (name, added,
 * last used), with a delete key for each one. The add form needs
 * JavaScript (WebAuthn). With no JavaScript the module says so
 * (REQ-CRM-BARE-001).
 */
export const passkeysPage = ({
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
}): PageParts => ({
  title: 'Passkeys',
  device: (
    <Device>
      <Lcd
        alert={error}
        rows={[
          { label: 'Person', value: email },
          { label: 'Session', value: SESSION_TEXT[method] },
          { label: 'Passkeys', value: String(passkeys.length) },
        ]}
      />
      {canChange && (
        <Module label="Add a passkey">
          <AddPasskey next="/account/passkeys" />
        </Module>
      )}
    </Device>
  ),
  help: (
    <Notice
      method={method}
      admin={admin}
      firstPasskey={firstPasskey}
      canChange={canChange}
    />
  ),
  records: (
    <Records title="Passkeys">
      {passkeys.length === 0 ? (
        <p>You have no passkeys.</p>
      ) : (
        <form method="post" action="/account/passkeys">
          <RecordTable
            head={['Name', 'Added', 'Last used', 'Action']}
            rows={passkeys.map((passkey) => ({
              key: passkey.id,
              cells: [
                passkey.name,
                <When key="added" value={passkey.created_at} />,
                passkey.last_used_at ? (
                  <When key="used" value={passkey.last_used_at} />
                ) : (
                  'Never'
                ),
                canChange ? (
                  <Key key="delete" name="delete" value={passkey.id}>
                    Delete
                  </Key>
                ) : (
                  'Sign in with a passkey to delete'
                ),
              ],
            }))}
          />
        </form>
      )}
    </Records>
  ),
  entries: ['passkeys'],
});

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
  return reply.type('text/html; charset=utf-8').send(
    renderPage(
      request,
      passkeysPage({
        email: auth.email,
        method: auth.method,
        admin: isAdmin(auth),
        firstPasskey: !hasPasskey(db, auth.personId),
        canChange: canChangePasskeys(db, auth),
        passkeys,
        error,
      }),
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
