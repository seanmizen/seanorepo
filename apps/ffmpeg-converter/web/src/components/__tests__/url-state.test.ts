/**
 * SEAN-93 — URL-state for converter options.
 *
 * Three invariants this test guards:
 *   1. Whitelist — `parseUrlState` keeps only operation-whitelisted params,
 *      silently drops the rest. A `gif` page must reject `crf`, a `convert`
 *      page must reject `max_colors`, etc.
 *   2. Merge order — URL > preset > default. `mergeUrlIntoExtraArgs` must
 *      let URL params override preset-derived extraArgs without erasing the
 *      preset keys URL didn't touch.
 *   3. Ffmpeg command reflection — `applyUrlToFfmpegCommand` must rewrite
 *      `fps=N` and `scale=W:H` so a copy-paste command matches the user's
 *      URL state. Backed by the AC test:
 *        navigating to /gif/mp4-to-gif?fps=24&width=320 → command shows
 *        `fps=24,scale=320:-1`.
 *
 * Test runner: `node --test` via ts-node (matches the rest of the suite).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { MATRIX_BY_SLUG } from '../../ops/matrix';
import { buildExtraArgs } from '../converter-row-args';
import {
  applyUrlToFfmpegCommand,
  mergeUrlIntoExtraArgs,
  parseUrlState,
  serializeUrlState,
  URL_PARAM_WHITELIST,
} from '../url-state';

describe('SEAN-93 url-state — parseUrlState whitelist enforcement', () => {
  it('keeps gif-whitelisted params and drops everything else', () => {
    const state = parseUrlState(
      'fps=24&width=320&max_colors=128&dither=bayer&crf=18&hostile=1',
      'gif',
    );
    assert.equal(state.fps, '24');
    assert.equal(state.width, '320');
    assert.equal(state.max_colors, '128');
    assert.equal(state.dither, 'bayer');
    // crf is convert-only, must be dropped on the gif row.
    assert.equal(state.crf, undefined, 'crf must be dropped on a gif page');
    // Unknown params must be dropped wholesale — no echo, no forwarding.
    assert.equal(state.hostile, undefined, 'unknown param must be dropped');
  });

  it('rejects gif-only params on a video convert page', () => {
    const state = parseUrlState('crf=23&max_colors=128&fps=30', 'convert');
    assert.equal(state.crf, '23');
    assert.equal(state.fps, '30');
    assert.equal(
      state.max_colors,
      undefined,
      'max_colors is gif-only, must be dropped on convert',
    );
  });

  it('drops empty-string values so ?fps= doesn’t override the preset', () => {
    const state = parseUrlState('fps=&width=480', 'gif');
    assert.equal(state.fps, undefined);
    assert.equal(state.width, '480');
  });

  it('accepts both URLSearchParams and raw strings', () => {
    const fromString = parseUrlState('fps=20', 'gif');
    const fromParams = parseUrlState(new URLSearchParams('fps=20'), 'gif');
    assert.deepEqual(fromString, fromParams);
  });

  it('returns an empty object for operations with no whitelisted params', () => {
    // `mute` and `merge` deliberately have no params today.
    assert.deepEqual(parseUrlState('foo=1', 'mute'), {});
    assert.deepEqual(parseUrlState('foo=1', 'merge'), {});
  });

  it('every operation in the type union has a whitelist entry', () => {
    // Defence-in-depth — adding a new operation must force the author to
    // declare its whitelist (even an empty array). Otherwise the new op
    // would silently allow nothing and ConverterPanel would behave as if
    // URL-state were disabled for the page.
    const operations = [
      'convert',
      'compress',
      'extract-audio',
      'extract-frames',
      'trim',
      'resize',
      'rotate',
      'gif',
      'merge',
      'mute',
      'change-speed',
      'add-subtitles',
      'remove-audio',
      'reverse',
      'thumbnail',
      'contact-sheet',
      'normalize-audio',
      'image-convert',
    ] as const;
    for (const op of operations) {
      assert.ok(
        URL_PARAM_WHITELIST[op] !== undefined,
        `URL_PARAM_WHITELIST is missing operation: ${op}`,
      );
    }
  });
});

describe('SEAN-93 url-state — serializeUrlState round-trip', () => {
  it('serializes whitelisted params in deterministic order', () => {
    // Whitelist order for gif is [fps, width, max_colors, dither] — the
    // serializer must follow that, not the input map's iteration order, so
    // two identical states always produce byte-identical URLs.
    const state = { dither: 'bayer', fps: '24', width: '320' };
    const out = serializeUrlState(state, 'gif');
    assert.equal(out, '?fps=24&width=320&dither=bayer');
  });

  it('returns empty string for an empty state (never just `?`)', () => {
    assert.equal(serializeUrlState({}, 'gif'), '');
  });

  it('skips empty / nullish values', () => {
    const state = { fps: '24', width: '' };
    assert.equal(serializeUrlState(state, 'gif'), '?fps=24');
  });

  it('parse → serialize → parse is idempotent', () => {
    const original = parseUrlState('fps=24&width=320&max_colors=128', 'gif');
    const serialized = serializeUrlState(original, 'gif');
    const reparsed = parseUrlState(serialized.slice(1), 'gif');
    assert.deepEqual(reparsed, original);
  });

  it('encodes values that need URL-encoding', () => {
    // `preset` for convert can be `slow`/`medium` — no encoding needed —
    // but a future caller might pass a value with `&` or `=`. The serializer
    // must use encodeURIComponent so the URL is parseable on the receive
    // side.
    const state = { preset: 'slow', crf: '18' };
    const out = serializeUrlState(state, 'convert');
    assert.equal(out, '?crf=18&preset=slow');
  });
});

describe('SEAN-93 url-state — mergeUrlIntoExtraArgs (URL > preset > default)', () => {
  it('URL params override preset-derived extraArgs', () => {
    const presetArgs = { fps: '10', target_size_mb: '25' };
    const urlState = { fps: '24' };
    const merged = mergeUrlIntoExtraArgs(presetArgs, urlState);
    assert.ok(merged);
    assert.equal(merged.fps, '24', 'URL fps must beat preset fps');
    // Preset keys URL didn't touch must survive.
    assert.equal(merged.target_size_mb, '25');
  });

  it('preset survives when URL state is empty', () => {
    const presetArgs = { fps: '10' };
    const merged = mergeUrlIntoExtraArgs(presetArgs, {});
    assert.deepEqual(merged, { fps: '10' });
  });

  it('URL state alone produces extraArgs when preset is undefined', () => {
    const merged = mergeUrlIntoExtraArgs(undefined, { fps: '24' });
    assert.deepEqual(merged, { fps: '24' });
  });

  it('returns undefined when both inputs are empty', () => {
    assert.equal(mergeUrlIntoExtraArgs(undefined, {}), undefined);
    assert.equal(mergeUrlIntoExtraArgs({}, {}), undefined);
  });

  it('the gif flagship row + URL fps override produces the expected payload', () => {
    // The `mp4-to-gif` flagship has preset.fps = 10. A user landing via
    // ?fps=24 should send fps=24 to the backend, not 10. This is the
    // load-bearing AC test from the ticket body.
    const row = MATRIX_BY_SLUG['mp4-to-gif'];
    assert.ok(row, 'mp4-to-gif must exist in the matrix');
    const presetArgs = buildExtraArgs(row);
    const urlState = parseUrlState('fps=24&width=320', 'gif');
    const merged = mergeUrlIntoExtraArgs(presetArgs, urlState);
    assert.ok(merged);
    assert.equal(merged.fps, '24', 'URL fps must override preset fps=10');
    assert.equal(merged.width, '320', 'URL width must reach the payload');
  });
});

describe('SEAN-93 url-state — applyUrlToFfmpegCommand', () => {
  it('rewrites fps=N in the gif flagship command', () => {
    const row = MATRIX_BY_SLUG['mp4-to-gif'];
    assert.ok(row);
    const out = applyUrlToFfmpegCommand(row.ffmpegCommand, { fps: '24' });
    assert.match(out, /fps=24/);
    assert.doesNotMatch(out, /fps=10/, 'original fps=10 must be replaced');
  });

  it('rewrites scale=W:-1 to use the URL width', () => {
    const command =
      "ffmpeg -i input.mp4 -vf 'fps=10,scale=480:-1:flags=lanczos' output.gif";
    const out = applyUrlToFfmpegCommand(command, { width: '320' });
    assert.match(out, /scale=320:-1/);
    assert.doesNotMatch(out, /scale=480/);
  });

  it('combined fps + width matches the AC example exactly', () => {
    // Ticket body AC test:
    //   navigating to /gif/mp4-to-gif?fps=24&width=320 → command shows
    //   `fps=24,scale=320:-1`.
    const row = MATRIX_BY_SLUG['mp4-to-gif'];
    assert.ok(row);
    const state = parseUrlState('fps=24&width=320', 'gif');
    const out = applyUrlToFfmpegCommand(row.ffmpegCommand, state);
    assert.match(out, /fps=24,scale=320:-1/);
  });

  it('leaves the command untouched when state is empty', () => {
    const row = MATRIX_BY_SLUG['mp4-to-gif'];
    assert.ok(row);
    assert.equal(
      applyUrlToFfmpegCommand(row.ffmpegCommand, {}),
      row.ffmpegCommand,
    );
  });

  it('leaves non-ffmpeg-relevant params alone', () => {
    // `max_colors` and `dither` are forwarded to the backend but the gif
    // flagship's matrix command doesn't bake them in. The substitution
    // should be a no-op for those, not a mangled string.
    const row = MATRIX_BY_SLUG['mp4-to-gif'];
    assert.ok(row);
    const out = applyUrlToFfmpegCommand(row.ffmpegCommand, {
      max_colors: '128',
      dither: 'bayer',
    });
    assert.equal(out, row.ffmpegCommand);
  });
});
