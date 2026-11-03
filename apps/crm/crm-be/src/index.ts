import type { Database } from 'bun:sqlite';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ensureAdmin, makeLoginLimits, registerAuth } from './auth';
import { DB_PATH, openDatabase } from './db';
import { demoConfigError } from './demo';
import { checkEmailConfig } from './email';
import { FE_DIST } from './render';
import { accountRoute } from './routes/account';
import { accountPasskeysRoute } from './routes/account/passkeys';
import { accountResetDemoRoute } from './routes/account/reset-demo';
import { accountSessionsRoute } from './routes/account/sessions';
import { healthRoute } from './routes/api/health';
import { passkeyRegisterRoute } from './routes/api/passkeys/register';
import { passkeyRegisterOptionsRoute } from './routes/api/passkeys/register-options';
import { passkeySignInRoute } from './routes/api/passkeys/sign-in';
import { passkeySignInOptionsRoute } from './routes/api/passkeys/sign-in-options';
import { faviconRoute } from './routes/favicon';
import { listRoute } from './routes/index';
import { loginRoute } from './routes/login';
import { loginCodeRoute } from './routes/login/code';
import { loginDemoRoute } from './routes/login/demo';
import { loginRecoverRoute } from './routes/login/recover';
import { loginVerifyRoute } from './routes/login/verify';
import { logoutRoute } from './routes/logout';
import { orgRoute } from './routes/orgs/[slug]';
import { orgActivityRoute } from './routes/orgs/[slug]/activity';
import { orgActivityEditRoute } from './routes/orgs/[slug]/activity/[id]';
import { orgContactsRoute } from './routes/orgs/[slug]/contacts';
import { orgContactEditRoute } from './routes/orgs/[slug]/contacts/[id]';
import { orgContactRemoveRoute } from './routes/orgs/[slug]/contacts/[id]/remove';
import { orgEditRoute } from './routes/orgs/[slug]/edit';
import { orgStageRoute } from './routes/orgs/[slug]/stage';
import { orgsNewRoute } from './routes/orgs/new';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4100;
const IS_TEST = process.env.NODE_ENV === 'test';

/**
 * Make the Fastify app. It renders every page, serves the crm-fe build at
 * `/static/`, and serves the API under `/api`. One route file for each URL,
 * in `routes/`. Every page except the sign-in pages needs a session (see
 * `auth.ts`).
 */
export const buildApp = (db: Database) => {
  const app = Fastify({ logger: !IS_TEST });
  app.register(fastifyCookie);
  app.register(fastifyFormbody);
  registerAuth(app, db);

  // Rsbuild puts a content hash in each file name, so a browser can keep a
  // file for a year.
  app.register(fastifyStatic, {
    root: path.join(FE_DIST, 'static'),
    prefix: '/static/',
    immutable: true,
    maxAge: '365d',
  });

  listRoute(app, db);
  healthRoute(app);
  faviconRoute(app);
  const limits = makeLoginLimits();
  loginRoute(app, db, limits);
  loginCodeRoute(app, db, limits);
  loginVerifyRoute(app, db);
  loginRecoverRoute(app, db);
  loginDemoRoute(app, db);
  logoutRoute(app, db);
  accountRoute(app, db);
  accountSessionsRoute(app, db);
  accountPasskeysRoute(app, db);
  accountResetDemoRoute(app, db);
  passkeyRegisterOptionsRoute(app, db);
  passkeyRegisterRoute(app, db);
  passkeySignInOptionsRoute(app, db);
  passkeySignInRoute(app, db);
  orgsNewRoute(app, db);
  // `/orgs/new` is a static route, so it wins over `/orgs/<slug>`, and no
  // slug is `new` (`RESERVED_SLUG` in `org.ts`).
  orgRoute(app, db);
  orgEditRoute(app, db);
  orgStageRoute(app, db);
  orgActivityRoute(app, db);
  orgActivityEditRoute(app, db);
  orgContactsRoute(app, db);
  orgContactEditRoute(app, db);
  orgContactRemoveRoute(app, db);

  return app;
};

const start = async () => {
  // A demo switch on the live host stops the server before it opens the
  // database (`demo.ts`).
  const demoError = demoConfigError();
  if (demoError) {
    console.error(`crm-be: ${demoError}`);
    process.exit(1);
  }
  // Open the database at boot, so that a bad DB_PATH stops the server now.
  const db = openDatabase(DB_PATH);
  checkEmailConfig();
  ensureAdmin(db, process.env.CRM_ADMIN_EMAIL);
  const app = buildApp(db);
  app.addHook('onClose', async () => db.close());
  try {
    await app.listen({ host: '0.0.0.0', port: PORT });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

if (import.meta.main) {
  start();
}
