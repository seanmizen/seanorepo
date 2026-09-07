// WCAG 2.1 AA accessibility scan via @axe-core/playwright.
//
// Tagged `@axe` so `yarn workspace inside test:axe` runs only this file; the
// e2e command excludes the tag. Mirrors the harness already in use by
// ffmpeg-converter/web (see .github/workflows/ux-check.yml).
//
// Every route is scanned in BOTH themes. The app defaults to `auto`, so
// Playwright's `colorScheme` context option is enough to pin each one —
// no clicking through the toggle, which would leave localStorage state
// behind and make the scans order-dependent. Dark-mode contrast is the
// usual offender, and a light-only scan would never see it.

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { signIn, uniqueEmail, waitForApp } from './helpers';

/** The rule tags we hold ourselves to. Everything here must be clean. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Scan and assert. Violations are printed before the assertion so a CI
 * failure names the rule, the impact and the offending selector rather than
 * just showing an empty-array diff.
 */
async function expectNoViolations(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();

  if (violations.length > 0) {
    console.log(
      `axe violations on ${label}:`,
      JSON.stringify(
        violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        })),
        null,
        2,
      ),
    );
  }

  expect(violations).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`@axe WCAG 2.1 AA — ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    // Proves the scans below really ran in the theme this block claims. Without
    // it a regression in the pre-paint script would silently scan light twice.
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await waitForApp(page);
      await expect(page.locator('body')).toHaveClass(
        new RegExp(`\\b${scheme}\\b`),
      );
    });

    test('home', async ({ page }) => {
      await expectNoViolations(page, `/ (${scheme})`);
    });

    test('login', async ({ page }) => {
      await page.goto('/login');
      await waitForApp(page);
      await expectNoViolations(page, `/login (${scheme})`);
    });

    test('login — link sent', async ({ page }) => {
      await page.goto('/login');
      await waitForApp(page);
      await page
        .getByRole('textbox', { name: /email/i })
        .fill(uniqueEmail('axe'));
      await page.getByRole('button', { name: /email me a link/i }).click();
      await expect(page.getByTestId('dev-magic-link')).toBeVisible();
      await expectNoViolations(page, `/login sent (${scheme})`);
    });

    test('verify — failure state', async ({ page }) => {
      await page.goto('/verify?token=nonsense');
      await expect(
        page.getByRole('heading', { name: /sign-in failed/i }),
      ).toBeVisible();
      await expectNoViolations(page, `/verify?token=nonsense (${scheme})`);
    });

    test('account', async ({ page }) => {
      await page.goto('/login');
      await waitForApp(page);
      await signIn(page, uniqueEmail('axe-account'));
      await page.goto('/account');
      await expect(page.getByTestId('account-email')).toBeVisible();
      await expectNoViolations(page, `/account (${scheme})`);
    });

    test('home — signed in', async ({ page }) => {
      await page.goto('/login');
      await waitForApp(page);
      await signIn(page, uniqueEmail('axe-home'));
      await page.goto('/');
      await expect(
        page.getByRole('banner').getByRole('link', { name: 'Account' }),
      ).toBeVisible();
      await expectNoViolations(page, `/ signed in (${scheme})`);
    });

    test('designers — list', async ({ page }) => {
      await page.goto('/designers');
      await expect(page.getByTestId('designers-grid')).toBeVisible();
      await expectNoViolations(page, `/designers (${scheme})`);
    });

    test('designers — profile', async ({ page }) => {
      await page.goto('/designers/studio-mercer');
      await expect(page.getByTestId('portfolio-grid')).toBeVisible();
      await expectNoViolations(page, `/designers/:slug (${scheme})`);
    });

    test('designers — portfolio piece', async ({ page }) => {
      await page.goto('/designers/studio-mercer/portfolio/clapham-townhouse');
      await expect(page.getByTestId('project-images')).toBeVisible();
      await expectNoViolations(
        page,
        `/designers/:slug/portfolio/:projectSlug (${scheme})`,
      );
    });

    test('account — scaffolded sections', async ({ page }) => {
      await page.goto('/login');
      await waitForApp(page);
      await signIn(page, uniqueEmail('axe-account-full'));
      await page.goto('/account');
      await expect(page.getByTestId('account-preferences')).toBeVisible();
      await expectNoViolations(page, `/account sections (${scheme})`);
    });

    test('my studio — empty', async ({ page }) => {
      await page.goto('/login');
      await waitForApp(page);
      await signIn(page, uniqueEmail('axe-studio'), 'designer');
      await page.goto('/me');
      await expect(page.getByTestId('start-profile')).toBeVisible();
      await expectNoViolations(page, `/me empty (${scheme})`);
    });

    test('my studio — profile editor', async ({ page }) => {
      await page.goto('/login');
      await waitForApp(page);
      await signIn(page, uniqueEmail('axe-editor'), 'designer');
      await page.goto('/me/profile');
      await expect(page.getByTestId('field-studioName')).toBeVisible();
      await expectNoViolations(page, `/me/profile (${scheme})`);
    });

    test('my studio — portfolio', async ({ page }) => {
      await page.goto('/login');
      await waitForApp(page);
      await signIn(page, uniqueEmail('axe-port'), 'designer');
      await page.goto('/me/portfolio');
      // A designer with no profile yet — which is now its own id, distinct
      // from a genuinely empty portfolio (REQ-QUALITY-001).
      await expect(page.getByTestId('portfolio-needs-profile')).toBeVisible();
      await expectNoViolations(page, `/me/portfolio (${scheme})`);
    });

    test('my studio — piece editor', async ({ page }) => {
      await page.goto('/login');
      await waitForApp(page);
      await signIn(page, uniqueEmail('axe-piece'), 'designer');
      // No such piece for this designer, which is the inline "no longer
      // available" state rather than the catch-all 404.
      await page.goto('/me/portfolio/1');
      await expect(page.getByTestId('piece-missing')).toBeVisible();
      await expectNoViolations(page, `/me/portfolio/:id (${scheme})`);
    });

    test('admin — review queue', async ({ page }) => {
      await page.goto('/login');
      await waitForApp(page);
      // ADMIN_EMAILS in playwright.config.ts is what grants the role.
      await signIn(page, 'admin@inside.test');
      await page.goto('/admin/designers');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoViolations(page, `/admin/designers (${scheme})`);
    });

    test('admin — review detail', async ({ page }) => {
      await page.goto('/login');
      await waitForApp(page);
      await signIn(page, 'admin@inside.test');
      await page.goto('/admin/designers/1');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoViolations(page, `/admin/designers/:id (${scheme})`);
    });

    test('not found', async ({ page }) => {
      // Two segments deep on purpose: it renders a three-crumb trail including
      // an inert crumb for an undeclared parent, which is the only place that
      // styling appears. /designers/* stopped being undeclared in SEAN-160.
      await page.goto('/journal/spring-2026');
      await waitForApp(page);
      await expect(page.getByTestId('not-found')).toBeVisible();
      await expectNoViolations(page, `/journal/spring-2026 (${scheme})`);
    });
  });
}
