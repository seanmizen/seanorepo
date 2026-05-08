// SEAN-56 — shared hub-page template.
//
// One template, six routes. `/convert`, `/compress`, `/extract-audio`,
// `/trim`, `/resize`, and `/gif` (without a `[slug]` segment) each render a
// HubPage filtered to a single operation. Hub pages serve two purposes per
// `phased-spec.md` §"Phase 2 — pSEO at scale":
//
//   1. Internal-link velocity — they crosslink the entire matrix in one
//      place, helping Google discover the ≥200 generated tool pages quickly.
//   2. Catch-all for fuzzy intent — a user typing "compress mp4" lands here
//      when their exact slug isn't ranking yet.
//
// The card grid is sorted by `intentVolume` (head → mid → tail) so the
// strongest commercial intent slugs appear first. Each card links straight
// to the underlying tool page via `pathForSlug`, which is gated on the
// route registry — if a slug somehow doesn't have a real page, it's
// skipped silently rather than emitting a dead link.
//
// SERVER component — pure HTML, no client JS. Keeps the bundle minimal.

import Link from 'next/link';
import { MATRIX } from '@/ops/matrix';
import type { Operation, OperationRow } from '@/ops/types';
import { pathForSlug } from './route-registry';

const INTENT_RANK: Record<string, number> = {
  head: 0,
  mid: 1,
  tail: 2,
};

export interface HubPageProps {
  /** Matching operation. */
  operation: Operation;
  /**
   * Additional operations whose rows should also appear here. e.g. `/convert`
   * pulls in `image-convert` rows because Directive 1's verb-first slug rule
   * routes image conversions under `/convert/...`.
   */
  alsoInclude?: readonly Operation[];
  /** Page <h1>. */
  h1: string;
  /** Two-line lede shown directly under the H1. */
  lede: string;
  /** ~50–80 word intro paragraph rendered above the card grid. */
  intro: string;
}

/**
 * Filter the matrix to the given operations and sort by intent volume so
 * head slugs (`mov-to-mp4`) appear before tail slugs (`3gp-to-vob`).
 *
 * Rows are de-duplicated by slug (defensive — the matrix is supposed to be
 * slug-unique already, but we don't want a duplicate-key React warning if
 * that invariant breaks).
 */
function selectRows(
  operation: Operation,
  alsoInclude: readonly Operation[] = [],
): OperationRow[] {
  const ops = new Set<Operation>([operation, ...alsoInclude]);
  const seen = new Set<string>();
  const rows: OperationRow[] = [];
  for (const row of MATRIX) {
    if (!ops.has(row.operation)) continue;
    if (seen.has(row.slug)) continue;
    seen.add(row.slug);
    rows.push(row);
  }
  rows.sort((a, b) => {
    const rankDiff =
      (INTENT_RANK[a.intentVolume] ?? 99) - (INTENT_RANK[b.intentVolume] ?? 99);
    if (rankDiff !== 0) return rankDiff;
    return a.slug.localeCompare(b.slug);
  });
  return rows;
}

export function HubPage({
  operation,
  alsoInclude,
  h1,
  lede,
  intro,
}: HubPageProps) {
  const rows = selectRows(operation, alsoInclude);

  // Filter to rows whose route actually resolves. `pathForSlug` returns null
  // for any operation not in `IMPLEMENTED_OPERATION_ROUTES`. In practice
  // every row we surface here will have a route — the per-op `[slug]/page.tsx`
  // is the whole point — but keep the guard in case the matrix grows a new
  // operation ahead of its dynamic route.
  const cards = rows
    .map((row) => {
      const href = pathForSlug(row.slug);
      return href ? { row, href } : null;
    })
    .filter((c): c is { row: OperationRow; href: string } => c !== null);

  return (
    <div className="mx-auto max-w-5xl px-6 pt-12 pb-20 md:pt-16">
      <header className="mb-6 max-w-3xl">
        <h1 className="text-balance text-4xl font-bold tracking-tight text-gray-100 md:text-5xl">
          {h1}
        </h1>
        <p className="mt-3 text-balance text-lg text-gray-400">{lede}</p>
      </header>

      <p className="mb-10 max-w-3xl text-gray-300">{intro}</p>

      {cards.length === 0 ? (
        <p className="text-gray-400">No tools available yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ row, href }) => (
            <li key={row.slug}>
              <Link
                href={href}
                className={[
                  'group flex h-full flex-col justify-between gap-4',
                  'rounded-lg border border-gray-800 bg-gray-900/60 p-5',
                  'transition-colors',
                  'hover:border-indigo-500 hover:bg-indigo-500/10',
                ].join(' ')}
              >
                <div>
                  <h2 className="text-lg font-semibold text-gray-100 group-hover:text-white">
                    {row.h1}
                  </h2>
                  <p className="mt-2 text-sm text-gray-400">{row.valueProp}</p>
                </div>
                <span className="text-sm font-medium text-indigo-400 group-hover:text-indigo-300">
                  Convert &rarr;
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
