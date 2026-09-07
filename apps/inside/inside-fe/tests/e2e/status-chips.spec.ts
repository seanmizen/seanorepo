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

test.describe('the chips float (REQ-CHIPS-001)', () => {
  /**
   * These were briefly moved into the site header's normal flow to resolve a
   * layout collision, which silently dropped a stated requirement. The
   * assertions below exist so that trade cannot be made again without a test
   * going red and someone having to argue for it.
   */
  test('are fixed-position, not in normal flow', async ({ page }) => {
    await page.goto('/');
    const position = await page
      .getByTestId('status-chips')
      .evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe('fixed');
  });

  test('stay put when the page scrolls', async ({ page }) => {
    await page.goto('/designers');
    const before = await page.getByTestId('status-chips').boundingBox();
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(200);
    const after = await page.getByTestId('status-chips').boundingBox();
    expect(after?.y).toBe(before?.y);
  });

  test('are translucent, so content shows through', async ({ page }) => {
    await page.goto('/');
    const style = await page.getByTestId('status-chips').evaluate((el) => ({
      background: getComputedStyle(el).backgroundColor,
      opacity: getComputedStyle(el).opacity,
    }));

    // The BACKGROUND is translucent, not the element: fading the whole card
    // fades the chip text with it and costs it contrast.
    expect(style.background).toMatch(/rgba\(.+,\s*0?\.9\d*\)/);
    expect(Number(style.opacity)).toBe(1);
  });

  test('never cover the header brand or nav', async ({ page }) => {
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 720 });
      await page.goto('/');
      const chips = await page.getByTestId('status-chips').boundingBox();
      const brand = await page
        .getByRole('banner')
        .getByRole('link', { name: 'inside' })
        .boundingBox();

      expect(chips, `chips missing at ${width}px`).not.toBeNull();
      expect(brand, `brand missing at ${width}px`).not.toBeNull();
      // The header moves aside for the chips, not the other way round.
      expect(
        (chips as { x: number; width: number }).x +
          (chips as { width: number }).width,
        `chips overlap the brand at ${width}px`,
      ).toBeLessThanOrEqual((brand as { x: number }).x);
    }
  });
});
