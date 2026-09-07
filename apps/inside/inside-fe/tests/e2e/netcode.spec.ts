import { expect, test } from '@playwright/test';
import { waitForApp } from './helpers';

const PROFILE = '/designers/northlight-architects';

test.describe('a request that never answers', () => {
  test('becomes a failure the visitor can see, not a spinner forever', async ({
    page,
  }) => {
    // Held open indefinitely. Before REQ-NET-002 there was no timeout, so the
    // promise never settled, retry never fired, and the query sat in isPending
    // with no failure state to render at all.
    await page.route('**/api/designers/**', () => {
      // Deliberately never fulfilled or aborted.
    });

    await page.goto(PROFILE);

    // Must appear on the FIRST deadline, not after retries: a timeout is not
    // retried precisely so the visitor is told at 15s rather than at 45s.
    await expect(page.getByTestId('designer-missing')).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByTestId('designer-missing')).toHaveText(
      /did not answer in time|too long/i,
    );
  });
});

test.describe('a server fault', () => {
  test('does not claim the studio is unlisted', async ({ page }) => {
    await page.route('**/api/designers/**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Something went wrong at our end.' }),
      }),
    );

    await page.goto(PROFILE);
    const alert = page.getByTestId('designer-missing');
    await expect(alert).toBeVisible();

    // The whole point of REQ-NET-007: this used to say "That studio is not
    // listed" — the app asserting something it had not verified, one layer up
    // from where REQ-STATE-003 was being applied.
    await expect(alert).not.toHaveText(/not listed/i);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /our end/i,
    );
  });

  test('an unreachable server reads as a connection problem', async ({
    page,
  }) => {
    await page.route('**/api/designers/**', (route) => route.abort('failed'));

    await page.goto(PROFILE);
    await expect(page.getByTestId('designer-missing')).toHaveText(
      /could not reach|connection/i,
    );
  });
});

test.describe('a genuine 404', () => {
  test('still says the studio is not listed', async ({ page }) => {
    // The honest case must survive the change — this is the one message that
    // was always correct.
    await page.goto('/designers/no-such-studio-at-all');
    await waitForApp(page);

    await expect(page.getByTestId('designer-missing')).toHaveText(
      /not listed/i,
    );
  });
});

test.describe('request correlation', () => {
  test('every API response carries an id the logs can be searched by', async ({
    page,
  }) => {
    const ids: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/')) {
        const id = response.headers()['x-request-id'];
        if (id) ids.push(id);
      }
    });

    await page.goto('/designers');
    await waitForApp(page);

    expect(ids.length).toBeGreaterThan(0);
    // Distinct per request, so one id identifies one thing.
    expect(new Set(ids).size).toBe(ids.length);
  });
});
