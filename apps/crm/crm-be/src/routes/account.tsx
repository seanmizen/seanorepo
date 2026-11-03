import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { type Auth, now, type SessionMethod } from '../auth';
import { demoLoginOn } from '../demo';
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
 * in, then a menu of the account pages, each with its count. While the
 * demo switch is on (`demo.ts`), the Demo module holds `Reset demo data`.
 */
export const accountPage = ({
  auth,
  passkeys,
  sessions,
}: {
  auth: Auth;
  passkeys: number;
  sessions: number;
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
          ],
        }}
      />
      {demoLoginOn() && (
        <Module label="Demo">
          <form method="post" action="/account/reset-demo">
            <Key>Reset demo data</Key>
          </form>
        </Module>
      )}
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
        }),
      ),
    );
  });
};
