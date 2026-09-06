/**
 * The filter contract, declared once.
 *
 * A filterable endpoint gets ONE schema here, and both sides derive from it:
 * the server validates `request.query` with it, and the client parses and
 * serialises URL state with it. Adding a filter is a single line in this file
 * — the client hook, the server validation and the types all follow.
 *
 * Before this existed there were three hand-rolled query parsers with three
 * different policies: discovery rejected out-of-range numbers, briefs used a
 * near-duplicate parser where `"1e3"` was valid, and admin silently clamped
 * garbage to a default. That is the class of drift this file removes.
 */
import { z } from 'zod';
import {
  AVAILABILITIES,
  BUDGET_BANDS,
  DESIGNER_PROFILE_STATUSES,
  DESIGNER_SORTS,
  WORK_TYPES,
} from './enums';

/**
 * A repeatable, comma-separated parameter: `?designers=a,b,c`.
 *
 * Accepts BOTH forms — the comma list and repeated keys (`?x=a&x=b`) — and
 * normalises to an array either way, because a URL that arrives from a hand-
 * written link, a form, or another service should not need to know which
 * convention we prefer. The canonical form we *write* is the comma list: it is
 * shorter and reads better in a shared or marketed link.
 */
export const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = Array.isArray(value) ? value : [value];
    const parts = raw
      .flatMap((entry) => String(entry).split(','))
      .map((entry) => entry.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  }, z.array(item).optional());

/**
 * A bounded integer from a query string.
 *
 * Rejects rather than clamps. Silently coercing `?limit=9999` to 60 hands back
 * a page the caller did not ask for and cannot tell is wrong; a 400 says so.
 * The digits-only check also rejects `"1e3"`, `"-1"` and `" 12"`, which
 * `Number()` would all accept.
 */
const boundedInt = (min: number, max: number, fallback: number) =>
  z
    .union([z.string().regex(/^\d+$/, 'must be a whole number'), z.number()])
    .optional()
    .transform((value) => (value === undefined ? fallback : Number(value)))
    .pipe(z.number().int().min(min).max(max));

export const pageParam = boundedInt(1, 10_000, 1);
export const limitParam = (max: number, fallback: number) =>
  boundedInt(1, max, fallback);

/** Free text, trimmed, with empty treated as absent rather than as a match-all. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

/* ------------------------------------------------------------------ *
 * Endpoint schemas
 *
 * NOTE: none of these use `.strict()`, and that is deliberate. Unknown keys
 * are STRIPPED, never rejected — `?utm_source=instagram` must not 400 a
 * campaign landing page, and neither must a stray `fbclid` or a bookmarked
 * param from an older release.
 * ------------------------------------------------------------------ */

export const designerFilters = z.object({
  q: text(200),
  workTypes: csv(z.enum(WORK_TYPES)),
  budgetBands: csv(z.enum(BUDGET_BANDS)),
  availability: csv(z.enum(AVAILABILITIES)),
  location: text(120),
  sort: z.enum(DESIGNER_SORTS).optional(),
  page: pageParam,
  limit: limitParam(60, 24),
});

export const briefFilters = z.object({
  workTypes: csv(z.enum(WORK_TYPES)),
  budgetBands: csv(z.enum(BUDGET_BANDS)),
  location: text(120),
  page: pageParam,
  limit: limitParam(100, 24),
});

export const adminDesignerFilters = z.object({
  statuses: csv(z.enum(DESIGNER_PROFILE_STATUSES)),
  page: pageParam,
  limit: limitParam(100, 25),
});

export const bidFilters = z.object({
  /**
   * Which designers' bids to show. This NARROWS an already-permitted set — the
   * server decides what the caller may see and intersects this with it. A
   * filter must never widen visibility.
   */
  designers: csv(z.string().max(120)),
  page: pageParam,
  limit: limitParam(100, 24),
});

export type DesignerFilters = z.infer<typeof designerFilters>;
export type BriefFilters = z.infer<typeof briefFilters>;
export type AdminDesignerFilters = z.infer<typeof adminDesignerFilters>;
export type BidFilters = z.infer<typeof bidFilters>;

/**
 * Serialise parsed filters back to a query string.
 *
 * Defaults and empties are omitted, so the URL stays short and one set of
 * filters always produces one canonical URL — which matters for sharing, for
 * caching, and for not splitting search equity across paginated duplicates.
 */
export function toQueryString(
  values: Record<string, unknown>,
  defaults: Record<string, unknown> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      params.set(key, value.join(','));
      continue;
    }
    if (defaults[key] !== undefined && defaults[key] === value) continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
