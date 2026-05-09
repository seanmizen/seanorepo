// File-handling edge cases for the adaptive panel.
//
// SEAN-109 dropped the `accept=` attribute from the picker — the panel
// detects the input type from the dropped file's extension rather than
// gating it at the browser level. These tests verify the homepage hero
// drop zone (which uses the same filename-based extension detection) is
// not too restrictive: correct ext, wrong ext, capitalised, unicode,
// and no extension all behave reasonably.
//
// We intercept /api/convert so the spec doesn't need the Go backend.
// Each case asserts on what the FRONTEND does with the file — the actual
// transcode is the backend's problem.

import { expect, test } from '@playwright/test';
import { ensureFixtures, fixtureBuffer, fixturePath } from '../helpers/backend';

test.describe('file handling — adaptive panel + extension detection', () => {
  test.beforeAll(async () => {
    ensureFixtures();
  });

  /**
   * Each case drops a file with a specific (filename, content) shape on the
   * homepage hero drop zone. We then assert one of two outcomes:
   *   - 'accepted': the panel mounted the chip-row + converter (file is in
   *     a recognised matrix family and routed to a real op).
   *   - 'rejected': the panel showed the friendly error message ("we can't
   *     convert .X yet" or "no extension we can route on").
   *
   * The cases match the AC list verbatim:
   *   - correct ext (.mov)
   *   - wrong ext (.mp4 contents but named .mov)
   *   - capitalised (.MOV)
   *   - unicode filename (vidéo.mov)
   *   - no extension (vidéo with no dot)
   */
  type Case = {
    label: string;
    filename: string;
    sourceFixture: string;
    expectAcceptance: boolean;
    /** Expected operation name on the intercepted /api/convert call (when accepted). */
    expectedOp?: string;
  };

  const cases: Case[] = [
    {
      label: 'correct ext (.mov)',
      filename: 'tiny.mov',
      sourceFixture: 'tiny.mov',
      expectAcceptance: true,
      expectedOp: 'transcode',
    },
    {
      label: 'wrong ext (mp4 bytes named .mov)',
      filename: 'mislabeled.mov',
      sourceFixture: 'tiny.mp4',
      expectAcceptance: true,
      // The frontend trusts the *filename* — bytes don't matter at the
      // routing layer. So this still routes to the mov→mp4 op. (The
      // backend may reject it later; that's a different test.)
      expectedOp: 'transcode',
    },
    {
      label: 'capitalised ext (.MOV)',
      filename: 'TINY.MOV',
      sourceFixture: 'tiny.mov',
      expectAcceptance: true,
      expectedOp: 'transcode',
    },
    {
      label: 'unicode filename with valid ext',
      filename: 'vidéo-日本-🎬.mov',
      sourceFixture: 'tiny.mov',
      expectAcceptance: true,
      expectedOp: 'transcode',
    },
    {
      label: 'no extension',
      filename: 'just-a-file',
      sourceFixture: 'tiny.mov',
      expectAcceptance: false,
    },
  ];

  for (const c of cases) {
    test(c.label, async ({ page }) => {
      await page.goto('/');

      const convertCalls: { op: string; filename: string }[] = [];
      await page.route('**/api/convert', async (route) => {
        const data = route.request().postData() ?? '';
        const opMatch = data.match(/name="op"\r?\n\r?\n([\w-]+)/);
        const fileMatch = data.match(/filename="([^"]+)"/);
        convertCalls.push({
          op: opMatch?.[1] ?? '(unknown)',
          filename: fileMatch?.[1] ?? '(unknown)',
        });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: 'mock-job',
            status: 'done',
            op: opMatch?.[1] ?? 'transcode',
            output: '/jobs/mock-job/output',
          }),
        });
      });

      const fileInput = page.locator('input[type="file"]').first();
      const buf = fixtureBuffer(c.sourceFixture);
      await fileInput.setInputFiles({
        name: c.filename,
        mimeType: 'application/octet-stream',
        buffer: buf,
      });

      if (c.expectAcceptance) {
        // Accepted path: the picker mounts (HeroDrop → RunningPanel →
        // CapabilitiesPicker, post-SEAN-121). We assert the API was hit
        // with the right op.
        await expect
          .poll(() => convertCalls.length, { timeout: 10_000 })
          .toBeGreaterThan(0);
        if (c.expectedOp) {
          expect(convertCalls[0].op).toBe(c.expectedOp);
        }
        expect(convertCalls[0].filename).toBe(c.filename);
        // Friendly error must NOT have been shown.
        await expect(page.getByText(/we can't convert/i)).toHaveCount(0);
      } else {
        // Rejected path: the friendly error string is rendered. We grep
        // by visible text rather than role=alert because Next.js injects
        // its own off-screen #__next-route-announcer__ with role=alert,
        // which would trip Playwright's strict-mode locator.
        // Two flavours from `friendlyDropError`:
        //   - "That file doesn't have an extension we can route on." (no dot)
        //   - "We can't convert .X yet. We handle ..." (unknown ext)
        const friendly = page.getByText(
          /(extension we can route on|We can't convert)/,
        );
        await expect(friendly).toBeVisible({ timeout: 5_000 });
        // No conversion fired.
        expect(convertCalls.length).toBe(0);
      }
    });
  }

  test('unsupported extension (.zip) shows friendly error', async ({
    page,
  }) => {
    await page.goto('/');
    let convertHit = false;
    await page.route('**/api/convert', async (route) => {
      convertHit = true;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'should not be called' }),
      });
    });

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'archive.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('PK\x03\x04 fake zip content for routing test'),
    });

    const friendly = page.getByText(/We can't convert .zip/i);
    await expect(friendly).toBeVisible({ timeout: 5_000 });
    expect(convertHit).toBe(false);
  });

  test('slug page: drop a .png on /convert/mov-to-mp4 swaps panel via adaptive routing', async ({
    page,
  }) => {
    // SEAN-105/107 — the adaptive panel detects the input type from the
    // dropped file and re-derives the row. Dropping a `.png` on a
    // `/convert/mov-to-mp4` slug page should NOT silently fail; it should
    // either swap to an image-convert row or surface the friendly fallback.
    await page.goto('/convert/mov-to-mp4');
    const convertCalls: string[] = [];
    await page.route('**/api/convert', async (route) => {
      const data = route.request().postData() ?? '';
      const opMatch = data.match(/name="op"\r?\n\r?\n([\w-]+)/);
      const op = opMatch?.[1] ?? '(unknown)';
      convertCalls.push(op);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job_id: 'mock',
          status: 'done',
          op,
          output: '/jobs/mock/output',
        }),
      });
    });

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(fixturePath('tiny.png'));

    // Either the panel swapped (URL shows an image-convert slug, or convert
    // was called with an image-convert op) OR the friendly fallback rendered.
    // Both outcomes are acceptable per SEAN-103/SEAN-105 — what's NOT
    // acceptable is silent failure with the original `transcode` op.
    await page.waitForTimeout(2_000);
    if (convertCalls.length > 0) {
      // Should NOT be the original mov→mp4 op for a PNG file.
      expect(convertCalls[0]).not.toBe('transcode');
    } else {
      // Friendly fallback path: SEAN-108 renders a "Clear and try another
      // file" button when the dropped file has no matrix coverage.
      await expect(
        page.getByRole('button', { name: /clear and try another file/i }),
      ).toBeVisible({ timeout: 5_000 });
    }
  });
});
