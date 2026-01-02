import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { openDbConnection } from '../services/db';
import { storage } from '../services/storage';

interface Image {
  id: number;
  filename: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  storage_path: string;
  alt_text: string | null;
  created_at: string;
}

export async function imageRoutes(fastify: FastifyInstance) {
  /**
   * POST /admin/images/upload
   * Upload multiple images/videos
   */
  fastify.post(
    '/upload',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const files = await request.files();
        const uploadedImages: Array<Image & { url: string }> = [];

        // Validate file types
        const allowedTypes = [
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/webp',
          'image/gif',
          'video/mp4',
          'video/quicktime',
          'video/webm',
        ];

        const db = await openDbConnection();
        try {
          for await (const file of files) {
            if (!allowedTypes.includes(file.mimetype)) {
              console.warn(
                `Skipping file ${file.filename} with invalid type ${file.mimetype}`,
              );
              continue;
            }

            // Read file buffer
            const buffer = await file.toBuffer();

            // Generate unique filename
            const ext = path.extname(file.filename);
            const uniqueFilename = `${randomUUID()}${ext}`;

            // Upload to storage
            const { path: storagePath, url } = await storage.upload(
              buffer,
              uniqueFilename,
              {
                mimeType: file.mimetype,
                folder: 'images',
              },
            );

            // Save metadata to database
            db.run(
              `INSERT INTO images (filename, original_name, mime_type, file_size, storage_path)
             VALUES (?, ?, ?, ?, ?)`,
              [
                uniqueFilename,
                file.filename,
                file.mimetype,
                buffer.length,
                storagePath,
              ],
            );

            const imageId = Number(
              (
                db.query('SELECT last_insert_rowid() as id').get() as {
                  id: number;
                }
              ).id,
            );

            const image = db
              .query('SELECT * FROM images WHERE id = ?')
              .get(imageId) as Image;

            uploadedImages.push({
              ...image,
              url,
            });
          }

          if (uploadedImages.length === 0) {
            return reply.status(400).send({ error: 'No valid files uploaded' });
          }

          return reply.send({
            images: uploadedImages,
            count: uploadedImages.length,
          });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error uploading files:', error);
        return reply.status(500).send({ error: 'Failed to upload files' });
      }
    },
  );

  /**
   * GET /admin/images/count
   * Get count of images
   */
  fastify.get(
    '/count',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const db = await openDbConnection();
        try {
          const result = db
            .query('SELECT COUNT(*) as count FROM images')
            .get() as { count: number };
          return reply.send({ count: result.count });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error counting images:', error);
        return reply.status(500).send({ error: 'Failed to count images' });
      }
    },
  );

  /**
   * GET /admin/images
   * List all images with pagination
   */
  fastify.get(
    '/',
    async (
      request: FastifyRequest<{
        Querystring: { page?: string; limit?: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const page = Number.parseInt(request.query.page || '1', 10);
        const limit = Number.parseInt(request.query.limit || '20', 10);
        const offset = (page - 1) * limit;

        const db = await openDbConnection();
        try {
          const images = db
            .query(
              'SELECT * FROM images ORDER BY created_at DESC LIMIT ? OFFSET ?',
            )
            .all(limit, offset) as Image[];

          const totalResult = db
            .query('SELECT COUNT(*) as count FROM images')
            .get() as {
            count: number;
          };

          // Add URLs to images
          const imagesWithUrls = images.map((img) => ({
            ...img,
            url: storage.getUrl(img.storage_path),
          }));

          return reply.send({
            images: imagesWithUrls,
            pagination: {
              page,
              limit,
              total: totalResult.count,
              totalPages: Math.ceil(totalResult.count / limit),
            },
          });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error fetching images:', error);
        return reply.status(500).send({ error: 'Failed to fetch images' });
      }
    },
  );

  /**
   * DELETE /admin/images/:id
   * Delete an image
   */
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const imageId = Number.parseInt(request.params.id, 10);

        const db = await openDbConnection();
        try {
          // Get image details
          const image = db
            .query('SELECT * FROM images WHERE id = ?')
            .get(imageId) as Image | undefined;

          if (!image) {
            return reply.status(404).send({ error: 'Image not found' });
          }

          // Delete from storage
          await storage.delete(image.storage_path);

          // Delete from database
          db.run('DELETE FROM images WHERE id = ?', [imageId]);

          return reply.send({ message: 'Image deleted successfully' });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error deleting image:', error);
        return reply.status(500).send({ error: 'Failed to delete image' });
      }
    },
  );
}
