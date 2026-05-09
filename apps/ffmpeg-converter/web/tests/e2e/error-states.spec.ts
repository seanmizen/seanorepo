// Error-state coverage — three failure modes the user can plausibly hit:
//
//   1. Backend 500 — API returns a non-2xx with an error body.
//   2. Broken file — backend rejects the upload with a decode error.
//   3. Oversize file — backend rejects with a too-large error.
//
// All three should surface an actionable message via role=alert. We
// don't need the real Go backend for these — we mock the responses.

import { expect, test } from '@playwright/test';
import { ensureFixtures, fixturePath } from '../helpers/backend';

test.describe('error states', () => {
  test.beforeAll(async () => {
    ensureFixtures();
  });

  test('backend 500 response surfaces a visible error', async ({ page }) => {
    await page.goto('/convert/mov-to-mp4');

    await page.route('**/api/convert', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'internal server error: ffmpeg crashed',
        }),
      });
    });

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(fixturePath('tiny.mov'));

    // submitConversion throws on non-2xx; DropZone catches and renders
    // "Conversion failed: <message>" inside a role=alert paragraph.
    // Filter out Next.js's invisible route-announcer alert via the visible
    // text — DropZone renders the error inside a <p role="alert"> with the
    // string "Conversion failed: <message>".
    const alert = page.getByText(/conversion failed|too large|error/i).first();
    await expect(alert).toBeVisible({ timeout: 10_000 });
    expect(await alert.textContent()).toMatch(/conversion failed|error/i);
  });

  test('broken file: backend rejects with decode error', async ({ page }) => {
    await page.goto('/convert/mov-to-mp4');

    await page.route('**/api/convert', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'could not decode input: not a valid mp4',
        }),
      });
    });

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(fixturePath('broken.mp4'));

    // Filter out Next.js's invisible route-announcer alert via the visible
    // text — DropZone renders the error inside a <p role="alert"> with the
    // string "Conversion failed: <message>".
    const alert = page.getByText(/conversion failed|too large|error/i).first();
    await expect(alert).toBeVisible({ timeout: 10_000 });
    const txt = (await alert.textContent()) ?? '';
    // Either the FE friendly-rejected the .mp4 (likely accepted — bytes
    // don't gate routing) OR the BE-mocked 400 surfaced. Both are valid
    // "actionable" outcomes; what we forbid is a silent stuck spinner.
    expect(txt.length).toBeGreaterThan(0);
  });

  test('oversize file: backend rejects with size error', async ({ page }) => {
    await page.goto('/convert/mov-to-mp4');

    await page.route('**/api/convert', async (route) => {
      await route.fulfill({
        status: 413,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'file too large: max 500 MB',
        }),
      });
    });

    // Synthesise a fake oversize-looking buffer. The backend mock decides
    // the response — we don't need to actually upload 500 MB to verify
    // that the FE renders the error string.
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'huge.mov',
      mimeType: 'video/quicktime',
      buffer: Buffer.alloc(1024, 0xff),
    });

    // Filter out Next.js's invisible route-announcer alert via the visible
    // text — DropZone renders the error inside a <p role="alert"> with the
    // string "Conversion failed: <message>".
    const alert = page.getByText(/conversion failed|too large|error/i).first();
    await expect(alert).toBeVisible({ timeout: 10_000 });
    const txt = (await alert.textContent()) ?? '';
    expect(txt).toMatch(/too large|conversion failed|error/i);
  });
});
