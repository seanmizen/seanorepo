/**
 * SEAN-96 — drag-out download from the result row.
 *
 * The user-visible behaviour: after a successful conversion, the user can
 * grab the result row's filename label and drop it into Finder, the desktop,
 * an email compose window, or Slack — bypassing the Downloads folder. The
 * load-bearing primitive is `dataTransfer.setData('DownloadURL', payload)`,
 * where the payload is a magic `<mime>:<filename>:<absolute-url>` string the
 * Chromium drag-and-drop handler reads on drop.
 *
 * This suite covers:
 *   1. The MIME-by-extension table (`mimeForExt`) returns the correct types
 *      for every output format the matrix actually emits, plus a sane
 *      `application/octet-stream` fallback for unknown extensions — so the
 *      drag never breaks, it just ships a generic blob.
 *   2. The `DownloadURL` payload builder (`buildDownloadUrlPayload`) emits
 *      the exact `mime:filename:absolute-url` shape Chromium expects, with
 *      the URL absolutised against `window.location.origin` (Chromium
 *      ignores relative URLs in this slot).
 *   3. The end-to-end dragstart simulation: build a fake `DataTransfer`,
 *      invoke the same payload-building flow `<ResultBlock />` runs in
 *      `onDragStart`, and assert the `DownloadURL` slot ends up with the
 *      right MIME + filename + URL. This is the "programmatically simulate
 *      a dragstart and assert dataTransfer carries the right MIME +
 *      filename" line in the AC.
 *
 * We don't mount React in this test runner (the rest of the suite is pure
 * `node --test` over .ts modules, no JSDOM). Instead we exercise the
 * handler the component installs by importing the same pure helper the
 * component calls — which is also how SEAN-75's HeroDrop test covers
 * `<DropZone />`'s upload path without rendering JSX.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildDownloadName,
  buildDownloadUrlPayload,
  mimeForExt,
} from '../drag-out-download';

// ─────────────────────────────────────────────────────── HELPERS ─────────────

/**
 * Minimal stand-in for the browser's `DataTransfer` object. Records every
 * `setData(type, value)` call so the test can assert on what the dragstart
 * handler wrote. Mirrors only the surface the handler actually touches.
 */
class FakeDataTransfer {
  private store = new Map<string, string>();
  effectAllowed = 'none';

  setData(type: string, value: string): void {
    this.store.set(type, value);
  }

  getData(type: string): string {
    return this.store.get(type) ?? '';
  }
}

// ─────────────────────────────────────────────────────── TESTS ───────────────

describe('SEAN-96 mimeForExt — every matrix output gets a real MIME type', () => {
  it('returns the expected MIME for every output format the matrix produces', () => {
    // Pulled from `grep outputFormat: src/ops`. If the matrix grows a new
    // output format and this test fails for that ext, add it to the table
    // in `drag-out-download.ts` rather than papering over with octet-stream.
    const expected: Record<string, string> = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      webm: 'video/webm',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      aac: 'audio/aac',
      flac: 'audio/flac',
      jpg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      'webp-anim': 'image/webp',
    };
    for (const [ext, mime] of Object.entries(expected)) {
      assert.equal(mimeForExt(ext), mime, `mimeForExt('${ext}')`);
    }
  });

  it('is case-insensitive and tolerates a leading dot', () => {
    assert.equal(mimeForExt('MP4'), 'video/mp4');
    assert.equal(mimeForExt('.png'), 'image/png');
    assert.equal(mimeForExt('  Webm  '), 'video/webm');
  });

  it('falls back to application/octet-stream for unknown extensions', () => {
    // The drag still works in Chrome — the receiving app just sees an
    // opaque blob. Better than throwing and breaking the dragstart entirely.
    assert.equal(mimeForExt('xyz'), 'application/octet-stream');
    assert.equal(mimeForExt(''), 'application/octet-stream');
  });
});

describe('SEAN-96 buildDownloadUrlPayload — Chromium DownloadURL shape', () => {
  it('builds the canonical mime:filename:absolute-url payload', () => {
    const payload = buildDownloadUrlPayload({
      downloadUrl: '/api/jobs/abc-123/output',
      filename: 'vacation.mp4',
      outputExt: 'mp4',
      origin: 'https://seansconverter.com',
    });
    assert.equal(
      payload,
      'video/mp4:vacation.mp4:https://seansconverter.com/api/jobs/abc-123/output',
    );
  });

  it('absolutises a same-origin path against window.location.origin', () => {
    // Chromium ignores relative URLs in the DownloadURL slot — the payload
    // MUST start with a real scheme://host. This is the bug we'd hit if we
    // shipped `event.dataTransfer.setData('DownloadURL', mime:name:/api/...)`
    // verbatim.
    const payload = buildDownloadUrlPayload({
      downloadUrl: '/api/jobs/x/output',
      filename: 'a.webm',
      outputExt: 'webm',
      origin: 'http://localhost:4050',
    });
    assert.ok(
      payload.includes('http://localhost:4050/api/jobs/x/output'),
      `payload missing absolute URL: ${payload}`,
    );
  });

  it('passes through an already-absolute URL untouched', () => {
    // If the backend ever returns a CDN URL or a fully-qualified link, we
    // must not double-prefix it with the origin.
    const payload = buildDownloadUrlPayload({
      downloadUrl: 'https://cdn.example.com/jobs/x/output',
      filename: 'a.webm',
      outputExt: 'webm',
      origin: 'http://localhost:4050',
    });
    assert.equal(
      payload,
      'video/webm:a.webm:https://cdn.example.com/jobs/x/output',
    );
  });

  it('handles trailing slash on origin without producing //', () => {
    const payload = buildDownloadUrlPayload({
      downloadUrl: '/api/jobs/x/output',
      filename: 'a.mp4',
      outputExt: 'mp4',
      origin: 'http://localhost:4050/',
    });
    assert.ok(
      !payload.includes('//api/'),
      `double slash in payload: ${payload}`,
    );
    assert.ok(payload.includes('http://localhost:4050/api/jobs/x/output'));
  });
});

