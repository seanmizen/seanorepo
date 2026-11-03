import cors from '@fastify/cors';
import type { HealthResponse } from '@shared/types';
import Fastify from 'fastify';
import { DB_PATH, openDatabase } from './db';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4101;
const IS_TEST = process.env.NODE_ENV === 'test';

/** Make the Fastify app. All routes use the `/api` prefix. */
export const buildApp = () => {
  const app = Fastify({ logger: !IS_TEST });

  app.register(cors, {
    origin: process.env.CORS_ORIGIN || 'http://localhost:4100',
  });

  app.get('/api/health', async (): Promise<HealthResponse> => ({ ok: true }));

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
