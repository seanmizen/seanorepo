import { expect, type Page, test } from '@playwright/test';

/**
 * Body carries exactly one of `light` / `dark`, set pre-paint by the blocking
 * script and kept in step by the provider.
 *
 * These use Playwright's retrying assertions rather than a bare
 * `page.evaluate` read — the class lands on a React re-render after the click,
 * so a synchronous read races it.
 */
const expectTheme = (page: Page, theme: 'light' | 'dark') =>
  expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`));

const toggle = (page: Page) => page.getByRole('button', { name: /theme/i });

const ready = (page: Page) =>
  expect(page.getByRole('heading', { level: 1 })).toBeVisible();

test.describe('theme', () => {
  test('follows the OS preference by default', async ({ browser }) => {
    for (const scheme of ['dark', 'light'] as const) {
      const ctx = await browser.newContext({ colorScheme: scheme });
      const page = await ctx.newPage();
      await page.goto('/');
      await ready(page);
      await expectTheme(page, scheme);
      await expect(toggle(page)).toHaveAttribute('aria-label', /system/i);
      await ctx.close();
    }
  });

  test('cycles auto -> light -> dark -> auto', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await expect(toggle(page)).toHaveAttribute('aria-label', /system/i);

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-label', /light/i);
    await expectTheme(page, 'light');

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-label', /dark/i);
    await expectTheme(page, 'dark');

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-label', /system/i);
  });

  test('survives a reload', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await toggle(page).click(); // -> light
    await toggle(page).click(); // -> dark
    await expectTheme(page, 'dark');

    await page.reload();
    await ready(page);
    await expectTheme(page, 'dark');
    await expect(toggle(page)).toHaveAttribute('aria-label', /dark/i);
  });

  test('an explicit choice is not overridden by the OS', async ({
    browser,
  }) => {
    // Pin light while the OS says dark — the user's choice must win.
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto('/');
    await ready(page);
    await expectTheme(page, 'dark');

    await toggle(page).click(); // auto -> light
    await expectTheme(page, 'light');

    await page.reload();
    await ready(page);
    await expectTheme(page, 'light');
    await ctx.close();
  });

  test('follows a live OS theme change while on auto', async ({ browser }) => {
    // The regression this guards: planning-poker's provider never subscribed
    // to matchMedia, so 'auto' ignored an OS flip until remount.
    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto('/');
    await ready(page);
    await expectTheme(page, 'light');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'dark');

    await page.emulateMedia({ colorScheme: 'light' });
    await expectTheme(page, 'light');
    await ctx.close();
  });

  test('does not flash the wrong theme before hydrating', async ({
    browser,
  }) => {
    // The blocking script in index.html sets the body class pre-paint, so the
    // first observable state is already correct.
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto('/', { waitUntil: 'commit' });
    await page.waitForFunction(() => document.body.className.length > 0);
    await expectTheme(page, 'dark');
    await ctx.close();
  });
});
