import { adminDesignerFilters } from '@shared/filters';
import type { DesignerProfileStatus } from '@shared/types';
import type { FastifyInstance } from 'fastify';
import { getAuthUser } from '../middleware/auth';
import {
  decideProfile,
  findProfileForReview,
  listReviewQueue,
  type ReviewDecision,
} from '../services/admin-designers';
import { sendReviewDecisionEmail } from '../services/email';
import { parseQuery } from '../services/query';
import { optionalString, ValidationError } from '../services/validation';

const STATUSES: DesignerProfileStatus[] = [
  'draft',
  'pending',
  'approved',
  'rejected',
];

/**
 * Registered INSIDE the admin scope in controllers/index.ts, which attaches
 * `requireAdmin` as an onRequest hook — so every route here is protected by
 * construction rather than by remembering a decorator.
 */
export async function adminDesignerRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.get('/designers', async (request, reply) => {
    // Same shared contract as every other list. This endpoint used to clamp
    // with Math.min/Math.max, so `?limit=abc` silently became 25 and the
    // caller had no way to know their request had been ignored.
    const filters = await parseQuery(
      adminDesignerFilters,
      reply,
      request.query,
    );
    if (!filters) return reply;

    const offset = (filters.page - 1) * filters.limit;
    const { designers, total } = await listReviewQueue({
      statuses: filters.statuses ?? null,
      limit: filters.limit,
      offset,
    });

    return { designers, total, page: filters.page, limit: filters.limit };
  });

  fastify.get('/designers/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const found = await findProfileForReview(id);
    if (!found) return reply.status(404).send({ error: 'Not found' });
    return {
      profile: found.profile,
      portfolio_projects: found.portfolio_projects,
    };
  });

  for (const decision of ['approve', 'reject'] as ReviewDecision[]) {
    fastify.post(`/designers/:id/${decision}`, async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      const admin = getAuthUser(request);

      const found = await findProfileForReview(id);
      if (!found) return reply.status(404).send({ error: 'Not found' });

      let note: string | null;
      try {
        note = optionalString(
          (request.body as { note?: unknown } | undefined)?.note,
          'Review note',
          1000,
        );
      } catch (error) {
        if (error instanceof ValidationError) {
          return reply.status(400).send({ error: error.message });
        }
        throw error;
      }

      // A rejection the designer cannot act on is not a decision, it is a
      // dead end — so the reason is required when rejecting.
      if (decision === 'reject' && !note) {
        return reply
          .status(400)
          .send({ error: 'A reason is required when rejecting a profile' });
      }

      const profile = await decideProfile(
        id,
        decision,
        admin?.id as number,
        note,
      );
      if (!profile) return reply.status(404).send({ error: 'Not found' });

      // The decision is already committed. Email is a notification, not part
      // of the transaction: if SMTP is down the reviewer's decision must still
      // stand, so a send failure is logged and swallowed rather than 500ing
      // and inviting them to click approve a second time.
      try {
        await sendReviewDecisionEmail(found.email, {
          decision,
          studioName: profile.studioName,
          slug: profile.slug,
          note,
        });
      } catch (error) {
        fastify.log.error(
          { error, profileId: id },
          'Review decision saved but the notification email failed to send',
        );
      }

      return { profile };
    });
  }
}
