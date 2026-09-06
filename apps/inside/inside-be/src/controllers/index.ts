import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/auth';
import { authRoutes } from './auth';
import { configRoutes } from './config';
import { designerRoutes } from './designers';
import { healthRoutes } from './health';
import { imageRoutes } from './images';

/** Everything under /api. */
export async function routes(fastify: FastifyInstance): Promise<void> {
  fastify.register(healthRoutes);
  fastify.register(configRoutes);
  fastify.register(authRoutes, { prefix: '/auth' });

  // Public reads and the signed-in designer's own /me scope.
  fastify.register(designerRoutes);
  fastify.register(imageRoutes);

  // Admin routes live in their own encapsulated scope with the guard attached
  // as an onRequest hook, so every child route is protected by construction —
  // you cannot add an unprotected admin route by forgetting a decorator.
  fastify.register(
    async (adminScope) => {
      adminScope.addHook('onRequest', requireAdmin);

      adminScope.get('/whoami', async (request) => {
        return { user: (request as { authUser?: unknown }).authUser };
      });
    },
    { prefix: '/admin' },
  );
}
