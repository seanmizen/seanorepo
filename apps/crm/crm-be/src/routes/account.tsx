import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { type Auth, now, type SessionMethod } from '../auth';
import { type PageParts, renderPage } from '../render';
import { Device } from '../ui/Device';
import { Lcd } from '../ui/Lcd';

/** How a session started, as the LCD of an account page shows it. */
export const SESSION_TEXT: Record<SessionMethod, string> = {
  email: 'Email link or code',
  passkey: 'Passkey',
  recovery: 'Recovery link',
};

/**
 * The account page. The nav links to it, and so does the path title of
 * each account page. The LCD shows the person and the session, then a
 * menu of the account pages, each with its count.
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
          { label: 'Person', value: auth.email },
          { label: 'Session', value: SESSION_TEXT[auth.method] },
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
