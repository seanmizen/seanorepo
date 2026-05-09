// End-to-end conversion flow: drop a fixture on a slug page, wait for the
// backend to process it, verify the download URL serves bytes.
//
// Requires the Go backend on :9876. If unreachable, the spec self-skips
// (the suite is the foundation for the AI UX Verification harness — we
// want it to run cleanly even when contributors don't have Go installed).

import { expect, test } from '@playwright/test';
import { backendIsLive, ensureFixtures, fixturePath } from '../helpers/backend';

test.describe('conversion flow', () => {
  test.beforeAll(async () => {
    ensureFixtures();
  });

  test.beforeEach(async () => {
    const live = await backendIsLive();
    test.skip(!live, 'Go backend not reachable on :9876 — skipping e2e');
  });

  test('mov→mp4: drop fixture on slug page, download bytes back', async ({
    page,
    request,
  }) => {
    await page.goto('/convert/mov-to-mp4');

    // The drop zone exposes a hidden <input type="file"> via setInputFiles.
    // We grab it via the page locator rather than role because Playwright's
    // role engine doesn't see hidden inputs.
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(fixturePath('tiny.mov'));

    // The result block surfaces a Download anchor whose accessible name
    // starts with "Download " (see ResultBlock.tsx). Wait up to 30s — a
    // 1-second tiny.mov transcodes in well under that on any machine.
    const downloadLink = page.getByRole('link', { name: /^Download / });
    await expect(downloadLink).toBeVisible({ timeout: 30_000 });

    // Pull the href and HEAD it through Playwright's APIRequestContext so
    // we don't rely on the browser's download mechanism (which writes to a
    // temp dir Playwright manages with fixtures).
    const href = await downloadLink.getAttribute('href');
    expect(href).toBeTruthy();
    if (!href) throw new Error('download link href missing');
    const absolute = href.startsWith('http')
      ? href
      : `http://localhost:4050${href}`;
    const res = await request.get(absolute);
    expect(res.ok()).toBeTruthy();
    const buf = await res.body();
    expect(buf.length).toBeGreaterThan(0);
  });
});
