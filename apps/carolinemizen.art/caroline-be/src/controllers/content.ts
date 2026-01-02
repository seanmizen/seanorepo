import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAdmin } from '../middleware/auth';
import { openDbConnection } from '../services/db';

interface SiteContent {
  id: number;
  key: string;
  value: string;
  content_type: string;
  updated_at: string;
}

interface UpdateContentBody {
  value: string;
  content_type?: string;
}

export async function contentRoutes(fastify: FastifyInstance) {
  /**
   * GET /content
   * Public: Get all site content
   */
  fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = await openDbConnection();
      try {
        const rows = db
          .query('SELECT * FROM site_content')
          .all() as SiteContent[];

        // Convert to key-value object
        const content: Record<string, string> = {};
        for (const row of rows) {
          content[row.key] = row.value;
        }

        return reply.send({ content });
      } finally {
        db.close();
      }
    } catch (error) {
      console.error('Error fetching content:', error);
      return reply.status(500).send({ error: 'Failed to fetch content' });
    }
  });

  /**
   * GET /content/:key
   * Public: Get single content value
   */
  fastify.get<{ Params: { key: string } }>(
    '/:key',
    async (
      request: FastifyRequest<{ Params: { key: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { key } = request.params;

        const db = await openDbConnection();
        try {
          const content = db
            .query('SELECT * FROM site_content WHERE key = ?')
            .get(key) as SiteContent | undefined;

          if (!content) {
            return reply.status(404).send({ error: 'Content not found' });
          }

          return reply.send({ key: content.key, value: content.value });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error fetching content:', error);
        return reply.status(500).send({ error: 'Failed to fetch content' });
      }
    },
  );

  /**
   * PUT /admin/content/:key
   * Admin: Update content value
   */
  fastify.put<{ Params: { key: string }; Body: UpdateContentBody }>(
    '/:key',
    { onRequest: [requireAdmin] },
    async (
      request: FastifyRequest<{
        Params: { key: string };
        Body: UpdateContentBody;
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const { key } = request.params;
        const { value, content_type = 'text' } = request.body;

        if (!value) {
          return reply.status(400).send({ error: 'Value is required' });
        }

        const db = await openDbConnection();
        try {
          // Check if key exists
          const existing = db
            .query('SELECT * FROM site_content WHERE key = ?')
            .get(key);

          if (existing) {
            // Update existing
            db.run(
              "UPDATE site_content SET value = ?, content_type = ?, updated_at = datetime('now') WHERE key = ?",
              [value, content_type, key],
            );
          } else {
            // Insert new
            db.run(
              'INSERT INTO site_content (key, value, content_type) VALUES (?, ?, ?)',
              [key, value, content_type],
            );
          }

          const content = db
            .query('SELECT * FROM site_content WHERE key = ?')
            .get(key);

          return reply.send({ content });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error updating content:', error);
        return reply.status(500).send({ error: 'Failed to update content' });
      }
    },
  );

  /**
   * DELETE /admin/content/:key
   * Admin: Delete content
   */
  fastify.delete<{ Params: { key: string } }>(
    '/:key',
    { onRequest: [requireAdmin] },
    async (
      request: FastifyRequest<{ Params: { key: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { key } = request.params;

        const db = await openDbConnection();
        try {
          const existing = db
            .query('SELECT * FROM site_content WHERE key = ?')
            .get(key);
          if (!existing) {
            return reply.status(404).send({ error: 'Content not found' });
          }

          db.run('DELETE FROM site_content WHERE key = ?', [key]);

          return reply.send({ message: 'Content deleted successfully' });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error deleting content:', error);
        return reply.status(500).send({ error: 'Failed to delete content' });
      }
    },
  );
}
