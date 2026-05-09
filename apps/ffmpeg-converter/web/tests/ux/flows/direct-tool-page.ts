// Direct-tool-page flow — a user lands on `/convert/mov-to-mp4` directly
// (e.g. from a Google search hit), drops a file, downloads the result.
// This is the "deep link" path: the slug-page UI must work just as
// cleanly as the homepage for SEO traffic to convert.

import path from 'node:path';
import type { Flow } from '../capture';

const FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'fixtures',
  'tiny.mov',
);

export const directToolPageFlow: Flow = {
  name: 'direct-tool-page',
  description:
    'Cold-land /convert/mov-to-mp4, drop tiny.mov, wait for download anchor.',
  steps: [
    {
      name: 'cold-slug-landing',
      description:
        'Direct hit on /convert/mov-to-mp4 — captures whether the slug page communicates the tool unambiguously.',
      async run(page) {
        await page.goto('/convert/mov-to-mp4');
        await page.locator('input[type="file"]').first().waitFor({
          state: 'attached',
          timeout: 15_000,
        });
      },
    },
    {
      name: 'drop-fixture',
      description: 'Drop tiny.mov on the slug page drop zone.',
      async run(page) {
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(FIXTURE_PATH);
        await page
          .waitForFunction(
            () => {
              const t = document.body.innerText;
              return /Download/i.test(t) || /converting/i.test(t);
            },
            { timeout: 20_000 },
          )
          .catch(() => {});
      },
    },
    {
      name: 'download',
      description:
        'Result block visible — the user can grab the converted file in one click.',
      async run(page) {
        await page
          .getByRole('link', { name: /^Download / })
          .waitFor({ state: 'visible', timeout: 30_000 })
          .catch(() => {});
      },
    },
  ],
};

export default directToolPageFlow;
