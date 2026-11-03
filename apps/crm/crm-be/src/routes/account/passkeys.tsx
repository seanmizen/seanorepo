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

interface PasskeyRow {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

/**
 * The one sentence under the nav that tells this session what it can do on
 * this page, or nothing.
 */
const notice = ({
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
    return `This recovery session can only add a passkey, and it ends ${RECOVERY_MINUTES} minutes after it started.`;
  }
  if (admin && firstPasskey) {
    return 'The admin pages need a passkey, so add one to this device to open them in this session.';
  }
  if (!canChange) {
    return 'To add or delete a passkey, sign in with a passkey.';
  }
  return undefined;
};

/**
 * The passkeys page. The intro tells a session that cannot change its
 * passkeys why. The device adds a passkey, and the LCD shows only an
 * error. The records list the passkeys (name, added, last used), with a
 * small delete key for each one. The add form needs JavaScript (WebAuthn).
 * With no JavaScript the module says so (REQ-CRM-BARE-001).
 */
export const passkeysPage = ({
  method,
  admin,
  firstPasskey,
  canChange,
  passkeys,
  error,
}: {
  method: SessionMethod;
  admin: boolean;
  firstPasskey: boolean;
  canChange: boolean;
  passkeys: PasskeyRow[];
  error?: string;
}): PageParts => ({
  title: 'Passkeys',
  intro: notice({ method, admin, firstPasskey, canChange }),
  device:
    canChange || error ? (
      <Device>
        <Lcd alert={error} />
        {canChange && (
          <Module label="Add a passkey">
            <AddPasskey next="/account/passkeys" />
          </Module>
        )}
      </Device>
    ) : undefined,
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
