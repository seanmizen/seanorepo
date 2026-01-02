import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export async function configRoutes(fastify: FastifyInstance) {
  /**
   * GET /config
   * Returns app configuration and metadata
   */
  fastify.get(
    '/config',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({
        site: {
          name: process.env.SITE_NAME || 'Caroline Mizen Art',
          adminTitle: process.env.ADMIN_TITLE || 'Caroline Mizen Admin',
        },
        dashboard: {
          welcome: {
            title:
              process.env.DASHBOARD_WELCOME_TITLE ||
              'Welcome to Your Admin Panel',
            text:
              process.env.DASHBOARD_WELCOME_TEXT ||
              'Manage your artwork, galleries, and site content from this central hub.',
          },
          cards: {
            artworks: {
              title: 'Artworks',
              description:
                process.env.DASHBOARD_CARD_ARTWORKS ||
                'Manage your artwork collection, upload images, set prices, and control availability.',
            },
            galleries: {
              title: 'Galleries',
              description:
                process.env.DASHBOARD_CARD_GALLERIES ||
                'Create and organize galleries, group artworks into collections, and feature them on your homepage.',
            },
            images: {
              title: 'Images',
              description:
                process.env.DASHBOARD_CARD_IMAGES ||
                'Upload and manage all images used throughout the site for artworks and galleries.',
            },
            content: {
              title: 'Site Content',
              description:
                process.env.DASHBOARD_CARD_CONTENT ||
                'Edit site-wide content including hero text, about page, and other page content.',
            },
            orders: {
              title: 'Orders',
              description:
                process.env.DASHBOARD_CARD_ORDERS ||
                'View and manage orders, update shipping status, and track sales.',
            },
          },
        },
        uploads: {
          maxFileSizeMB: Number(process.env.UPLOAD_MAX_FILE_SIZE_MB || '100'),
          maxFiles: Number(process.env.UPLOAD_MAX_FILES || '30'),
        },
      });
    },
  );
}
