/**
 * SEAN-60 — per-page word-count assertions.
 *
 * Phase 2 of the converter phased build plan (`apps/ffmpeg-converter/phased-spec.md`
 * §"Phase 2 — pSEO at scale") requires:
 *
 *   > Per-page word count: 250–600 unique words (template + per-op variation,
 *   > no spun filler).
 *
 * This test walks every resolved (op, input, output) page in the matrix and
 * asserts:
 *
 *   1. The composed body copy lands inside the 250-600 word window.
 *      "Body copy" matches the AC: H1 + valueProp + whenToUse +
 *      extendedHowItWorks + commonPitfalls answers + faqs answers. Excludes
 *      nav, footer, FAQ questions, ffmpeg command code blocks, and structural
 *      labels.
 *
 *   2. No two pages produce the same composite body verbatim. Google's
 *      duplicate-content filter is the bar; matching even one paragraph
 *      across two pages would put both at risk.
 *
 *   3. Per-format / per-operation defaults compose distinct paragraphs
 *      across the matrix — sampled spot-checks ensure the variation surfaces.
 *
 * Test runner: `node:test` invoked via `ts-node`, same wiring as
 * `matrix.test.ts`. Wired up in package.json as `yarn test:word-count` and
 * aggregated into `yarn test`.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { countWords, estimatePageWordCount, resolvePageCopy } from './copy';
import { resolveAllPages } from './matrix';

// ─────────────────────────────────────────────────────── CONSTANTS ───────────

const MIN_WORDS = 250;
const MAX_WORDS = 600;

// ─────────────────────────────────────────────────────── TESTS ───────────────

describe('SEAN-60 word count — Phase 2 pSEO body floor', () => {
  it('countWords handles whitespace and punctuation', () => {
    assert.equal(countWords(''), 0);
    assert.equal(countWords('   '), 0);
    assert.equal(countWords('hello world'), 2);
    assert.equal(countWords('hello, world.'), 2);
    assert.equal(countWords('one  two\nthree\tfour'), 4);
    // Pure punctuation tokens don't count
    assert.equal(countWords('hello — world'), 2);
  });

  it('every resolved page lands within the 250-600 word window', () => {
    const pages = resolveAllPages();
    assert.ok(pages.length > 0, 'expected at least one resolved page');

    const failures: { slug: string; input: string; count: number }[] = [];
    for (const page of pages) {
      const count = estimatePageWordCount(page.row, page);
      if (count < MIN_WORDS || count > MAX_WORDS) {
        failures.push({
          slug: page.slug,
          input: page.inputFormat,
          count,
        });
      }
    }

    if (failures.length > 0) {
      const sample = failures
        .slice(0, 10)
        .map(
          (f) =>
            `  - ${f.slug} (input=${f.input}): ${f.count} words (need ${MIN_WORDS}-${MAX_WORDS})`,
        )
        .join('\n');
      assert.fail(
        `${failures.length} page(s) outside the ${MIN_WORDS}-${MAX_WORDS} word window:\n${sample}${
          failures.length > 10 ? `\n  ... and ${failures.length - 10} more` : ''
        }`,
      );
    }
  });

  it('no two resolved pages share an identical body copy verbatim', () => {
    // Composite signature = whenToUse + extendedHowItWorks + first pitfall.
    // If two pages match on all three, they've effectively collapsed under
    // Google's duplicate filter even if H1/valueProp differ.
    const seen = new Map<string, { slug: string; input: string }>();
    const collisions: {
      a: { slug: string; input: string };
      b: { slug: string; input: string };
    }[] = [];
    for (const page of resolveAllPages()) {
      const copy = resolvePageCopy(page.row, page);
      const sig = [
        copy.whenToUse,
        copy.extendedHowItWorks,
        copy.commonPitfalls[0]?.a ?? '',
      ].join('|||');
      const previous = seen.get(sig);
      if (previous) {
        collisions.push({
          a: previous,
          b: { slug: page.slug, input: page.inputFormat },
        });
      } else {
        seen.set(sig, { slug: page.slug, input: page.inputFormat });
      }
    }

    if (collisions.length > 0) {
      const sample = collisions
        .slice(0, 5)
        .map(
          (c) =>
            `  - ${c.a.slug} (input=${c.a.input}) vs ${c.b.slug} (input=${c.b.input})`,
        )
        .join('\n');
      assert.fail(
        `${collisions.length} duplicate body copy collision(s):\n${sample}`,
      );
    }
  });

  it('whenToUse copy varies between MP4-to-GIF and MOV-to-MP4 (anti-templated-filler check)', () => {
    // Smoke test that the per-op + per-format variation actually surfaces.
    // If both pages get the same "When to use" paragraph the matrix has
    // collapsed back to spun filler.
    const pages = resolveAllPages();
    const gifPage = pages.find((p) => p.slug === 'mp4-to-gif');
    const movPage = pages.find((p) => p.slug === 'mov-to-mp4');
    assert.ok(gifPage, 'expected mp4-to-gif page in resolved set');
    assert.ok(movPage, 'expected mov-to-mp4 page in resolved set');
    const gifCopy = resolvePageCopy(gifPage.row, gifPage);
    const movCopy = resolvePageCopy(movPage.row, movPage);
    assert.notEqual(
      gifCopy.whenToUse,
      movCopy.whenToUse,
      'mp4-to-gif and mov-to-mp4 must not share the When to use copy',
    );
    assert.notEqual(
      gifCopy.extendedHowItWorks,
      movCopy.extendedHowItWorks,
      'mp4-to-gif and mov-to-mp4 must not share the How it works deep dive',
    );
  });

  it('compress-mp4 talks about something different than compress-mkv', () => {
    // Per-format pitfall variation: compress rows differ only by format,
    // so the only thing that can vary the body is the format itself. If
    // the pitfall text matches verbatim, we've lost format-specific colour.
    const pages = resolveAllPages();
    const mp4 = pages.find((p) => p.slug === 'compress-mp4');
    const mkv = pages.find((p) => p.slug === 'compress-mkv');
    if (!mp4 || !mkv) return; // generator may shift; not load-bearing
    const a = resolvePageCopy(mp4.row, mp4);
    const b = resolvePageCopy(mkv.row, mkv);
    assert.notEqual(a.whenToUse, b.whenToUse);
    assert.notEqual(a.extendedHowItWorks, b.extendedHowItWorks);
  });
});
