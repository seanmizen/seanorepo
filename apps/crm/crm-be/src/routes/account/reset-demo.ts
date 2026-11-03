import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { demoLoginOn } from '../../demo';
import { seedDemo } from '../../demo-seed';
import { sendNotFound } from '../orgs/[slug]';

/**
 * `POST /account/reset-demo`: the `Reset demo data` button of `/account`.
 * While the demo switch is on (`demo.ts`), it runs the demo seed
 * (`demo-seed.ts`), the same as `bun run demo:seed`, then opens `/`. While
 * the switch is off, the route returns 404. It is an admin route.
 */
export const accountResetDemoRoute = (app: FastifyInstance, db: Database) => {
  app.post(
    '/account/reset-demo',
    { config: { admin: true } },
    async (request, reply) => {
      if (!demoLoginOn()) return sendNotFound(request, reply);
      seedDemo(db, process.env.CRM_ADMIN_EMAIL);
      return reply.redirect('/', 303);
    },
  );
};
