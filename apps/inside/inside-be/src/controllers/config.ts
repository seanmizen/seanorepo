import type { AppConfig } from '@shared/types';
import type { FastifyInstance } from 'fastify';
import { isDevMode } from '../services/dev-mode';

/**
 * Server-driven copy and limits, fetched once at boot. Keeps the upload limits
 * the frontend enforces in step with the ones the backend actually applies.
 */
export async function configRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/config', async (): Promise<AppConfig> => {
    return {
      // Drives the "dev" status chip. Cosmetic: no sign-in link exists to
      // render unless the server itself sent one.
      devMode: isDevMode(process.env.NODE_ENV),
      siteName: process.env.SITE_NAME ?? 'inside.space',
      tagline: process.env.TAGLINE ?? 'Find the designer for your space',
      uploadMaxFileSizeMb: Number(process.env.UPLOAD_MAX_FILE_SIZE_MB ?? 50),
      uploadMaxFiles: Number(process.env.UPLOAD_MAX_FILES ?? 30),
    };
  });
}
