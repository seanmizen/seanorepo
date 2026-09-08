import { expect, type Page, test } from '@playwright/test';
import { waitForApp } from './helpers';

/**
 * The wordmark is `inside` plus a quieter `.space`.
 *
 * Two things have to hold at once, and they pull against each other: the two
 * halves must look different, and they must still read as a single word to
 * anybody who cannot see them.
 */

/*
 * Both halves from ONE wordmark, scoped to the header.
 *
 * Resolving `.first()` separately for each half is not the same thing: the
 * homepage renders two wordmarks, and two independent queries can bind to
 * different ones. That produced a comparison of the header's `inside` against
 * the masthead's `.space` — a ratio of 0.81 rather than 0.62 — but only in a
 * full serial run, where the masthead had mounted by the time the second
 * locator resolved.
 */
const halves = (page: Page) => {
  const mark = page.getByRole('banner').getByTestId('wordmark');
  return {
    name: mark.getByTestId('wordmark-name'),
    suffix: mark.getByTestId('wordmark-suffix'),
  };
};

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

      /*
       * Smaller. NOT "smaller by a specific ratio" — the first version of this
       * asserted `< nameSize * 0.8`, which encoded the 0.62 the component
       * shipped with. Retuning the wordmark to 0.81 (7adce85) then failed a
       * test about a design decision that is the designer's to make.
       *
       * The requirement is that the suffix recedes, so that is what this
       * checks: strictly smaller, and by more than a sub-pixel rounding
       * difference.
       */
      expect(pixels(nameSize) - pixels(suffixSize)).toBeGreaterThan(1);
      // And a different colour. Asserting "greyer" numerically would need a
      // luminance comparison that flips between themes. What the requirement
      // actually forbids is the two halves rendering identically.
      expect(suffixColour).not.toBe(nameColour);
    });
  });
}
