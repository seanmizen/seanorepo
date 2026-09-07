import { expect, test } from '@playwright/test';
import { waitForApp } from './helpers';

const PROFILE = '/designers/northlight-architects';

test.describe('going offline', () => {
  test('says so once, at app level, rather than once per failed page', async ({
    page,
    context,
  }) => {
    await page.goto('/designers');
    await waitForApp(page);

    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible({
      timeout: 15_000,
    });

    // The point of the banner: ONE statement about the network. Before it,
    // losing connection produced a separate "not listed" on every page in
    // flight — six honest-looking messages, all wrong, for one cause.
    await expect(page.getByTestId('designers-error')).toHaveCount(0);
  });

  test('recovers without a manual refresh', async ({ page, context }) => {
    await page.goto('/designers');
    await waitForApp(page);

    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible({
      timeout: 15_000,
    });

    await context.setOffline(false);
    await expect(page.getByTestId('offline-banner')).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});

test.describe('a failure offers a control that actually retries', () => {
  test('the retry button refetches, and succeeds once the server does', async ({
    page,
  }) => {
    /*
     * Fail every attempt until the visitor presses retry, then let it through.
     *
     * It has to be every attempt, not one: a 5xx IS retried (REQ-NET-006), so
     * a single failure is absorbed by the query layer and never reaches a
     * failure state at all — which is the policy working, and is why the first
     * version of this test passed the wrong thing.
     */
    let allowThrough = false;
    await page.route(/\/api\/designers\//, async (route) => {
      if (allowThrough) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'nope' }),
      });
    });

    await page.goto(PROFILE);
    await expect(page.getByTestId('designer-missing')).toBeVisible();

    allowThrough = true;
    await page.getByTestId('designer-missing-retry').click();

    // The real page, from a real second request.
    await expect(page.getByTestId('studio-name')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('designer-missing')).toHaveCount(0);
  });
});

test.describe('a render crash', () => {
  test('is themed, announced, and recoverable', async ({ page }) => {
    await page.goto('/designers');
    await waitForApp(page);

    // Force a crash below the boundary by handing the app a response of the
    // wrong shape — the page maps over a list that is not one.
    /*
     * A REGEX, not a glob. `?` is a single-character wildcard in Playwright's
     * glob syntax, so '**' + '/api/designers?**' silently matched nothing that
     * mattered and the crash never happened — the test asserted nothing.
     *
     * `(\?|$)` because the shared serialiser omits default params, so with no
     * filters applied the list URL carries no query string at all. Matching on
     * a required '?' missed it for the same reason.
     */
    await page.route(/\/api\/designers(\?|$)/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          designers: 'not-an-array',
          total: 0,
          limit: 24,
          offset: 0,
        }),
      }),
    );
    await page.reload();

    const crash = page.getByTestId('render-error');
    await expect(crash).toBeVisible({ timeout: 15_000 });

    // Themed, not a bare browser-default div: it renders inside the app's
    // container with a real heading (REQ-FAIL-001).
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /something went wrong/i,
    );
    // MUI's Alert carries role="alert", so a screen reader is told.
    await expect(crash).toHaveAttribute('role', 'alert');
    // And it can be recovered from without a manual browser refresh.
    await expect(page.getByTestId('render-error-retry')).toBeVisible();
  });
});
