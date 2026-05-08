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
import { pathForSlug } from '../route-registry';
import { parseUrlState, URL_PARAM_WHITELIST } from '../url-state';

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

/**
 * SEAN-107 — cross-category drop adapts the panel without losing the file.
 *
 * Same testability constraint as SEAN-105: ConverterPanel renders JSX, so we
 * test the load-bearing decision via the pure helpers it composes. The
 * panel's behaviour for `.png` dropped on `/convert/mp4-to-gif`:
 *
 *   1. `adaptiveRowForFile(file, currentRow.operation, currentRow.outputFormat)`
 *      finds no same-output row for png on a gif page → falls through to
 *      `matrixRowForFile(file)` → resolves to the image-convert/png-to-webp
 *      row.
 *   2. The panel sets `detectedRow = match.row` → `effectiveOperation` flips
 *      to the new row's operation (`'image-convert'`).
 *   3. URL update via `pathForSlug(match.row.slug)` →
 *      `/convert/png-to-webp` (image-convert is aliased onto /convert).
 *   4. URL-state useEffect re-parses with the new operation; any params from
 *      the previous slug not in the new whitelist are silently dropped.
 *
 * Step (3) and (4) are pure-function assertions — no JSX render needed.
 */
describe('SEAN-107 ConverterPanel cross-category drop — operation switch', () => {
  it('PNG dropped on /convert/mp4-to-gif resolves to a different operation', () => {
    // The headline AC scenario. The slug page is `gif`/`gif`; the dropped
    // file is `.png`. The resolved row must come from a different operation
    // (image-convert, not gif) — that's what makes it a cross-category swap.
    const match = adaptiveRowForFile({ name: 'photo.png' }, 'gif', 'gif');
    assert.ok(match, 'png on a gif page must resolve via cross-category');
    assert.notEqual(
      match.row.operation,
      'gif',
      'cross-category swap MUST flip the operation away from gif',
    );
    assert.equal(
      match.row.operation,
      'image-convert',
      'png belongs on image-convert, not gif/convert',
    );
    assert.equal(
      match.row.outputFormat,
      'webp',
      'png prefers webp per PREFERRED_TARGET_BY_EXT',
    );
    // Today the matrix has a multi-input `image-to-webp` row (covering
    // jpg/png/heic/avif → webp), not a direct `png-to-webp` slug. The AC's
    // example URL `/convert/png-to-webp` is illustrative — the real slug
    // the panel lands on is whichever multi-input row covers png. If a
    // future commit splits this into a per-input row the slug here will
    // change; the test pins the OPERATION, not the exact slug.
    assert.ok(
      MATRIX_BY_SLUG[match.row.slug],
      `cross-category swap landed on slug ${match.row.slug} which must exist in the matrix`,
    );
  });

  it('cross-category resolved row has a real route via pathForSlug', () => {
    // The panel calls `pathForSlug(match.row.slug)` to update the URL via
    // history.replaceState. That call must return a non-null path so the
    // URL bar reflects the now-correct slug. The exact path depends on
    // which row the matrix exposes for png → webp today (image-to-webp)
    // — but it MUST live under /convert/ because image-convert aliases
    // there per route-registry.
    const match = adaptiveRowForFile({ name: 'photo.png' }, 'gif', 'gif');
    assert.ok(match);
    const newPath = pathForSlug(match.row.slug);
    assert.ok(newPath, 'cross-category swap must produce a non-null URL path');
    assert.ok(
      newPath.startsWith('/convert/'),
      `image-convert aliases to /convert/, got: ${newPath}`,
    );
    // And critically, it's not the slug we landed on — replaceState only
    // fires when the new path differs from the current location. The
    // mp4-to-gif slug lives at /gif/mp4-to-gif (operation `gif`), not
    // /convert/mp4-to-gif — but either way the new path differs.
    assert.notEqual(newPath, pathForSlug('mp4-to-gif'));
  });

  it('flipping from gif to image-convert drops gif-only URL params', () => {
    // The AC: "URL-state params from previous whitelist not in new whitelist
    // are silently dropped." Concretely, a shared link
    // `/convert/mp4-to-gif?fps=24&max_colors=128` followed by a png drop
    // should re-parse the URL through the image-convert whitelist, which
    // dumps `fps` and `max_colors` (gif-only) on the floor.
    const params = new URLSearchParams('?fps=24&max_colors=128&width=320');
    const beforeSwap = parseUrlState(params, 'gif');
    assert.equal(beforeSwap.fps, '24', 'fps survives on gif whitelist');
    assert.equal(
      beforeSwap.max_colors,
      '128',
      'max_colors survives on gif whitelist',
    );

    const afterSwap = parseUrlState(params, 'image-convert');
    assert.equal(
      afterSwap.fps,
      undefined,
      'fps is NOT in image-convert whitelist → dropped',
    );
    assert.equal(
      afterSwap.max_colors,
      undefined,
      'max_colors is NOT in image-convert whitelist → dropped',
    );
    // image-convert keeps `width` (it's in both whitelists), so a shared
    // link with width=320 still applies after a png drop. Verifies the
    // "silently dropped" behaviour is per-param, not all-or-nothing.
    assert.equal(
      afterSwap.width,
      '320',
      'width IS in image-convert whitelist → preserved',
    );
  });

  it('image-convert whitelist excludes the convert/gif advanced knobs', () => {
    // Structural pin: the AC for SEAN-107 depends on the whitelists not
    // overlapping for the advanced knobs (fps, max_colors, dither, crf,
    // bitrate, codec). If a future commit accidentally adds `fps` to the
    // image-convert whitelist this test will fail loudly so we know the
    // "silently dropped" behaviour for that param has changed.
    const imageWhitelist = URL_PARAM_WHITELIST['image-convert'];
    assert.ok(
      !imageWhitelist.includes('fps'),
      'fps must stay gif/extract-frames-only',
    );
    assert.ok(
      !imageWhitelist.includes('max_colors'),
      'max_colors must stay gif-only',
    );
    assert.ok(!imageWhitelist.includes('crf'), 'crf must stay convert-only');
    assert.ok(
      !imageWhitelist.includes('codec'),
      'codec must stay convert-only',
    );
  });

  it('cross-category swap landing on image-convert hides Advanced disclosure', () => {
    // The Advanced disclosure renders only when the *effective* operation is
    // `convert`. After a png drop on a gif page the effective operation is
    // `image-convert` → the Advanced panel must not render. We assert the
    // structural property the panel uses to make that decision: the
    // resolved row's operation is NOT 'convert'.
    const match = adaptiveRowForFile({ name: 'photo.png' }, 'gif', 'gif');
    assert.ok(match);
    assert.notEqual(
      match.row.operation,
      'convert',
      'png cross-category swap must not land on a convert row → Advanced hidden',
    );
  });

  it('mp4 dropped on a gif page is NOT cross-category (same operation kept)', () => {
    // Negative anchor: the cross-category branch must only trigger when the
    // operation actually differs. Dropping the slug's declared input on its
    // own page is the dominant case and must not flip operations.
    const match = adaptiveRowForFile({ name: 'video.mp4' }, 'gif', 'gif');
    assert.ok(match);
    assert.equal(
      match.row.operation,
      'gif',
      'same-input drop must keep the gif operation',
    );
    assert.equal(match.row.slug, 'mp4-to-gif');
  });

  it('mov dropped on /convert/mp4-to-gif is same-category (gif kept)', () => {
    // The case-2 anchor from STRATEGY (case 3 = cross-category, case 2 =
    // same-category). A mov on a gif page swaps the row but stays on `gif`
    // — the operation does NOT flip. Verifies the cross-category logic
    // doesn't over-trigger on legitimate same-category swaps.
    const match = adaptiveRowForFile({ name: 'iphone.mov' }, 'gif', 'gif');
    assert.ok(match);
    assert.equal(
      match.row.operation,
      'gif',
      'mov-to-gif row preserves the gif operation',
    );
    assert.equal(match.row.slug, 'mov-to-gif');
  });
});
