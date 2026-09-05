import { expect, test } from '@playwright/test';

test.describe('homepage', () => {
  test('renders the site name and tagline from the backend', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('inside');
    // Copy is server-driven via /api/config, so this also proves the frontend
    // reached the backend.
    await expect(
      page.getByText('Find the designer for your space'),
    ).toBeVisible();
  });

  test('reports the backend as reachable', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/backend ok/)).toBeVisible();
  });

  test('logs no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    expect(errors).toEqual([]);
  });
});

test.describe('backend degraded', () => {
  test('surfaces an unreachable backend rather than failing silently', async ({
    page,
  }) => {
    await page.route('**/api/health', (route) => route.abort());
    await page.goto('/');
    await expect(page.getByText('backend unreachable')).toBeVisible({
      timeout: 15_000,
    });
  });
});