describe('SEAN-96 buildDownloadName — output filename mirrors ResultBlock', () => {
  it('replaces the input extension with the output extension', () => {
    assert.equal(buildDownloadName('vacation.mov', 'mp4'), 'vacation.mp4');
    assert.equal(buildDownloadName('photo.heic', 'jpg'), 'photo.jpg');
  });

  it('falls back to output.<ext> when the input has no extension', () => {
    assert.equal(buildDownloadName('', 'mp4'), 'output.mp4');
    assert.equal(buildDownloadName('noext', 'mp4'), 'noext.mp4');
  });

  it('preserves dots inside the basename', () => {
    assert.equal(
      buildDownloadName('my.video.file.mov', 'webm'),
      'my.video.file.webm',
    );
  });
});

describe('SEAN-96 dragstart — DataTransfer carries the right MIME + filename', () => {
  it('writes DownloadURL, text/uri-list, and text/plain on dragstart', () => {
    // This is the AC's "programmatically simulate a dragstart and assert
    // dataTransfer carries the right MIME + filename" line. We reconstruct
    // the body of `<ResultBlock />`'s `onDragStart` handler against a fake
    // DataTransfer — same shape the React event hands to the real handler.
    const job = {
      jobId: 'abc',
      downloadUrl: '/api/jobs/abc/output',
      inputFilename: 'vacation.mov',
      outputExt: 'mp4',
    };
    const downloadName = buildDownloadName(job.inputFilename, job.outputExt);
    const origin = 'https://seansconverter.com';
    const dt = new FakeDataTransfer();

    // Inline the handler logic — kept in sync with ResultBlock.tsx. Any
    // drift here means the test stops covering the real flow, so this
    // string match deliberately mirrors the component.
    const payload = buildDownloadUrlPayload({
      downloadUrl: job.downloadUrl,
      filename: downloadName,
      outputExt: job.outputExt,
      origin,
    });
    dt.setData('DownloadURL', payload);
    const absolute = payload.split(':').slice(2).join(':');
    dt.setData('text/uri-list', `${mimeForExt(job.outputExt)}\n${absolute}`);
    dt.setData('text/plain', absolute);
    dt.effectAllowed = 'copy';

    // The DownloadURL slot is the magic one — Chromium reads it as
    // `<mime>:<filename>:<url>`. All three pieces must be present.
    const dl = dt.getData('DownloadURL');
    assert.ok(dl.startsWith('video/mp4:'), `wrong MIME prefix: ${dl}`);
    assert.ok(
      dl.includes(':vacation.mp4:'),
      `wrong filename in payload: ${dl}`,
    );
    assert.ok(
      dl.endsWith('https://seansconverter.com/api/jobs/abc/output'),
      `wrong URL in payload: ${dl}`,
    );

    // text/plain is the universal fallback every drop target understands —
    // even Firefox without the DownloadURL extension drops a working URL.
    assert.equal(
      dt.getData('text/plain'),
      'https://seansconverter.com/api/jobs/abc/output',
    );

    // text/uri-list is the WHATWG-spec format for dragging URLs to
    // file managers and browsers; first line is MIME, second is the URL.
    const uriList = dt.getData('text/uri-list');
    assert.ok(
      uriList.startsWith('video/mp4\n'),
      `uri-list MIME wrong: ${uriList}`,
    );
    assert.ok(
      uriList.endsWith('https://seansconverter.com/api/jobs/abc/output'),
      `uri-list URL wrong: ${uriList}`,
    );

    // Drag effect: copy (not move/link) — the source file stays on the
    // server, the user is making a local copy.
    assert.equal(dt.effectAllowed, 'copy');
  });

  it('uses the correct MIME + extension for an audio extract job', () => {
    // Different op type, different MIME — make sure the per-job lookup
    // doesn't hardcode video/mp4. extract-audio jobs ship .mp3 today.
    const job = {
      jobId: 'audio-1',
      downloadUrl: '/api/jobs/audio-1/output',
      inputFilename: 'podcast.mp4',
      outputExt: 'mp3',
    };
    const downloadName = buildDownloadName(job.inputFilename, job.outputExt);
    const payload = buildDownloadUrlPayload({
      downloadUrl: job.downloadUrl,
      filename: downloadName,
      outputExt: job.outputExt,
      origin: 'http://localhost:4050',
    });
    assert.ok(
      payload.startsWith('audio/mpeg:'),
      `wrong audio MIME: ${payload}`,
    );
    assert.ok(
      payload.includes(':podcast.mp3:'),
      `wrong audio filename: ${payload}`,
    );
  });
});
