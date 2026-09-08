import { expect, type Page, request, test } from '@playwright/test';
import { signIn, uniqueEmail, waitForApp } from './helpers';

test.describe('sign in', () => {
  test('a new buyer can sign in end to end', async ({ page }) => {
    const email = uniqueEmail('buyer');
    await page.goto('/login');
    await signIn(page, email);

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'Account' }),
    ).toBeVisible();

    await page
      .getByRole('banner')
      .getByRole('link', { name: 'Account' })
      .click();
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
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'Sign in' }),
    ).toBeVisible();

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
    // The conversion mechanic: a sign-in prompt must not lose the action.
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

test.describe('a session that ends underneath you', () => {
  /**
   * Revoke the session SERVER-side while leaving the browser's cookie in
   * place — which is what "signed out from another browser" actually is, and
   * the only case REQ-AUTH-005 answers 401 for.
   *
   * Logging out from the page itself would not do: the response clears the
   * cookie, so the next `/me` is an ordinary anonymous 200 and the expiry is
   * indistinguishable from a normal sign-out. The call has to come from a
   * different cookie jar carrying the same token.
   */
  async function revokeElsewhere(page: Page) {
    const cookies = await page.context().cookies();
    const token = cookies.find((c) => c.name === 'token');
    expect(token, 'no session cookie to revoke').toBeTruthy();

    const elsewhere = await request.newContext({
      extraHTTPHeaders: { cookie: `token=${token?.value}` },
    });
    const res = await elsewhere.post('http://localhost:4161/api/auth/logout');
    expect(res.ok()).toBe(true);
    await elsewhere.dispose();
  }

  test('says why, rather than bouncing to login in silence', async ({
    page,
  }) => {
    await page.goto('/login');
    await waitForApp(page);
    await signIn(page, uniqueEmail('expiry'));

    await page.goto('/account');
    await expect(page.getByTestId('account-email')).toBeVisible();

    await revokeElsewhere(page);

    // A hard reload: the cookie is still there, so /me answers 401 rather
    // than an anonymous 200, and the boot check has to tell them apart.
    await page.reload();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('session-expired')).toBeVisible();
  });

  test('the next authenticated request ends the session, without a reload', async ({
    page,
  }) => {
    await page.goto('/login');
    await waitForApp(page);
    await signIn(page, uniqueEmail('expiry-live'), 'designer');

    await page.goto('/me');
    await expect(page.getByTestId('start-profile')).toBeVisible();

    await revokeElsewhere(page);

    /*
     * A client-side navigation to a page that ACTUALLY ASKS the server — no
     * reload, so nothing is re-read at boot.
     *
     * The qualifier matters and is the honest limit of REQ-AUTH-008: a session
     * ends, as far as the app knows, on the next authenticated request, not the
     * instant somebody revokes it. Nothing polls, and nothing should — the
     * alternative is a heartbeat asking "am I still here?" forever. A page
     * that makes no authenticated request keeps its stale session until one
     * does, which is why this test navigates somewhere that fetches.
     */
    await page.getByRole('link', { name: /start your profile/i }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('session-expired')).toBeVisible();
  });

  /*
   * A slow 401 on the boot check, which nothing covered before.
   *
   * Honest about what this is: **it passes against the code before #245 too.**
   * It is coverage of a path that had none, not proof of the fix. I could not
   * write a test that fails without the fix, because the ordering that loses
   * the verdict needs a race inside one page load that Playwright cannot stage
   * from outside. That is recorded on #245 rather than papered over with a
   * test that would pass either way and look like evidence.
   */
  test('a slow 401 on boot still explains itself', async ({ page }) => {
    await page.goto('/login');
    await waitForApp(page);
    await signIn(page, uniqueEmail('expiry-late'));

    await page.route('**/api/auth/me', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Session ended' }),
      });
    });

    await page.goto('/account');

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('session-expired')).toBeVisible();
  });

  test('an ordinary anonymous visitor is not told a session ended', async ({
    page,
  }) => {
    // The distinction REQ-AUTH-005 exists for: /me answers 200 with a null
    // user when signed out, which is not an expiry and must not read as one.
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('session-expired')).toHaveCount(0);
  });
});
