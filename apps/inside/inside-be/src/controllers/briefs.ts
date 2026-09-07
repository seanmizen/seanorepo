import { briefFilters } from '@shared/filters';
import type { BriefVisibility } from '@shared/types';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getAuthUser, optionalAuth, requireRole } from '../middleware/auth';
import { findUserByEmail } from '../services/auth';
import * as briefs from '../services/briefs';
import { parseQuery } from '../services/query';
import {
  BUDGET_BANDS,
  optionalDateTime,
  optionalEnum,
  optionalString,
  requiredString,
  TIMELINES,
  ValidationError,
  WORK_TYPES,
} from '../services/validation';
import { withValidation } from './helpers';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

const readBriefFields = (body: unknown): briefs.BriefFields => {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    title: requiredString(b.title, 'Title', 160),
    description: requiredString(b.description, 'Description', 6000),
    workType: optionalEnum(b.workType, 'PortfolioProject type', WORK_TYPES),
    budgetBand: optionalEnum(b.budgetBand, 'Budget band', BUDGET_BANDS),
    location: optionalString(b.location, 'Location', 120),
    timeline: optionalEnum(b.timeline, 'Timeline', TIMELINES),
    closesAt: optionalDateTime(b.closesAt, 'Closing date'),
  };
};

const briefId = (request: FastifyRequest): number =>
  Number((request.params as { id: string }).id);

