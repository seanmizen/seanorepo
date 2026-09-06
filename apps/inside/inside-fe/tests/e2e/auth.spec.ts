import { expect, test } from '@playwright/test';
import { signIn, uniqueEmail } from './helpers';

test.describe('sign in', () => {
  test('a new buyer can sign in end to end', async ({ page }) => {
    const email = uniqueEmail('buyer');
    await page.goto('/login');
    await signIn(page, email);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();

    await page.getByRole('link', { name: 'Account' }).click();
    await expect(page.getByTestId('account-email')).toHaveText(email);
    await expect(page.getByText('buyer', { exact: true })).toBeVisible();
  });

  test('a designer keeps the designer role', async ({ page }) => {
    const email = uniqueEmail('designer');
    await page.goto('/login');
    await signIn(page, email, 'designer');

    await page.goto('/account');
    await expect(page.getByText('designer', { exact: true })).toBeVisible();
  });

  test('the session survives a reload', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, uniqueEmail('persist'));
    await page.goto('/account');

    await page.reload();
    // The cookie is httpOnly, so this also proves /me re-resolves on boot.
    await expect(page.getByTestId('account-email')).toBeVisible();
  });

  test('signing out ends the session', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, uniqueEmail('logout'));
    await page.goto('/account');
    await page.getByRole('button', { name: /sign out/i }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    // Revoked server-side, so the route guard must bounce us.
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('protected routes', () => {
  test('an anonymous visitor is sent to login', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Faccount/);
  });

  test('signing in resumes where the visitor was headed', async ({ page }) => {
    // The conversion mechanic: being asked to sign in must not lose the action.
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login/);

    await signIn(page, uniqueEmail('resume'));

    await expect(page).toHaveURL(/\/account/);
    await expect(page.getByTestId('account-email')).toBeVisible();
  });
});

test.describe('bad links', () => {
  test('an invalid token shows a real error', async ({ page }) => {
    await page.goto('/verify?token=nonsense');
    await expect(
      page.getByRole('heading', { name: /sign-in failed/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /request a new link/i }),
    ).toBeVisible();
  });

  test('a token cannot be reused', async ({ page }) => {
    await page.goto('/login');
    await page
      .getByRole('textbox', { name: /email/i })
      .fill(uniqueEmail('reuse'));
    await page.getByRole('button', { name: /email me a link/i }).click();

    const link = await page.getByTestId('dev-magic-link').getAttribute('href');
    expect(link).toBeTruthy();

    await page.goto(
      new URL(link as string).pathname + new URL(link as string).search,
    );
    await expect(page).toHaveURL(/\/$/);

    // Same link a second time — single-use must reject it.
    await page.goto(
      new URL(link as string).pathname + new URL(link as string).search,
    );
    await expect(
      page.getByRole('heading', { name: /sign-in failed/i }),
    ).toBeVisible();
  });

  test('a returnTo pointing off-site is ignored', async ({ page }) => {
    await page.goto(
      `/login?returnTo=${encodeURIComponent('https://evil.example')}`,
    );
    await signIn(page, uniqueEmail('redirect'));

    // Must land on our own site, never the attacker's.
    await expect(page).toHaveURL(/localhost:4160\//);
  });
});
