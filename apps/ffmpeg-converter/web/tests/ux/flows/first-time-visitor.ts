// First-time visitor flow — cold-load the homepage, drop a fixture file
// onto the hero drop zone, wait for the result block, capture the
// download. Mirrors the highest-traffic real-user path.
//
// Each step is defined as a CaptureStep. The harness in `capture.ts`
// drives the page through them and snapshots the evidence after each
// step lands.

import path from 'node:path';
import type { Flow } from '../capture';

const FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'fixtures',
  'tiny.mov',
);

export const firstTimeVisitorFlow: Flow = {
  name: 'first-time-visitor',
  description:
    'Cold-land homepage, drop tiny.mov on the hero drop zone, wait for the result block, capture download URL.',
  steps: [
    {
      name: 'cold-landing',
      description:
        'Initial paint of the homepage with no prior interaction. Captures first-paint clarity and CTA salience.',
      async run(page) {
        await page.goto('/');
        // Wait for the hero drop zone to be present so the screenshot
        // captures the rendered UI rather than a hydration flash.
        await page.locator('input[type="file"]').first().waitFor({
          state: 'attached',
          timeout: 15_000,
        });
      },
    },
    {
      name: 'drop-file',
      description:
        'Dropping tiny.mov on the homepage hero drop zone triggers adaptive routing.',
      async run(page) {
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(FIXTURE_PATH);
        // Either the chip row mounts or the friendly fallback appears —
        // both are acceptable. Wait for either.
        await page
          .waitForFunction(
            () => {
              const t = document.body.innerText;
              return (
                /Download/i.test(t) ||
                /converting/i.test(t) ||
                /clear and try another/i.test(t) ||
                /we can't convert/i.test(t)
              );
            },
            { timeout: 20_000 },
          )
          .catch(() => {
            // Fall through to capture even if nothing changed — the
            // screenshot itself will diagnose the wait state.
          });
      },
    },
    {
      name: 'result-block',
      description:
        'After the conversion completes, the result block surfaces a download anchor.',
      async run(page) {
        // Best-effort wait for the download link. If the backend is offline
        // the harness still captures whatever final state the page reached
        // — that\'s diagnostic too.
        await page
          .getByRole('link', { name: /^Download / })
          .waitFor({ state: 'visible', timeout: 30_000 })
          .catch(() => {
            // No download link materialised. Still capture the page state.
          });
      },
    },
  ],
};

export default firstTimeVisitorFlow;
