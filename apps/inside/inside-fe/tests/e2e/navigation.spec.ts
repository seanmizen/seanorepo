// Breadcrumb navigation, and the guard that keeps it honest.
//
// The rule this file exists to enforce: EVERY ancestor of every route must be
// a real, visitable page. `/designers/:slug` may not ship without
// `/designers`, because the breadcrumb renders `/designers` as a link and a
// link into a 404 is a bug.
//
// The guard is driven off `src/app/routes.ts` — the same table the router is
// built from — rather than a list kept here. That is deliberate: a
// hand-maintained list of paths would silently miss exactly the route someone
// forgot to give a parent, which is the only case that matters. Add a nested
// route to the table and it is covered on the next run, with no edit here.

import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  ancestorsOf,
  crumbsFor,
  fillParams,
  findMissingAncestors,
  matchRoute,
  ROUTES,
  type RouteDefinition,
} from '../../src/app/routes';
import { signIn, uniqueEmail, waitForApp } from './helpers';

/**
 * The same table the router is built from, widened to the interface.
 *
 * `ROUTES` is declared `as const` so the router can type-check that every
 * declared path has an element; that makes it a tuple of literal object types,
 * where an optional field a given route omits is not even a property. Reading
 * it as `RouteDefinition[]` is what lets this file ask any route about
 * `params`, `search` or `requiresAuth` uniformly.
 */
const ROUTE_TABLE: readonly RouteDefinition[] = ROUTES;

/**
 * Fixture values for a pattern's `:params`.
 *
 * An ancestor's own declaration wins, so `/designers` and
 * `/designers/:slug/projects/:id` agree on which designer is being visited;
 * the descendant's values fill anything the ancestor did not name.
 */
const paramsFor = (pattern: string, descendant: RouteDefinition) => ({
  ...descendant.params,
  ...matchRoute(pattern, ROUTE_TABLE)?.params,
});

/** A pattern turned into a URL that can actually be opened. */
const concrete = (pattern: string, descendant: RouteDefinition) =>
  fillParams(pattern, paramsFor(pattern, descendant));

const searchFor = (pattern: string) =>
  matchRoute(pattern, ROUTE_TABLE)?.search ?? '';

/** True when reaching this route, or anything on the way to it, needs a session. */
const needsSession = (route: RouteDefinition) =>
  route.requiresAuth === true ||
  ancestorsOf(route.path).some(
    (ancestor) => matchRoute(ancestor, ROUTE_TABLE)?.requiresAuth === true,
  );

const establishSession = async (page: Page) => {
  await page.goto('/login');
  await waitForApp(page);
  await signIn(page, uniqueEmail('nav'));
};

/**
 * Open a path and assert it is a real page: it renders, it is not the 404, and
 * it did not bounce somewhere else.
 *
 * The URL check uses `expect.poll` rather than a bare `page.url()` read — a
 * route guard's redirect lands on a React re-render, and a synchronous read
 * would happily pass before the bounce happened.
 */
async function expectRealPage(page: Page, path: string, context: string) {
  await page.goto(`${path}${searchFor(path)}`);
  await waitForApp(page);

  await expect(
    page.getByTestId('breadcrumbs'),
    `${context}: no breadcrumb rendered`,
  ).toBeVisible();

  await expect(
    page.getByTestId('not-found'),
    `${context}: resolves to the 404 page, so the crumb linking to it is dead`,
  ).toHaveCount(0);

  await expect
    .poll(() => new URL(page.url()).pathname, {
      message: `${context}: bounced away instead of rendering`,
    })
    .toBe(path);
}

test.describe('route table', () => {
  test('every ancestor of every route is itself a declared route', () => {
    // The whole ticket in one assertion. A failure here names the route and
    // the parent it implies but nobody built.
    expect(
      findMissingAncestors(ROUTE_TABLE),
      'A route declares a nested URL whose parent no route serves. Add the parent page — do not hide the crumb.',
    ).toEqual([]);
  });

  test('the guard catches a nested route with no parent', () => {
    // Proves the check above can fail. Without this, a bug in
    // findMissingAncestors would make the real guard pass silently forever.
    const table: RouteDefinition[] = [
      { path: '/', label: 'home' },
      { path: '/designers/:slug', label: 'designer' },
      { path: '/me/projects/:id', label: 'project' },
    ];

    expect(findMissingAncestors(table)).toEqual([
      { route: '/designers/:slug', missing: '/designers' },
      { route: '/me/projects/:id', missing: '/me' },
      { route: '/me/projects/:id', missing: '/me/projects' },
    ]);
  });
});

test.describe('no dead intermediate paths', () => {
  for (const route of ROUTE_TABLE) {
    test(`every ancestor of ${route.path} resolves to a real page`, async ({
      page,
    }) => {
      if (needsSession(route)) await establishSession(page);

      for (const ancestor of ancestorsOf(route.path)) {
        const path = concrete(ancestor, route);
        await expectRealPage(page, path, `ancestor ${path} of ${route.path}`);
      }

      // The route itself too, so the case with no ancestors — the root — is
      // still asserting something rather than passing vacuously.
      await expectRealPage(page, concrete(route.path, route), route.path);
    });
  }
});

