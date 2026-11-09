/**
 * The cron service. It runs the jobs in `registry.ts`, and serves the
 * dashboard data to seanmizen.com/cron.
 *
 * Env vars: PORT (default 4001), DB_PATH (default ./data/cron.db),
 * LOG_LEVEL, and the email values in `email.ts`. The README lists them.
 *
 * At startup, the service sends one email (`startupEmail` in runner.ts).
 *
 * Routes:
 * - GET /api/cron: each job, its schedule, and its recent runs.
 * - GET /api/health: 200 when the service is up.
 */

import { openDb } from './db';
import { checkEmailConfig, sendEmail } from './email';
import { log } from './log';
import { registry } from './registry';
import { dashboard, startJobs, startupEmail } from './runner';

const port = Number.parseInt(process.env.PORT || '4001', 10);
const db = openDb(process.env.DB_PATH || './data/cron.db');
const email = checkEmailConfig();
const crons = startJobs(db, registry);

Bun.serve({
  port,
  routes: {
    '/api/health': new Response('ok'),
    '/api/cron': () =>
      Response.json(dashboard(db, registry, crons), {
        headers: { 'cache-control': 'no-store' },
      }),
  },
  fetch: () => new Response('Not found', { status: 404 }),
});

log.info(`listening on ${port}. Email is ${email ? 'on' : 'off'}.`);

// One email at each start: after a deploy that changed the image, a reboot,
// or a crash. sendEmail never throws.
await sendEmail(startupEmail(registry, crons));
