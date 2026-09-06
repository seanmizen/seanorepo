import { expect, test } from '@playwright/test';
import { signIn, uniqueEmail, waitForApp } from './helpers';

/** Every route a signed-out visitor can reach. */
const PUBLIC_ROUTES = ['/', '/login', '/verify?token=nonsense'];

test.describe('status chips', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`shows the dev chip and backend chip on ${route}`, async ({
      page,
    }) => {
      await page.goto(route);
      await expect(page.getByTestId('status-chip-dev')).toBeVisible();
      await expect(page.getByTestId('status-chip-dev')).toHaveText(/dev/i);
      await expect(page.getByTestId('status-chip-backend')).toBeVisible();
      await expect(page.getByTestId('status-chip-backend')).toHaveText(
        /backend ok/i,
      );
    });
  }

  test('shows them on a signed-in route too', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, uniqueEmail('chips'));
    await page.goto('/account');
    await expect(page.getByTestId('status-chip-dev')).toBeVisible();
    await expect(page.getByTestId('status-chip-backend')).toBeVisible();
  });

  test('the backend chip sits below the dev chip, top-left', async ({
    page,
  }) => {
    await page.goto('/');
    const dev = await page.getByTestId('status-chip-dev').boundingBox();
    const backend = await page.getByTestId('status-chip-backend').boundingBox();

    expect(dev).not.toBeNull();
    expect(backend).not.toBeNull();
    // Stacked, not side by side.
    expect(backend?.y).toBeGreaterThan(dev?.y as number);
    // Left-aligned with each other, and anchored to the left of the viewport.
    expect(Math.abs((backend?.x as number) - (dev?.x as number))).toBeLessThan(
      2,
    );
    expect(dev?.x as number).toBeLessThan(200);
  });

  test('reports the backend as down when the API is unreachable', async ({
    page,
  }) => {
    await page.route('**/api/health', (route) => route.abort());
    await page.goto('/');
    await expect(page.getByTestId('status-chip-backend')).toHaveText(
      /backend down/i,
      { timeout: 15_000 },
    );
  });

  test('the dev chip is driven by the server, not the bundle', async ({
    page,
  }) => {
    // If the server says this is production, the chip must disappear even
    // though the frontend build is unchanged — the client is never the
    // authority on which environment it is talking to.
    await page.route('**/api/config', (route) =>
      route.fulfill({
        json: {
          devMode: false,
          siteName: 'inside',
          tagline: 'Find the designer for your space',
          uploadMaxFileSizeMb: 50,
          uploadMaxFiles: 30,
        },
      }),
    );
    await page.goto('/');
    await waitForApp(page);
    await expect(page.getByTestId('status-chip-backend')).toBeVisible();
    await expect(page.getByTestId('status-chip-dev')).toHaveCount(0);
  });
});

test.describe('dev sign-in link', () => {
  test('is offered on /login and actually signs you in', async ({ page }) => {
    const email = uniqueEmail('devlink');
    await page.goto('/login');
    await page.getByRole('textbox', { name: /email/i }).fill(email);
    await page.getByRole('button', { name: /email me a link/i }).click();

    await expect(page.getByTestId('dev-magic-link-notice')).toBeVisible();
    const link = page.getByTestId('dev-magic-link');
    await expect(link).toBeVisible();
    await expect(link).toContainText(email);

    await link.click();
    await page.waitForURL(
      (url) =>
        !url.pathname.startsWith('/verify') &&
        !url.pathname.startsWith('/login'),
    );
    await page.goto('/account');
    await expect(page.getByTestId('account-email')).toHaveText(email);
  });

  test('requesting a link never 502s when no SMTP is configured', async ({
    page,
  }) => {
    // The original bug: the endpoint tried to send real email with blank
    // credentials, so a developer could not sign in at all.
    const responses: number[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/auth/magic-link')) responses.push(r.status());
    });

    await page.goto('/login');
    await page
      .getByRole('textbox', { name: /email/i })
      .fill(uniqueEmail('no502'));
    await page.getByRole('button', { name: /email me a link/i }).click();
    await expect(page.getByTestId('dev-magic-link')).toBeVisible();

    expect(responses).toContain(200);
    expect(responses).not.toContain(502);
  });

  test('the page never invents a link the server did not send', async ({
    page,
  }) => {
    // Simulating a production backend: it answers without a devLink. The page
    // must show the plain "check your email" state and no credential at all.
    await page.route('**/api/auth/magic-link', (route) =>
      route.fulfill({ json: { sent: true } }),
    );

    await page.goto('/login');
    await page
      .getByRole('textbox', { name: /email/i })
      .fill('nobody@inside.test');
    await page.getByRole('button', { name: /email me a link/i }).click();

    await expect(page.getByText(/check your email/i)).toBeVisible();
    await expect(page.getByTestId('dev-magic-link')).toHaveCount(0);
    await expect(page.getByTestId('dev-magic-link-notice')).toHaveCount(0);
  });
});

test.describe('in-flight state', () => {
  /**
   * The bug this guards: the chip was green with the tooltip "API reachable"
   * while the health request was still outstanding — asserting a fact the app
   * had not yet established. Success-and-failure tests never catch this,
   * because the window only exists while the request is open.
   */
  test('never claims the backend is reachable before a response lands', async ({
    page,
  }) => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    await page.route('**/api/health', async (route) => {
      await held;
      await route.continue();
    });

    await page.goto('/');

    const chip = page.getByTestId('status-chip-backend');
    await expect(chip).toBeVisible();
    // Assert the state, not the copy, so rewording cannot silently break this.
    await expect(chip).toHaveAttribute('data-status', 'checking');
    await expect(chip).toHaveText(/backend…/);
    // The tooltip must not assert reachability while the request is open.
    await expect(chip).toHaveAttribute('aria-label', /^Checking/);

    release?.();
    await expect(chip).toHaveAttribute('data-status', 'ok', {
      timeout: 15_000,
    });
    await expect(chip).toHaveText(/backend ok/);
  });

  test('the tagline is not invented while config is loading', async ({
    page,
  }) => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    await page.route('**/api/config', async (route) => {
      await held;
      await route.continue();
    });

    await page.goto('/');
    // A skeleton, not a plausible hardcoded sentence standing in for real data.
    await expect(page.getByTestId('tagline-loading')).toBeVisible();

    release?.();
    await expect(
      page.getByText('Find the designer for your space'),
    ).toBeVisible({ timeout: 15_000 });
  });
});
