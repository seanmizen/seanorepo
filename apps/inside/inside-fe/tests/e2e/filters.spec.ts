import { expect, test } from '@playwright/test';
import { signIn, waitForApp } from './helpers';

const ADMIN_EMAIL = 'admin@inside.test';

const asAdmin = async (page: import('@playwright/test').Page) => {
  await page.goto('/login');
  await waitForApp(page);
  await signIn(page, ADMIN_EMAIL);
};

test.describe('URL-backed filters', () => {
  test('a filter change is reflected in the URL', async ({ page }) => {
    await asAdmin(page);
    await page.goto('/admin/designers');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'approved', exact: true }).click();
    await expect(page).toHaveURL(/statuses=approved/);
  });

  test('the URL drives the state, not the other way round', async ({
    page,
  }) => {
    await asAdmin(page);
    // Arriving at a filtered URL must produce the filtered view — this is what
    // makes a filtered list shareable and bookmarkable.
    await page.goto('/admin/designers?statuses=rejected');
    await expect(
      page.getByRole('button', { name: 'rejected', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('filter state survives a reload', async ({ page }) => {
    await asAdmin(page);
    await page.goto('/admin/designers');
    await page.getByRole('button', { name: 'draft', exact: true }).click();
    await expect(page).toHaveURL(/statuses=draft/);

    await page.reload();
    await expect(
      page.getByRole('button', { name: 'draft', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('changing a filter does not pile up history entries', async ({
    page,
  }) => {
    await asAdmin(page);
    await page.goto('/admin/designers');

    for (const name of ['approved', 'rejected', 'draft']) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`statuses=${name}`));
    }

    // replace, not push: one back should leave the page entirely rather than
    // walking back through every filter the reviewer tried.
    await page.goBack();
    await expect(page).not.toHaveURL(/\/admin\/designers/);
  });

  test('a nonsense filter in the URL does not blank the page', async ({
    page,
  }) => {
    await asAdmin(page);
    // A hand-edited URL should degrade to the default view, not an error.
    await page.goto('/admin/designers?statuses=banished&limit=notanumber');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('campaign parameters are carried without breaking anything', async ({
    page,
  }) => {
    await asAdmin(page);
    await page.goto('/admin/designers?utm_source=newsletter');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
