/**
 * The route table, as data.
 *
 * This file is deliberately free of JSX, React and path aliases so that both
 * the router and the Playwright guard in `tests/e2e/navigation.spec.ts` can
 * import it. The guard being driven off *this* table rather than a list it
 * keeps itself is the whole point: a route added here is covered
 * automatically, and a hand-maintained list would silently miss exactly the
 * route someone forgot.
 *
 * ## The standing rule: no dead intermediate paths
 *
 * Every ancestor of every path here must itself be a declared, visitable
 * route. `/designers/:slug` may not exist without `/designers`, because the
 * breadcrumb renders `/designers` as a link and a link that 404s is a bug.
 * `findMissingAncestors` is what enforces it; CI fails on a non-empty result.
 */

export interface RouteDefinition {
  /** react-router path pattern. Parameterised segments look like `:slug`. */
  path: string;
  /**
   * Human-readable crumb label for this route's own segment.
   *
   * Lower case, because the trail reads as one sentence: `home › account`.
   *
   * Only meaningful for a STATIC segment. On a parameterised route the label
   * is the same for every instance — `/designers/:slug` is "studio" for every
   * studio — so the concrete segment wins instead and the label goes unused;
   * see `crumbsFor`. A page that knows the real name supplies it at runtime
   * with `useCrumbTitles`, for its own crumb or an ancestor's.
   */
  label: string;
  /** The route is behind `ProtectedRoute` and needs a session to resolve. */
  requiresAuth?: boolean;
  /**
   * The session must also hold this role, or `ProtectedRoute` bounces to home.
   * The breadcrumb guard reads this to sign in as the right kind of user;
   * without it an admin route would look like a dead path to a buyer.
   */
  requiresRole?: 'designer' | 'admin';
  /**
   * Representative values for the `:params` in `path`, so the guard can
   * genuinely visit this route and every descendant's version of it.
   */
  params?: Readonly<Record<string, string>>;
  /** Query string the guard should append when visiting, if the page needs one. */
  search?: string;
}

export const ROUTES = [
  { path: '/', label: 'home' },
  { path: '/login', label: 'sign in' },
  // Without a token the page renders "missing its token"; the guard uses a
  // deliberately invalid one so it lands on the same state the other specs use.
  { path: '/verify', label: 'sign-in link', search: '?token=nonsense' },
  { path: '/account', label: 'account', requiresAuth: true },
  // Public discovery. Every level is a real page, so the trail on a portfolio
  // piece — home > designers > studio > portfolio > project — is all links.
  { path: '/designers', label: 'designers' },
  {
    path: '/designers/:slug',
    label: 'studio',
    params: { slug: 'studio-mercer' },
  },
  {
    path: '/designers/:slug/portfolio',
    label: 'portfolio',
    params: { slug: 'studio-mercer' },
  },
  {
    path: '/designers/:slug/portfolio/:projectSlug',
    label: 'project',
    params: { slug: 'studio-mercer', projectSlug: 'clapham-townhouse' },
  },
  // Admin. `/admin` and `/admin/designers` both exist as real pages because
  // `/admin/designers/:id` implies them, and a breadcrumb link that 404s is a
  // bug — see the standing rule above.
  {
    path: '/admin',
    label: 'admin',
    requiresAuth: true,
    requiresRole: 'admin',
  },
  {
    path: '/admin/designers',
    label: 'designers',
    requiresAuth: true,
    requiresRole: 'admin',
  },
  {
    path: '/admin/designers/:id',
    label: 'review',
    requiresAuth: true,
    requiresRole: 'admin',
    // The page renders "no longer available" inline for an unknown id rather
    // than the 404 route, so the guard can visit it without a fixture profile.
    params: { id: '1' },
  },
] as const satisfies readonly RouteDefinition[];

/** Every path the router serves. A route with no element is a type error. */
export type RoutePath = (typeof ROUTES)[number]['path'];

/**
 * The catch-all. Not a member of `ROUTES` — it is not a place, it is what is
 * rendered when a URL names no place. Kept out of the table on purpose so the
 * guard never treats `*` as a real ancestor.
 */
export const NOT_FOUND_PATH = '*';

/** `/a/b/` -> `['a', 'b']`. Tolerates repeated and trailing slashes. */
export const toSegments = (path: string): string[] =>
  path.split('/').filter(Boolean);

/** `['a', 'b']` -> `/a/b`; the empty case is the root. */
const fromSegments = (segments: readonly string[]): string =>
  segments.length === 0 ? '/' : `/${segments.join('/')}`;

