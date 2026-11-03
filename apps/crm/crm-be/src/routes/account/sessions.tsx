import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { type Auth, audit, now } from '../../auth';
import { type PageParts, renderPage } from '../../render';
import { Device } from '../../ui/Device';
import { Key } from '../../ui/Key';
import { Module } from '../../ui/Module';
import { Records, RecordTable } from '../../ui/Records';
import { When } from '../../ui/When';

interface SessionRow {
  id: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
}

/**
 * The sessions page. The device signs out every other session, and it
 * shows only when there is one. The records list the sessions, with a
 * small revoke key for each one except this session. "sign out" in the
 * nav ends this session.
 */
export const sessionsPage = ({
  currentId,
  sessions,
}: {
  currentId: string;
  sessions: SessionRow[];
}): PageParts => {
  const others = sessions.some((session) => session.id !== currentId);
  return {
    title: 'Sessions',
    device: others ? (
      <Device>
        <Module label="Sign out">
          <form method="post" action="/account/sessions">
            <Key name="revoke" value="others">
              Everywhere else
            </Key>
          </form>
        </Module>
      </Device>
    ) : undefined,
    records: (
      <Records title="Sessions">
        {others ? (
          <form method="post" action="/account/sessions">
            <SessionTable currentId={currentId} sessions={sessions} />
          </form>
        ) : (
          <SessionTable currentId={currentId} sessions={sessions} />
        )}
      </Records>
    ),
  };
};

/**
 * The sessions as a table, with a revoke key for each one except this
 * session. The page puts it in a form only when it has a revoke key.
 */
const SessionTable = ({
  currentId,
  sessions,
}: {
  currentId: string;
  sessions: SessionRow[];
}) => (
  <RecordTable
    head={['Device', 'Signed in', 'Last seen', 'Action']}
    rows={sessions.map((session) => ({
      key: session.id,
      cells: [
        session.user_agent || 'Unknown device',
        <When key="signed-in" value={session.created_at} />,
        <When key="last-seen" value={session.last_seen_at} />,
        session.id === currentId ? (
          'This session'
        ) : (
          <Key key="revoke" name="revoke" value={session.id}>
            Revoke
          </Key>
        ),
      ],
    }))}
  />
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
      .all(auth.personId, now());
    return reply.type('text/html; charset=utf-8').send(
      renderPage(
        request,
        sessionsPage({
          currentId: auth.sessionId,
          sessions,
        }),
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
