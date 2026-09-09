import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/auth';
import { adminDesignerRoutes } from './admin-designers';
import { authRoutes } from './auth';
import { bidRoutes } from './bids';
import { briefRoutes } from './briefs';
import { configRoutes } from './config';
import { designerRoutes } from './designers';
import { discoveryRoutes } from './discovery';
import { healthRoutes } from './health';
import { imageRoutes } from './images';
import { savedDesignerRoutes } from './saved-designers';

/** Everything under /api. */
export async function routes(fastify: FastifyInstance): Promise<void> {
  fastify.register(healthRoutes);
  fastify.register(configRoutes);
  fastify.register(authRoutes, { prefix: '/auth' });

  // Public reads and the signed-in designer's own /me scope.
  fastify.register(designerRoutes);
  // Browse, filter and search. Public and anonymous by design.
  fastify.register(discoveryRoutes);
  fastify.register(imageRoutes);

  // Post-a-project: the buyer posts briefs, the designer bids on them.
  fastify.register(briefRoutes);
  fastify.register(bidRoutes);

  // The buyer's shortlist — save a designer for later (#161).
  fastify.register(savedDesignerRoutes);

  // Admin routes live in their own encapsulated scope with the guard attached
  // as an onRequest hook, so every child route is protected by construction —
  // you cannot add an unprotected admin route by forgetting a decorator.
  fastify.register(
    async (adminScope) => {
      adminScope.addHook('onRequest', requireAdmin);

      adminScope.get('/whoami', async (request) => {
        return { user: (request as { authUser?: unknown }).authUser };
      });

      // The designer review queue that operates the approval gate.
      adminScope.register(adminDesignerRoutes);
    },
    { prefix: '/admin' },
  );
}
