import { expect, test } from '@playwright/test';
import { signIn, uniqueEmail, waitForApp } from './helpers';

test.describe('homepage sign-up CTA', () => {
  test('invites a signed-out visitor to create an account', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForApp(page);

    const cta = page.getByTestId('signup-cta');
    await expect(cta).toBeVisible();
    await expect(
      cta.getByRole('heading', { name: /buy or sell design services/i }),
    ).toBeVisible();
    await expect(
      cta.getByRole('link', { name: /create an account/i }),
    ).toBeVisible();
    await expect(
      cta.getByRole('link', { name: /i already have one/i }),
    ).toBeVisible();
  });

  test('the primary action reaches sign-in', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await page
      .getByTestId('signup-cta')
      .getByRole('link', { name: /create an account/i })
      .click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('the top-right affordance is kept alongside it', async ({ page }) => {
    // Sean asked for both: the CTA explains the site, the header button is for
    // people who already know what it is.
    await page.goto('/');
    await waitForApp(page);
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByTestId('signup-cta')).toBeVisible();
  });

  test('is not shown to someone already signed in', async ({ page }) => {
    await page.goto('/login');
    await waitForApp(page);
    await signIn(page, uniqueEmail('cta'));

    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();
    // Inviting someone to create an account they have reads as the site not
    // knowing who they are.
    await expect(page.getByTestId('signup-cta')).toHaveCount(0);
  });

  test('does not flash before the session is known', async ({ page }) => {
    // The auth check is in flight on first paint; showing the CTA and then
    // yanking it away would be the same "assert before you know" bug.
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/auth/me', async (route) => {
      await held;
      await route.continue();
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('signup-cta')).toHaveCount(0);

    release?.();
    await expect(page.getByTestId('signup-cta')).toBeVisible({
      timeout: 15_000,
    });
  });
});
