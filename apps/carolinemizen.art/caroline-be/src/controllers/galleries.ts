import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAdmin } from '../middleware/auth';
import { openDbConnection } from '../services/db';

interface Gallery {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  cover_image_id: number | null;
  is_featured: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

interface CreateGalleryBody {
  name: string;
  slug: string;
  description?: string;
  cover_image_id?: number;
  is_featured?: boolean;
  display_order?: number;
  artwork_ids?: number[];
}

interface UpdateGalleryBody {
  name?: string;
  slug?: string;
  description?: string;
  cover_image_id?: number;
  is_featured?: boolean;
  display_order?: number;
}

export async function galleryRoutes(fastify: FastifyInstance) {
  /**
   * GET /galleries
   * Public: List all galleries
   */
  fastify.get(
    '/',
    async (
      request: FastifyRequest<{ Querystring: { featured?: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { featured } = request.query;

        const db = await openDbConnection();
        try {
          let query = `
            SELECT g.*,
                   i.storage_path as cover_image_path,
                   i.mime_type as cover_image_mime_type
            FROM galleries g
            LEFT JOIN images i ON g.cover_image_id = i.id
          `;
          const params: (string | number | null)[] = [];

          if (featured === 'true') {
            query += ' WHERE g.is_featured = 1';
          }

          query += ' ORDER BY g.display_order ASC, g.created_at DESC';

          const galleries = db.query(query).all(...params);

          return reply.send({ galleries });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error fetching galleries:', error);
        return reply.status(500).send({ error: 'Failed to fetch galleries' });
      }
    },
  );

  /**
   * GET /admin/galleries/count
   * Admin only: Get count of galleries
   */
  fastify.get(
    '/count',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const db = await openDbConnection();
        try {
          const result = db
            .query('SELECT COUNT(*) as count FROM galleries')
            .get() as { count: number };
          return reply.send({ count: result.count });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error counting galleries:', error);
        return reply.status(500).send({ error: 'Failed to count galleries' });
      }
    },
  );

  /**
   * GET /galleries/:slugOrId or GET /admin/galleries/:slugOrId
   * Public: Get gallery by slug
   * Admin: Get gallery by slug or ID
   */
  fastify.get<{ Params: { slug: string } }>(
    '/:slug',
    async (
      request: FastifyRequest<{ Params: { slug: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const { slug } = request.params;

        const db = await openDbConnection();
        try {
          // Detect if parameter is numeric ID or string slug
          const isNumericId = /^\d+$/.test(slug);
          const gallery = isNumericId
            ? (db
                .query('SELECT * FROM galleries WHERE id = ?')
                .get(Number.parseInt(slug, 10)) as Gallery | undefined)
            : (db.query('SELECT * FROM galleries WHERE slug = ?').get(slug) as
                | Gallery
                | undefined);
          console.log('isNumericId', isNumericId, slug);
          console.log('isNumericId', gallery);
          if (!gallery) {
            return reply.status(404).send({ error: 'Gallery not found' });
          }

          // Get artworks in gallery with image data
          const artworks = db
            .query(
              `SELECT a.*,
                      i.storage_path as primary_image_path,
                      i.mime_type as primary_image_mime_type
               FROM artworks a
               JOIN gallery_artworks ga ON a.id = ga.artwork_id
               LEFT JOIN images i ON a.primary_image_id = i.id
               WHERE ga.gallery_id = ?
               ORDER BY ga.display_order ASC`,
            )
            .all(gallery.id);

          console.log(artworks.length);
          return reply.send({ gallery, artworks });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error fetching gallery:', error);
        return reply.status(500).send({ error: 'Failed to fetch gallery' });
      }
    },
  );

  /**
   * POST /admin/galleries
   * Admin: Create gallery
   */
  fastify.post<{ Body: CreateGalleryBody }>(
    '/',
    { onRequest: [requireAdmin] },
    async (
      request: FastifyRequest<{ Body: CreateGalleryBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const {
          name,
          slug: providedSlug,
          description,
          cover_image_id,
          artwork_ids = [],
        } = request.body;

        if (!name) {
          return reply.status(400).send({ error: 'Name is required' });
        }

        // Auto-generate slug from name if not provided
        const generateSlug = (name: string): string => {
          return name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        };

        const slug = providedSlug || generateSlug(name);

        const db = await openDbConnection();
        try {
          // Check if slug already exists, if so append a number
          let finalSlug = slug;
          let counter = 1;
          while (
            db.query('SELECT id FROM galleries WHERE slug = ?').get(finalSlug)
          ) {
            finalSlug = `${slug}-${counter}`;
            counter++;
          }

          // Increment all existing galleries' display_order by 1 to make room at the top
          db.run('UPDATE galleries SET display_order = display_order + 1');

          // Insert new gallery at position 0 (top of the list)
          db.run(
            `INSERT INTO galleries (name, slug, description, cover_image_id, is_featured, display_order)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              name,
              finalSlug,
              description || null,
              cover_image_id || null,
              0, // is_featured defaults to false
              0, // New galleries always go to the top
            ],
          );

          const result = db.query('SELECT last_insert_rowid() as id').get() as {
            id: number;
          };
          const galleryId = Number(result.id);

          // Associate artworks
          // if (artwork_ids.length > 0) {
          for (let i = 0; i < artwork_ids.length; i++) {
            db.run(
              'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
              [galleryId, artwork_ids[i], i],
            );
          }
          // }

          const gallery = db
            .query('SELECT * FROM galleries WHERE id = ?')
            .get(galleryId);

          return reply.send({ gallery });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error creating gallery:', error);
        return reply.status(500).send({ error: 'Failed to create gallery' });
      }
    },
  );

  /**
   * PUT /admin/galleries/:id
   * Admin: Update gallery
   */
  fastify.put<{ Params: { id: string }; Body: UpdateGalleryBody }>(
    '/:id',
    { onRequest: [requireAdmin] },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: UpdateGalleryBody;
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const galleryId = Number.parseInt(request.params.id, 10);
        const updates = request.body;

        const db = await openDbConnection();
        try {
          const existing = db
            .query('SELECT * FROM galleries WHERE id = ?')
            .get(galleryId);
          if (!existing) {
            return reply.status(404).send({ error: 'Gallery not found' });
          }

          const fields: string[] = [];
          const values: (string | number | null)[] = [];

          if (updates.name !== undefined) {
            fields.push('name = ?');
            values.push(updates.name);
          }
          if (updates.slug !== undefined) {
            fields.push('slug = ?');
            values.push(updates.slug);
          }
          if (updates.description !== undefined) {
            fields.push('description = ?');
            values.push(updates.description);
          }
          if (updates.cover_image_id !== undefined) {
            fields.push('cover_image_id = ?');
            values.push(updates.cover_image_id);
          }
          // Note: is_featured and display_order are not updatable via this endpoint
          // Use the reorder endpoint to change display_order

          if (fields.length > 0) {
            fields.push("updated_at = datetime('now')");
            values.push(galleryId);
            db.run(
              `UPDATE galleries SET ${fields.join(', ')} WHERE id = ?`,
              values,
            );
          }

          const gallery = db
            .query('SELECT * FROM galleries WHERE id = ?')
            .get(galleryId);

          return reply.send({ gallery });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error updating gallery:', error);
        return reply.status(500).send({ error: 'Failed to update gallery' });
      }
    },
  );

  /**
   * PUT /admin/galleries/:id/artworks
   * Admin: Set gallery artworks (reorder)
   */
  fastify.put<{ Params: { id: string }; Body: { artwork_ids: number[] } }>(
    '/:id/artworks',
    { onRequest: [requireAdmin] },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { artwork_ids: number[] };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const galleryId = Number.parseInt(request.params.id, 10);
        const { artwork_ids } = request.body;

        const db = await openDbConnection();
        try {
          const existing = db
            .query('SELECT * FROM galleries WHERE id = ?')
            .get(galleryId);
          if (!existing) {
            return reply.status(404).send({ error: 'Gallery not found' });
          }

          // Remove existing associations
          db.run('DELETE FROM gallery_artworks WHERE gallery_id = ?', [
            galleryId,
          ]);

          // Add new associations with order
          for (let i = 0; i < artwork_ids.length; i++) {
            db.run(
              'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
              [galleryId, artwork_ids[i], i],
            );
          }

          // Get updated gallery with artworks
          const gallery = db
            .query('SELECT * FROM galleries WHERE id = ?')
            .get(galleryId);
          const artworks = db
            .query(
              `SELECT a.*,
                      i.storage_path as primary_image_path,
                      i.mime_type as primary_image_mime_type
               FROM artworks a
               JOIN gallery_artworks ga ON a.id = ga.artwork_id
               LEFT JOIN images i ON a.primary_image_id = i.id
               WHERE ga.gallery_id = ?
               ORDER BY ga.display_order ASC`,
            )
            .all(galleryId);

          return reply.send({ gallery, artworks });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error updating gallery artworks:', error);
        return reply
          .status(500)
          .send({ error: 'Failed to update gallery artworks' });
      }
    },
  );

  /**
   * POST /admin/galleries/:id/move-up
   * Admin: Move gallery up in display order (swap with previous)
   */
  fastify.post<{ Params: { id: string } }>(
    '/:id/move-up',
    { onRequest: [requireAdmin] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const galleryId = Number.parseInt(request.params.id, 10);
        const db = await openDbConnection();

        try {
          const gallery = db
            .query('SELECT * FROM galleries WHERE id = ?')
            .get(galleryId) as Gallery | undefined;

          if (!gallery) {
            return reply.status(404).send({ error: 'Gallery not found' });
          }

          if (gallery.display_order === 0) {
            return reply
              .status(400)
              .send({ error: 'Gallery is already at the top' });
          }

          // Find the gallery to swap with (the one above)
          const swapGallery = db
            .query('SELECT * FROM galleries WHERE display_order = ?')
            .get(gallery.display_order - 1) as Gallery | undefined;

          if (!swapGallery) {
            return reply.status(400).send({ error: 'No gallery to swap with' });
          }

          // Swap display_order values
          db.run('UPDATE galleries SET display_order = ? WHERE id = ?', [
            swapGallery.display_order,
            gallery.id,
          ]);
          db.run('UPDATE galleries SET display_order = ? WHERE id = ?', [
            gallery.display_order,
            swapGallery.id,
          ]);

          return reply.send({ success: true });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error moving gallery up:', error);
        return reply.status(500).send({ error: 'Failed to move gallery' });
      }
    },
  );

  /**
   * POST /admin/galleries/:id/move-down
   * Admin: Move gallery down in display order (swap with next)
   */
  fastify.post<{ Params: { id: string } }>(
    '/:id/move-down',
    { onRequest: [requireAdmin] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const galleryId = Number.parseInt(request.params.id, 10);
        const db = await openDbConnection();

        try {
          const gallery = db
            .query('SELECT * FROM galleries WHERE id = ?')
            .get(galleryId) as Gallery | undefined;

          if (!gallery) {
            return reply.status(404).send({ error: 'Gallery not found' });
          }

          // Find the gallery to swap with (the one below)
          const swapGallery = db
            .query('SELECT * FROM galleries WHERE display_order = ?')
            .get(gallery.display_order + 1) as Gallery | undefined;

          if (!swapGallery) {
            return reply
              .status(400)
              .send({ error: 'Gallery is already at the bottom' });
          }

          // Swap display_order values
          db.run('UPDATE galleries SET display_order = ? WHERE id = ?', [
            swapGallery.display_order,
            gallery.id,
          ]);
          db.run('UPDATE galleries SET display_order = ? WHERE id = ?', [
            gallery.display_order,
            swapGallery.id,
          ]);

          return reply.send({ success: true });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error moving gallery down:', error);
        return reply.status(500).send({ error: 'Failed to move gallery' });
      }
    },
  );

  /**
   * DELETE /admin/galleries/:id
   * Admin: Delete gallery
   */
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [requireAdmin] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const galleryId = Number.parseInt(request.params.id, 10);

        const db = await openDbConnection();
        try {
          const existing = db
            .query('SELECT * FROM galleries WHERE id = ?')
            .get(galleryId);
          if (!existing) {
            return reply.status(404).send({ error: 'Gallery not found' });
          }

          db.run('DELETE FROM galleries WHERE id = ?', [galleryId]);

          return reply.send({ message: 'Gallery deleted successfully' });
        } finally {
          db.close();
        }
      } catch (error) {
        console.error('Error deleting gallery:', error);
        return reply.status(500).send({ error: 'Failed to delete gallery' });
      }
    },
  );
}
