import { expect, type Page } from '@playwright/test';

/** Unique per test so parallel runs never share an account. */
export const uniqueEmail = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@inside.test`;

/**
 * Complete a sign-in using the dev bypass, which returns the magic link in the
 * response rather than emailing it.
 *
 * The caller must already be on /login.
 */
export async function signIn(
  page: Page,
  email: string,
  role: 'buyer' | 'designer' = 'buyer',
) {
  await page.getByRole('textbox', { name: /email/i }).fill(email);
  if (role === 'designer') {
    await page.getByRole('button', { name: /i'm a designer/i }).click();
  }
  await page.getByRole('button', { name: /email me a link/i }).click();
  await page.getByTestId('dev-magic-link').click();

  // /verify consumes the token and sets the cookie via fetch, THEN redirects.
  // Returning early lets the caller's next navigation cancel that request in
  // flight, so the sign-in silently doesn't stick.
  //
  // This skips both interstitials: when the caller runs it, the page is
  // still on /login, so waiting only for "not /verify" would match instantly.
  await page.waitForURL(
    (url) =>
      !url.pathname.startsWith('/verify') && !url.pathname.startsWith('/login'),
  );
}

/**
 * The first paint is driven by a blocking script in index.html, but the copy
 * and the auth-dependent header only land after React has rendered. Waiting on
 * the h1 keeps every scan and every keyboard walk deterministic.
 */
export const waitForApp = (page: Page) =>
  expect(page.getByRole('heading', { level: 1 })).toBeVisible();