test.describe('breadcrumb', () => {
  for (const route of ROUTE_TABLE) {
    test(`mirrors the URL on ${route.path}`, async ({ page }) => {
      if (needsSession(route)) await establishSession(page);

      const path = concrete(route.path, route);
      await expectRealPage(page, path, route.path);

      const expected = crumbsFor(path);
      const crumbs = page.getByTestId('breadcrumb-crumb');
      await expect(crumbs).toHaveCount(expected.length);

      for (const [index, crumb] of expected.entries()) {
        const rendered = crumbs.nth(index);

        if (crumb.isCurrent) {
          // The last crumb's text may be supplied by the page itself (see
          // /verify), so this asserts it is present and marked, not its wording
          // — the explicit trails below cover the wording.
          await expect(rendered).toHaveAttribute('aria-current', 'page');
          await expect(rendered).not.toBeEmpty();
        } else {
          await expect(rendered).toHaveText(crumb.label);
          await expect(rendered).toHaveAttribute('href', crumb.path);
        }
      }

      const nav = page.getByTestId('breadcrumbs');
      // Every crumb but the last is a link, and the last is not one.
      await expect(nav.getByRole('link')).toHaveCount(expected.length - 1);
      await expect(nav.locator('a[aria-current]')).toHaveCount(0);
    });
  }

  const TRAILS: ReadonlyArray<readonly [string, string[]]> = [
    ['/', ['home']],
    ['/login', ['home', 'sign in']],
    // The page renames its own crumb once the attempt has resolved: the route
    // table can only say "sign-in link", the page knows it failed.
    ['/verify?token=nonsense', ['home', 'sign-in failed']],
  ];

  for (const [url, trail] of TRAILS) {
    test(`reads "${trail.join(' › ')}" on ${url}`, async ({ page }) => {
      await page.goto(url);
      await waitForApp(page);
      await expect(page.getByTestId('breadcrumb-crumb')).toHaveText([...trail]);
    });
  }

  test('reads "home › account" on the signed-in account page', async ({
    page,
  }) => {
    await establishSession(page);
    await page.goto('/account');
    await expect(page.getByTestId('account-email')).toBeVisible();
    await expect(page.getByTestId('breadcrumb-crumb')).toHaveText([
      'home',
      'account',
    ]);
  });

  for (const route of ROUTE_TABLE) {
    const intermediates = crumbsFor(
      fillParams(route.path, route.params),
    ).filter((crumb) => !crumb.isCurrent);
    if (intermediates.length === 0) continue;

    test(`the crumbs on ${route.path} navigate to real pages`, async ({
      page,
    }) => {
      if (needsSession(route)) await establishSession(page);
      const path = concrete(route.path, route);

      for (const crumb of intermediates) {
        await page.goto(`${path}${searchFor(route.path)}`);
        await waitForApp(page);

        await page
          .getByTestId('breadcrumbs')
          .getByRole('link', { name: crumb.label, exact: true })
          .click();

        await expect
          .poll(() => new URL(page.url()).pathname, {
            message: `clicking "${crumb.label}" did not go to ${crumb.path}`,
          })
          .toBe(crumb.path);
        await waitForApp(page);
        await expect(page.getByTestId('not-found')).toHaveCount(0);
      }
    });
  }
});

test.describe('an undeclared URL', () => {
  test('renders the 404 page and never offers a dead link', async ({
    page,
  }) => {
    // Nobody declared /designers yet, so the middle crumb is inert text. The
    // moment a ticket adds /designers/:slug, the route-table guard above
    // forces /designers to exist and this crumb becomes a link.
    await page.goto('/designers/alice-morgan');
    await waitForApp(page);

    await expect(page.getByTestId('not-found')).toBeVisible();
    await expect(page.getByTestId('breadcrumb-crumb')).toHaveText([
      'home',
      'designers',
      'alice morgan',
    ]);

    const nav = page.getByTestId('breadcrumbs');
    await expect(nav.getByRole('link')).toHaveCount(1);
    await expect(
      nav.getByRole('link', { name: 'home', exact: true }),
    ).toBeVisible();
  });
});

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(locator: Locator, name: string): Promise<Box> {
  await expect(locator, `${name} is not visible`).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${name} has no bounding box`);
  return box;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

test.describe('layout', () => {
  for (const width of [375, 768, 1280]) {
    test(`the trail clears the status chips and the theme toggle at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.goto('/');
      await waitForApp(page);

      const nav = await boxOf(page.getByTestId('breadcrumbs'), 'breadcrumb');
      const neighbours: ReadonlyArray<readonly [string, Box]> = [
        ['dev chip', await boxOf(page.getByTestId('status-chip-dev'), 'dev')],
        [
          'backend chip',
          await boxOf(page.getByTestId('status-chip-backend'), 'backend'),
        ],
        [
          'theme toggle',
          await boxOf(page.getByRole('button', { name: /theme/i }), 'toggle'),
        ],
      ];

      for (const [name, neighbour] of neighbours) {
        expect(
          overlaps(nav, neighbour),
          `the breadcrumb overlaps the ${name} at ${width}px`,
        ).toBe(false);
      }

      expect(
        nav.x,
        `the breadcrumb starts off-screen at ${width}px`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        nav.x + nav.width,
        `the breadcrumb overflows the viewport at ${width}px`,
      ).toBeLessThanOrEqual(width);
    });
  }
});
