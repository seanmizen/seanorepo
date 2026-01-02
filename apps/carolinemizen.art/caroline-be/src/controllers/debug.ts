import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAdmin } from '../middleware/auth';
import { openDbConnection } from '../services/db';

const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

interface GenerateSampleDataBody {
  artworkCount: number;
  galleryCount: number;
}

const ARTWORK_TITLES = [
  'Sunset Dreams',
  'Ocean Waves',
  'Mountain Peak',
  'Forest Path',
  'City Lights',
  'Desert Bloom',
  'Northern Lights',
  'Autumn Colors',
  'Winter Frost',
  'Spring Awakening',
  'Summer Breeze',
  'Moonlit Night',
  'Starry Sky',
  'Golden Hour',
  'Misty Morning',
  'Twilight Horizon',
  'Rainbow Bridge',
  'Crimson Sunset',
  'Azure Waters',
  'Emerald Forest',
];

const GALLERY_NAMES = [
  'Nature Collection',
  'Urban Landscapes',
  'Abstract Expressions',
  'Seascapes',
  'Mountain Vistas',
  'Seasonal Moods',
  'Color Studies',
  'Light & Shadow',
  'Textures & Patterns',
  'Minimalist Views',
];

const DESCRIPTIONS = [
  'A beautiful exploration of natural beauty and light.',
  'Capturing the essence of the moment.',
  'An intimate study of form and color.',
  'A meditation on space and composition.',
  'Inspired by the changing seasons.',
  'A vibrant celebration of color and texture.',
  'Exploring the interplay of light and shadow.',
  'A peaceful moment frozen in time.',
  'Bold strokes and vivid imagination.',
  'A journey through shape and form.',
];

function randomItem<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function randomPrice(): number {
  const prices = [5000, 7500, 10000, 15000, 20000, 25000, 30000, 50000];
  return randomItem(prices);
}

function randomStatus(): 'draft' | 'available' | 'sold' {
  const statuses: ('draft' | 'available' | 'sold')[] = [
    'draft',
    'available',
    'available',
    'available',
    'sold',
  ];
  return randomItem(statuses);
}

export async function debugRoutes(fastify: FastifyInstance) {
  if (!DEBUG_MODE) {
    fastify.log.info('Debug routes disabled (DEBUG_MODE not set to true)');
    return;
  }

  fastify.log.info('Debug routes enabled');

  /**
   * POST /admin/debug/generate-sample-data
   * Admin: Generate sample artworks and galleries
   */
  fastify.post<{ Body: GenerateSampleDataBody }>(
    '/generate-sample-data',
    { onRequest: [requireAdmin] },
    async (
      request: FastifyRequest<{ Body: GenerateSampleDataBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const { artworkCount, galleryCount } = request.body;

        if (!artworkCount || !galleryCount) {
          return reply
            .status(400)
            .send({ error: 'artworkCount and galleryCount are required' });
        }

        const db = await openDbConnection();
        try {
          // Get all available images
          const images = db.query('SELECT id FROM images').all() as {
            id: number;
          }[];

          if (images.length === 0) {
            return reply.status(400).send({
              error: 'No images found in database. Upload some images first.',
            });
          }

          const artworkIds: number[] = [];

          // Create artworks
          for (let i = 0; i < artworkCount; i++) {
            const title = `${randomItem(ARTWORK_TITLES)} ${i + 1}`;
            const description = randomItem(DESCRIPTIONS);
            const priceCents = randomPrice();
            const status = randomStatus();
            const primaryImageId = randomItem(images).id;

            db.run(
              `INSERT INTO artworks (title, description, price_cents, currency, status, primary_image_id)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [title, description, priceCents, 'GBP', status, primaryImageId],
            );

            const result = db
              .query('SELECT last_insert_rowid() as id')
              .get() as {
              id: number;
            };
            artworkIds.push(Number(result.id));
          }

          const galleryIds: number[] = [];

          // Create galleries
          for (let i = 0; i < galleryCount; i++) {
            const name = `${randomItem(GALLERY_NAMES)} ${i + 1}`;
            const slug = name.toLowerCase().replace(/\s+/g, '-');
            const description = randomItem(DESCRIPTIONS);
            const coverImageId = randomItem(images).id;

            // Get max display order
            const maxOrderResult = db
              .query(
                'SELECT COALESCE(MAX(display_order), -1) as max_order FROM galleries',
              )
              .get() as { max_order: number };
            const displayOrder = maxOrderResult.max_order + 1;

            db.run(
              `INSERT INTO galleries (name, slug, description, cover_image_id, display_order, is_featured)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [name, slug, description, coverImageId, displayOrder, i === 0],
            );

            const result = db
              .query('SELECT last_insert_rowid() as id')
              .get() as {
              id: number;
            };
            galleryIds.push(Number(result.id));
          }

          // Associate artworks with galleries randomly
          for (const artworkId of artworkIds) {
            // Each artwork goes in 1-3 random galleries
            const numGalleries = Math.floor(Math.random() * 3) + 1;
            const selectedGalleries = [...galleryIds]
              .sort(() => Math.random() - 0.5)
              .slice(0, numGalleries);

            for (const galleryId of selectedGalleries) {
              // Get max display order for this gallery
              const maxOrderResult = db
                .query(
                  'SELECT COALESCE(MAX(display_order), -1) as max_order FROM gallery_artworks WHERE gallery_id = ?',
                )
                .get(galleryId) as { max_order: number };
              const displayOrder = maxOrderResult.max_order + 1;

              db.run(
                'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
                [galleryId, artworkId, displayOrder],
              );
            }
          }

          return reply.send({
            artworksCreated: artworkCount,
            galleriesCreated: galleryCount,
            message: 'Sample data generated successfully',
          });
        } finally {
          db.close();
        }
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
}
