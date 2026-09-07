// Keyboard-only operability — WCAG 2.1.1 (Keyboard) and 2.4.7 (Focus Visible).
//
// axe cannot see either of these: whether a control is *reachable* by Tab and
// whether focus is *visible* are both runtime properties, not static DOM ones.
// So a11y.spec.ts and this file are complements, not duplicates.
//
// Deliberately not tagged @axe — this runs as part of the normal e2e suite.

import { expect, type Page, test } from '@playwright/test';
import { signIn, uniqueEmail, waitForApp } from './helpers';

/** Anything the browser will hand focus to via Tab. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type TabStop = {
  id: string | null;
  label: string;
  hasFocusRing: boolean;
};

/**
 * Walk the page with Tab and report what was reached and whether each stop
 * showed a focus ring.
 *
 * Every visible focusable element is tagged with `data-kbd` first so a stop can
 * be matched back to the element it came from — accessible names are not unique
 * enough (two toggle buttons, several plain links) to key on.
 *
 * A focus ring may be drawn on the focused element or on a wrapper: MUI styles
 * the inner `<input>` of a text field with `outline: 0` and the ring goes on
 * `.MuiOutlinedInput-root` instead (see app/theme.ts). So ancestors are checked
 * too, a few levels up.
 */
async function walkWithTab(page: Page) {
  const expected = await page.evaluate((selector) => {
    const visible = Array.from(
      document.querySelectorAll<HTMLElement>(selector),
    ).filter((el) => el.getClientRects().length > 0);

    return visible.map((el, index) => {
      const id = String(index);
      el.setAttribute('data-kbd', id);
      return {
        id,
        label: `<${el.tagName.toLowerCase()}> ${
          el.getAttribute('aria-label') ?? (el.textContent ?? '').trim()
        }`.slice(0, 60),
      };
    });
  }, FOCUSABLE);

  const stops: TabStop[] = [];
  // Tabbing past the last control hands focus to the browser chrome, where
  // activeElement falls back to <body>; the next Tab re-enters at the top. So
  // this loops well past the element count and tolerates the empty stops
  // rather than breaking on the first one.
  for (let i = 0; i < expected.length * 2 + 4; i++) {
    await page.keyboard.press('Tab');

    const stop = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) return null;

      let node: HTMLElement | null = active;
      let hasFocusRing = false;
      for (let depth = 0; depth < 4 && node; depth++) {
        const style = getComputedStyle(node);
        if (
          style.outlineStyle !== 'none' &&
          Number.parseFloat(style.outlineWidth) >= 2
        ) {
          hasFocusRing = true;
          break;
        }
        node = node.parentElement;
      }

      return {
        id: active.getAttribute('data-kbd'),
        label: `<${active.tagName.toLowerCase()}> ${
          active.getAttribute('aria-label') ?? (active.textContent ?? '').trim()
        }`.slice(0, 60),
        hasFocusRing,
      };
    });

    if (stop) stops.push(stop);
  }

  return { expected, stops };
}

/**
 * Assert every interactive element on the current page is reachable by Tab and
 * shows a visible focus indicator when it is.
 */
async function expectKeyboardNavigable(page: Page, route: string) {
  const { expected, stops } = await walkWithTab(page);

  expect(
    expected.length,
    `${route} has no focusable controls — the walk would pass vacuously`,
  ).toBeGreaterThan(0);

  const reached = new Set(stops.map((s) => s.id));
  const unreachable = expected.filter((e) => !reached.has(e.id));
  expect(
    unreachable.map((e) => e.label),
    `${route}: controls not reachable by Tab`,
  ).toEqual([]);

  const unringed = stops.filter((s) => !s.hasFocusRing);
  expect(
    unringed.map((s) => s.label),
    `${route}: controls focused with no visible focus indicator`,
  ).toEqual([]);
}

test.describe('keyboard navigation', () => {
  test('home', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await expectKeyboardNavigable(page, '/');
  });

  test('login', async ({ page }) => {
    await page.goto('/login');
    await waitForApp(page);
    // The submit button is disabled until an email is present, and a disabled
    // button is correctly not a tab stop. Fill it so the walk covers the
    // enabled form, which is the state a real user tabs through.
    await page.getByRole('textbox', { name: /email/i }).fill('kbd@inside.test');
    await expect(
      page.getByRole('button', { name: /email me a link/i }),
    ).toBeEnabled();
    await expectKeyboardNavigable(page, '/login');
  });

  test('verify — failure state', async ({ page }) => {
    await page.goto('/verify?token=nonsense');
    await expect(
      page.getByRole('heading', { name: /sign-in failed/i }),
    ).toBeVisible();
    await expectKeyboardNavigable(page, '/verify?token=nonsense');
  });

  test('account', async ({ page }) => {
    await page.goto('/login');
    await waitForApp(page);
    await signIn(page, uniqueEmail('kbd-account'));
    await page.goto('/account');
    await expect(page.getByTestId('account-email')).toBeVisible();
    await expectKeyboardNavigable(page, '/account');
  });

  test('not found', async ({ page }) => {
    await page.goto('/no-such-page');
    await waitForApp(page);
    await expect(page.getByTestId('not-found')).toBeVisible();
    await expectKeyboardNavigable(page, '/no-such-page');
  });
});

