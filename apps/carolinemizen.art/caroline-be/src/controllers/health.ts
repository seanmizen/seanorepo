import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export async function healthRoutes(fastify: FastifyInstance) {
  /**
   * GET /health
   * Simple healthcheck endpoint
   */
  fastify.get(
    '/health',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
      });
    },
  );
}
