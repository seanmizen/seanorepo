import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAdmin } from '../middleware/auth';
import { openDbConnection } from '../services/db';

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

export async function carouselRoutes(fastify: FastifyInstance) {
  /**
   * GET /carousel
   * Public: Get carousel images in display order
   */
  fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = await openDbConnection();
      try {
        const images = db
          .query(
            `SELECT i.*, ci.display_order
             FROM carousel_images ci
             JOIN images i ON ci.image_id = i.id
             ORDER BY ci.display_order ASC`,
          )
          .all() as (Image & { display_order: number })[];

        return reply.send({ images });
      } finally {
        db.close();
      }
    } catch (error) {
      console.error('Error fetching carousel images:', error);
      return reply
        .status(500)
        .send({ error: 'Failed to fetch carousel images' });
    }
  });

  /**
   * PUT /admin/carousel
   * Admin: Replace all carousel images
   * Body: { image_ids: number[] }
   */
  fastify.put<{ Body: { image_ids: number[] } }>(
    '/',
    { onRequest: [requireAdmin] },
    async (
      request: FastifyRequest<{ Body: { image_ids: number[] } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { image_ids } = request.body;

        if (!Array.isArray(image_ids)) {
          return reply
            .status(400)
            .send({ error: 'image_ids must be an array' });
        }

        const db = await openDbConnection();
        try {
          // Delete all existing carousel images
          db.run('DELETE FROM carousel_images');

          // Insert new carousel images with display order
          for (let i = 0; i < image_ids.length; i++) {
            db.run(
              'INSERT INTO carousel_images (image_id, display_order) VALUES (?, ?)',
              [image_ids[i], i],
            );
          }

          // Fetch and return the updated carousel
          const images = db
            .query(
              `SELECT i.*, ci.display_order
               FROM carousel_images ci
               JOIN images i ON ci.image_id = i.id
               ORDER BY ci.display_order ASC`,
            )
            .all() as (Image & { display_order: number })[];

          return reply.send({ images });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error updating carousel images:', error);
        return reply
          .status(500)
          .send({ error: 'Failed to update carousel images' });
      }
    },
  );
}
