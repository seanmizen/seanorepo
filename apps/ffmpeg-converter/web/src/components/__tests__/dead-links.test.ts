/**
 * SEAN-50 — dead-link guard.
 *
 * Walks every internal link rendered on the homepage and on every generated
 * tool page, and asserts each href resolves to an existing route.
 *
 * Routes are declared by `src/components/route-registry.ts`
 * (`IMPLEMENTED_OPERATION_ROUTES`). When a new dynamic route ships, add the
 * corresponding `Operation` value to that set in the same commit — this test
 * will then pass for the new flagship/sibling links automatically.
 *
 * Test runner: `node --test` (Node 18+). No external test runner required.
 * Run via: `node --loader ts-node/esm --test src/components/__tests__/dead-links.test.ts`
 * (a `test:dead-links` package.json script wires this up.)
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { MATRIX } from '../../ops/matrix';
import { FLAGSHIP_PRESETS } from '../flagship-data';
import { extOf, routeForFile } from '../route-for-file';
import {
  IMPLEMENTED_OPERATION_ROUTES,
  pathForSlug,
  routeExistsForSlug,
} from '../route-registry';

// SEAN-56 — hub-page routes added in this ticket. Listed here so the
// dead-link walk recognises them as real, and so the footer's "Browse:"
// nav row (which links into them) doesn't trip the homepage assertion.
// SEAN-80 added the remaining three (thumbnail, contact-sheet, normalize-audio)
// so every operation segment resolves as a hub page rather than 404ing.
const HUB_ROUTES = [
  '/convert',
  '/compress',
  '/extract-audio',
  '/trim',
  '/resize',
  '/gif',
  '/thumbnail',
  '/contact-sheet',
  '/normalize-audio',
];

// ─────────────────────────────────────────────────────── HELPERS ─────────────

/**
 * Build the set of paths the app is known to serve. Mirrors the file-system
 * routes under `src/app/`. Static routes are listed verbatim; dynamic routes
 * come from the matrix filtered by the registry.
 *
 * Update this list when adding a new route under `src/app/`.
 */
function buildKnownRoutes(): Set<string> {
  const known = new Set<string>();

  // Static routes (top-level pages).
  known.add('/');

  // /pricing and /docs are still real (placeholder) routes — kept so that
  // bookmarked/external links don't 404 — but as of SEAN-82 they are no longer
  // linked from the header or footer (the dead-end nav links were pure funnel
  // friction). Listed here because the file-system route still exists.
  known.add('/pricing');
  known.add('/docs');
  known.add('/llms.txt');

  // SEAN-56 hub pages.
  for (const hub of HUB_ROUTES) known.add(hub);

  // Dynamic operation routes — every matrix slug whose operation is in the
  // implemented set, plus image-convert rows aliased under /convert/.
  for (const row of MATRIX) {
    if (row.operation === 'image-convert') {
      known.add(`/convert/${row.slug}`);
      continue;
    }
    if (!IMPLEMENTED_OPERATION_ROUTES.has(row.operation)) continue;
    known.add(`/${row.operation}/${row.slug}`);
  }

  return known;
}

/**
 * Re-create the homepage's outgoing internal-link list. Mirrors `app/page.tsx`
 * + the static layout header/footer + the HeroDrop routing table.
 *
 * HeroDrop links are conditional (drag a file → routes), so we synthesise one
 * dummy file per known input extension and assert each result resolves.
 */
function homepageLinks(): string[] {
  const links: string[] = [];

  // Header (layout.tsx) — no nav links anymore (SEAN-82); only the logotype,
  // pushed below.

  // Footer (SiteFooter.tsx) — only /llms.txt remains as an internal link
  // (Pricing/Docs removed in SEAN-82); the GitHub link is external.
  links.push('/llms.txt');

  // SEAN-56 — hub-page nav row in the footer.
  for (const hub of HUB_ROUTES) links.push(hub);

  // Logotype links back to /.
  links.push('/');

  // FlagshipPills.
  for (const pill of FLAGSHIP_PRESETS) {
    links.push(pill.href);
  }

  // HeroDrop — synthesise drops for every extension currently in the
  // PREFERRED_TARGET_BY_EXT table. We can't import that table directly (it's
  // module-private), so we exercise routeForFile() with a representative file
  // per extension.
  const candidateExts = [
    'mov',
    'webm',
    'mkv',
    'avi',
    'flv',
    'wmv',
    'm4v',
    'mpeg',
    'mpg',
    'mp4',
    'jpg',
    'jpeg',
    'png',
    'heic',
    'heif',
    'bmp',
    'tiff',
    'tif',
    'wav',
    'flac',
    'aac',
    'ogg',
    'm4a',
    'opus',
  ];
  for (const ext of candidateExts) {
    const target = routeForFile({ name: `dummy.${ext}` });
    if (target) links.push(target);
  }

  return links;
}

