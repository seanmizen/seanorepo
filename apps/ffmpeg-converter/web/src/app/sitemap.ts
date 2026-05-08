// SEAN-54 — sitemap.xml auto-generated from the operations matrix.
//
// Next.js renders this as `/sitemap.xml` automatically when a `sitemap.ts`
// file exists at the app root and the default export returns a
// `MetadataRoute.Sitemap`.
//
// Strategy (per phased-spec.md §"Phase 2 — pSEO at scale" and SEAN-54 AC):
//   - One `<url>` entry per resolved page: every (operation × from × to) pair
//     in the matrix that passes validation.
//   - `priority` derived from `intentVolume` so head terms rank above tail
//     variants in crawler ordering: head=1.0, mid=0.7, tail=0.4.
//   - Homepage `/` included at priority 0.5 — lower than every tool page.
//     The tool pages are the SEO targets; the homepage is a hub, not a head term.
//   - `changeFrequency: 'weekly'` everywhere — the matrix changes when we ship
//     a new operation, which is roughly that cadence.
//   - `lastModified: new Date()` (build time). Static export => baked at
//     `next build`. We rebuild often enough that this stays close to truth.
//
// URL prefix mapping. Rows in the matrix have an `operation` field. For
// `image-convert` rows the page lives under `/convert/...` (e.g.
// `image-to-webp` is served by `app/convert/[slug]/page.tsx`). Every other
// operation has its own `app/[op]/[slug]/page.tsx` directory and the URL
// prefix matches the operation name verbatim. See `convert/[slug]/page.tsx`
// for the design rationale (verb-first slug rule under Directive 1).
//
// Hub pages (`/convert`, `/compress`, …) are not generated yet — they ship in
// the hub-pages ticket. When that lands, add their URLs here in the same
// commit. Likewise for any new top-level static pages.

import type { MetadataRoute } from 'next';
import { MATRIX } from '@/ops/matrix';
import type { IntentVolume, Operation } from '@/ops/types';

/** Canonical production origin. Mirror this in robots.txt's Sitemap directive. */
export const SITE_ORIGIN = 'https://seansconverter.com';

/**
 * Map an `intentVolume` bucket onto a sitemap `priority` value (0.0–1.0).
 * Head terms get the absolute top — those are the SEO targets we most want
 * Google to crawl first. Tail variants stay above the homepage but well
 * below head — they exist to catch long-tail traffic.
 */
const PRIORITY_BY_INTENT: Record<IntentVolume, number> = {
  head: 1.0,
  mid: 0.7,
  tail: 0.4,
};

/** Homepage priority. Strictly below every tool page — the tool pages are
 * the indexable targets; the homepage is the funnel above them. */
const HOMEPAGE_PRIORITY = 0.5;

/**
 * URL prefix for a row's tool page. `image-convert` rows live under
 * `/convert/...` (the user-facing verb is still "convert" — see the route's
 * page.tsx for the rationale). Every other operation maps to a directory
 * with the same name as the operation.
 */
function urlPrefixForOperation(operation: Operation): string {
  if (operation === 'image-convert') return '/convert';
  return `/${operation}`;
}

/**
 * Build the sitemap entries. Exported separately so the unit test can call
 * the same function the route does — no chance of test/runtime drift.
 */
export function buildSitemapEntries(
  now: Date = new Date(),
): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  // Homepage first. Lower priority than tool pages — the tool pages are the
  // SEO targets, not the homepage.
  entries.push({
    url: `${SITE_ORIGIN}/`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: HOMEPAGE_PRIORITY,
  });

  // One entry per matrix row's URL. A row's URL is its `(/[op]|/convert)/[slug]`
  // — bulk rows like `video-to-mp4` (which accept many input formats but share
  // a single slug) emit *one* page, not one per input. Phase 2's "one entry per
  // resolved (op × from × to) page" maps to "one entry per *URL*", and the
  // matrix already represents that 1:1: a row has one URL. If a future row
  // splits one input per slug, the resolved-page count and the row count will
  // converge.
  for (const row of MATRIX) {
    const prefix = urlPrefixForOperation(row.operation);
    entries.push({
      url: `${SITE_ORIGIN}${prefix}/${row.slug}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: PRIORITY_BY_INTENT[row.intentVolume],
    });
  }

  return entries;
}

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemapEntries();
}
