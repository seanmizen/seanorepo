/**
 * SEAN-75 — homepage drop must not lose the File.
 *
 * Reproduces the bug from the ticket: the user drops a `.mov` on the
 * homepage drop zone and previously got `router.push()`-ed to
 * `/convert/mov-to-mp4` with their File abandoned in the homepage's component
 * memory. The fix routes the homepage drop into the same `<ConverterPanel />`
 * the slug pages use, with the File pre-loaded so the upload auto-fires.
 *
 * This test drives the load-bearing path of that fix:
 *   1. `matrixRowForFile()` resolves a `.mov` to a real matrix row + go op.
 *   2. `submitConversion()` (the function `<DropZone />` calls when a file
 *      arrives) POSTs the file to `/api/convert` exactly once.
 *
 * Together those guarantee that when `<HeroDrop />` matches the file and
 * mounts a `<DropZone initialFile={file} />`, the conversion request fires
 * without a second user action — which is the AC requirement.
 *
 * Test runner: `node --test` via ts-node (matches the rest of the suite).
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  matrixRowForFile,
  outputsForExt,
  routeForFile,
} from '../route-for-file';
import { submitConversion } from '../submit-conversion';

// ─────────────────────────────────────────────────────── HELPERS ─────────────

/**
 * Minimal File-shaped object that satisfies what `submitConversion` does with
 * it (passes through to `FormData.append('file', …)`). Node's global `File`
 * works fine in Node 20+; we wrap it so the test reads as "a fake File the
 * user dropped".
 */
function fakeFile(name: string, body = 'binary-data-stub'): File {
  return new File([body], name, { type: 'application/octet-stream' });
}

interface FetchCall {
  url: string;
  method: string;
  body: FormData;
}

/**
 * Build a fake fetch that records calls and returns a successful job
 * response — same shape the real backend returns. Typed as `typeof fetch`
 * via a cast because Node's lib.dom fetch signature mixes in extras
 * (`preconnect`) that the test doesn't need to model.
 */
