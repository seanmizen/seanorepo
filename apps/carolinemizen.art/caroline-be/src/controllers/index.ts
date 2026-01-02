// API layer
import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { artworkRoutes } from './artworks';
import { authRoutes } from './auth';
import { configRoutes } from './config';
import { contentRoutes } from './content';
import { routes as databaseRoutes } from './db';
import { debugRoutes } from './debug';
import { galleryRoutes } from './galleries';
import { healthRoutes } from './health';
import { imageRoutes } from './images';
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

  // Admin routes - protected by requireAdmin middleware
  fastify.register(
    async (adminScope) => {
      const { requireAdmin } = await import('../middleware/auth');
      adminScope.addHook('onRequest', requireAdmin);

      adminScope.register(imageRoutes, { prefix: '/images' });
      adminScope.register(artworkRoutes, { prefix: '/artworks' });
      adminScope.register(galleryRoutes, { prefix: '/galleries' });
      adminScope.register(contentRoutes, { prefix: '/content' });
      adminScope.register(debugRoutes, { prefix: '/debug' });

      // Nuke endpoint - backup and reseed database
      adminScope.post(
        '/nuke',
        async (_request: FastifyRequest, reply: FastifyReply) => {
          try {
            const { seedDatabase } = await import('../services/db');
            const { copyFile } = await import('node:fs/promises');
            const path = await import('node:path');

            // Get database path
            const dbPath = process.env.DB_PATH
              ? `${process.env.DB_PATH}/database.db`
              : './database.db';

            // Create backup with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = process.env.DB_PATH || '.';
            const backupPath = path.join(
              backupDir,
              `database.backup.${timestamp}.db`,
            );

            // Copy database to backup
            await copyFile(dbPath, backupPath);
            console.log(`✓ Database backed up to: ${backupPath}`);

            // Reset database
            await seedDatabase();
            console.log('✓ Database reset to defaults');

            return reply.send({
              success: true,
              backup_path: backupPath,
              message: 'Database reset successful',
            });
          } catch (error) {
            console.error('Error resetting database:', error);
            return reply
              .status(500)
              .send({ error: 'Failed to reset database' });
          }
        },
      );
    },
    { prefix: '/admin' },
  );

  // Dev/debug routes
  fastify.register(databaseRoutes, { prefix: '/db' });
  fastify.register(userRoutes, { prefix: '/users' });
};

export { routes };
