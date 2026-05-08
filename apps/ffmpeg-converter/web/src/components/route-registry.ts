// Single source of truth for which internal routes actually resolve today.
//
// Phase 2 (SEAN-52) shipped dynamic routes for compress, extract-audio, gif,
// trim, resize, thumbnail, contact-sheet, and normalize-audio alongside the
// existing /convert/[slug]. The registry tracks every operation whose
// `app/[op]/[slug]/page.tsx` route exists today; hub pages (SEAN-56) depend
// on this set to gate their card links.
//
// Used by HeroDrop, FlagshipPills, ToolPage, and HubPage to gate every
// internal link on "is the destination route actually implemented + is the
// slug in the matrix". The dead-links test imports this module and walks
// every emitted Link.

import { MATRIX_BY_SLUG } from '@/ops/matrix';
import type { Operation } from '@/ops/types';

/**
 * Operations that have a corresponding `app/[op]/[slug]/page.tsx` route. Add
 * to this list when shipping a new dynamic route — never add an operation here
 * without also shipping its route, or links will 404.
 *
 * `image-convert` is intentionally absent: those rows are routed under
 * `/convert/[slug]` per Directive 1's verb-first slug rule, not under their
 * own `/image-convert/...` segment. `pathForSlug` handles the alias below.
 */
export const IMPLEMENTED_OPERATION_ROUTES: ReadonlySet<Operation> =
  new Set<Operation>([
    'convert',
    'compress',
    'extract-audio',
    'gif',
    'trim',
    'resize',
    'thumbnail',
    'contact-sheet',
    'normalize-audio',
  ]);

/**
 * Operations whose URL prefix differs from their `Operation` value. Currently
 * the only entry is `image-convert` → `/convert/...` per Directive 1's
 * verb-first slug rule (image-to-jpg, image-to-webp etc. are still "convert"
 * to the user, just with image inputs).
 */
const URL_PREFIX_ALIAS: Partial<Record<Operation, string>> = {
  'image-convert': 'convert',
};

/**
 * Returns true when there is an existing matrix row for `slug` AND the row's
 * operation has a generated route. Use this to gate every dynamic link the UI
 * emits.
 */
export function routeExistsForSlug(slug: string): boolean {
  const row = MATRIX_BY_SLUG[slug];
  if (!row) return false;
  if (URL_PREFIX_ALIAS[row.operation]) return true;
  return IMPLEMENTED_OPERATION_ROUTES.has(row.operation);
}

/**
 * Build the canonical path for a matrix slug, or `null` when the route does
 * not exist yet. Centralised here so we never hand-roll `/${operation}/${slug}`
 * at the call site (and silently desync when the registry changes).
 */
export function pathForSlug(slug: string): string | null {
  const row = MATRIX_BY_SLUG[slug];
  if (!row) return null;
  const alias = URL_PREFIX_ALIAS[row.operation];
  if (alias) return `/${alias}/${row.slug}`;
  if (!IMPLEMENTED_OPERATION_ROUTES.has(row.operation)) return null;
  return `/${row.operation}/${row.slug}`;
}
