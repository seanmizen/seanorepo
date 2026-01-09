import { copyFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { seedDatabase } from '../services/db';

export async function nukeRoutes(fastify: FastifyInstance) {
  /**
   * POST /admin/nuke
   * Admin: Backup database, delete all images, and reseed database
   */
  fastify.post('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
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
      return reply.status(500).send({ error: 'Failed to reset database' });
    }
  });
}