export async function briefRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * The public board. Anonymous by design — a homeowner's job is meant to be
   * found — and `PublicBrief` carries no `buyerId`, so no listing ever hands a
   * stranger a route back to the person who posted it.
   */
  fastify.get('/briefs', async (request, reply) => {
    const filters = await parseQuery(briefFilters, reply, request.query);
    if (!filters) return reply;

    // Page-based, like every other list. This endpoint used to take `offset`
    // while discovery took `page`, which meant the public API answered the
    // same question two different ways.
    const offset = (filters.page - 1) * filters.limit;
    const { briefs: found, total } = await briefs.listOpenBriefs({
      workTypes: filters.workTypes ?? null,
      budgetBands: filters.budgetBands ?? null,
      location: filters.location ?? null,
      limit: filters.limit,
      offset,
    });

    return {
      briefs: found,
      total,
      page: filters.page,
      limit: filters.limit,
      hasMore: offset + found.length < total,
    };
  });

  /**
   * Public detail, addressed by slug — any slug the brief has ever held.
   *
   * Visibility is decided by `findVisibleBrief`, which is the single place the
   * rules live (REQ-BRIEF-001). `optionalAuth` rather than a guard, because
   * who is asking changes the answer: an invitee sees a private brief, an
   * anonymous visitor sees only a published public or link one.
   *
   * A brief the viewer may not see is 404, indistinguishable from one that
   * does not exist — a different response would confirm it is there.
   */
  fastify.get(
    '/briefs/:slug',
    { onRequest: optionalAuth },
    async (request, reply) => {
      const slug = (request.params as { slug: string }).slug;
      const found = await briefs.findVisibleBrief(
        slug,
        getAuthUser(request)?.id ?? null,
      );
      if (!found) return reply.status(404).send({ error: 'Brief not found' });
      return { brief: found.brief, isOwner: found.isOwner };
    },
  );

  /**
   * A buyer's own briefs.
   *
   * An encapsulated scope with the role guard as an onRequest hook, so every
   * route below is protected by construction. Designers are refused here with
   * a 403: posting a job is the buyer's side of the marketplace.
   *
   * Ownership always comes from the session, never from a path or body, so one
   * buyer cannot address another's brief at all.
   */
  fastify.register(
    async (me) => {
      me.addHook('onRequest', requireRole('buyer'));

      /** Resolves a brief only if the caller posted it. */
      const owned = async (request: FastifyRequest) => {
        const brief = await briefs.findOwnedBrief(briefId(request));
        // The same 404 for "missing" and "someone else's", so ids are not
        // probeable — a 403 would confirm the brief exists.
        return brief && brief.buyerId === getAuthUser(request)?.id
          ? brief
          : null;
      };

      me.get('/briefs', async (request) => ({
        briefs: await briefs.listBriefsByBuyer(
          getAuthUser(request)?.id as number,
        ),
      }));

      me.post('/briefs', async (request, reply) =>
        withValidation(reply, async () => {
          const body = (request.body ?? {}) as Record<string, unknown>;
          // Private unless asked otherwise, so a brief is never public by
          // omission. Publishing is a separate flag because visibility and
          // publication are orthogonal (REQ-BRIEF-003).
          const visibility = (optionalEnum(body.visibility, 'Visibility', [
            'public',
            'link',
            'private',
          ]) ?? 'private') as BriefVisibility;
          const brief = await briefs.insertBrief(
            getAuthUser(request)?.id as number,
            readBriefFields(body),
            visibility,
            { publish: body.publish === true },
          );
          return reply.status(201).send({ brief });
        }),
      );

      me.get('/briefs/:id', async (request, reply) => {
        const brief = await owned(request);
        if (!brief) return reply.status(404).send({ error: 'Not found' });
        return { brief };
      });

      me.put('/briefs/:id', async (request, reply) =>
        withValidation(reply, async () => {
          const brief = await owned(request);
          if (!brief) return reply.status(404).send({ error: 'Not found' });
          return {
            brief: await briefs.updateBrief(
              brief.id,
              readBriefFields(request.body),
            ),
          };
        }),
      );

      me.delete('/briefs/:id', async (request, reply) => {
        const brief = await owned(request);
        if (!brief) return reply.status(404).send({ error: 'Not found' });
        await briefs.deleteBrief(brief.id);
        return reply.status(204).send();
      });

      /**
       * Publish and unpublish, freely and repeatedly.
       *
       * Unpublishing hides the brief from everyone but its owner and KEEPS the
       * invitee list, so republishing restores access to the same people
       * without re-inviting anyone (REQ-BRIEF-003). Idempotent on purpose:
       * publishing an already-published brief is not an error, it is a no-op,
       * and a 409 here would only make a retry look like a failure.
       */
      me.post('/briefs/:id/publish', async (request, reply) => {
        const brief = await owned(request);
        if (!brief) return reply.status(404).send({ error: 'Not found' });
        return { brief: await briefs.setBriefPublished(brief.id, true) };
      });

      me.post('/briefs/:id/unpublish', async (request, reply) => {
        const brief = await owned(request);
        if (!brief) return reply.status(404).send({ error: 'Not found' });
        return { brief: await briefs.setBriefPublished(brief.id, false) };
      });

      /** Who may ever see it. Orthogonal to whether it is published now. */
      me.put('/briefs/:id/visibility', async (request, reply) =>
        withValidation(reply, async () => {
          const brief = await owned(request);
          if (!brief) return reply.status(404).send({ error: 'Not found' });
          const body = (request.body ?? {}) as Record<string, unknown>;
          const visibility = optionalEnum(body.visibility, 'Visibility', [
            'public',
            'link',
            'private',
          ]);
          if (!visibility) {
            throw new ValidationError(
              'Visibility must be one of public, link, private',
            );
          }
          return {
            brief: await briefs.setBriefVisibility(
              brief.id,
              visibility as BriefVisibility,
            ),
          };
        }),
      );

      /**
       * Stop taking bids. The brief stays visible and the bids already
       * received stay exactly where they are — closing withdraws the
       * invitation to bid, not the responses, and not the listing.
       */
      me.post('/briefs/:id/close', async (request, reply) => {
        const brief = await owned(request);
        if (!brief) return reply.status(404).send({ error: 'Not found' });
        return { brief: await briefs.closeBriefToBids(brief.id) };
      });

      /* Invitees — who may see a private brief. Users, not designers. */

      me.get('/briefs/:id/invitees', async (request, reply) => {
        const brief = await owned(request);
        if (!brief) return reply.status(404).send({ error: 'Not found' });
        return { invitees: await briefs.listInvitees(brief.id) };
      });

      me.post('/briefs/:id/invitees', async (request, reply) =>
        withValidation(reply, async () => {
          const brief = await owned(request);
          if (!brief) return reply.status(404).send({ error: 'Not found' });
          const body = (request.body ?? {}) as Record<string, unknown>;
          const email = requiredString(body.email, 'Email');

          const invitee = await findUserByEmail(email);
          // Deliberately explicit rather than silently dropping it: a buyer
          // who thinks they have shared a brief and has not is worse off than
          // one told the person has no account yet.
          if (!invitee) {
            return reply
              .status(404)
              .send({ error: 'Nobody with that email has an account yet' });
          }

          await briefs.inviteToBrief(brief.id, invitee.id);
          return reply
            .status(201)
            .send({ invitees: await briefs.listInvitees(brief.id) });
        }),
      );

      me.delete('/briefs/:id/invitees/:userId', async (request, reply) => {
        const brief = await owned(request);
        if (!brief) return reply.status(404).send({ error: 'Not found' });
        const userId = Number((request.params as { userId: string }).userId);
        await briefs.uninviteFromBrief(brief.id, userId);
        return { invitees: await briefs.listInvitees(brief.id) };
      });

      /**
       * The responses to one brief, for the person who posted it.
       *
       * This is the only route that returns somebody else's bid, and it is
       * reachable only by the brief's owner. A designer sees their own bids
       * through `GET /api/me/bids` and nobody else's, ever.
       */
      me.get('/briefs/:id/bids', async (request, reply) => {
        const brief = await owned(request);
        if (!brief) return reply.status(404).send({ error: 'Not found' });
        return { bids: await briefs.listBidsForBrief(brief.id) };
      });
    },
    { prefix: '/me' },
  );
}
