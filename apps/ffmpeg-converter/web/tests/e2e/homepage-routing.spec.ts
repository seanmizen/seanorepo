// Homepage drop routing: dropping a `.mov` on the homepage should land
// the user on `/convert/mov-to-mp4` (the matrix-derived default per
// SEAN-50/78). We exercise this without the backend by mocking the
// /api/* responses — the file_input change handler runs synchronously
// and the `<HeroDrop />` component runs its logic in the browser.

import { expect, test } from '@playwright/test';
import { ensureFixtures, fixturePath } from '../helpers/backend';

test.describe('homepage routing', () => {
  test.beforeAll(async () => {
    ensureFixtures();
  });

  test('homepage renders the hero drop zone', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', {
        name: /Drop a file here or click to browse/i,
      }),
    ).toBeVisible();
  });

  test('drop .mov on homepage → URL stays on / but conversion starts', async ({
    page,
  }) => {
    // The homepage flow runs the conversion *in place* (SEAN-75/81): the
    // URL doesn't change, but the panel mounts a `<ConverterPanel />` that
    // POSTs to /api/convert. We intercept that request to assert the
    // backend was hit with the mov-to-mp4 op — proves the routing logic
    // resolved the file's extension to the right matrix row.
    await page.goto('/');

    const convertCalls: { op: string; filename: string }[] = [];
    await page.route('**/api/convert', async (route) => {
      const req = route.request();
      const data = req.postData() ?? '';
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
          job_id: 'test-job-1',
          status: 'done',
          op: opMatch?.[1] ?? 'transcode_mp4',
          output: '/jobs/test-job-1/output',
        }),
      });
    });

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(fixturePath('tiny.mov'));

    // Wait for the picker + converter panel to mount (SEAN-81 / SEAN-121).
    // The new CapabilitiesPicker renders "What do you want to do?" above
    // the operation chips once the file is being uploaded.
    await expect(page.getByText(/what do you want to do/i)).toBeVisible({
      timeout: 10_000,
    });

    // The intercepted /api/convert call should have op=transcode — the
    // matrix's mov→mp4 row goes through that op (see ops/matrix.ts).
    await expect.poll(() => convertCalls.length).toBeGreaterThan(0);
    const call = convertCalls[0];
    expect(call.filename).toBe('tiny.mov');
    expect(call.op).toBe('transcode');

    // URL hasn't changed — homepage flow runs in place per SEAN-81.
    expect(new URL(page.url()).pathname).toBe('/');
  });
});
