// API layer
import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { artworkRoutes } from './artworks';
import { authRoutes } from './auth';
import { carouselRoutes } from './carousel';
import { configRoutes } from './config';
import { contentRoutes } from './content';
import { routes as databaseRoutes } from './db';
import { debugRoutes } from './debug';
import { galleryRoutes } from './galleries';
import { healthRoutes } from './health';
import { imageRoutes } from './images';
import { nukeRoutes } from './nuke';
import { routes as userRoutes } from './users';

/**
 * encapsulates the routes
 */
const routes = async (
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) => {
  fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ hello: 'world' });
  });

  // Health check
  fastify.register(healthRoutes);

  // Config endpoint
  fastify.register(configRoutes);

  // Auth routes
  fastify.register(authRoutes, { prefix: '/auth' });

  // Public content routes
  fastify.register(contentRoutes, { prefix: '/content' });
  fastify.register(artworkRoutes, { prefix: '/artworks' });
  fastify.register(galleryRoutes, { prefix: '/galleries' });
  fastify.register(carouselRoutes, { prefix: '/carousel' });

  // Admin routes - protected by requireAdmin middleware
  fastify.register(
    async (adminScope) => {
      const { requireAdmin } = await import('../middleware/auth');
      adminScope.addHook('onRequest', requireAdmin);

      adminScope.register(imageRoutes, { prefix: '/images' });
      adminScope.register(artworkRoutes, { prefix: '/artworks' });
      adminScope.register(galleryRoutes, { prefix: '/galleries' });
      adminScope.register(contentRoutes, { prefix: '/content' });
      adminScope.register(carouselRoutes, { prefix: '/carousel' });
      adminScope.register(debugRoutes, { prefix: '/debug' });
      adminScope.register(nukeRoutes, { prefix: '/nuke' });

      // Dev/debug routes - now protected
      adminScope.register(databaseRoutes, { prefix: '/db' });
      adminScope.register(userRoutes, { prefix: '/users' });
    },
    { prefix: '/admin' },
  );
};

export { routes };
