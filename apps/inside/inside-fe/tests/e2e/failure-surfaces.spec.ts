import { expect, type Page, test } from '@playwright/test';
import { signIn, uniqueEmail, waitForApp } from './helpers';

const PROFILE = '/designers/northlight-architects';

const signInAsDesigner = async (page: Page, prefix: string) => {
  await page.goto('/login');
  await waitForApp(page);
  await signIn(page, uniqueEmail(prefix), 'designer');
};

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
    await expect(page.getByTestId('designers-failure')).toHaveCount(0);
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
    await expect(page.getByTestId('designer-failure')).toBeVisible();

    allowThrough = true;
    await page.getByTestId('designer-failure-retry').click();

    // The real page, from a real second request.
    await expect(page.getByTestId('studio-name')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('designer-failure')).toHaveCount(0);
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

/*
 * The signed-in half of the app. REQ-STATE-003.
 *
 * `/me/profile` and `/me/portfolio` answer 404 for a designer who has not
 * started a profile, so on these pages "you have nothing yet" and "the request
 * failed" arrive identically — `isError`, no data. Every test here exists to
 * hold those two apart, which is why each failure case is paired with the 404
 * case rather than asserted alone.
 */
test.describe('a failed load in /me is not an empty studio', () => {
  /** Fail /me/profile until the flag flips. Never matches /profile/submit. */
  const breakProfile = (page: Page, allow: () => boolean) =>
    page.route(/\/api\/me\/profile(\?|$)/, async (route) => {
      if (allow()) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'nope' }),
      });
    });

  test('/me says the load failed rather than inviting a setup', async ({
    page,
  }) => {
    await signInAsDesigner(page, 'me-fail');

    let allowThrough = false;
    await breakProfile(page, () => allowThrough);

    await page.goto('/me');
    await expect(page.getByTestId('studio-load-failure')).toBeVisible();
    // The bug this covers: a listed studio being told it has none.
    await expect(page.getByTestId('start-profile')).toHaveCount(0);

    allowThrough = true;
    await page.getByTestId('studio-load-failure-retry').click();

    // This designer genuinely has no profile, so a real 404 now arrives — and
    // THAT is the invitation. Same page, same absence of data, opposite answer.
    await expect(page.getByTestId('start-profile')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('studio-load-failure')).toHaveCount(0);
  });

  test('/me/profile says so rather than showing a blank new profile', async ({
    page,
  }) => {
    await signInAsDesigner(page, 'me-profile-fail');

    let allowThrough = false;
    await breakProfile(page, () => allowThrough);

    await page.goto('/me/profile');
    await expect(page.getByTestId('profile-load-failure')).toBeVisible();
    // The empty create form is what made this dangerous: the first save would
    // POST as though the designer had no profile at all.
    await expect(page.getByTestId('field-studioName')).toHaveCount(0);

    allowThrough = true;
    await page.getByTestId('profile-load-failure-retry').click();

    await expect(page.getByTestId('field-studioName')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('profile-load-failure')).toHaveCount(0);
  });

  test('a portfolio that failed to load is not a portfolio of nothing', async ({
    page,
  }) => {
    await signInAsDesigner(page, 'me-count-fail');

    // A profile that loads, so the page reaches the work card at all. Served
    // rather than seeded: this test is about the count, not about onboarding.
    await page.route(/\/api\/me\/profile(\?|$)/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profile: {
            id: 1,
            userId: 1,
            slug: 'count-fail-studio',
            studioName: 'Count Fail Studio',
            headline: null,
            bio: null,
            location: null,
            websiteUrl: null,
            instagramUrl: null,
            budgetBand: null,
            availability: null,
            coverImageId: null,
            status: 'approved',
            reviewedAt: null,
            reviewedBy: null,
            reviewNote: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
      }),
    );
    await page.route(/\/api\/me\/portfolio(\?|$)/, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'nope' }),
      }),
    );

    await page.goto('/me');
    await expect(page.getByTestId('piece-count')).toBeVisible();
    // A count we do not have is not zero, and must not be dressed as advice.
    await expect(page.getByTestId('piece-count')).not.toHaveText(/no pieces/i);
    await expect(page.getByTestId('piece-count')).toHaveText(
      /could not load your work/i,
    );
  });
});

/*
 * REQ-QUALITY-001, on the page the #217 sweep missed.
 *
 * The two cases are asserted separately and never in the same test, because
 * conflating them IS the bug: a spec that only checked "some state appears"
 * passed happily while a 500 was being reported as a deleted piece.
 */
test.describe('a piece editor tells a failure from a missing piece', () => {
  test('a 404 is the missing piece, in its own right', async ({ page }) => {
    await signInAsDesigner(page, 'piece-missing');

    // This designer owns no piece 1, and the backend 404s for "no such piece"
    // and "not yours" alike — so this is genuinely all the page can know.
    await page.goto('/me/portfolio/1');
    await expect(page.getByTestId('piece-missing')).toBeVisible();
    await expect(page.getByTestId('piece-load-failure')).toHaveCount(0);
  });

  test('a 500 is a failure, not a deletion', async ({ page }) => {
    await signInAsDesigner(page, 'piece-failure');

    let allowThrough = false;
    await page.route(/\/api\/me\/portfolio\/\d+(\?|$)/, async (route) => {
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

    await page.goto('/me/portfolio/1');
    await expect(page.getByTestId('piece-load-failure')).toBeVisible();
    // The bug: "That piece is no longer available", severity info, for a
    // server that was down for a second.
    await expect(page.getByTestId('piece-missing')).toHaveCount(0);

    allowThrough = true;
    await page.getByTestId('piece-load-failure-retry').click();

    // The real answer now arrives — a 404, because this designer really does
    // not own piece 1. Same page, opposite meaning, and only reachable
    // because the retry actually re-issued the request.
    await expect(page.getByTestId('piece-missing')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('piece-load-failure')).toHaveCount(0);
  });
});