/**
 * Re-create every internal link a generated tool page would emit. Mirrors
 * `ToolPage.tsx`:
 *   - sibling Related links (filtered through `routeExistsForSlug` already)
 *   - reverse-link (rendered by ResultBlock when present)
 */
function toolPageLinks(): string[] {
  const links: string[] = [];

  for (const row of MATRIX) {
    if (!IMPLEMENTED_OPERATION_ROUTES.has(row.operation)) continue;

    // Siblings.
    for (const slug of row.related ?? []) {
      if (!routeExistsForSlug(slug)) continue;
      const href = pathForSlug(slug);
      if (href) links.push(href);
    }

    // Reverse-link, if it exists.
    if (row.operation === 'convert' && row.inputFormats.length === 1) {
      const inputExt = row.inputFormats[0];
      const reverseSlug = `${row.outputFormat}-to-${inputExt}`;
      if (routeExistsForSlug(reverseSlug)) {
        const href = pathForSlug(reverseSlug);
        if (href) links.push(href);
      }
    }
  }

  return links;
}

// ─────────────────────────────────────────────────────── TESTS ───────────────

describe('SEAN-50 dead-links — every internal link resolves', () => {
  const knownRoutes = buildKnownRoutes();

  it('every homepage link points at a real route', () => {
    const links = homepageLinks();
    assert.ok(links.length > 0, 'homepage should emit at least one link');
    for (const href of links) {
      assert.ok(
        knownRoutes.has(href),
        `homepage link ${href} does not resolve to a real route`,
      );
    }
  });

  it('every generated tool-page link points at a real route', () => {
    const links = toolPageLinks();
    // Phase 1 only ships convert routes — at least the flagship convert pages
    // (mov-to-mp4, mp4-to-webm, webm-to-mp4) emit siblings, so the count
    // should be >0. If this assertion fires after a matrix change, either a
    // new route landed (good — bump `IMPLEMENTED_OPERATION_ROUTES`) or
    // related-slugs got filtered out (also good — the test is doing its job).
    assert.ok(
      links.length > 0,
      'tool pages should emit at least one related/reverse link',
    );
    for (const href of links) {
      assert.ok(
        knownRoutes.has(href),
        `tool-page link ${href} does not resolve to a real route`,
      );
    }
  });

  it('routeForFile only returns paths that resolve', () => {
    // Walk every plausible extension. routeForFile returns null for unknown
    // ones — that's fine. Anything it returns must be a real route.
    const exts = [
      'mov',
      'webm',
      'mkv',
      'avi',
      'flv',
      'wmv',
      'm4v',
      'mpeg',
      'mpg',
      'mp4',
      'jpg',
      'jpeg',
      'png',
      'heic',
      'heif',
      'bmp',
      'tiff',
      'tif',
      'wav',
      'flac',
      'aac',
      'ogg',
      'm4a',
      'opus',
      'unknown-ext',
    ];
    for (const ext of exts) {
      const target = routeForFile({ name: `dummy.${ext}` });
      if (target === null) continue;
      assert.ok(
        knownRoutes.has(target),
        `routeForFile('.${ext}') returned ${target} which does not resolve`,
      );
    }
  });

  it('extOf normalises common extension shapes', () => {
    assert.equal(extOf('foo.MP4'), 'mp4');
    assert.equal(extOf('bare'), '');
    assert.equal(extOf('a.b.tiff'), 'tiff');
  });
});
