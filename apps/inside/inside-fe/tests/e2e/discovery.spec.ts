import { expect, test } from '@playwright/test';
import { waitForApp } from './helpers';

/** Seeded by `bun src/seed.ts` before the E2E backend starts. */
const APPROVED = 'Studio Mercer';
const APPROVED_SLUG = 'studio-mercer';

test.describe('browsing designers', () => {
  test('lists approved studios to an anonymous visitor', async ({ page }) => {
    // Buyers browse without an account. That is the whole funnel.
    await page.goto('/designers');
    await waitForApp(page);

    const grid = page.getByTestId('designers-grid');
    await expect(grid).toBeVisible();
    await expect(grid.getByText(APPROVED)).toBeVisible();
  });

  test('never shows an unapproved studio', async ({ page }) => {
    await page.goto('/designers');
    await waitForApp(page);
    // Seeded as pending, draft and rejected respectively.
    for (const hidden of [
      'Ash & Ember',
      'Halcyon Interiors',
      'Placeholder Design Co',
    ]) {
      await expect(page.getByText(hidden)).toHaveCount(0);
    }
  });

  test('an unapproved studio is unreachable by guessing its slug', async ({
    page,
  }) => {
    await page.goto('/designers/ash-ember');
    await waitForApp(page);
    await expect(page.getByTestId('designer-failure')).toBeVisible();
  });

  test('filtering narrows the list and shows in the URL', async ({ page }) => {
    await page.goto('/designers');
    await waitForApp(page);
    await expect(page.getByTestId('designers-grid')).toBeVisible();

    await page.getByLabel('Location').fill('Bristol');
    await expect(page).toHaveURL(/location=Bristol/);
    await expect(page.getByText('Atelier Bloom')).toBeVisible();
    await expect(page.getByText(APPROVED)).toHaveCount(0);
  });

  test('a filtered URL reproduces the same view when shared', async ({
    page,
  }) => {
    // The point of URL state: a link a buyer sends shows what they saw.
    await page.goto('/designers?location=Manchester');
    await waitForApp(page);
    await expect(page.getByText('Northlight Architects')).toBeVisible();
    await expect(page.getByText('Atelier Bloom')).toHaveCount(0);
  });

  test('searching finds a studio by its bio', async ({ page }) => {
    await page.goto('/designers?q=brass');
    await waitForApp(page);
    await expect(page.getByText(APPROVED)).toBeVisible();
  });

  test('a filter matching nothing gets a real empty state', async ({
    page,
  }) => {
    await page.goto('/designers?location=Atlantis');
    await waitForApp(page);
    await expect(page.getByTestId('designers-empty')).toBeVisible();
    await expect(page.getByTestId('designers-grid')).toHaveCount(0);
  });
});

test.describe('a designer profile', () => {
  test('shows the studio, its bio and its published work', async ({ page }) => {
    await page.goto(`/designers/${APPROVED_SLUG}`);
    await expect(page.getByTestId('studio-name')).toHaveText(APPROVED);
    await expect(page.getByText(/unlacquered brass/i)).toBeVisible();
    await expect(page.getByTestId('portfolio-grid')).toBeVisible();
    await expect(page.getByText('Clapham Townhouse')).toBeVisible();
  });

  test('hides unpublished work', async ({ page }) => {
    await page.goto(`/designers/${APPROVED_SLUG}`);
    await expect(page.getByTestId('portfolio-grid')).toBeVisible();
    // Seeded as a draft piece.
    await expect(page.getByText('Notting Hill Study')).toHaveCount(0);
  });

  test('serves a right-sized image, not the full-resolution original', async ({
    page,
  }) => {
    await page.goto(`/designers/${APPROVED_SLUG}`);
    await expect(page.getByTestId('portfolio-grid')).toBeVisible();

    const img = page.getByTestId('portfolio-grid').locator('img').first();
    // A srcset with widths is what lets a phone avoid the 2000px file.
    await expect(img).toHaveAttribute('srcset', /\d+w/);
    await expect(img).toHaveAttribute('sizes', /.+/);
  });

  test('images below the fold are lazy-loaded', async ({ page }) => {
    await page.goto(`/designers/${APPROVED_SLUG}`);
    await expect(page.getByTestId('portfolio-grid')).toBeVisible();
    const second = page.getByTestId('portfolio-grid').locator('img').nth(1);
    await expect(second).toHaveAttribute('loading', 'lazy');
  });
});

test.describe('a portfolio piece', () => {
  test('opens from the profile and shows its images', async ({ page }) => {
    await page.goto(`/designers/${APPROVED_SLUG}`);
    await page.getByText('Clapham Townhouse').first().click();

    await expect(page).toHaveURL(
      new RegExp(`/designers/${APPROVED_SLUG}/portfolio/`),
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Clapham Townhouse',
    );
    await expect(page.getByTestId('project-images')).toBeVisible();
  });

  test('an unpublished piece is not reachable', async ({ page }) => {
    await page.goto(`/designers/${APPROVED_SLUG}/portfolio/notting-hill-study`);
    await waitForApp(page);
    await expect(page.getByTestId('project-failure')).toBeVisible();
  });

  test('the full portfolio page lists every published piece', async ({
    page,
  }) => {
    await page.goto(`/designers/${APPROVED_SLUG}/portfolio`);
    await waitForApp(page);
    await expect(page.getByText('Clapham Townhouse')).toBeVisible();
    await expect(page.getByText('Marylebone Kitchen')).toBeVisible();
  });
});
