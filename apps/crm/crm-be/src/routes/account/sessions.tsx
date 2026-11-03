import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { type Auth, audit } from '../../auth';
import { renderPage } from '../../render';
import { Key } from '../../ui/Key';
import { Panel } from '../../ui/Panel';

interface SessionRow {
  id: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
}

/** The sessions list. Each row has a revoke button, except this session. */
export const SessionsPage = ({
  email,
  currentId,
  sessions,
}: {
  email: string;
  currentId: string;
  sessions: SessionRow[];
}) => (
  <Panel label="Sessions">
    <p>Signed in as {email}.</p>
    <form method="post" action="/account/sessions">
      <table>
        <thead>
          <tr>
            <th scope="col">Device</th>
            <th scope="col">Signed in</th>
            <th scope="col">Last seen</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id}>
              <td>{session.user_agent || 'Unknown device'}</td>
              <td>
                <time dateTime={session.created_at}>{session.created_at}</time>
              </td>
              <td>
                <time dateTime={session.last_seen_at}>
                  {session.last_seen_at}
                </time>
              </td>
              <td>
                {session.id === currentId ? (
                  'This session'
                ) : (
                  <Key name="revoke" value={session.id}>
                    Revoke
                  </Key>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <Key name="revoke" value="others">
          Sign out everywhere else
        </Key>
      </p>
    </form>
    <form method="post" action="/logout">
      <p>
        <Key>Sign out</Key>
      </p>
    </form>
    <p>
      <a href="/account/passkeys">Passkeys</a>
    </p>
  </Panel>
);

/**
 * Revoke one session of this person, or all their sessions except this one
 * (`revoke=others`). A session of a different person is never touched.
 */
const revoke = (db: Database, auth: Auth, target: string) => {
  const rows =
    target === 'others'
      ? db
          .query<{ id: string }, [string, string]>(
            'DELETE FROM session WHERE person_id = ? AND id != ? RETURNING id;',
          )
          .all(auth.personId, auth.sessionId)
      : db
          .query<{ id: string }, [string, string, string]>(
            'DELETE FROM session WHERE person_id = ? AND id = ? AND id != ? RETURNING id;',
          )
          .all(auth.personId, target, auth.sessionId);
  for (const row of rows) {
    audit(db, auth.personId, 'sign_out', 'session', row.id, {
      revoked_by: auth.sessionId,
    });
  }
};

/** `GET /account/sessions` and `POST /account/sessions` */
export const accountSessionsRoute = (app: FastifyInstance, db: Database) => {
  app.get('/account/sessions', async (request, reply) => {
    const auth = request.auth as Auth;
    const sessions = db
      .query<SessionRow, [string, string]>(
        `SELECT id, user_agent, created_at, last_seen_at FROM session
         WHERE person_id = ? AND expires_at > ? ORDER BY last_seen_at DESC;`,
      )
      .all(auth.personId, new Date().toISOString());
    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderPage(
          'Sessions',
          <SessionsPage
            email={auth.email}
            currentId={auth.sessionId}
            sessions={sessions}
          />,
          request,
        ),
      );
  });

  app.post<{ Body: { revoke?: string } }>(
    '/account/sessions',
    async (request, reply) => {
      revoke(db, request.auth as Auth, String(request.body?.revoke ?? ''));
      return reply.redirect('/account/sessions', 303);
    },
  );
};
