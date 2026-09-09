import type { SavedDesignerListResponse } from '@shared/types';
import type { FastifyInstance } from 'fastify';
import { getAuthUser, requireAuth } from '../middleware/auth';
import * as savedDesigners from '../services/saved-designers';

const DEFAULT_LIMIT = 24;

/** `?page=` as a whole number >= 1. Anything else falls back to page 1. */
function readPage(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** `:id` as a positive integer, or null. */
function readId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The buyer's shortlist. REQ-PRODUCT-003 — this is the account a signed-out
 * visitor is asked to create.
 *
 * Encapsulated scope with `requireAuth` as the `onRequest` hook, so every
 * route here is protected by construction. Ownership is always the session's
 * own user id (`getAuthUser`) and never a request parameter, which is what
 * makes it structurally impossible for a save to land on someone else's
 * shortlist — see the note in `services/saved-designers.ts`.
 */
export async function savedDesignerRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.register(
    async (me) => {
      me.addHook('onRequest', requireAuth);

      me.get('/saved-designers', async (request) => {
        const query = request.query as { page?: string };
        const page = readPage(query.page);
        const limit = DEFAULT_LIMIT;
        const userId = getAuthUser(request)?.id as number;

        const { items, total } = await savedDesigners.listSavedDesigners(
          userId,
          { limit, offset: (page - 1) * limit },
        );

        const body: SavedDesignerListResponse = {
          savedDesigners: items,
          total,
          page,
          limit,
          hasMore: page * limit < total,
        };
        return body;
      });

      /** Whether ONE designer is on the caller's shortlist. */
      me.get('/saved-designers/:id', async (request, reply) => {
        const id = readId((request.params as { id: string }).id);
        if (id === null) {
          return reply.status(400).send({ error: 'Invalid designer id' });
        }
        const userId = getAuthUser(request)?.id as number;
        return { saved: await savedDesigners.isSaved(userId, id) };
      });

      me.post('/saved-designers/:id', async (request, reply) => {
        const id = readId((request.params as { id: string }).id);
        if (id === null) {
          return reply.status(400).send({ error: 'Invalid designer id' });
        }

        // Same 404 an unapproved slug gets on the public routes — an id that
        // exists but is not approved must not be distinguishable from one
        // that does not exist at all.
        const approvedId = await savedDesigners.findApprovedProfileId(id);
        if (approvedId === null) {
          return reply.status(404).send({ error: 'Designer not found' });
        }

        const userId = getAuthUser(request)?.id as number;
        await savedDesigners.saveDesigner(userId, approvedId);
        return reply.status(200).send({ saved: true });
      });

      me.delete('/saved-designers/:id', async (request, reply) => {
        const id = readId((request.params as { id: string }).id);
        if (id === null) {
          return reply.status(400).send({ error: 'Invalid designer id' });
        }
        const userId = getAuthUser(request)?.id as number;
        // Idempotent: removing something already absent is still success, so
        // there is no existence check to fail here.
        await savedDesigners.unsaveDesigner(userId, id);
        return reply.status(200).send({ saved: false });
      });
    },
    { prefix: '/me' },
  );
}