/**
 * Every proper ancestor of a path, root first, excluding the path itself.
 *
 * `/designers/:slug/portfolio` -> `['/', '/designers', '/designers/:slug']`
 * `/account` -> `['/']`
 * `/` -> `[]`
 */
export const ancestorsOf = (path: string): string[] => {
  const segments = toSegments(path);
  return segments.map((_, index) => fromSegments(segments.slice(0, index)));
};

/**
 * The route serving a concrete path, treating `:param` segments as wildcards.
 *
 * Patterns match themselves too, so this also answers "is this ancestor
 * pattern declared?".
 */
export const matchRoute = (
  path: string,
  routes: readonly RouteDefinition[] = ROUTES,
): RouteDefinition | undefined => {
  const target = toSegments(path);
  return routes.find((route) => {
    const pattern = toSegments(route.path);
    if (pattern.length !== target.length) return false;
    return pattern.every(
      (segment, index) => segment.startsWith(':') || segment === target[index],
    );
  });
};

export interface MissingAncestor {
  /** The route whose URL implies a parent that does not exist. */
  route: string;
  /** The ancestor path no route serves. */
  missing: string;
}

/**
 * The guard, as a pure function so it can be asserted on directly.
 *
 * A non-empty result means some route's breadcrumb would render a link to a
 * path nothing serves. Fix it by adding the parent route, not by hiding the
 * crumb.
 */
export const findMissingAncestors = (
  routes: readonly RouteDefinition[] = ROUTES,
): MissingAncestor[] =>
  routes.flatMap((route) =>
    ancestorsOf(route.path)
      .filter((ancestor) => !matchRoute(ancestor, routes))
      .map((missing) => ({ route: route.path, missing })),
  );

/**
 * Substitute fixture values into a pattern so it can actually be visited.
 *
 * Throws rather than visiting a literal `/designers/:slug`, which would 404
 * and report the wrong failure.
 */
export const fillParams = (
  path: string,
  params: Readonly<Record<string, string>> = {},
): string =>
  fromSegments(
    toSegments(path).map((segment) => {
      if (!segment.startsWith(':')) return segment;
      const name = segment.slice(1);
      const value = params[name];
      if (!value) {
        throw new Error(
          `No fixture value for ":${name}" in "${path}". Give the route a \`params\` entry in app/routes.ts so the breadcrumb guard can visit it.`,
        );
      }
      return value;
    }),
  );

/** Last-resort crumb label: `alice-morgan` reads better than nothing at all. */
export const humaniseSegment = (segment: string): string => {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // A malformed escape is not worth failing a render over.
  }
  return decoded.replace(/[-_]+/g, ' ').trim() || segment;
};

export interface Crumb {
  /** The path this crumb stands for. */
  path: string;
  label: string;
  /** The last crumb: the page you are on, so not a link. */
  isCurrent: boolean;
  /**
   * A declared route serves this path, so it is safe to link to.
   *
   * For every route in `ROUTES` this is true of every crumb — that is the
   * rule, and `findMissingAncestors` enforces it. It can only be false on a
   * URL nobody declared (someone hand-typing `/designers/alice` before
   * `/designers` exists), where the honest thing is inert text rather than a
   * link into a 404.
   */
  exists: boolean;
}

/**
 * The trail for a URL, mirroring its segments: `home › subsection › page`.
 *
 * Labels come from the route table where a route claims the path, and fall
 * back to the humanised segment otherwise — never a blank crumb.
 */
export const crumbsFor = (
  pathname: string,
  routes: readonly RouteDefinition[] = ROUTES,
): Crumb[] => {
  const segments = toSegments(pathname);

  const root: Crumb = {
    path: '/',
    label: matchRoute('/', routes)?.label ?? 'home',
    isCurrent: segments.length === 0,
    exists: true,
  };

  return [
    root,
    ...segments.map((segment, index) => {
      const path = fromSegments(segments.slice(0, index + 1));
      const route = matchRoute(path, routes);

      /*
       * A route's label is a placeholder, and only a good one for a STATIC
       * path. Where the matched segment is a parameter, the concrete segment
       * is strictly more informative: `northlight-architects` says which
       * studio, `studio` says nothing. So the label is used only when the
       * route's own segment is not a parameter.
       *
       * A page that knows the real name still overrides this at runtime; this
       * is what the crumb degrades to before that name arrives, or when
       * nothing supplies one.
       */
      const pattern = route ? toSegments(route.path)[index] : undefined;
      const isParameterised = pattern?.startsWith(':') ?? false;
      const label =
        route && !isParameterised ? route.label : humaniseSegment(segment);

      return {
        path,
        label,
        isCurrent: index === segments.length - 1,
        exists: route !== undefined,
      };
    }),
  ];
};