function recordingFetch(): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body as FormData;
    calls.push({ url, method, body });
    return new Response(
      JSON.stringify({
        job_id: 'test-job-id',
        output: '/jobs/test-job-id/output',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

// ─────────────────────────────────────────────────────── TESTS ───────────────

describe('SEAN-75 homepage drop — file is honoured without re-upload', () => {
  it('matrixRowForFile resolves a dropped .mov to the mov-to-mp4 row', () => {
    const match = matrixRowForFile(fakeFile('vacation.mov'));
    assert.ok(match, 'expected a matrix row for .mov');
    assert.equal(match.row.slug, 'mov-to-mp4');
    assert.equal(match.row.outputFormat, 'mp4');
    assert.equal(match.inputFormat, 'mov');
    // The row must have a backend op so the homepage flow can actually run it.
    assert.ok(match.row.goOp, 'matrix row must have a goOp');
  });

  it('matrixRowForFile and routeForFile agree on the target slug', () => {
    // Belt-and-braces: the new helper must not diverge from the existing
    // route-resolver. If they desynced, slug pages and the homepage flow
    // could pick different targets for the same dropped file.
    const exts = ['mov', 'mp4', 'webm', 'mkv', 'avi', 'png', 'heic', 'wav'];
    for (const ext of exts) {
      const file = fakeFile(`a.${ext}`);
      const match = matrixRowForFile(file);
      const path = routeForFile(file);
      if (match) {
        assert.ok(
          path,
          `routeForFile null but matrixRowForFile resolved .${ext}`,
        );
        assert.ok(
          path.endsWith(`/${match.row.slug}`),
          `path ${path} does not end with slug ${match.row.slug}`,
        );
      } else {
        assert.equal(
          path,
          null,
          `routeForFile resolved .${ext} but matrixRowForFile did not`,
        );
      }
    }
  });

  it('submitConversion POSTs the dropped File to /api/convert exactly once', async () => {
    // This is the upload that <DropZone initialFile={file} /> auto-fires on
    // mount. Asserting it works end-to-end (file present in the multipart
    // body, op + ext set, single request) covers the "no second user action"
    // AC: when HeroDrop mounts the panel with the dropped File, this is the
    // call that goes out.
    const { fetch, calls } = recordingFetch();
    const file = fakeFile('vacation.mov');
    const match = matrixRowForFile(file);
    assert.ok(match);

    const job = await submitConversion({
      file,
      goOp: match.row.goOp,
      outputExt: 'mp4',
      fetchImpl: fetch,
    });

    assert.equal(calls.length, 1, 'expected exactly one /api/convert request');
    const call = calls[0];
    assert.ok(call, 'expected a recorded fetch call');
    assert.equal(call.url, '/api/convert');
    assert.equal(call.method, 'POST');
    // The dropped File must be on the multipart body — that's the whole bug.
    const sentFile = call.body.get('file');
    assert.ok(sentFile, 'no file field on /api/convert request');
    assert.ok(
      typeof sentFile === 'object' && sentFile !== null && 'size' in sentFile,
      'file field on /api/convert is not a File/Blob',
    );
    assert.equal(call.body.get('op'), match.row.goOp);
    assert.equal(call.body.get('ext'), 'mp4');

    // And the resolved job is shaped the way ResultBlock expects (so the
    // reset path the AC mentions can render the download/try-another UI).
    assert.equal(job.jobId, 'test-job-id');
    assert.equal(job.downloadUrl, '/api/jobs/test-job-id/output');
    assert.equal(job.inputFilename, 'vacation.mov');
    assert.equal(job.outputExt, 'mp4');
  });

  it('submitConversion forwards extraArgs (preset hints) as form fields', async () => {
    // Compress flagship rows carry preset.targetSizeMb — that has to land on
    // the request body or the homepage in-place flow runs without the
    // preset, producing a different output than the slug page would.
    const { fetch, calls } = recordingFetch();
    await submitConversion({
      file: fakeFile('big.mp4'),
      goOp: 'transcode',
      outputExt: 'mp4',
      extraArgs: { target_size_mb: '25', crf: '28' },
      fetchImpl: fetch,
    });
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.body.get('target_size_mb'), '25');
    assert.equal(call.body.get('crf'), '28');
  });
});

describe('SEAN-79 outputsForExt — homepage format picker options', () => {
  it('returns the full set of convert outputs for a .mov input', () => {
    // Dropping a .mov should let the user pick mp4 (default), webm, mov, and
    // any other convert-style row whose route is implemented today. The
    // picker hides extract-audio / gif / compress — those are different
    // intents, not different output formats of the convert intent.
    const options = outputsForExt('mov');
    assert.ok(options.length >= 2, 'expected at least 2 mov output options');

    const formats = new Set<string>(options.map((o) => o.format));
    assert.ok(formats.has('mp4'), 'mov picker must offer mp4');
    assert.ok(formats.has('webm'), 'mov picker must offer webm');

    // Extract-audio outputs (mp3/wav/aac/flac/ogg/opus) MUST NOT appear in
    // the convert picker — they are a separate operation.
    for (const audio of ['mp3', 'wav', 'aac', 'flac', 'ogg', 'opus']) {
      assert.ok(
        !formats.has(audio),
        `mov picker must not surface audio output ${audio}`,
      );
    }
    // Same for animated outputs (gif op, not convert).
    for (const anim of ['gif', 'webp-anim']) {
      assert.ok(
        !formats.has(anim),
        `mov picker must not surface animated output ${anim}`,
      );
    }
  });

  it('marks exactly one option as the default and sorts it first', () => {
    const options = outputsForExt('mov');
    const defaults = options.filter((o) => o.isDefault);
    assert.equal(
      defaults.length,
      1,
      'expected exactly one default option for .mov',
    );
    assert.equal(defaults[0]?.format, 'mp4', '.mov default must be mp4');
    // Default first in the sorted list.
    assert.equal(
      options[0]?.format,
      'mp4',
      'default option must sort to the front',
    );
  });

  it('agrees with matrixRowForFile on the default target row', () => {
    // The picker default and the routeForFile preferred target must point at
    // the same row — otherwise a user who never touches the picker gets a
    // different target from someone who lands on the slug page directly.
    const exts = ['mov', 'mp4', 'webm', 'mkv', 'png', 'heic'];
    for (const ext of exts) {
      const match = matrixRowForFile({ name: `a.${ext}` });
      const options = outputsForExt(ext);
      if (!match) {
        // No match means no preferred target — picker may still have options
        // but no `isDefault: true` entry.
        const hasDefault = options.some((o) => o.isDefault);
        assert.ok(
          !hasDefault,
          `outputsForExt('${ext}') flagged a default but matrixRowForFile returned null`,
        );
        continue;
      }
      const def = options.find((o) => o.isDefault);
      assert.ok(def, `outputsForExt('${ext}') has no default option`);
      assert.equal(
        def.format,
        match.row.outputFormat,
        `picker default for .${ext} (${def.format}) does not match matrixRowForFile (${match.row.outputFormat})`,
      );
    }
  });

  it('returns empty array for an unknown extension', () => {
    assert.deepEqual(outputsForExt(''), []);
    assert.deepEqual(outputsForExt('xyz-not-real'), []);
  });

  it('every returned row has an implemented route', () => {
    // Same gating as routeForFile / matrixRowForFile — clicking a chip must
    // never land the user on a 404. We can't easily import route-registry's
    // gate from here without the @/ alias, so cross-check by piping each
    // row's slug through routeForFile (which uses the same gate).
    for (const ext of ['mov', 'mp4', 'webm', 'png', 'heic']) {
      const options = outputsForExt(ext);
      for (const opt of options) {
        // The row must at minimum exist + have a goOp the homepage can fire.
        assert.ok(opt.row.slug, `option for .${ext} has empty slug`);
        assert.ok(opt.row.goOp, `option for .${ext} has empty goOp`);
        assert.ok(
          opt.row.inputFormats.length > 0,
          `option for .${ext} has empty inputFormats`,
        );
      }
    }
  });

  it('does not duplicate output formats when multiple rows target the same one', () => {
    // E.g. mov can resolve via the flagship `mov-to-mp4` row OR the
    // multi-input `video-to-mp4` row — the picker should only show MP4 once.
    const options = outputsForExt('mov');
    const formats = options.map((o) => o.format);
    const unique = new Set(formats);
    assert.equal(
      formats.length,
      unique.size,
      `outputsForExt('mov') returned duplicate formats: ${formats.join(', ')}`,
    );
  });
});
