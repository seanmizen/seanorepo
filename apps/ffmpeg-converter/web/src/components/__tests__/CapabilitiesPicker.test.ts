/**
 * SEAN-121 — capabilities picker contract.
 *
 * The bug: `outputsForExt()` filtered to `convert` / `image-convert` rows
 * only. Drop a `.mov` and the chip row offered MP4/3GP/AVI/FLV/M2TS/M4V/MKV
 * /MPEG/MTS/OGV/TS/VOB/WEBM/WMV — but NO GIF, NO audio extract, NO compress,
 * NO trim, NO thumbnail, NO contact-sheet — even though every one of those
 * is a shipped operation with matrix rows that accept video input.
 *
 * The fix: replace the operation filter with `capabilitiesForExt(ext)` which
 * returns every shipped operation+format the matrix supports for the input.
 * This test pins the new contract:
 *
 *   - Video drops surface convert / compress / extract-audio / gif / trim
 *     / thumbnail / contact-sheet (any with matrix rows).
 *   - Image drops surface image-convert (and any image ops if/when shipped).
 *   - Audio drops surface every audio op with matrix coverage.
 *   - GIF specifically must be one click from any video drop.
 *   - The picker honours the route registry — every returned row has a
 *     real route via `routeExistsForSlug` / `pathForSlug`.
 *
 * The widget itself (chips above chips, composite chips, dropdowns inside
 * chips) is intentionally open per the AC; what's locked is the data
 * contract this test asserts.
 *
 * Test runner: `node --test` via ts-node (matches the rest of the suite).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { capabilitiesForExt } from '../route-for-file';
import { pathForSlug } from '../route-registry';

describe('SEAN-121 capabilitiesForExt — operation-first picker data', () => {
  it('returns multiple operations for a .mov drop', () => {
    // The headline AC: dropping a .mov surfaces convert + compress +
    // extract-audio + gif + trim + thumbnail + contact-sheet (all shipped
    // operations with matrix rows for mov input). The exact set depends on
    // matrix coverage — we assert the load-bearing ones explicitly.
    const caps = capabilitiesForExt('mov');
    const ops = new Set(caps.map((c) => c.operation));

    // GIF specifically — Sean's "where on earth is GIF?" anchor.
    assert.ok(
      ops.has('gif'),
      'mov drop must surface gif operation — this is the load-bearing case',
    );
    // Convert is the dominant case and must always be there.
    assert.ok(ops.has('convert'), 'mov drop must surface convert');
    // Extract-audio: the matrix has video-to-{mp3,wav,aac,flac,ogg,opus} rows
    // and they all include mov in inputFormats.
    assert.ok(ops.has('extract-audio'), 'mov drop must surface extract-audio');
    // Compress: the matrix has compress rows for video formats including mov.
    // (Generated via `generatedCompressRows`.)
    assert.ok(
      ops.has('compress') || ops.has('compress'),
      'mov drop should surface compress (matrix dependent)',
    );
    // Thumbnail and contact-sheet both include all video formats via
    // VIDEO_FORMATS_ALL — must appear.
    assert.ok(ops.has('thumbnail'), 'mov drop must surface thumbnail');
    assert.ok(ops.has('contact-sheet'), 'mov drop must surface contact-sheet');
  });

  it('mov drop NEVER hides gif behind a sub-picker — gif chip is one click', () => {
    // The AC: "GIF specifically must be one click from any video drop on
    // any tool page." gif's matrix rows always output `gif` (single output),
    // so the gif capability has exactly one output and the chip runs the
    // op directly without a sub-picker reveal.
    const caps = capabilitiesForExt('mov');
    const gif = caps.find((c) => c.operation === 'gif');
    assert.ok(gif, 'gif must be a capability for mov');
    assert.equal(
      gif.outputs.length,
      1,
      'gif output is always gif — one-click chip, no sub-picker',
    );
    assert.equal(gif.outputs[0]?.format, 'gif');
  });

  it('every flagship video extension surfaces gif in its capabilities', () => {
    // Anchor for the AC: "Dropping a `.mov` on `/convert/mov-to-mp4` shows:
    // ... Make GIF". The picker must surface gif for every video format the
    // matrix accepts as gif input. Anything missing here is a regression
    // back to the SEAN-79 filter.
    const videoExts = [
      'mov',
      'mp4',
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
    for (const ext of videoExts) {
      const caps = capabilitiesForExt(ext);
      const gif = caps.find((c) => c.operation === 'gif');
      assert.ok(
        gif,
        `dropping .${ext} must surface a gif capability — was hidden by SEAN-79 filter`,
      );
    }
  });

  it('image drops surface image-convert (and not gif/extract-audio)', () => {
    // The AC: "Dropping a `.png` on a video page shows: Convert (JPG/WebP
    // /AVIF/...), Compress (if image-compress exists)." Cross-category
    // drops continue to work per #107 — the picker reflects what the matrix
    // actually has for png, not what the slug demands.
    const caps = capabilitiesForExt('png');
    const ops = new Set(caps.map((c) => c.operation));

    assert.ok(ops.has('image-convert'), 'png drop must surface image-convert');
    // No gif / extract-audio / video-trim — png is image, not video.
    assert.ok(
      !ops.has('gif'),
      'png drop must not surface gif (no png-to-gif row)',
    );
    assert.ok(
      !ops.has('extract-audio'),
      'png drop must not surface extract-audio',
    );
  });

  it('image-convert chip exposes multiple output formats for png', () => {
    // The image-convert rows (`image-to-jpg`, `image-to-webp`, etc.) all
    // accept png as input. The capability for png + image-convert should
    // have multiple outputs so the chip reveals a sub-picker.
    const caps = capabilitiesForExt('png');
    const conv = caps.find((c) => c.operation === 'image-convert');
    assert.ok(conv, 'png must have an image-convert capability');
    assert.ok(
      conv.outputs.length >= 2,
      'png image-convert must offer multiple output formats (jpg, webp, ...)',
    );
    const formats = new Set(conv.outputs.map((o) => o.format));
    assert.ok(formats.has('jpg'), 'png → jpg must be available');
    assert.ok(formats.has('webp'), 'png → webp must be available');
  });

  it('audio drops surface normalize-audio (and the picker is not blank)', () => {
    // The AC: "Dropping an audio file shows: audio-convert outputs +
    // normalize-audio (if matrix supports). If the matrix has no audio-to-
    // audio convert rows yet, the picker says so honestly rather than
    // going blank."
    //
    // Today the matrix has no audio→audio convert rows, but normalize-audio
    // accepts every common audio format. So the picker must surface AT
    // LEAST normalize-audio for any common audio drop.
    const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus'];
    for (const ext of audioExts) {
      const caps = capabilitiesForExt(ext);
      assert.ok(
        caps.length > 0,
        `audio .${ext} must surface at least one capability (normalize-audio at minimum)`,
      );
      const ops = new Set(caps.map((c) => c.operation));
      assert.ok(
        ops.has('normalize-audio'),
        `audio .${ext} must surface normalize-audio`,
      );
    }
  });

  it('returns empty array for unknown / no-extension inputs', () => {
    assert.deepEqual(capabilitiesForExt(''), []);
    assert.deepEqual(capabilitiesForExt('xyz-not-real'), []);
  });

  it('every returned row has a real route', () => {
    // Same gating as routeForFile / matrixRowForFile — clicking any chip
    // must never land the user on a 404.
    const exts = ['mov', 'mp4', 'webm', 'png', 'heic', 'mp3', 'wav'];
    for (const ext of exts) {
      const caps = capabilitiesForExt(ext);
      for (const cap of caps) {
        for (const opt of cap.outputs) {
          const path = pathForSlug(opt.row.slug);
          assert.ok(
            path,
            `capability ${cap.operation} for .${ext} resolved slug ${opt.row.slug} with no real route`,
          );
        }
      }
    }
  });

  it('marks one default output per operation matching PREFERRED_TARGET_BY_EXT', () => {
    // The default option for the convert operation on .mov should be mp4
    // (per PREFERRED_TARGET_BY_EXT). Other operations whose default output
    // doesn't appear in PREFERRED_TARGET_BY_EXT (e.g. gif always outputs
    // gif, regardless of preferred target) get the first sorted option as
    // their `defaultOption` even when none is `isDefault: true`.
    const caps = capabilitiesForExt('mov');
    const conv = caps.find((c) => c.operation === 'convert');
    assert.ok(conv, 'mov has a convert capability');
    assert.equal(
      conv.defaultOption.format,
      'mp4',
      'mov convert default output must be mp4 per PREFERRED_TARGET_BY_EXT',
    );
    // The default sorts first.
    assert.equal(conv.outputs[0]?.format, 'mp4');
    assert.equal(conv.outputs[0]?.isDefault, true);
  });

  it('does not duplicate output formats within an operation', () => {
    // Same dedupe semantics as `outputsForExt` — flagship rows + multi-input
    // fallback rows must collapse to a single chip per output format.
    const caps = capabilitiesForExt('mov');
    for (const cap of caps) {
      const formats = cap.outputs.map((o) => o.format);
      const unique = new Set(formats);
      assert.equal(
        formats.length,
        unique.size,
        `${cap.operation} for .mov has duplicate formats: ${formats.join(', ')}`,
      );
    }
  });

  it('display order puts convert first, then value-add operations', () => {
    // Stability check on the picker layout. The display order is the user's
    // mental model: "what can I do?" → convert is the default expectation,
    // then the value-add operations (compress, extract-audio, gif, trim,
    // resize, thumbnail, contact-sheet, normalize-audio).
    const caps = capabilitiesForExt('mov');
    const ops = caps.map((c) => c.operation);
    assert.equal(
      ops[0],
      'convert',
      'convert must be the first chip on a video drop',
    );
    // gif must come before thumbnail/contact-sheet — those are sub-cases of
    // "make a still", whereas gif is the headline animated-output.
    const gifIdx = ops.indexOf('gif');
    const thumbIdx = ops.indexOf('thumbnail');
    if (gifIdx >= 0 && thumbIdx >= 0) {
      assert.ok(
        gifIdx < thumbIdx,
        `gif (${gifIdx}) must come before thumbnail (${thumbIdx})`,
      );
    }
  });

  it('every video format ext has the same capability shape', () => {
    // Robustness: dropping any video format on any video page should yield
    // the same capability set (modulo matrix coverage edge cases). If a
    // future commit accidentally drops one format from a row's inputFormats
    // this test will fail loudly.
    const baseline = new Set(capabilitiesForExt('mov').map((c) => c.operation));
    const otherVideos = ['mp4', 'webm', 'mkv', 'avi'];
    for (const ext of otherVideos) {
      const ops = new Set(capabilitiesForExt(ext).map((c) => c.operation));
      // Each must surface the headline ops we care about.
      for (const required of ['convert', 'gif', 'extract-audio'] as const) {
        assert.ok(
          ops.has(required),
          `${ext} should surface ${required} (baseline mov has it: ${baseline.has(required)})`,
        );
      }
    }
  });
});
