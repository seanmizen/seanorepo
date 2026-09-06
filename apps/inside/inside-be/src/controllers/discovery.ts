import type { DesignerSort } from '@shared/types';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  listApprovedDesigners,
  listPublicPortfolio,
} from '../services/discovery';
import { MAX_SEARCH_LENGTH } from '../services/search';
import {
  AVAILABILITIES,
  BUDGET_BANDS,
  boundedInt,
  DESIGNER_SORTS,
  optionalEnum,
  optionalString,
  ValidationError,
  WORK_TYPES,
} from '../services/validation';

/**
 * Discovery: the public, anonymous-friendly read side of the marketplace.
 *
 * Nothing here takes a session. Buyers browse fully signed-out, and these are
 * the pages search engines crawl, so an auth check would be both wrong and
 * invisible until traffic arrived.
 *
 * Only approved designers are ever returned; the gate lives in
 * `services/discovery.ts`, in the base WHERE clause of every query, rather
 * than being reapplied per route where a future route could forget it.
 */

/** Sensible grid page; the ceiling stops a caller pulling the whole table. */
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;
/** 10k pages deep is a crawler or a mistake, and OFFSET cost grows with it. */
const MAX_PAGE = 10_000;

async function withValidation<T>(
  reply: FastifyReply,
  run: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ValidationError) {
      await reply.status(400).send({ error: error.message });
      return undefined;
    }
    throw error;
  }
}

export async function discoveryRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/designers — the browse and search surface.
   *
   * Every filter value is validated against the same enum the schema's CHECK
   * constraint uses, and a value outside it is a 400. Ignoring an unrecognised
   * filter would be worse than rejecting it: the caller gets a full, unfiltered
   * list back and has no way to tell it was not narrowed.
   */
  fastify.get('/designers', async (request, reply) =>
    withValidation(reply, async () => {
      const query = (request.query ?? {}) as Record<string, unknown>;

      const q = optionalString(query.q, 'Search', MAX_SEARCH_LENGTH);
      const sort = optionalEnum<DesignerSort>(
        query.sort,
        'Sort',
        DESIGNER_SORTS,
      );
      // Relevance without a query has nothing to rank. Falling back silently
      // would return a differently-ordered list than the caller asked for and
      // never say so.
      if (sort === 'relevance' && q === null) {
        throw new ValidationError(
          'Sorting by relevance needs a search query — pass q',
        );
      }

      const limit = boundedInt(query.limit, 'Limit', {
        min: 1,
        max: MAX_LIMIT,
        fallback: DEFAULT_LIMIT,
      });
      const page = boundedInt(query.page, 'Page', {
        min: 1,
        max: MAX_PAGE,
        fallback: 1,
      });
      const offset = (page - 1) * limit;

      const { designers, total } = await listApprovedDesigners({
        q,
        workType: optionalEnum(
          query.workType,
          'PortfolioProject type',
          WORK_TYPES,
        ),
        location: optionalString(query.location, 'Location', 120),
        budgetBand: optionalEnum(query.budgetBand, 'Budget band', BUDGET_BANDS),
        availability: optionalEnum(
          query.availability,
          'Availability',
          AVAILABILITIES,
        ),
        // Search defaults to relevance; browsing defaults to newest.
        sort: sort ?? (q === null ? 'newest' : 'relevance'),
        limit,
        offset,
      });

      // A page past the end, or a filter nothing matches, is an empty page —
      // 200 with zero results. It is a valid answer to a valid question, and
      // a 404 would make an empty filter combination look like a broken URL.
      return {
        designers,
        total,
        page,
        limit,
        hasMore: offset + designers.length < total,
      };
    }),
  );

  /**
   * GET /api/designers/:slug/portfolio_projects — one designer's public portfolio.
   *
   * Published pieces of an approved designer, and nothing else. An unapproved
   * or unknown slug gets the same 404, so the approval queue cannot be probed.
   */
  fastify.get('/designers/:slug/portfolio_projects', async (request, reply) =>
    withValidation(reply, async () => {
      const { slug } = request.params as { slug: string };
      const query = (request.query ?? {}) as Record<string, unknown>;

      const limit = boundedInt(query.limit, 'Limit', {
        min: 1,
        max: MAX_LIMIT,
        fallback: DEFAULT_LIMIT,
      });
      const page = boundedInt(query.page, 'Page', {
        min: 1,
        max: MAX_PAGE,
        fallback: 1,
      });
      const offset = (page - 1) * limit;

      const result = await listPublicPortfolio(slug, { limit, offset });
      if (!result) {
        return reply.status(404).send({ error: 'Designer not found' });
      }

      return {
        designer: {
          slug: result.profile.slug,
          studioName: result.profile.studioName,
        },
        portfolio_projects: result.portfolio_projects,
        total: result.total,
        page,
        limit,
        hasMore: offset + result.portfolio_projects.length < result.total,
      };
    }),
  );
}
