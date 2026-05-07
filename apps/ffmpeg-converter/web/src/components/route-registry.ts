// Single source of truth for which internal routes actually resolve today.
//
// Phase 1 ships only `/convert/[slug]`. Phase 2 will add /compress/[slug],
// /extract-audio/[slug], /gif/[slug] etc — when those page routes land, add
// their `Operation` value to `IMPLEMENTED_OPERATION_ROUTES` in the same commit.
//
// Used by HeroDrop, FlagshipPills, and ToolPage to gate every internal link on
// "is the destination route actually implemented + is the slug in the matrix".
// The dead-links test imports this module and walks every emitted Link.

import { MATRIX_BY_SLUG } from '@/ops/matrix';
import type { Operation } from '@/ops/types';

/**
 * Operations that have a corresponding `app/[op]/[slug]/page.tsx` route. Add
 * to this list when shipping a new dynamic route — never add an operation here
 * without also shipping its route, or links will 404.
 */
export const IMPLEMENTED_OPERATION_ROUTES: ReadonlySet<Operation> =
  new Set<Operation>(['convert']);

/**
 * Returns true when there is an existing matrix row for `slug` AND the row's
 * operation has a generated route. Use this to gate every dynamic link the UI
 * emits.
 */
export function routeExistsForSlug(slug: string): boolean {
  const row = MATRIX_BY_SLUG[slug];
  if (!row) return false;
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
  if (!IMPLEMENTED_OPERATION_ROUTES.has(row.operation)) return null;
  return `/${row.operation}/${row.slug}`;
}
