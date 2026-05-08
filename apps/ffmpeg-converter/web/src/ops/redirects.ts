/**
 * SEAN-59 — 301 redirects from common slug misspellings to canonical pages.
 *
 * Users typo URLs all the time — "mp4tomov", "mp4-mov", "convert mp4 mov".
 * Without redirects every typo is a 404; with them every typo lands on the
 * canonical page and preserves SEO equity.
 *
 * Implemented as a pure function over the operations matrix so that adding a
 * matrix row automatically adds the corresponding misspelling redirects. The
 * output is consumed by `next.config.ts` `redirects()` and runs at the edge
 * (no per-request JS).
 *
 * Patterns covered, for every canonical slug of shape `{from}-to-{to}`:
 *   1. `{from}to{to}`        — no hyphens     (e.g. `mp4tomov`)
 *   2. `{from}-{to}`         — no "to"        (e.g. `mp4-mov`)
 *   3. `{from}_{to}`         — underscore     (e.g. `mp4_mov`)
 *   4. `convert-{from}-{to}` — verb-flat form (e.g. `convert-mp4-mov`)
 *
 * Every redirect targets the nested canonical URL — `/{operation}/{slug}` for
 * most operations, `/convert/{slug}` for `image-convert` (which lives under
 * the `/convert` URL prefix despite being a distinct operation, mirroring the
 * sitemap convention in `app/sitemap.ts`).
 *
 * IMPORTANT: a misspelling source MUST NOT collide with any canonical slug
 * (otherwise the redirect would shadow a real page and produce a 404 loop or
 * worse). The generator below filters collisions out and the test asserts the
 * resulting list contains zero overlaps with the canonical slug set.
 */

import type { OperationRow } from './types';

// ─────────────────────────────────────────────────────── TYPES ───────────────

/**
 * Subset of the Next.js redirect shape used by `redirects()` in next.config.ts.
 * We only need the three fields; widening this type would just create a
 * pointless dependency on Next's internal types in test code.
 */
export interface RedirectRule {
  /** URL path to redirect FROM, e.g. `/mp4tomov`. Must start with `/`. */
  source: string;
  /** URL path to redirect TO, e.g. `/convert/mp4-to-mov`. Must start with `/`. */
  destination: string;
  /** Always `true` — every misspelling redirect is a 301. */
  permanent: true;
}

// ─────────────────────────────────────────────────────── HELPERS ─────────────

/**
 * URL prefix for a given operation row. Mirrors the convention in
 * `app/sitemap.ts` and the per-operation `[slug]` route folders under
 * `src/app/[operation]/[slug]/`.
 *
 * `image-convert` rows live under `/convert/...` because there is no
 * `/image-convert/...` route — they're indistinguishable from regular
 * convert pages from a URL perspective.
 */
function urlPrefixFor(row: OperationRow): string {
  return row.operation === 'image-convert' ? '/convert' : `/${row.operation}`;
}

/**
 * Pull the `(from, to)` pair out of a `{from}-to-{to}` slug. Returns null for
 * slugs that don't match the pattern (e.g. `compress-mp4`, `trim-mp4`,
 * `compress-mp4-under-25mb`) — those operations don't have the from-to shape
 * the misspelling patterns target.
 *
 * Matches greedy on the first `-to-` so multi-segment formats with hyphens
 * (we have none currently, but `webp-anim` is in the type space) would still
 * resolve correctly.
 */
function parseFromToSlug(slug: string): { from: string; to: string } | null {
  const match = slug.match(/^([a-z0-9]+)-to-([a-z0-9-]+)$/);
  if (!match) return null;
  return { from: match[1], to: match[2] };
}

/**
 * Generate the four misspelling source paths for one `{from}-to-{to}` slug.
 * Returned strings include the leading `/` to match `RedirectRule.source`.
 *
 * Listed in matrix order so the test's "≥200 redirects" assertion has a
 * stable count to reason about (currently 4 × N canonical from-to slugs).
 */
function misspellingSourcesFor(from: string, to: string): string[] {
  return [
    `/${from}to${to}`, // mp4tomov
    `/${from}-${to}`, // mp4-mov
    `/${from}_${to}`, // mp4_mov
    `/convert-${from}-${to}`, // convert-mp4-mov
  ];
}

// ─────────────────────────────────────────────────────── GENERATOR ───────────

/**
 * Build the full redirect list from the matrix. Pure function — no side
 * effects, no I/O. Safe to call from `next.config.ts` (runs once at build
 * time) or from tests.
 *
 * Filters:
 *   - rows whose slug isn't `{from}-to-{to}` are skipped (no misspelling
 *     pattern applies — e.g. `compress-mp4`, `trim-mp4`, `normalize-audio`)
 *   - any source path that collides with a canonical URL `/{op}/{slug}` is
 *     dropped so we never shadow a real page
 *   - duplicate sources (could happen if two rows generated the same
 *     misspelling) are dropped — first-write wins, since `redirects()`
 *     ignores trailing duplicates anyway
 */
export function generateRedirects(rows: OperationRow[]): RedirectRule[] {
  // Set of canonical URL paths — sources must not collide with these.
  const canonicalPaths = new Set<string>();
  for (const row of rows) {
    canonicalPaths.add(`${urlPrefixFor(row)}/${row.slug}`);
  }

  const seenSources = new Set<string>();
  const redirects: RedirectRule[] = [];

  for (const row of rows) {
    const parsed = parseFromToSlug(row.slug);
    if (!parsed) continue; // skip non-from-to slugs

    const destination = `${urlPrefixFor(row)}/${row.slug}`;
    const sources = misspellingSourcesFor(parsed.from, parsed.to);

    for (const source of sources) {
      if (seenSources.has(source)) continue;
      if (canonicalPaths.has(source)) continue; // never shadow a real page
      seenSources.add(source);
      redirects.push({ source, destination, permanent: true });
    }
  }

  return redirects;
}

/**
 * Expose the canonical-path set so the test can assert no source collides
 * with any of them. Re-derives the set rather than caching it — keeps the
 * module stateless.
 */
export function canonicalPathsForTest(rows: OperationRow[]): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    set.add(`${urlPrefixFor(row)}/${row.slug}`);
  }
  return set;
}
