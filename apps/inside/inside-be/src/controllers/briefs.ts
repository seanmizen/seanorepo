import type { BriefStatus } from '@shared/types';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getAuthUser, requireRole } from '../middleware/auth';
import * as briefs from '../services/briefs';
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

/** A whole number in range, or a 400 — a bad filter is never silently ignored. */
const readBounded = (
  value: unknown,
  field: string,
  fallback: number,
  { min, max }: { min: number; max: number },
): number => {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ValidationError(
      `${field} must be a whole number between ${min} and ${max}`,
    );
  }
  return parsed;
};

const readListQuery = (query: unknown): briefs.BriefFilters => {
  const q = (query ?? {}) as Record<string, unknown>;
  return {
    workType: optionalEnum(q.workType, 'PortfolioProject type', WORK_TYPES),
    budgetBand: optionalEnum(q.budgetBand, 'Budget band', BUDGET_BANDS),
    location: optionalString(q.location, 'Location', 120),
    limit: readBounded(q.limit, 'Limit', DEFAULT_LIMIT, {
      min: 1,
      max: MAX_LIMIT,
    }),
    offset: readBounded(q.offset, 'Offset', 0, { min: 0, max: 1_000_000 }),
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
  fastify.get('/briefs', async (request, reply) =>
    withValidation(reply, async () => {
      const filters = readListQuery(request.query);
      const { briefs: found, total } = await briefs.listOpenBriefs(filters);
      return {
        briefs: found,
        total,
        limit: filters.limit,
        offset: filters.offset,
      };
    }),
  );

  /**
   * Public detail. A draft reads as missing; closed briefs stay
   * readable so a designer can still see what they bid for.
   */
  fastify.get('/briefs/:id', async (request, reply) => {
    const brief = await briefs.findPublicBrief(briefId(request));
    if (!brief) return reply.status(404).send({ error: 'Brief not found' });
    return { brief };
  });

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
          // A brief can be saved as a draft or posted straight to the board.
          const status = (optionalEnum(body.status, 'Status', [
            'draft',
            'open',
          ]) ?? 'draft') as BriefStatus;
          const brief = await briefs.insertBrief(
            getAuthUser(request)?.id as number,
            readBriefFields(body),
            status,
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

      /** draft | closed -> open. Awarded is final; reopening it is refused. */
      me.post('/briefs/:id/publish', async (request, reply) => {
        const brief = await owned(request);
        if (!brief) return reply.status(404).send({ error: 'Not found' });
        if (brief.status === 'open') {
          return reply
            .status(409)
            .send({ error: 'This brief is already open' });
        }
        return { brief: await briefs.setBriefStatus(brief.id, 'open') };
      });

      /**
       * Stop taking bids. The bids already received stay exactly where
       * they are — closing a brief withdraws the listing, not the responses.
       */
      me.post('/briefs/:id/close', async (request, reply) => {
        const brief = await owned(request);
        if (!brief) return reply.status(404).send({ error: 'Not found' });
        if (brief.status === 'closed') {
          return reply
            .status(409)
            .send({ error: 'This brief is already closed to bids' });
        }
        return { brief: await briefs.setBriefStatus(brief.id, 'closed') };
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
