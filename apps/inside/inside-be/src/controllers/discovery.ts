import { designerFilters } from '@shared/filters';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  findPublicPortfolioProject,
  listApprovedDesigners,
  listPublicPortfolio,
} from '../services/discovery';
import { parseQuery } from '../services/query';
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
import { withValidation } from './helpers';

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

export async function discoveryRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/designers — the browse and search surface.
   *
   * Every filter value is validated against the same enum the schema's CHECK
   * constraint uses, and a value outside it is a 400. Ignoring an unrecognised
   * filter would be worse than rejecting it: the caller gets a full, unfiltered
   * list back and has no way to tell it was not narrowed.
   */
  fastify.get('/designers', async (request, reply) => {
    // One shared schema does the parsing, the validation and the defaults, so
    // this endpoint cannot drift from the others or from the client.
    const filters = await parseQuery(designerFilters, reply, request.query);
    if (!filters) return reply;

    // Relevance without a query has nothing to rank. Falling back silently
    // would return a differently-ordered list than the caller asked for and
    // never say so.
    if (filters.sort === 'relevance' && filters.q === undefined) {
      return reply
        .status(400)
        .send({ error: 'sort: relevance needs a search query — pass q' });
    }

    const offset = (filters.page - 1) * filters.limit;
    const { designers, total } = await listApprovedDesigners({
      q: filters.q ?? null,
      workTypes: filters.workTypes ?? null,
      location: filters.location ?? null,
      budgetBands: filters.budgetBands ?? null,
      availability: filters.availability ?? null,
      // Search defaults to relevance; browsing defaults to newest.
      sort: filters.sort ?? (filters.q === undefined ? 'newest' : 'relevance'),
      limit: filters.limit,
      offset,
    });

    // A page past the end, or a filter nothing matches, is an empty page —
    // 200 with zero results. It is a valid answer to a valid question, and a
    // 404 would make an empty filter combination look like a broken URL.
    return {
      designers,
      total,
      page: filters.page,
      limit: filters.limit,
      hasMore: offset + designers.length < total,
    };
  });

  /**
   * GET /api/designers/:slug/portfolio — one designer's public portfolio.
   *
   * Published pieces of an approved designer, and nothing else. An unapproved
   * or unknown slug gets the same 404, so the approval queue cannot be probed.
   */
  /**
   * GET /api/designers/:slug/portfolio/:projectSlug — one piece.
   *
   * Both slugs must resolve to something published and approved, or it 404s.
   */
  fastify.get(
    '/designers/:slug/portfolio/:projectSlug',
    async (request, reply) => {
      const { slug, projectSlug } = request.params as {
        slug: string;
        projectSlug: string;
      };
      const found = await findPublicPortfolioProject(slug, projectSlug);
      if (!found) return reply.status(404).send({ error: 'Not found' });
      return found;
    },
  );

  fastify.get('/designers/:slug/portfolio', async (request, reply) =>
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
        portfolioProjects: result.portfolioProjects,
        total: result.total,
        page,
        limit,
        hasMore: offset + result.portfolioProjects.length < result.total,
      };
    }),
  );
}
