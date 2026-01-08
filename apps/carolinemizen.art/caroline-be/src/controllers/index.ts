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

      // Nuke endpoint - backup and reseed database
      adminScope.post(
        '/nuke',
        async (_request: FastifyRequest, reply: FastifyReply) => {
          try {
            const { seedDatabase } = await import('../services/db');
            const { copyFile, readdir, unlink, stat } = await import(
              'node:fs/promises'
            );
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

            // Delete all images from storage
            const uploadsPath = process.env.UPLOADS_PATH || './uploads';
            const imagesPath = path.join(uploadsPath, 'images');

            let deletedCount = 0;
            try {
              // Check if images folder exists
              await stat(imagesPath);

              const files = await readdir(imagesPath);
              for (const file of files) {
                const filePath = path.join(imagesPath, file);
                const fileStats = await stat(filePath);

                // Only delete files, not directories
                if (fileStats.isFile()) {
                  await unlink(filePath);
                  deletedCount++;
                }
              }
              console.log(`✓ Deleted ${deletedCount} image(s) from storage`);
            } catch {
              // If images folder doesn't exist, that's fine
              console.log('✓ No images folder to clean');
            }

            // Reset database
            await seedDatabase();
            console.log('✓ Database reset to defaults');

            return reply.send({
              success: true,
              backup_path: backupPath,
              images_deleted: deletedCount,
              message: 'Database and images reset successful',
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
