import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { type Auth, isAdmin, now, type SessionMethod } from '../auth';
import { demoLoginOn } from '../demo';
import { listConnections } from '../oauth';
import { type PageParts, renderPage } from '../render';
import { Device } from '../ui/Device';
import { Key } from '../ui/Key';
import { Lcd } from '../ui/Lcd';
import { Module } from '../ui/Module';

/** How a session started, as the account page shows it. */
export const SESSION_TEXT: Record<SessionMethod, string> = {
  email: 'Email link or code',
  passkey: 'Passkey',
  recovery: 'Recovery link',
};

/**
 * The account page. The nav links to it, and so does the path title of
 * each account page. The LCD shows the email and how this session signed
 * in, then a menu of the account pages, each with its count. Only the
 * admin has the Connections page (`connections`). The Demo module holds
 * `Reset demo data`. While the demo switch (`demo.ts`) is off, the key is
 * off, with the reason (REQ-CRM-BUTTON-001).
 */
export const accountPage = ({
  auth,
  passkeys,
  sessions,
  connections,
}: {
  auth: Auth;
  passkeys: number;
  sessions: number;
  connections?: number;
}): PageParts => ({
  title: 'Account',
  device: (
    <Device>
      <Lcd
        rows={[
          { label: 'Email', value: auth.email },
          { label: 'Signed in with', value: SESSION_TEXT[auth.method] },
        ]}
        menu={{
          legend: ['Page', 'Count'],
          empty: '',
          items: [
            {
              href: '/account/passkeys',
              name: 'Passkeys',
              value: String(passkeys),
            },
            {
              href: '/account/sessions',
              name: 'Sessions',
              value: String(sessions),
            },
            ...(connections === undefined
              ? []
              : [
                  {
                    href: '/account/connections',
                    name: 'Connections',
                    value: String(connections),
                  },
                ]),
          ],
        }}
      />
      <Module label="Demo">
        <form method="post" action="/account/reset-demo">
          <Key
            id="reset-demo"
            off={
              demoLoginOn() ? undefined : 'Only the demo site has demo data.'
            }
          >
            Reset demo data
          </Key>
        </form>
      </Module>
    </Device>
  ),
});

/** `GET /account` */
export const accountRoute = (app: FastifyInstance, db: Database) => {
  app.get('/account', async (request, reply) => {
    const auth = request.auth as Auth;
    const count = (sql: string, ...params: string[]) =>
      db.query<{ n: number }, string[]>(sql).get(...params)?.n ?? 0;
    return reply.type('text/html; charset=utf-8').send(
      renderPage(
        request,
        accountPage({
          auth,
          passkeys: count(
            'SELECT count(*) AS n FROM passkey WHERE person_id = ?;',
            auth.personId,
          ),
          sessions: count(
            'SELECT count(*) AS n FROM session WHERE person_id = ? AND expires_at > ?;',
            auth.personId,
            now(),
          ),
          connections: isAdmin(auth)
            ? listConnections(db, auth.personId).length
            : undefined,
        }),
      ),
    );
  });
};
