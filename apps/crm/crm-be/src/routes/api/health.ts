import type { HealthResponse } from '@shared/types';
import type { FastifyInstance } from 'fastify';

/** The health result. `GET /api/health` returns it, and `GET /` shows it. */
export const getHealth = (): HealthResponse => ({ ok: true });

/** `GET /api/health` */
export const healthRoute = (app: FastifyInstance) => {
  app.get('/api/health', async (): Promise<HealthResponse> => getHealth());
};
