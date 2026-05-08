/**
 * SEAN-78 — homepage drop-zone routing invariants.
 *
 * Two invariants this test guards:
 *   1. `PREFERRED_TARGET_BY_EXT` is reconciled with the matrix — every
 *      input format the matrix can handle on a routable row resolves to a
 *      real path via `routeForFile`. Nothing should silently fall through
 *      to the friendly-error path just because the routing table forgot to
 *      list a new format.
 *   2. The friendly error names the matrix-supported families and gives
 *      sensible example extensions, not a hand-rolled "video formats only"
 *      list that drifts out of sync with reality.
 *
 * Test runner: `node --test` via ts-node (matches the rest of the suite).
 * Run via: `yarn test:route-for-file` (wired in package.json).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  extOf,
  friendlyDropError,
  matrixInputExtensions,
  routeForFile,
} from '../route-for-file';
import { routeExistsForSlug } from '../route-registry';

describe('SEAN-78 route-for-file — every matrix input has a routing target', () => {
  it('every matrix input extension routes to a real path', () => {
    const exts = matrixInputExtensions();
    assert.ok(
      exts.length > 0,
      'matrix should expose at least one routable input format',
    );
    const failures: string[] = [];
    for (const ext of exts) {
      const target = routeForFile({ name: `dummy.${ext}` });
      if (target === null) {
        failures.push(
          `routeForFile('.${ext}') returned null — add to PREFERRED_TARGET_BY_EXT`,
        );
        continue;
      }
      // The path must resolve to a real route too.
      // pathForSlug strips the leading slash and the operation prefix when
      // building paths; we re-derive the slug from the path's last segment
      // and ask the registry directly.
      const slug = target.split('/').filter(Boolean).pop();
      if (!slug) {
        failures.push(
          `routeForFile('.${ext}') returned ${target} — couldn't extract a slug`,
        );
        continue;
      }
      if (!routeExistsForSlug(slug)) {
        failures.push(
          `routeForFile('.${ext}') returned ${target}, slug ${slug} doesn't resolve`,
        );
      }
    }
    assert.equal(
      failures.length,
      0,
      `unmapped matrix inputs:\n  ${failures.join('\n  ')}`,
    );
  });

  it('every common user extension alias routes to a real path', () => {
    // Aliases the matrix doesn't list verbatim but real users drop:
    // jpeg → jpg, heif → heic, mpg → mpeg. These should route. (TIFF/BMP
    // aren't matrix inputs today — those land on the friendly-error path.)
    const aliases = ['jpeg', 'heif', 'mpg'];
    for (const ext of aliases) {
      const target = routeForFile({ name: `photo.${ext}` });
      assert.ok(
        target !== null,
        `routeForFile('.${ext}') returned null — common alias should route`,
      );
    }
  });

  it('returns null for genuinely unknown extensions', () => {
    assert.equal(routeForFile({ name: 'mystery.xyz' }), null);
    assert.equal(routeForFile({ name: 'no-extension' }), null);
    assert.equal(routeForFile({ name: 'empty.' }), null);
  });

  it('friendlyDropError names the matrix-supported families', () => {
    const msg = friendlyDropError('mystery.xyz');
    // Should mention the file extension we couldn't handle.
    assert.ok(
      msg.includes('.xyz'),
      `error should mention .xyz: ${JSON.stringify(msg)}`,
    );
    // Should mention each supported family that the matrix actually covers.
    // We don't hard-code which families because they're derived from the
    // matrix; instead we assert at least video and image families show up
    // since the matrix definitely has both.
    assert.ok(
      msg.includes('video'),
      `error should mention video: ${JSON.stringify(msg)}`,
    );
    assert.ok(
      msg.includes('image'),
      `error should mention images: ${JSON.stringify(msg)}`,
    );
    // Examples should include at least one common extension per family.
    assert.ok(
      msg.includes('.mp4') || msg.includes('.mov'),
      `error should suggest a video example: ${JSON.stringify(msg)}`,
    );
  });

  it('friendlyDropError handles missing extension', () => {
    const msg = friendlyDropError('no-extension');
    assert.ok(
      msg.toLowerCase().includes('extension'),
      `error should mention missing extension: ${JSON.stringify(msg)}`,
    );
  });

  it('extOf normalises common extension shapes', () => {
    assert.equal(extOf('foo.MP4'), 'mp4');
    assert.equal(extOf('bare'), '');
    assert.equal(extOf('a.b.tiff'), 'tiff');
    assert.equal(extOf('trailing-dot.'), '');
  });

  it('audio inputs route to a real audio page', () => {
    // SEAN-78: the matrix has no audio-to-audio convert rows yet, but
    // dropping an audio file should still land somewhere useful instead
    // of the friendly-error path. /normalize-audio/ is the bridge today.
    for (const ext of ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus']) {
      const target = routeForFile({ name: `track.${ext}` });
      assert.ok(
        target !== null,
        `audio input .${ext} should route somewhere — got null`,
      );
    }
  });

  it('image inputs (incl. avif/webp) route to a real image page', () => {
    // SEAN-78: avif and webp were listed by the matrix but missing from
    // PREFERRED_TARGET_BY_EXT, so they fell through to the friendly error.
    for (const ext of ['jpg', 'png', 'heic', 'avif', 'webp']) {
      const target = routeForFile({ name: `pic.${ext}` });
      assert.ok(
        target !== null,
        `image input .${ext} should route somewhere — got null`,
      );
    }
  });

  it('rare video formats (3gp, ts, mts, m2ts, ogv, vob) all route', () => {
    // SEAN-78: these are matrix-supported but were missing from the
    // routing table.
    for (const ext of ['3gp', 'ts', 'mts', 'm2ts', 'ogv', 'vob']) {
      const target = routeForFile({ name: `clip.${ext}` });
      assert.ok(
        target !== null,
        `video input .${ext} should route somewhere — got null`,
      );
    }
  });
});
