/**
 * SEAN-105 — adaptive-panel foundation: drop-mismatch detection.
 *
 * The panel itself is JSX (renders DropZone + ResultBlock + AdvancedPanel),
 * so we can't test the swap UI from `node --test` without a JSDOM. What we
 * CAN test is the load-bearing pure helper:
 *
 *   `adaptiveRowForFile(file, currentOperation, currentOutputFormat)`
 *
 * which encapsulates the entire decision: same row, swapped row preserving
 * output, or fallback to PREFERRED_TARGET_BY_EXT. Every UI-driven scenario
 * the panel implements reduces to one call into this helper.
 *
 * Test runner: `node --test` via ts-node (matches the rest of the suite).
 * Run via: `yarn test:converter-panel`.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { MATRIX_BY_SLUG } from '../../ops/matrix';
import { adaptiveRowForFile } from '../route-for-file';

describe('SEAN-105 ConverterPanel adaptive-panel — adaptiveRowForFile', () => {
  it('keeps the current row when the dropped file matches the slug input', () => {
    // Drop .mp4 on /convert/mp4-to-gif → no swap, stay on mp4-to-gif.
    const match = adaptiveRowForFile({ name: 'screen.mp4' }, 'gif', 'gif');
    assert.ok(match, 'mp4 on a gif page should resolve');
    assert.equal(match.row.slug, 'mp4-to-gif');
    assert.equal(match.row.operation, 'gif');
    assert.equal(match.row.outputFormat, 'gif');
  });

  it('swaps to the matching same-output row when input differs (mov on mp4-to-gif)', () => {
    // The load-bearing case from the AC: drop a .mov on /convert/mp4-to-gif
    // and the panel should land on the mov-to-gif row, NOT the
    // PREFERRED_TARGET_BY_EXT['mov']='mp4' default.
    const match = adaptiveRowForFile({ name: 'iphone.mov' }, 'gif', 'gif');
    assert.ok(match, 'mov on a gif page should resolve to a gif row');
    assert.equal(match.row.slug, 'mov-to-gif');
    assert.equal(match.row.operation, 'gif');
    assert.equal(match.row.outputFormat, 'gif');
    assert.equal(match.row.goOp, 'gif_from_video');
  });

  it('swaps to a same-output row across video formats (webm on mp4-to-gif)', () => {
    const match = adaptiveRowForFile({ name: 'clip.webm' }, 'gif', 'gif');
    assert.ok(match, 'webm on a gif page should resolve');
    assert.equal(match.row.slug, 'webm-to-gif');
    assert.equal(match.row.outputFormat, 'gif');
  });

  it('falls back to PREFERRED_TARGET_BY_EXT when no same-output row exists', () => {
    // Drop a .png on /convert/mov-to-mp4 — there's no png-to-mp4 row, so the
    // panel falls back to the preferred-target table. PNG's preferred target
    // is webp → image-convert row. This validates the AC's "fall back to
    // PREFERRED_TARGET_BY_EXT[ext]" clause.
    const match = adaptiveRowForFile({ name: 'photo.png' }, 'convert', 'mp4');
    assert.ok(
      match,
      'png on a video convert page should fall back to an image route',
    );
    // Output format necessarily changes — we lost the mp4 anchor.
    assert.notEqual(
      match.row.outputFormat,
      'mp4',
      'png cannot produce mp4 — output must change',
    );
    // png's preferred target is webp.
    assert.equal(match.row.outputFormat, 'webp');
  });

  it('returns null for files with no extension (no swap, panel keeps current row)', () => {
    const match = adaptiveRowForFile({ name: 'no-extension' }, 'gif', 'gif');
    assert.equal(
      match,
      null,
      'no extension → no detection → caller keeps current row',
    );
  });

  it('returns null for genuinely unknown extensions', () => {
    const match = adaptiveRowForFile({ name: 'mystery.xyz' }, 'gif', 'gif');
    assert.equal(match, null);
  });

  it('preserves operation when an alternate input has a same-op row', () => {
    // Drop a .mov on /convert/mp4-to-webm → there's a mov-to-webm row in the
    // matrix; we must land on that, not on the gif row that also accepts mov.
    const match = adaptiveRowForFile({ name: 'iphone.mov' }, 'convert', 'webm');
    assert.ok(match, 'mov on /convert/mp4-to-webm should resolve');
    assert.equal(match.row.operation, 'convert');
    // Either a direct mov-to-webm row OR a multi-input video-to-webm row is
    // acceptable — what matters is it stays a `convert` op landing on webm.
    assert.equal(match.row.outputFormat, 'webm');
  });

  it('returned row must exist in the matrix (sanity check)', () => {
    const match = adaptiveRowForFile({ name: 'iphone.mov' }, 'gif', 'gif');
    assert.ok(match);
    assert.ok(
      MATRIX_BY_SLUG[match.row.slug],
      `resolved slug ${match.row.slug} must exist in the matrix`,
    );
  });

  it('extension comparison is case-insensitive (uppercase MOV resolves)', () => {
    const match = adaptiveRowForFile({ name: 'iPhone.MOV' }, 'gif', 'gif');
    assert.ok(match, 'uppercase extension should resolve like lowercase');
    assert.equal(match.row.slug, 'mov-to-gif');
  });
});
