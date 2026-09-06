import { expect, type Page, test } from '@playwright/test';
import { signIn, uniqueEmail, waitForApp } from './helpers';

/** The address in ADMIN_EMAILS (see playwright.config.ts). */
const ADMIN_EMAIL = 'admin@inside.test';

const signInAs = async (
  page: Page,
  email: string,
  role: 'buyer' | 'designer' = 'buyer',
) => {
  await page.goto('/login');
  await waitForApp(page);
  await signIn(page, email, role);
};

/** A designer with a submitted profile, waiting in the queue. */
async function submitProfile(page: Page, studioName: string) {
  await signInAs(page, uniqueEmail('designer'), 'designer');
  const created = await page.evaluate(async (name) => {
    const res = await fetch('http://localhost:4161/api/me/profile', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studioName: name }),
    });
    const body = await res.json();
    await fetch('http://localhost:4161/api/me/profile/submit', {
      method: 'POST',
      credentials: 'include',
    });
    return body.profile as { id: number; slug: string };
  }, studioName);
  return created;
}

test.describe('admin approval', () => {
  test('an approved designer becomes publicly visible', async ({ page }) => {
    const studioName = `Approve E2E ${Date.now()}`;
    const profile = await submitProfile(page, studioName);

    // Not yet visible to the public. Since SEAN-160 declared /designers/:slug,
    // an unapproved studio is a real page saying it is not listed rather than
    // the catch-all 404 — indistinguishable from one that never existed, which
    // is what keeps the approval queue unprobeable.
    await page.goto(`/designers/${profile.slug}`);
    await expect(page.getByTestId('designer-missing')).toBeVisible();

    await signInAs(page, ADMIN_EMAIL);
    await page.goto(`/admin/designers/${profile.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      studioName,
    );

    await page.getByRole('button', { name: /^approve$/i }).click();
    await expect(page.getByTestId('review-status')).toHaveText(/approved/i);
  });

  test('rejecting without a reason is refused', async ({ page }) => {
    const profile = await submitProfile(page, `Reject E2E ${Date.now()}`);
    await signInAs(page, ADMIN_EMAIL);
    await page.goto(`/admin/designers/${profile.id}`);

    await page.getByRole('button', { name: /^reject$/i }).click();
    // A rejection the designer cannot act on is a dead end.
    await expect(page.getByText(/reason is required/i)).toBeVisible();
    await expect(page.getByTestId('review-status')).toHaveText(/pending/i);
  });

  test('rejecting with a reason records it', async ({ page }) => {
    const profile = await submitProfile(page, `Reject Note ${Date.now()}`);
    await signInAs(page, ADMIN_EMAIL);
    await page.goto(`/admin/designers/${profile.id}`);

    await page
      .getByRole('textbox', { name: /note to the designer/i })
      .fill('Needs more finished work');
    await page.getByRole('button', { name: /^reject$/i }).click();

    await expect(page.getByTestId('review-status')).toHaveText(/rejected/i);
  });

  test('the queue lists a pending profile and links to it', async ({
    page,
  }) => {
    const studioName = `Queue E2E ${Date.now()}`;
    const profile = await submitProfile(page, studioName);

    await signInAs(page, ADMIN_EMAIL);
    await page.goto('/admin/designers');
    await expect(page.getByTestId('review-queue')).toBeVisible();

    await page.getByRole('link', { name: studioName }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/designers/${profile.id}$`));
  });
});

test.describe('admin access control', () => {
  test('a signed-in buyer is bounced off every admin route', async ({
    page,
  }) => {
    await signInAs(page, uniqueEmail('buyer'));
    for (const path of ['/admin', '/admin/designers', '/admin/designers/1']) {
      await page.goto(path);
      await expect(page).toHaveURL(/localhost:4160\/$/);
    }
  });

  test('an anonymous visitor is sent to sign in', async ({ page }) => {
    await page.goto('/admin/designers');
    await expect(page).toHaveURL(/\/login/);
  });
});
