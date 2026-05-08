/**
 * SEAN-57 — operations matrix coverage assertions.
 *
 * Phase 2 of the converter phased build plan requires ≥200 indexable pSEO
 * pages. This test enforces that floor at the matrix level so a future
 * refactor (e.g. dropping a video input format) can't quietly slip below it.
 *
 * Coverage checks mirror `apps/ffmpeg-converter/phased-spec.md` §"Phase 2 —
 * pSEO at scale":
 *   - convert: 15 video × 14 video targets
 *   - extract-audio: 15 video × 6 audio targets
 *   - compress: ≥15 video formats
 *   - gif: ≥15 video → gif pages
 *   - size-targeted compress: under-25mb / under-8mb / under-100mb
 *
 * Test runner: `node --test` (Node 18+) via ts-node, same wiring as
 * `dead-links.test.ts`. Run via `yarn test` from the web workspace.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  MATRIX,
  MATRIX_BY_SLUG,
  resolveAllPages,
  validateMatrix,
} from './matrix';
import type { Format } from './types';

// ─────────────────────────────────────────────────────── HELPERS ─────────────

function pagesByOperation(operation: string) {
  return resolveAllPages().filter((p) => p.row.operation === operation);
}

// ─────────────────────────────────────────────────────── TESTS ───────────────

describe('SEAN-57 matrix coverage — Phase 2 pSEO floor', () => {
  it('resolveAllPages produces ≥200 pages', () => {
    const pages = resolveAllPages();
    assert.ok(
      pages.length >= 200,
      `expected ≥200 resolved pages for Phase 2 SEO floor, got ${pages.length}`,
    );
  });

  it('every matrix slug is unique', () => {
    const seen = new Set<string>();
    for (const row of MATRIX) {
      assert.ok(
        !seen.has(row.slug),
        `duplicate slug detected: ${row.slug} — MATRIX_BY_SLUG would lose a row`,
      );
      seen.add(row.slug);
    }
    // Belt-and-braces: the size of the indexed map should match the array.
    assert.equal(Object.keys(MATRIX_BY_SLUG).length, MATRIX.length);
  });

  it('every (operation, input, output) tuple is uniquely addressable except for preset variants', () => {
    // Two slugs serving the same conversion is a duplicate-content SEO penalty.
    // Phase 2's pSEO architecture relies on exactly one canonical URL per
    // (op, input, output) — UNLESS the rows differ by preset (e.g.
    // `compress-mp4` and `compress-mp4-under-25mb` both run mp4→mp4 compress
    // but target different long-tail keywords with distinct copy and presets).
    const seen = new Map<string, { slug: string; preset?: object }>();
    for (const page of resolveAllPages()) {
      const key = `${page.row.operation}|${page.inputFormat}|${page.outputFormat}`;
      const previous = seen.get(key);
      if (previous === undefined) {
        seen.set(key, { slug: page.slug, preset: page.row.preset });
        continue;
      }
      // Either current or previous must carry a non-equal preset.
      const currentPreset = JSON.stringify(page.row.preset ?? null);
      const prevPreset = JSON.stringify(previous.preset ?? null);
      assert.notEqual(
        currentPreset,
        prevPreset,
        `duplicate (op, in, out) pair with identical preset: ${key} — served by both '${previous.slug}' and '${page.slug}'`,
      );
    }
  });

  it('validateMatrix returns no row-level "zero valid pages" errors', () => {
    const errors = validateMatrix(MATRIX);
    const fatal = errors.filter((e) =>
      e.reason.startsWith('row produces zero valid pages'),
    );
    assert.deepEqual(
      fatal,
      [],
      `every matrix row must produce ≥1 valid page; offenders: ${fatal
        .map((e) => e.slug)
        .join(', ')}`,
    );
  });

  it('convert covers 15 × 14 video pairs', () => {
    const convertPages = pagesByOperation('convert');
    // Every video format pair (from, to) where from ≠ to.
    const VIDEO: Format[] = [
      'mp4',
      'mov',
      'webm',
      'mkv',
      'avi',
      'flv',
      'wmv',
      'm4v',
      'mpeg',
      '3gp',
      'ts',
      'mts',
      'm2ts',
      'ogv',
      'vob',
    ];
    for (const from of VIDEO) {
      for (const to of VIDEO) {
        if (from === to) continue;
        const hit = convertPages.find(
          (p) => p.inputFormat === from && p.outputFormat === to,
        );
        assert.ok(
          hit,
          `convert (${from} → ${to}) missing — Phase 2 requires the full 15×14 video matrix`,
        );
      }
    }
    assert.ok(
      convertPages.length >= 15 * 14,
      `expected ≥${15 * 14} convert pages, got ${convertPages.length}`,
    );
  });

  it('extract-audio covers 15 video × 6 audio targets', () => {
    const audioPages = pagesByOperation('extract-audio');
    const VIDEO: Format[] = [
      'mp4',
      'mov',
      'webm',
      'mkv',
      'avi',
      'flv',
      'wmv',
      'm4v',
      'mpeg',
      '3gp',
      'ts',
      'mts',
      'm2ts',
      'ogv',
      'vob',
    ];
    const AUDIO: Format[] = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'opus'];
    for (const from of VIDEO) {
      for (const to of AUDIO) {
        const hit = audioPages.find(
          (p) => p.inputFormat === from && p.outputFormat === to,
        );
        assert.ok(
          hit,
          `extract-audio (${from} → ${to}) missing — Phase 2 requires 15×6 audio matrix`,
        );
      }
    }
    assert.ok(
      audioPages.length >= 15 * 6,
      `expected ≥${15 * 6} extract-audio pages, got ${audioPages.length}`,
    );
  });

  it('compress covers all 15 video formats', () => {
    const compressPages = pagesByOperation('compress');
    const VIDEO: Format[] = [
      'mp4',
      'mov',
      'webm',
      'mkv',
      'avi',
      'flv',
      'wmv',
      'm4v',
      'mpeg',
      '3gp',
      'ts',
      'mts',
      'm2ts',
      'ogv',
      'vob',
    ];
    for (const f of VIDEO) {
      const hit = compressPages.find(
        (p) => p.inputFormat === f && p.outputFormat === f,
      );
      assert.ok(
        hit,
        `compress (${f}) missing — Phase 2 wants ≥15 compress pages`,
      );
    }
  });

  it('size-targeted compress variants are present', () => {
    for (const slug of [
      'compress-mp4-under-25mb',
      'compress-mp4-under-8mb',
      'compress-mp4-under-100mb',
    ]) {
      assert.ok(
        MATRIX_BY_SLUG[slug],
        `size-targeted compress slug missing: ${slug}`,
      );
    }
  });

  it('gif covers ≥15 video → animated-image pages', () => {
    const gifPages = pagesByOperation('gif');
    assert.ok(
      gifPages.length >= 15,
      `expected ≥15 gif pages, got ${gifPages.length}`,
    );
    // Every page output must be an animated-image format. The `gif` operation
    // covers both literal GIF output and animated WebP output (per SEAN-76 —
    // webp-anim is the modern half-the-bytes alternative to GIF and uses the
    // same video → animated-image pipeline).
    const ANIMATED_IMAGE_OUTPUTS = new Set(['gif', 'webp-anim', 'apng']);
    for (const page of gifPages) {
      assert.ok(
        ANIMATED_IMAGE_OUTPUTS.has(page.outputFormat),
        `gif op page ${page.slug} has non-animated-image output: ${page.outputFormat}`,
      );
    }
  });
});
