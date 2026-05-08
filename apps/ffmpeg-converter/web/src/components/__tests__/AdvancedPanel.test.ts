/**
 * SEAN-95 — Advanced disclosure panel for video convert pages.
 *
 * The panel itself is JSX (mounted by ConverterPanel for `convert` rows) so
 * we can't test the disclosure UI from `node --test` without a JSDOM. What
 * we CAN test (and what bears the risk):
 *
 *   1. `hydrateFormState` — URL > defaults override order, missing fields
 *      pull from defaults, defaults missing → empty string (matches the
 *      input element shape).
 *   2. `formStateToUrl` — empty fields drop, default CRF drops (so URL
 *      stays minimal), URL contains only explicit overrides.
 *   3. URL whitelist — `convert` accepts the new `bitrate` and `codec`
 *      keys after this ticket; `gif` and `compress` continue to reject
 *      both. (Defence-in-depth against regressions to the whitelist.)
 *   4. ffmpeg command rewriting — CRF / preset / bitrate / audio_bitrate
 *      substitutions hit the actual matrix command for `mov-to-mp4`.
 *
 * Test runner: `node --test` via ts-node (matches the rest of the suite).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { MATRIX_BY_SLUG } from '../../ops/matrix';
import { formStateToUrl, hydrateFormState } from '../advanced-panel-state';
import {
  applyUrlToFfmpegCommand,
  parseUrlState,
  URL_PARAM_WHITELIST,
} from '../url-state';

describe('SEAN-95 AdvancedPanel — hydrateFormState', () => {
  const defaults = {
    crf: 23,
    preset: 'medium',
    bitrate: '',
    fps: '',
    audio_bitrate: '',
    codec: '',
  };

  it('falls through to defaults when URL state is empty', () => {
    const out = hydrateFormState({}, defaults);
    assert.equal(out.crf, '23');
    assert.equal(out.preset, 'medium');
    assert.equal(out.bitrate, '');
    assert.equal(out.fps, '');
    assert.equal(out.audio_bitrate, '');
    assert.equal(out.codec, '');
  });

  it('lets URL values override defaults per-field', () => {
    const out = hydrateFormState(
      { crf: '32', bitrate: '2M', codec: 'libx265' },
      defaults,
    );
    assert.equal(out.crf, '32', 'URL crf must win');
    assert.equal(out.bitrate, '2M');
    assert.equal(out.codec, 'libx265');
    // Untouched fields keep defaults.
    assert.equal(out.preset, 'medium');
    assert.equal(out.fps, '');
    assert.equal(out.audio_bitrate, '');
  });

  it('preserves default CRF as a string (matches the slider value attr)', () => {
    // The slider value attribute is a string; the form state mirrors that
    // so React doesn't re-render the input on every change.
    const out = hydrateFormState({}, defaults);
    assert.equal(typeof out.crf, 'string');
  });
});

describe('SEAN-95 AdvancedPanel — formStateToUrl', () => {
  const defaults = { crf: 23, preset: 'medium' };

  it('returns an empty object when nothing is customised', () => {
    const out = formStateToUrl(
      {
        crf: '23',
        preset: 'medium',
        bitrate: '',
        fps: '',
        audio_bitrate: '',
        codec: '',
      },
      defaults,
    );
    assert.deepEqual(out, {});
  });

  it('drops the default CRF (so URL stays clean)', () => {
    // Critical: every render of the panel mounts with crf=defaultCrf in the
    // form state. We must NOT push that into the URL — otherwise navigating
    // to `/convert/mov-to-mp4` once writes `?crf=23` into the bar before the
    // user has touched anything.
    const out = formStateToUrl(
      {
        crf: '23',
        preset: 'medium',
        bitrate: '',
        fps: '',
        audio_bitrate: '',
        codec: '',
      },
      defaults,
    );
    assert.equal(out.crf, undefined);
  });

  it('keeps non-default CRF', () => {
    const out = formStateToUrl(
      {
        crf: '32',
        preset: 'medium',
        bitrate: '',
        fps: '',
        audio_bitrate: '',
        codec: '',
      },
      defaults,
    );
    assert.equal(out.crf, '32');
  });

  it('writes bitrate even when defaults lack one', () => {
    const out = formStateToUrl(
      {
        crf: '23',
        preset: 'medium',
        bitrate: '2M',
        fps: '',
        audio_bitrate: '',
        codec: '',
      },
      defaults,
    );
    assert.equal(out.bitrate, '2M');
    // CRF is at default — drops out per the contract above.
    assert.equal(out.crf, undefined);
  });

  it('writes codec only when explicitly chosen', () => {
    const empty = formStateToUrl(
      {
        crf: '23',
        preset: 'medium',
        bitrate: '',
        fps: '',
        audio_bitrate: '',
        codec: '',
      },
      defaults,
    );
    assert.equal(empty.codec, undefined);

    const set = formStateToUrl(
      {
        crf: '23',
        preset: 'medium',
        bitrate: '',
        fps: '',
        audio_bitrate: '',
        codec: 'libx265',
      },
      defaults,
    );
    assert.equal(set.codec, 'libx265');
  });
});

describe('SEAN-95 url-state — convert whitelist extension', () => {
  it('accepts bitrate and codec on convert pages', () => {
    const state = parseUrlState(
      'crf=32&bitrate=2M&codec=libx265&preset=slow&fps=30&audio_bitrate=128k',
      'convert',
    );
    assert.equal(state.crf, '32');
    assert.equal(state.bitrate, '2M');
    assert.equal(state.codec, 'libx265');
    assert.equal(state.preset, 'slow');
    assert.equal(state.fps, '30');
    assert.equal(state.audio_bitrate, '128k');
  });

  it('rejects bitrate/codec on non-convert operations (gif still tight)', () => {
    const gifState = parseUrlState('bitrate=2M&codec=libx265&fps=24', 'gif');
    assert.equal(gifState.bitrate, undefined);
    assert.equal(gifState.codec, undefined);
    // fps still works on gif (it's in the gif whitelist).
    assert.equal(gifState.fps, '24');
  });

  it('whitelist for convert lists exactly the expected keys', () => {
    const expected = [
      'crf',
      'bitrate',
      'preset',
      'audio_bitrate',
      'resolution',
      'fps',
      'codec',
    ];
    assert.deepEqual(
      [...URL_PARAM_WHITELIST.convert].sort(),
      [...expected].sort(),
    );
  });
});

describe('SEAN-95 url-state — applyUrlToFfmpegCommand extensions', () => {
  it('rewrites CRF on the mov-to-mp4 flagship command', () => {
    const row = MATRIX_BY_SLUG['mov-to-mp4'];
    assert.ok(row);
    const out = applyUrlToFfmpegCommand(row.ffmpegCommand, { crf: '32' });
    assert.match(out, /-crf 32/);
    assert.doesNotMatch(out, /-crf 30/);
  });

  it('rewrites preset on the mov-to-mp4 flagship command', () => {
    const row = MATRIX_BY_SLUG['mov-to-mp4'];
    assert.ok(row);
    const out = applyUrlToFfmpegCommand(row.ffmpegCommand, { preset: 'slow' });
    assert.match(out, /-preset slow/);
    assert.doesNotMatch(out, /-preset ultrafast/);
  });

  it('bitrate replaces existing -b:v on the mp4-to-webm command', () => {
    const row = MATRIX_BY_SLUG['mp4-to-webm'];
    assert.ok(row);
    const out = applyUrlToFfmpegCommand(row.ffmpegCommand, { bitrate: '500k' });
    assert.match(out, /-b:v 500k/);
    assert.doesNotMatch(out, /-b:v 200k/);
  });

  it('bitrate inserts -b:v and drops -crf on a CRF-mode command', () => {
    const row = MATRIX_BY_SLUG['mov-to-mp4'];
    assert.ok(row);
    const out = applyUrlToFfmpegCommand(row.ffmpegCommand, { bitrate: '2M' });
    assert.match(out, /-b:v 2M/);
    assert.doesNotMatch(out, /-crf/);
    // -preset survives — it's still meaningful with bitrate-targeted encoding.
    assert.match(out, /-preset/);
  });

  it('audio_bitrate rewrites -b:a', () => {
    const row = MATRIX_BY_SLUG['mov-to-mp4'];
    assert.ok(row);
    const out = applyUrlToFfmpegCommand(row.ffmpegCommand, {
      audio_bitrate: '192k',
    });
    assert.match(out, /-b:a 192k/);
    assert.doesNotMatch(out, /-b:a 64k/);
  });

  it('combined CRF + preset matches the AC test for mov-to-mp4', () => {
    // Ticket AC: setting CRF=32 on `/convert/mov-to-mp4` produces a different
    // command than default CRF=30. The displayed command is the user-visible
    // contract — if it says CRF=32, the backend MUST run CRF=32. This is the
    // round-trip test from URL → command.
    const row = MATRIX_BY_SLUG['mov-to-mp4'];
    assert.ok(row);
    const state = parseUrlState('crf=32&preset=slow', 'convert');
    const out = applyUrlToFfmpegCommand(row.ffmpegCommand, state);
    assert.match(out, /-crf 32/);
    assert.match(out, /-preset slow/);
  });
});
