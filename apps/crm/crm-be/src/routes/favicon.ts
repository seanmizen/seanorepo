import type { FastifyInstance } from 'fastify';

/**
 * `GET /favicon.ico`. Open to a signed-out visitor. The crm has no icon, so
 * the response is 204 with no body. A browser asks for this path on each
 * page, so it must not go to `/login`.
 */
export const faviconRoute = (app: FastifyInstance) => {
  app.get('/favicon.ico', async (_request, reply) =>
    reply.code(204).header('cache-control', 'public, max-age=86400').send(),
  );
};
