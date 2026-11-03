import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import {
  ensureAdmin,
  normalizeEmail,
  safeNext,
  startSession,
} from '../../auth';
import { demoLoginOn } from '../../demo';
import { Key } from '../../ui/Key';
import { Module } from '../../ui/Module';
import { sendNotFound } from '../orgs/[slug]';

/**
 * The module of `/login` that holds the `Enter as admin (demo)` button.
 * `/login` shows it only while the demo switch is on (`demo.ts`).
 */
export const DemoSignIn = ({ next }: { next: string }) => (
  <Module label="Demo">
    <form method="post" action="/login/demo">
      <input type="hidden" name="next" value={next} />
      <Key>Enter as admin (demo)</Key>
    </form>
  </Module>
);

/**
 * `POST /login/demo`. While the demo switch is on, start a session for the
 * admin (CRM_ADMIN_EMAIL), as if by passkey, with no check. The audit row
 * is `sign_in` with the method `demo`. While the switch is off, the route
 * returns 404.
 */
export const loginDemoRoute = (app: FastifyInstance, db: Database) => {
  app.post<{ Body: { next?: string } }>(
    '/login/demo',
    async (request, reply) => {
      const email = normalizeEmail(process.env.CRM_ADMIN_EMAIL);
      if (!demoLoginOn() || !email) return sendNotFound(request, reply);
      ensureAdmin(db, email);
      const admin = db
        .query<{ id: string }, [string]>(
          'SELECT id FROM person WHERE lower(email) = ?;',
        )
        .get(email);
      if (!admin) return sendNotFound(request, reply);
      startSession(db, request, reply, admin.id, 'demo');
      return reply.redirect(safeNext(request.body?.next), 303);
    },
  );
};