test.describe('breadcrumb', () => {
  test('a crumb is reachable by Tab and followed with Enter', async ({
    page,
  }) => {
    // The trail is the only way back on a page with no other navigation, so
    // "reachable and operable without a mouse" is not optional for it.
    await page.goto('/login');
    await waitForApp(page);

    const home = page
      .getByTestId('breadcrumbs')
      .getByRole('link', { name: 'home', exact: true });

    // Walk rather than assuming a position: what precedes the trail depends on
    // the page.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      if (await home.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(home, 'the breadcrumb was not reachable by Tab').toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/localhost:4160\/$/);
  });
});

test.describe('theme toggle', () => {
  const toggle = (page: Page) => page.getByRole('button', { name: /theme/i });

  test('its accessible name reports the current mode', async ({ page }) => {
    // The name is the only thing telling a screen-reader user what the button
    // will do next, so it must track the mode rather than being a static
    // "Toggle theme". Asserted on the accessible name, not the aria-label
    // attribute, so a future refactor to visually-hidden text still passes.
    await page.goto('/');
    await waitForApp(page);

    await expect(toggle(page)).toHaveAccessibleName(/system/i);
    await toggle(page).click();
    await expect(toggle(page)).toHaveAccessibleName(/light/i);
    await toggle(page).click();
    await expect(toggle(page)).toHaveAccessibleName(/dark/i);
    await toggle(page).click();
    await expect(toggle(page)).toHaveAccessibleName(/system/i);
  });

  test('is reachable and operable with the keyboard alone', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForApp(page);

    // Tab until focus lands on it rather than assuming a fixed position in the
    // tab order — the header's contents depend on whether anyone is signed in.
    let focused = false;
    for (let i = 0; i < 10 && !focused; i++) {
      await page.keyboard.press('Tab');
      focused = await toggle(page).evaluate(
        (el) => el === document.activeElement,
      );
    }
    expect(focused, 'theme toggle was not reachable by Tab').toBe(true);

    await expect(toggle(page)).toHaveAccessibleName(/system/i);

    // Enter and Space must both work — a <div role="button"> would pass one
    // and fail the other.
    await page.keyboard.press('Enter');
    await expect(toggle(page)).toHaveAccessibleName(/light/i);
    await expect(page.locator('body')).toHaveClass(/\blight\b/);

    await page.keyboard.press(' ');
    await expect(toggle(page)).toHaveAccessibleName(/dark/i);
    await expect(page.locator('body')).toHaveClass(/\bdark\b/);

    await page.keyboard.press('Enter');
    await expect(toggle(page)).toHaveAccessibleName(/system/i);
  });
});

test.describe('keyboard-only sign in', () => {
  test('the login form can be completed without a mouse', async ({ page }) => {
    // No .click() anywhere in this test on purpose: it is the whole point.
    await page.goto('/login');
    await waitForApp(page);

    const email = uniqueEmail('kbd-signin');

    // Tab to the role choice and pick "I'm a designer" with the keyboard, so
    // the ToggleButtonGroup is proven operable rather than merely focusable.
    //
    // Walked rather than counted: the header and the breadcrumb both come
    // first in the tab order and both vary — the trail by route, the header by
    // whether you are signed in and what role you hold. The bound is
    // deliberately generous so adding a header link does not break this; only
    // the toggle becoming genuinely unreachable should.
    const designer = page.getByRole('button', { name: /i'm a designer/i });
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      if (await designer.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(designer).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(designer).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Tab');
    await expect(page.getByRole('textbox', { name: /email/i })).toBeFocused();
    await page.keyboard.type(email);

    await page.keyboard.press('Tab');
    const submit = page.getByRole('button', { name: /email me a link/i });
    await expect(submit).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(
      page.getByRole('heading', { name: /check your email/i }),
    ).toBeVisible();
    await expect(page.getByTestId('dev-magic-link')).toBeVisible();
  });
});
