import { expect, type Page, test } from '@playwright/test';
import { waitForApp } from './helpers';

/**
 * The wordmark is `inside` plus a quieter `.space`.
 *
 * Two things have to hold at once, and they pull against each other: the two
 * halves must look different, and they must still read as a single word to
 * anybody who cannot see them.
 */

const halves = (page: Page) => ({
  name: page.getByTestId('wordmark-name').first(),
  suffix: page.getByTestId('wordmark-suffix').first(),
});

const pixels = (value: string) => Number.parseFloat(value.replace('px', ''));

test.describe('the wordmark reads as one name', () => {
  test('the header link is named "inside.space", not two fragments', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForApp(page);

    // getByRole matches on the accessible name, so this passing IS the
    // assertion that the two spans concatenate without a space between them.
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'inside.space' }),
    ).toBeVisible();
  });

  test('the masthead heading is the whole name', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'inside.space',
    );
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`the two halves are distinct — ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test.beforeEach(async ({ page }) => {
      // The app defaults to light whatever the OS says (REQ-THEME-003), so the
      // mode has to be stored before first paint to scan dark deterministically.
      await page.addInitScript((mode) => {
        try {
          localStorage.setItem('theme-mode', mode);
        } catch {
          // Blocked storage falls back to light, which fails the check below
          // rather than silently scanning light twice.
        }
      }, scheme);
      await page.goto('/');
      await waitForApp(page);
      await expect(page.locator('body')).toHaveClass(
        new RegExp(`\\b${scheme}\\b`),
      );
    });

    test('.space is smaller and greyer than inside', async ({ page }) => {
      const { name, suffix } = halves(page);

      const [nameSize, suffixSize] = await Promise.all([
        name.evaluate((el) => getComputedStyle(el).fontSize),
        suffix.evaluate((el) => getComputedStyle(el).fontSize),
      ]);
      const [nameColour, suffixColour] = await Promise.all([
        name.evaluate((el) => getComputedStyle(el).color),
        suffix.evaluate((el) => getComputedStyle(el).color),
      ]);

      // Smaller, and by a visible margin rather than a rounding difference.
      expect(pixels(suffixSize)).toBeLessThan(pixels(nameSize) * 0.8);
      // And a different colour. Asserting "greyer" numerically would need a
      // luminance comparison that flips between themes. What the requirement
      // actually forbids is the two halves rendering identically.
      expect(suffixColour).not.toBe(nameColour);
    });
  });
}
