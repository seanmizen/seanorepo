import type { Database } from 'bun:sqlite';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ensureAdmin, makeLoginLimits, registerAuth } from './auth';
import { DB_PATH, openDatabase } from './db';
import { checkEmailConfig } from './email';
import { FE_DIST } from './render';
import { accountSessionsRoute } from './routes/account/sessions';
import { healthRoute } from './routes/api/health';
import { homeRoute } from './routes/index';
import { loginRoute } from './routes/login';
import { loginCodeRoute } from './routes/login/code';
import { loginVerifyRoute } from './routes/login/verify';
import { logoutRoute } from './routes/logout';

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

  homeRoute(app);
  healthRoute(app);
  const limits = makeLoginLimits();
  loginRoute(app, db, limits);
  loginCodeRoute(app, db, limits);
  loginVerifyRoute(app, db);
  logoutRoute(app, db);
  accountSessionsRoute(app, db);

  return app;
};

const start = async () => {
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
