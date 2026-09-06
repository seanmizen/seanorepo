import type { FastifyInstance } from 'fastify';
import { getAuthUser, requireAuth } from '../middleware/auth';
import {
  addImage,
  deleteImage,
  findOwnedImage,
  listImages,
  QuotaExceededError,
} from '../services/image-library';
import { identifyImage, UnsupportedImageError } from '../services/images';
import { optionalString, ValidationError } from '../services/validation';

const UPLOAD_MAX_FILE_SIZE_MB = Number(
  process.env.UPLOAD_MAX_FILE_SIZE_MB ?? 50,
);

export async function imageRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * The signed-in user's own image library.
   *
   * Buyers upload too (a brief can carry reference shots), so this needs a
   * session rather than the designer role.
   */
  fastify.register(
    async (me) => {
      me.addHook('onRequest', requireAuth);

      me.post('/images', async (request, reply) => {
        const userId = getAuthUser(request)?.id as number;

        let uploaded: Awaited<ReturnType<typeof request.file>>;
        try {
          uploaded = await request.file();
        } catch {
          // @fastify/multipart throws when the declared size limit is passed.
          return reply.status(413).send({
            error: `Files must be ${UPLOAD_MAX_FILE_SIZE_MB}MB or smaller`,
          });
        }

        if (!uploaded) {
          return reply.status(400).send({ error: 'No file was uploaded' });
        }

        const buffer = await uploaded.toBuffer();

        // toBuffer() resolves even when the stream was truncated at the limit,
        // so the flag has to be checked explicitly or an oversized upload is
        // silently stored half-complete.
        if (uploaded.file.truncated) {
          return reply.status(413).send({
            error: `Files must be ${UPLOAD_MAX_FILE_SIZE_MB}MB or smaller`,
          });
        }

        try {
          // Decides the type by decoding, not by trusting the declared mime
          // type or the extension.
          const identified = await identifyImage(buffer);
          const alt = optionalString(
            uploaded.fields?.alt && 'value' in uploaded.fields.alt
              ? (uploaded.fields.alt as { value: unknown }).value
              : undefined,
            'Alt text',
            300,
          );

          const image = await addImage(
            userId,
            buffer,
            uploaded.filename ?? 'upload',
            identified.mimeType,
            alt,
          );
          return reply.status(201).send({ image });
        } catch (error) {
          if (error instanceof UnsupportedImageError) {
            return reply.status(415).send({ error: error.message });
          }
          if (error instanceof QuotaExceededError) {
            return reply.status(409).send({ error: error.message });
          }
          if (error instanceof ValidationError) {
            return reply.status(400).send({ error: error.message });
          }
          throw error;
        }
      });

      me.get('/images', async (request) => {
        const query = request.query as { limit?: string; page?: string };
        const limit = Math.min(Math.max(Number(query.limit) || 24, 1), 100);
        const page = Math.max(Number(query.page) || 1, 1);

        const { images, total } = await listImages(
          getAuthUser(request)?.id as number,
          { limit, offset: (page - 1) * limit },
        );
        return { images, total, page, limit };
      });

      me.delete('/images/:id', async (request, reply) => {
        const id = Number((request.params as { id: string }).id);
        const owned = await findOwnedImage(
          id,
          getAuthUser(request)?.id as number,
        );
        // 404 for both missing and someone else's, so ids are not probeable.
        if (!owned) return reply.status(404).send({ error: 'Not found' });

        await deleteImage(id);
        return reply.status(204).send();
      });
    },
    { prefix: '/me' },
  );
}
