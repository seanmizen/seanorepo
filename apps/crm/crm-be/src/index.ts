import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { DB_PATH, openDatabase } from './db';
import { FE_DIST } from './render';
import { healthRoute } from './routes/api/health';
import { homeRoute } from './routes/index';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4100;
const IS_TEST = process.env.NODE_ENV === 'test';

/**
 * Make the Fastify app. It renders every page, serves the crm-fe build at
 * `/static/`, and serves the API under `/api`. One route file for each URL,
 * in `routes/`.
 */
export const buildApp = () => {
  const app = Fastify({ logger: !IS_TEST });

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

  return app;
};

const start = async () => {
  // Open the database at boot, so that a bad DB_PATH stops the server now.
  const db = openDatabase(DB_PATH);
  const app = buildApp();
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
