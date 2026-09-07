import { expect, type Page, test } from '@playwright/test';
import { signIn, uniqueEmail, waitForApp } from './helpers';

const API = 'http://localhost:4161/api';
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

/** An approved, publicly visible studio — the only kind with a public URL. */
async function approvedStudio(page: Page, studioName: string) {
  await signInAs(page, uniqueEmail('slugdesigner'), 'designer');
  const designerEmail = await page.evaluate(
    async ([api, name]) => {
      const res = await fetch(`${api}/me/profile`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studioName: name }),
      });
      const body = await res.json();
      await fetch(`${api}/me/profile/submit`, {
        method: 'POST',
        credentials: 'include',
      });
      const me = await (
        await fetch(`${api}/auth/me`, { credentials: 'include' })
      ).json();
      return {
        profile: body.profile as { id: number; slug: string },
        email: me.user.email as string,
      };
    },
    [API, studioName] as const,
  );

  await signInAs(page, ADMIN_EMAIL);
  await page.goto(`/admin/designers/${designerEmail.profile.id}`);
  await page.getByRole('button', { name: /^approve$/i }).click();
  await expect(page.getByTestId('review-status')).toHaveText(/approved/i);

  return designerEmail;
}

/** Rename as the studio itself, which is the only account allowed to. */
async function renameSlug(page: Page, email: string, slug: string) {
  await signInAs(page, email, 'designer');
  return page.evaluate(
    async ({ api, next }) => {
      const res = await fetch(`${api}/me/profile`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studioName: 'Renamed Studio', slug: next }),
      });
      return { status: res.status, body: await res.json() };
    },
    { api: API, next: slug },
  );
}

test.describe('slug history', () => {
  test('an old slug rewrites to the current one and Back still works', async ({
    page,
  }) => {
    const studio = await approvedStudio(page, `Slug E2E ${Date.now()}`);
    const originalSlug = studio.profile.slug;
    const newSlug = `renamed-${Date.now()}`;

    const renamed = await renameSlug(page, studio.email, newSlug);
    expect(renamed.status).toBe(200);
    expect(renamed.body.profile.slug).toBe(newSlug);

    // Arrive from somewhere real, so "Back" has an unambiguous destination.
    await page.goto('/designers');
    await waitForApp(page);

    await page.goto(`/designers/${originalSlug}`);
    await waitForApp(page);

    // REQ-SLUG-003: the address corrects itself to the current slug.
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe(`/designers/${newSlug}`);
    await expect(page.getByTestId('studio-name')).toBeVisible();

    // The canonical tag carries the SEO consolidation the 301 would have.
    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute('href');
    expect(canonical).toContain(`/designers/${newSlug}`);

    // The load-bearing assertion. The old slug must not occupy a history
    // entry: with a push instead of a replace, Back would land on it, rewrite
    // forward again, and trap the visitor on this page forever.
    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/designers');
  });

  test('a slug nobody has held is still a real 404', async ({ page }) => {
    await page.goto('/designers/never-been-anyones-slug');
    await waitForApp(page);
    await expect(page.getByTestId('designer-missing')).toBeVisible();
  });

  test('a reserved slug is refused with a reason the designer can act on', async ({
    page,
  }) => {
    const studio = await approvedStudio(page, `Reserved E2E ${Date.now()}`);

    const refused = await renameSlug(page, studio.email, 'admin');
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('reserved');
    expect(refused.body.error).toContain('reserved');
  });
});
