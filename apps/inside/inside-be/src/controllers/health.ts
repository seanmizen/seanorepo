import type { HealthResponse } from '@shared/types';
import type { FastifyInstance } from 'fastify';

const startedAt = Date.now();

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      uptime: Math.round((Date.now() - startedAt) / 1000),
      version: process.env.APP_VERSION ?? '0.1.0',
    };
  });
}
