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
  test('is light by default, whatever the OS says', async ({ browser }) => {
    // REQ-THEME-003. The dark-OS case is the one that matters: before #224 it
    // decided the palette for a visitor who had never chosen.
    for (const scheme of ['dark', 'light'] as const) {
      const ctx = await browser.newContext({ colorScheme: scheme });
      const page = await ctx.newPage();
      await page.goto('/');
      await ready(page);
      await expectTheme(page, 'light');
      await expect(toggle(page)).toHaveAttribute('aria-label', /light/i);
      await ctx.close();
    }
  });

  test('auto is reachable, and then follows the OS', async ({ browser }) => {
    // REQ-THEME-001 intact: auto still does exactly what it did. It is now
    // something you opt into rather than something you are given.
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto('/');
    await ready(page);
    await expectTheme(page, 'light');

    await toggle(page).click(); // -> dark
    await toggle(page).click(); // -> auto
    await expect(toggle(page)).toHaveAttribute('aria-label', /system/i);
    await expectTheme(page, 'dark');
    await ctx.close();
  });

  test('cycles light -> dark -> auto -> light', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await expect(toggle(page)).toHaveAttribute('aria-label', /light/i);
    await expectTheme(page, 'light');

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-label', /dark/i);
    await expectTheme(page, 'dark');

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-label', /system/i);

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-label', /light/i);
    await expectTheme(page, 'light');
  });

  test('survives a reload', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await toggle(page).click(); // light -> dark
    await expectTheme(page, 'dark');

    await page.reload();
    await ready(page);
    await expectTheme(page, 'dark');
    await expect(toggle(page)).toHaveAttribute('aria-label', /dark/i);
  });

  test('an explicit choice is not overridden by the OS', async ({
    browser,
  }) => {
    // Pin dark while the OS says light — the visitor's choice must win, in
    // the direction that is now the interesting one.
    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto('/');
    await ready(page);
    await expectTheme(page, 'light');

    await toggle(page).click(); // light -> dark, explicitly
    await expectTheme(page, 'dark');

    await page.reload();
    await ready(page);
    await expectTheme(page, 'dark');
    await ctx.close();
  });

  test('follows a live OS theme change while on auto', async ({ browser }) => {
    // The regression this guards: planning-poker's provider never subscribed
    // to matchMedia, so 'auto' ignored an OS flip until remount.
    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto('/');
    await ready(page);

    // Auto has to be chosen now (REQ-THEME-003), so get there first — two
    // clicks, light -> dark -> auto.
    await toggle(page).click();
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-label', /system/i);
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
    //
    // A dark OS with nothing stored is the case #224 created and the one that
    // would regress silently: if index.html and theme.ts disagree on the
    // fallback, this is the only test that notices.
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto('/', { waitUntil: 'commit' });
    await page.waitForFunction(() => document.body.className.length > 0);
    await expectTheme(page, 'light');
    await ctx.close();
  });
});
