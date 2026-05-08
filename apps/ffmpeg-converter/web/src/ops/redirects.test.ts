/**
 * SEAN-59 — slug-misspelling redirect generator tests.
 *
 * Verifies the contract `next.config.ts` relies on:
 *   1. ≥200 redirects produced from the matrix (≥50 canonical from-to slugs
 *      × 4 misspelling patterns = ≥200).
 *   2. Every redirect is `permanent: true` (i.e. 301).
 *   3. No redirect source collides with a canonical URL — must never shadow
 *      a real page.
 *   4. The four misspelling patterns are present for a sample row
 *      (`mov-to-mp4`).
 *   5. No duplicate sources — `redirects()` would silently drop them anyway,
 *      but a duplicate is a sign of a generator bug.
 *
 * Test runner: `node:test` invoked via the same `ts-node`-based pattern as
 * the other tests in this folder. Wired up in package.json as
 * `yarn test:redirects` and aggregated into `yarn test`.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { MATRIX } from './matrix';
import {
  canonicalPathsForTest,
  generateRedirects,
  type RedirectRule,
} from './redirects';

// ─────────────────────────────────────────────────────── TESTS ───────────────

describe('SEAN-59 misspelling redirects', () => {
  const redirects: RedirectRule[] = generateRedirects(MATRIX);
  const canonicalPaths = canonicalPathsForTest(MATRIX);

  it('produces at least 200 redirects', () => {
    assert.ok(
      redirects.length >= 200,
      `expected ≥200 redirects, got ${redirects.length}`,
    );
  });

  it('every redirect is permanent (301)', () => {
    for (const r of redirects) {
      assert.equal(
        r.permanent,
        true,
        `redirect ${r.source} → ${r.destination} must be permanent`,
      );
    }
  });

  it('no redirect source collides with a canonical URL', () => {
    // The critical SEO/correctness check: if `/mp4-to-mov` were both a
    // canonical page AND a redirect source, Next would 301-loop on the
    // canonical page. Generator must filter these — assert it did.
    for (const r of redirects) {
      assert.ok(
        !canonicalPaths.has(r.source),
        `source ${r.source} collides with canonical URL — would shadow a real page`,
      );
    }
  });

  it('no canonical slug appears as a redirect source', () => {
    // Same property phrased the way the AC asks for: walking the canonical
    // slug set, none of those should be the source-path of any redirect.
    const sources = new Set(redirects.map((r) => r.source));
    for (const slug of MATRIX.map((row) => row.slug)) {
      // Try every operation prefix — we don't know which prefix a given slug
      // sits under without cross-referencing the matrix, so exclude all
      // possible canonical paths instead of just "/<slug>".
      for (const path of canonicalPaths) {
        assert.ok(
          !sources.has(path),
          `canonical path ${path} (slug ${slug}) is also a redirect source`,
        );
      }
    }
  });

  it('every source starts with `/` and is unique', () => {
    const seen = new Set<string>();
    for (const r of redirects) {
      assert.ok(
        r.source.startsWith('/'),
        `source must start with /: ${r.source}`,
      );
      assert.ok(!seen.has(r.source), `duplicate source: ${r.source}`);
      seen.add(r.source);
    }
  });

  it('every destination is a canonical URL', () => {
    for (const r of redirects) {
      assert.ok(
        canonicalPaths.has(r.destination),
        `destination ${r.destination} (from ${r.source}) is not a canonical URL`,
      );
    }
  });

  it('emits the four misspelling patterns for a known canonical slug (mov-to-mp4)', () => {
    // `mov-to-mp4` is a flagship page — its canonical URL is `/convert/mov-to-mp4`.
    // We expect the four patterns: movtomp4, mov-mp4, mov_mp4, convert-mov-mp4.
    const expected = new Set([
      '/movtomp4',
      '/mov-mp4',
      '/mov_mp4',
      '/convert-mov-mp4',
    ]);
    const movToMp4Redirects = redirects.filter(
      (r) => r.destination === '/convert/mov-to-mp4',
    );
    const sources = new Set(movToMp4Redirects.map((r) => r.source));
    for (const want of expected) {
      assert.ok(
        sources.has(want),
        `missing misspelling source ${want} → /convert/mov-to-mp4`,
      );
    }
    assert.equal(
      movToMp4Redirects.length,
      expected.size,
      `expected exactly ${expected.size} redirects to /convert/mov-to-mp4, got ${movToMp4Redirects.length}`,
    );
  });

  it('emits redirects for video-to-mp3 (extract-audio with from-to slug)', () => {
    // `video-to-mp3` is the only extract-audio canonical slug that matches the
    // from-to pattern (the others like `video-to-wav` do too — sanity-check the
    // pattern generalises beyond /convert/).
    const target = redirects.filter(
      (r) => r.destination === '/extract-audio/video-to-mp3',
    );
    assert.ok(
      target.length >= 3,
      `expected at least 3 redirects to /extract-audio/video-to-mp3 (some patterns may collide and be filtered), got ${target.length}`,
    );
    const sources = new Set(target.map((r) => r.source));
    assert.ok(
      sources.has('/videotomp3') ||
        sources.has('/video-mp3') ||
        sources.has('/video_mp3'),
      `expected at least one of /videotomp3, /video-mp3, /video_mp3 — got ${[...sources].join(', ')}`,
    );
  });
});
