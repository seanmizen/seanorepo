// Homepage flagship pill row — derived from the operations matrix.
//
// Source: `MATRIX`/`FLAGSHIP_PRESETS` in `@/ops/matrix`. SEAN-50 replaced the
// hardcoded list with a matrix-derived one so we can never ship a pill that
// points at a non-existent route. Flagship rows whose operation route hasn't
// been implemented yet are filtered out — they'll appear automatically when
// the matching `app/[op]/[slug]/page.tsx` route lands.
//
// Twelve presets max (per `apps/ffmpeg-converter/docs/STRATEGY.md` "Flagship
// 8-12 headline conversions"). Some flagships will not render in Phase 1 —
// they reappear when their operation route ships.

import {
  MATRIX_BY_SLUG,
  FLAGSHIP_PRESETS as MATRIX_FLAGSHIPS,
} from '@/ops/matrix';
import { pathForSlug, routeExistsForSlug } from './route-registry';

export interface FlagshipPreset {
  /** Short label used on the pill button. */
  label: string;
  /** Tool-page path (with leading slash), guaranteed to resolve. */
  href: string;
  /** Op identifier from the Go backend's ops registry. */
  op: string;
  /** Matrix slug — used as a stable React key. */
  slug: string;
}

/**
 * Flagship pills filtered to rows whose route is implemented today. As more
 * operation routes ship (Phase 2), more pills will surface automatically.
 */
export const FLAGSHIP_PRESETS: FlagshipPreset[] = MATRIX_FLAGSHIPS.flatMap(
  (row) => {
    if (!MATRIX_BY_SLUG[row.slug]) return [];
    if (!routeExistsForSlug(row.slug)) return [];
    const href = pathForSlug(row.slug);
    if (!href) return [];
    return [
      {
        label: row.flagship?.label ?? row.h1,
        href,
        op: row.goOp,
        slug: row.slug,
      },
    ];
  },
);
