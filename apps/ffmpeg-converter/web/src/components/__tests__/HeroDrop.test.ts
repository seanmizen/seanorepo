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

import { matrixRowForFile, routeForFile } from '../route-for-file';
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
