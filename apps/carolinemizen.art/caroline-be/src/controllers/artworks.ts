import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAdmin } from '../middleware/auth';
import { openDbConnection } from '../services/db';

interface Artwork {
  id: number;
  title: string;
  description: string | null;
  price_cents: number;
  currency: string;
  status: string;
  primary_image_id: number | null;
  created_at: string;
  updated_at: string;
}

interface CreateArtworkBody {
  title: string;
  description?: string;
  price_cents: number;
  currency?: string;
  status?: string;
  primary_image_id?: number;
  image_ids?: number[];
}

interface UpdateArtworkBody {
  title?: string;
  description?: string;
  price_cents?: number;
  currency?: string;
  status?: string;
  primary_image_id?: number;
  image_ids?: number[];
}

export async function artworkRoutes(fastify: FastifyInstance) {
  /**
   * GET /artworks or GET /admin/artworks
   * Public: List available artworks only
   * Admin: List all artworks (when accessed via /admin/artworks prefix)
   */
  fastify.get(
    '/',
    async (
      request: FastifyRequest<{
        Querystring: { status?: string; gallery?: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        // Check if this is admin route by checking if user is authenticated
        // Admin routes will have gone through requireAdmin middleware
        const isAdminRoute =
          (request as { authUser?: unknown }).authUser !== undefined;

        const { status, gallery } = request.query;

        // For public routes, default to 'available'. For admin, show all if no status specified
        const statusFilter = status || (isAdminRoute ? undefined : 'available');

        const db = await openDbConnection();
        try {
          let query = `
            SELECT a.*,
                   i.storage_path as primary_image_path,
                   i.mime_type as primary_image_mime_type
            FROM artworks a
            LEFT JOIN images i ON a.primary_image_id = i.id
          `;
          const params: (string | number | null)[] = [];

          const whereClauses: string[] = [];

          if (statusFilter) {
            whereClauses.push('a.status = ?');
            params.push(statusFilter);
          }

          if (gallery) {
            query = `
              SELECT a.*,
                     i.storage_path as primary_image_path,
                     i.mime_type as primary_image_mime_type
              FROM artworks a
              LEFT JOIN images i ON a.primary_image_id = i.id
              JOIN gallery_artworks ga ON a.id = ga.artwork_id
              JOIN galleries g ON ga.gallery_id = g.id
            `;
            whereClauses.push('g.slug = ?');
            params.push(gallery);
          }

          if (whereClauses.length > 0) {
            query += ` WHERE ${whereClauses.join(' AND ')}`;
          }

          query += gallery
            ? ' ORDER BY ga.display_order ASC'
            : ' ORDER BY a.created_at DESC';

          const artworks = db.query(query).all(...params);

          return reply.send({ artworks });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error fetching artworks:', error);
        return reply.status(500).send({ error: 'Failed to fetch artworks' });
      }
    },
  );

  /**
   * GET /admin/artworks/count
   * Admin only: Get count of artworks
   */
  fastify.get(
    '/count',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const db = await openDbConnection();
        try {
          const result = db
            .query('SELECT COUNT(*) as count FROM artworks')
            .get() as { count: number };
          return reply.send({ count: result.count });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error counting artworks:', error);
        return reply.status(500).send({ error: 'Failed to count artworks' });
      }
    },
  );

  /**
   * GET /artworks/:id
   * Public: Get single artwork with images
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const artworkId = Number.parseInt(request.params.id, 10);

        const db = await openDbConnection();
        try {
          const artwork = db
            .query('SELECT * FROM artworks WHERE id = ?')
            .get(artworkId) as Artwork | undefined;

          if (!artwork) {
            return reply.status(404).send({ error: 'Artwork not found' });
          }

          // Get associated images from junction table
          const artworkImages = db
            .query(
              `SELECT i.* FROM images i
               JOIN artwork_images ai ON i.id = ai.image_id
               WHERE ai.artwork_id = ?
               ORDER BY ai.display_order ASC`,
            )
            .all(artworkId);

          // If no images in junction table but primary_image_id is set, include it
          let images = artworkImages;
          if (images.length === 0 && artwork.primary_image_id) {
            const primaryImage = db
              .query('SELECT * FROM images WHERE id = ?')
              .get(artwork.primary_image_id);
            if (primaryImage) {
              images = [primaryImage];
            }
          }

          return reply.send({ artwork, images });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error fetching artwork:', error);
        return reply.status(500).send({ error: 'Failed to fetch artwork' });
      }
    },
  );

  /**
   * POST /admin/artworks
   * Admin: Create artwork
   */
  fastify.post<{ Body: CreateArtworkBody }>(
    '/',
    { onRequest: [requireAdmin] },
    async (
      request: FastifyRequest<{ Body: CreateArtworkBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const {
          title,
          description,
          price_cents,
          currency = 'GBP',
          status = 'draft',
          primary_image_id,
          image_ids = [],
        } = request.body;

        if (!title || price_cents === undefined) {
          return reply
            .status(400)
            .send({ error: 'Title and price are required' });
        }

        const db = await openDbConnection();
        try {
          // Insert artwork
          db.run(
            `INSERT INTO artworks (title, description, price_cents, currency, status, primary_image_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              title,
              description || null,
              price_cents,
              currency,
              status,
              primary_image_id || null,
            ],
          );

          const result = db.query('SELECT last_insert_rowid() as id').get() as {
            id: number;
          };
          const artworkId = Number(result.id);

          // Associate images
          if (image_ids.length > 0) {
            for (let i = 0; i < image_ids.length; i++) {
              db.run(
                'INSERT INTO artwork_images (artwork_id, image_id, display_order) VALUES (?, ?, ?)',
                [artworkId, image_ids[i], i],
              );
            }
          }

          const artwork = db
            .query('SELECT * FROM artworks WHERE id = ?')
            .get(artworkId);

          return reply.send({ artwork });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error creating artwork:', error);
        return reply.status(500).send({ error: 'Failed to create artwork' });
      }
    },
  );

  /**
   * PUT /admin/artworks/:id
   * Admin: Update artwork
   */
  fastify.put<{ Params: { id: string }; Body: UpdateArtworkBody }>(
    '/:id',
    { onRequest: [requireAdmin] },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: UpdateArtworkBody;
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const artworkId = Number.parseInt(request.params.id, 10);
        const updates = request.body;

        const db = await openDbConnection();
        try {
          // Check if artwork exists
          const existing = db
            .query('SELECT * FROM artworks WHERE id = ?')
            .get(artworkId);
          if (!existing) {
            return reply.status(404).send({ error: 'Artwork not found' });
          }

          // Build update query
          const fields: string[] = [];
          const values: (string | number | null)[] = [];

          if (updates.title !== undefined) {
            fields.push('title = ?');
            values.push(updates.title);
          }
          if (updates.description !== undefined) {
            fields.push('description = ?');
            values.push(updates.description);
          }
          if (updates.price_cents !== undefined) {
            fields.push('price_cents = ?');
            values.push(updates.price_cents);
          }
          if (updates.currency !== undefined) {
            fields.push('currency = ?');
            values.push(updates.currency);
          }
          if (updates.status !== undefined) {
            fields.push('status = ?');
            values.push(updates.status);
          }
          if (updates.primary_image_id !== undefined) {
            fields.push('primary_image_id = ?');
            values.push(updates.primary_image_id);
          }

          if (fields.length > 0) {
            fields.push("updated_at = datetime('now')");
            values.push(artworkId);
            db.run(
              `UPDATE artworks SET ${fields.join(', ')} WHERE id = ?`,
              values,
            );
          }

          // Update image associations if provided
          if (updates.image_ids !== undefined) {
            // Remove existing associations
            db.run('DELETE FROM artwork_images WHERE artwork_id = ?', [
              artworkId,
            ]);

            // Add new associations
            for (let i = 0; i < updates.image_ids.length; i++) {
              db.run(
                'INSERT INTO artwork_images (artwork_id, image_id, display_order) VALUES (?, ?, ?)',
                [artworkId, updates.image_ids[i], i],
              );
            }
          }

          const artwork = db
            .query('SELECT * FROM artworks WHERE id = ?')
            .get(artworkId);

          return reply.send({ artwork });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error updating artwork:', error);
        return reply.status(500).send({ error: 'Failed to update artwork' });
      }
    },
  );

  /**
   * PATCH /admin/artworks/:id/status
   * Admin: Quick update artwork status
   */
  fastify.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/:id/status',
    { onRequest: [requireAdmin] },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { status: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const artworkId = Number.parseInt(request.params.id, 10);
        const { status } = request.body;

        if (!status || !['draft', 'available', 'sold'].includes(status)) {
          return reply.status(400).send({ error: 'Invalid status' });
        }

        const db = await openDbConnection();
        try {
          const existing = db
            .query('SELECT * FROM artworks WHERE id = ?')
            .get(artworkId);
          if (!existing) {
            return reply.status(404).send({ error: 'Artwork not found' });
          }

          db.run(
            'UPDATE artworks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [status, artworkId],
          );

          const artwork = db
            .query('SELECT * FROM artworks WHERE id = ?')
            .get(artworkId);

          return reply.send({ artwork });
        } finally {
          db.close();
        }
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * DELETE /admin/artworks/:id
   * Admin: Delete artwork
   */
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [requireAdmin] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const artworkId = Number.parseInt(request.params.id, 10);

        const db = await openDbConnection();
        try {
          const existing = db
            .query('SELECT * FROM artworks WHERE id = ?')
            .get(artworkId);
          if (!existing) {
            return reply.status(404).send({ error: 'Artwork not found' });
          }

          db.run('DELETE FROM artworks WHERE id = ?', [artworkId]);

          return reply.send({ message: 'Artwork deleted successfully' });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error deleting artwork:', error);
        return reply.status(500).send({ error: 'Failed to delete artwork' });
      }
    },
  );
}
