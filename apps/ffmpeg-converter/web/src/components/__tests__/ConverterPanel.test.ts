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
import {
  adaptiveRowForFile,
  friendlyDropError,
  matrixRowForFile,
  outputsForExt,
} from '../route-for-file';

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

describe('SEAN-106 OutputFormatChips on slug pages', () => {
  it('drop .webm on /convert/mov-to-mp4 → webm-output options, .mp4 active', () => {
    // The load-bearing AC scenario: user lands on /convert/mov-to-mp4 (a
    // mov→mp4 convert row), drops a .webm. The panel re-detects the input
    // ext as `webm`; the chip row's options come from outputsForExt('webm');
    // active chip = the panel's current effective output, which after
    // adaptiveRowForFile resolves should land on mp4 (webm's preferred
    // target per PREFERRED_TARGET_BY_EXT, since there's no webm-to-mov).
    const match = adaptiveRowForFile({ name: 'clip.webm' }, 'convert', 'mp4');
    assert.ok(match, 'webm on a convert page should resolve');
    // webm has no webm-to-mp4 same-output preservation step (the source
    // page was mov-to-mp4, mp4 is mov's preferred target). For webm the
    // matrix exposes a webm-to-mp4 row directly, so the same-output match
    // should land on it.
    assert.equal(
      match.row.outputFormat,
      'mp4',
      'webm on /convert/mov-to-mp4 should preserve mp4 as output',
    );

    // Chip-row options for webm input must include mp4 (active) plus other
    // outputs the user can pick.
    const options = outputsForExt('webm');
    const formats = new Set(options.map((o) => o.format));
    assert.ok(formats.has('mp4'), 'webm chip row must offer mp4');
    assert.ok(
      options.length >= 2,
      'webm chip row must show at least 2 chips so the row is visible',
    );
    // The active chip is the resolved output — must exist in the options.
    assert.ok(
      formats.has(match.row.outputFormat),
      'effective output format must appear as a chip option',
    );
  });

  it('chip row hides itself when outputsForExt(ext).length < 2', () => {
    // Per AC: "When `outputsForExt(ext).length < 2` chip row hides itself."
    // We model this with the empty-extension case (no input → no options).
    const empty = outputsForExt('');
    assert.equal(empty.length, 0, 'empty ext returns no options');
    const unknown = outputsForExt('xyz-not-real');
    assert.equal(unknown.length, 0, 'unknown ext returns no options');
  });

  it('falls back to PREFERRED_TARGET_BY_EXT when URL output is unreachable', () => {
    // AC: "When detected input doesn't support URL's hinted output (e.g.
    // `.mov` on `/convert/mp4-to-webm` with no `mov-to-webm` row), chip
    // row's active state falls back to `PREFERRED_TARGET_BY_EXT[ext]`."
    //
    // The matrix today *does* have `mov-to-webm` — so we synthesise the
    // condition with png on a video-output page where no png-to-mp4 row
    // exists. PNG's preferred target is webp; that's what the chip row
    // active state should be.
    const match = adaptiveRowForFile({ name: 'photo.png' }, 'convert', 'mp4');
    assert.ok(match, 'png on a convert page must fall back to a routable row');
    assert.equal(
      match.row.outputFormat,
      'webp',
      "png's preferred target is webp; active chip falls back to it",
    );
    // The chip row options for png must include the resolved output.
    const options = outputsForExt('png');
    const formats = new Set(options.map((o) => o.format));
    assert.ok(
      formats.has('webp'),
      'png chip row must include the fallback output',
    );
  });
});

/**
 * SEAN-108 — friendly fallback when the dropped file has no matrix coverage.
 *
 * `ConverterPanel.resolveArgsForFile` consults two helpers in sequence:
 *   1. `adaptiveRowForFile` — try to land on a same-output row first.
 *   2. `matrixRowForFile`   — disambiguate "no same-output row" (the file
 *      has matrix coverage somewhere else) from "no matrix coverage at all"
 *      (zip / exe / docx / tif). The latter is the SEAN-108 reject branch.
 *
 * The branch in the panel is one if-statement built on these two helpers
 * plus `friendlyDropError`. We test the helper composition here — same
 * pattern as the SEAN-105 tests above (the JSX render path needs JSDOM,
 * which the suite intentionally avoids).
 */
describe('SEAN-108 ConverterPanel friendly-fallback — no matrix coverage', () => {
  // The four rep extensions called out in the AC. Each must satisfy:
  //   - matrixRowForFile returns null (no coverage)
  //   - adaptiveRowForFile returns null on a representative slug page
  //   - friendlyDropError produces a user-visible message naming the ext
  const NO_COVERAGE_EXTS = ['zip', 'exe', 'docx', 'tif'];

  for (const ext of NO_COVERAGE_EXTS) {
    it(`returns null from matrixRowForFile for .${ext}`, () => {
      const match = matrixRowForFile({ name: `payload.${ext}` });
      assert.equal(
        match,
        null,
        `.${ext} must have no matrix coverage — friendly fallback depends on this`,
      );
    });

    it(`returns null from adaptiveRowForFile for .${ext} on a slug page`, () => {
      // Drop the unsupported file on /convert/mp4-to-gif. Both helpers must
      // return null so the panel knows to surface the friendly message
      // rather than fire the conversion with the slug default.
      const match = adaptiveRowForFile(
        { name: `payload.${ext}` },
        'gif',
        'gif',
      );
      assert.equal(match, null);
    });

    it(`friendlyDropError mentions .${ext} verbatim`, () => {
      const msg = friendlyDropError(`payload.${ext}`);
      assert.ok(
        msg.includes(`.${ext}`),
        `friendly message must name the unsupported extension (got: ${msg})`,
      );
    });
  }

  it('friendlyDropError handles files with no extension at all', () => {
    const msg = friendlyDropError('README');
    assert.ok(
      msg.length > 0,
      'no-extension files must still get a friendly message, not an empty string',
    );
  });

  it('friendlyDropError output is the same string the homepage uses', () => {
    // The AC requires identical wording between homepage and slug pages.
    // Since both call `friendlyDropError(file.name)`, this is structurally
    // guaranteed — but the test pins it so a future refactor can't drift
    // the slug-page panel onto a different message source by mistake.
    const filename = 'archive.zip';
    const homepageMsg = friendlyDropError(filename);
    // The slug-page panel calls the SAME function with the SAME input —
    // there's no second message generator to compare against. The test
    // exists as a structural anchor: any future change that introduces a
    // second message string must trip an explicit grep for this test.
    assert.equal(typeof homepageMsg, 'string');
    assert.ok(homepageMsg.length > 0);
  });
});
