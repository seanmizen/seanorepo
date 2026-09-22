---
paths:
  - "apps/inside/inside-fe/**"
---

# inside: frontend

Read with `apps/inside/CLAUDE.md`.

## Routing and navigation

`inside-fe/src/app/routes.ts` declares the routes as **data**. The router,
the breadcrumb and the guard that polices both all read that one
table — never from a second list kept alongside it.

### NO DEAD INTERMEDIATE PATHS — a standing constraint, not a one-off

**Every ancestor of every route must itself be a real, visitable page.**
`REQ-NAV-001`, with `REQ-NAV-002` covering URLs nobody declared.

If `/designers/:slug` exists, `/designers` must exist and render something
worth landing on. The breadcrumb renders every intermediate segment as a link,
so a parent that 404s is a broken link the app itself is offering. This is a
rule about route *design*: no ticket may introduce a nested URL without also
providing its parent. `/me` and `/admin` arrive with their own feature tickets
and must comply the moment they do — `/me/projects/:id` requires both `/me`
and `/me/projects`.

`findMissingAncestors` in `routes.ts` enforces it, and
`tests/e2e/navigation.spec.ts` fails CI on a non-empty result and again on any
ancestor that does not actually resolve in a browser. The guard reads the route
table, so a nested route added without its parent fails **without anyone
touching the test**. Do not work around a failure by hiding the crumb — add the
parent page.

### Adding a route

1. Add it to `ROUTES` with a lower-case `label` (the crumb reads
   `home › subsection › page`, one sentence).
2. Give it an element in `ELEMENTS` in `router.tsx`. `RoutePath` types it,
   so a route with no element — or an element with no route — is a
   compile error.
3. Parameterised? Give it `params` with a representative fixture value, or the
   guard cannot visit it. Needs a session? Set `requiresAuth`. Needs a query
   string to render? Set `search`.
4. Add its parent if the URL is nested. Non-negotiable, see above.
5. Add it to `a11y.spec.ts` and `keyboard.spec.ts` like any other route.

### Crumb labels — `REQ-NAV-003`

A crumb shows the best name available, in this order: a real name supplied by
the page at runtime, then — for a **static** segment only — the route table's
`label`, then the humanised URL segment. A crumb is never blank.

The crumb skips the label for a **parameterised** segment, because the label
cannot tell one instance from another: the table calls `/designers/:slug`
"studio",
which would read the same for every studio. The concrete segment
(`northlight-architects` → "northlight architects") is strictly more
informative, so it wins until a real name arrives.

Pages supply real names with `useCrumbTitles({ [path]: name })`, keyed **by
path** rather than "the current page" — a nested page knows its ancestors'
names too, and a placeholder in the middle of a trail is as unhelpful as one at
the end. A portfolio piece names both itself and the studio above it. Entries
that are `undefined` or blank do nothing, so passing `data?.name` straight
through degrades gracefully while loading. The hook clears every name on unmount
so a name never leaks onto the next page. `useBreadcrumbTitle(name)` remains as
a thin wrapper for the common case of naming only your own crumb.

Because any crumb's wording can be replaced at runtime, tests that need to
identify a crumb structurally select it by `href`, not by accessible name.

A crumb only becomes a **link** when a route actually serves that path. On a
URL nobody declared, the intermediate crumbs are inert text rather than an
invitation into a 404.

### Layout

`RootLayout` renders the breadcrumb for every route, so pages never opt in. The
fixed furniture has assigned corners and they must stay clear of each other at
375px: status chips top-left, theme toggle top-right, breadcrumb below the
chips on the left. `navigation.spec.ts` asserts they do not collide.

## Never assert what you have not verified — `REQ-STATE-001` … `REQ-STATE-004`

**Loading, loaded and failed are three distinct states, and every surface must
make clear which one it is in.**

This is not a style preference. The backend status chip once rendered green
with the tooltip "API reachable" while its request was still in flight — the
app telling the user something it did not know. A fallback that looks identical
to real data is a lie with a happy path.

Rules:

- **Derive every presentation from ONE value.** When label, colour and tooltip
  each branch on the query separately, they will eventually disagree. Compute a
  single status (`'checking' | 'ok' | 'down'`) and map it to a presentation, so
  a contradictory combination is unrepresentable rather than merely unlikely.
- **A pending state must never look like a successful one.** Not green, not a
  reassuring word, not a plausible placeholder. Neutral or explicitly unknown.
- **Do not invent content for data you have not received.** `data?.x ?? 'some
  default'` renders a guess that is indistinguishable from the truth. Use a
  skeleton while pending, and render nothing rather than a fabrication on
  failure. The exception is genuinely static branding that never came from the
  server — the site's own name is not "data".
- **Handle the failure branch explicitly.** `isError` collapsing into the
  success path is the same bug wearing a different hat.
- **Test the in-flight state.** Most netcode bugs live there and never appear
  in a test that only covers success and failure. Playwright can hold a
  response open (`route.fulfill` after a delay) — use it.

## Theming — `REQ-THEME-001`, `REQ-THEME-002`

MUI, three-state light / dark / auto, persisted to `localStorage['theme-mode']`.

- One source of truth: `ThemeModeContext`. Components read it via
  `useThemeMode()`. Never keep a second copy of the mode in local state.
- `auto` subscribes to `matchMedia`, so the app follows a live OS theme change
  without a reload. Keep that.
- A blocking script in `public/index.html` sets the body class pre-paint to
  avoid a flash. It must read the same key the app writes.
- The current palette is a restrained neutral placeholder. The real editorial
  identity is a separate ticket — don't scatter hardcoded colours in
  components. Extend `app/theme.ts`.
