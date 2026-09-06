# CLAUDE.md — `inside`

Guidance for agents working in `apps/inside`. This file is scoped to this app;
the monorepo-wide rules in the root `CLAUDE.md` still apply.

## What this app is

`inside.seanmizen.com` — "Etsy for interior designers". A marketplace where
architects and interior designers sell themselves, their projects and their
portfolio, and where homeowners and building project managers find them.
Positioning is **high-brow, luxury**: image-first, restrained, editorial.

### Locked product decisions

Do not relitigate these without asking Sean.

- Both sides have accounts. Buyers can browse **fully anonymously** and are
  only asked to sign up at the point of value ("sign up to save this profile").
- Designers self-signup but stay **unlisted until admin-approved**.
- Two connection directions: buyer → designer **enquiries**, and
  **post-a-project** where a buyer posts a brief and designers pitch.
- Assets go through a storage abstraction: local disk now, S3 later.
- Site data is SQLite, kept right next to the runner. Barebones.

### Vocabulary

**One vocabulary, everywhere** — database, API, routes, code and UI copy. Split
vocabularies are where bugs and onboarding confusion breed, so a new concept
gets its name decided once and used identically in all five places.

| Term | Means |
|---|---|
| `portfolio_projects` | a designer's completed work, shown in their portfolio |
| `briefs` | a homeowner's posted job, which designers bid on |
| `bids` | a designer's response to a brief |
| `work_type` | the kind of work: kitchen, extension, new build … |
| `designers` / `buyers` | the two sides of the marketplace |

Two words are deliberately absent. **"Project" alone is banned** — it meant
both a designer's portfolio piece and a client's job, which is exactly the
ambiguity that cost us a rename; say `portfolio_project` or `brief`. And
**"pitch" is banned** — a designer places a `bid`.

Public URL shape:

| Purpose | URL |
|---|---|
| Designer profile | `/designers/:slug` |
| Portfolio piece | `/designers/:slug/portfolio/:slug` |
| Client brief | `/briefs/:slug` |
| A bid (private) | `/bids` |

## Layout

```
inside-fe/   React 19 + RSBuild + MUI + TanStack Query   (port 4060)
inside-be/   Bun + Fastify + SQLite, all routes /api      (port 4061)
shared/      types both sides import as @shared/types
```

## Testing standard

**A feature ticket is not done without tests.** Every PR that adds or changes
behaviour must add unit tests, E2E tests, or both — and they must pass before
merge. CI (`.github/workflows/inside-check.yml`) enforces this on every PR
touching `apps/inside`.

### Commands

| Command | Runs |
|---|---|
| `yarn workspace inside test` | types + unit. Fast, no browser. Run this constantly. |
| `yarn workspace inside test:types` | `tsc --noEmit` on **both** FE and BE |
| `yarn workspace inside test:unit` | backend `bun test` |
| `yarn workspace inside test:e2e` | Playwright against a real FE + BE |
| `yarn workspace inside test:axe` | axe WCAG 2.1 AA scan of every route, light and dark |
| `yarn workspace inside test:all` | everything |

### What to test where

**Backend unit/integration** — `inside-be/src/tests/*.test.ts`, `bun test`.

- **Suites share one process, one server and one database.** `bun test` runs
  every file in a single process, and the modules under test capture their
  config at import — `services/storage/index.ts` reads `UPLOADS_PATH` on
  import, `src/index.ts` builds the Fastify instance on import. Those imports
  are cached, so giving a suite its own environment isolates nothing; it only
  decides which suite's settings win.
- Get the server with `await getApp()` from `./setup` — already migrated and
  ready. Call `getTestEnv()` if you only need paths. Both are memoised.
- **Never call `app.close()` in a suite.** The instance is shared, so closing
  it breaks every other suite. Teardown happens once at process exit.
- **Keep suites independent by using unique data, not a clean database.**
  `uniqueEmail()` is in `./setup`; do the same for filenames and slugs. Never
  write a test that assumes a table is empty, and never bulk-mutate shared
  state — a query like `UPDATE sessions SET expires_at = ...` with no `WHERE`
  will sign out accounts other suites are mid-way through using. Scope every
  write to the row you created.
- Anything imported from `src/` must be imported *after* `getTestEnv()` or
  `getApp()` has run, so the env is set first. Use a top-level
  `await import(...)`.
- Tests must never create `database.db` or `uploads/` in the repo. CI fails if
  a run leaves artefacts behind, and a leak means your setup is wrong.
- Drive HTTP with `app.inject()`, not a real listening port. `src/index.ts`
  exports `app` without listening precisely for this.
- Schema work must assert constraints **actually bite** — insert a bad enum
  value and an orphan FK and expect a throw. `PRAGMA foreign_keys` is
  per-connection, so set it on your test connection.

**Frontend E2E** — `inside-fe/tests/e2e/*.spec.ts`, Playwright.

- Runs the real app against the real backend on ports 4160/4161, so a running
  `yarn start` on 4060/4061 never collides with a test run.
- Prefer **retrying** assertions (`expect(locator).toHaveClass(...)`) over a
  synchronous `page.evaluate()` read. State lands on a React re-render, and a
  bare read races it — this is the single most common flake here.
- Select by role and accessible name, not by CSS class. MUI class names are
  generated and will churn.
- Assert no console errors on any page you add. `smoke.spec.ts` shows the
  pattern.
- **Every new route goes into `a11y.spec.ts` and `keyboard.spec.ts`.** The axe
  scan runs each route in *both* themes — dark-mode contrast is what usually
  breaks — and must report zero WCAG 2.1 AA violations. `test:e2e` excludes the
  `@axe` tag and `test:axe` selects it, so the two never run twice.
- Keyboard cover is separate because axe cannot see it: whether a control is
  reachable by Tab and whether focus is *visible* are runtime properties. The
  focus ring is a theme concern — `app/theme.ts` defines it once for everything
  focusable. Do not restyle focus per component.
- Share fixtures via `tests/e2e/helpers.ts` (`signIn`, `uniqueEmail`,
  `waitForApp`). `signIn` must not return until the URL has left *both*
  `/login` and `/verify`, or the sign-in silently doesn't stick.

### Bar for new work

- New API route → an `app.inject()` test for the happy path, the auth failure,
  and at least one validation failure.
- New migration → tests for fresh apply, idempotency on reboot, and every new
  `CHECK`/FK constraint.
- New user-facing flow → an E2E spec walking it as a user would.
- New shared module (storage, images, email) → contract tests written against
  the interface, not the implementation, so a future provider passes unchanged.
- New route → an entry in `inside-fe/src/app/routes.ts`, plus its parent route
  if the URL is nested. See the routing rule below.

## Routing and navigation

Routes are declared as **data** in `inside-fe/src/app/routes.ts`. The router,
the breadcrumb and the guard that polices both are all built from that one
table — never from a second list kept alongside it.

### NO DEAD INTERMEDIATE PATHS — a standing constraint, not a one-off

**Every ancestor of every route must itself be a real, visitable page.**

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
2. Give it an element in `ELEMENTS` in `router.tsx`. It is typed by
   `RoutePath`, so a route with no element — or an element with no route — is a
   compile error.
3. Parameterised? Give it `params` with a representative fixture value, or the
   guard cannot visit it. Needs a session? Set `requiresAuth`. Needs a query
   string to render? Set `search`.
4. Add its parent if the URL is nested. Non-negotiable, see above.
5. Add it to `a11y.spec.ts` and `keyboard.spec.ts` like any other route.

### Crumb labels

The route table's `label` is the fallback. A page that knows a better name at
runtime — a designer's studio name, a project's title — calls
`useBreadcrumbTitle(name)` and owns its own crumb; passing `null` while the
name is still loading falls back to the label, and then to the humanised URL
segment. A crumb is never blank.

A crumb only becomes a **link** when a route actually serves that path. On a
URL nobody declared, the intermediate crumbs are inert text rather than an
invitation into a 404.

### Layout

`RootLayout` renders the breadcrumb for every route, so pages never opt in. The
fixed furniture has assigned corners and they must stay clear of each other at
375px: status chips top-left, theme toggle top-right, breadcrumb below the
chips on the left. `navigation.spec.ts` asserts they do not collide.

## Conventions

- **Bun is the runtime only.** Package management is Yarn 4. Never
  `bun install` or `bun build`.
- **Migrations are additive.** Never edit an applied migration; add
  `NNN_name.sql`. The runner tracks by presence (not a `MAX(version)`
  high-water mark) and wraps each file's DDL plus its tracking row in one
  transaction.
- **SQL is snake_case, TypeScript is camelCase.** Keep `shared/types.ts` in
  step with the schema.
- **Storage goes through `StorageProvider`.** Never touch the filesystem
  directly from a controller. Image resizing lives in `services/images.ts`,
  *above* the provider, so the provider stays a pure blob store and the S3 swap
  is one new file.
- **Admin routes** go inside the encapsulated scope in `controllers/index.ts`,
  which attaches the guard as an `onRequest` hook. Never bolt a guard onto an
  individual admin route — the scope makes protection structural.
- **Secrets fail hard.** `JWT_SECRET` and `COOKIE_SECRET` throw in production
  if unset or left at the dev default. Do not soften this to a warning.
- **Never commit** `.env`, `dist/`, `*.db`, or `uploads/`.
- The frontend's API base is baked in at **build time** via rsbuild
  `source.define`. There is deliberately no runtime hostname detection — do not
  add a second strategy.

## Auth

Magic link only; there are no passwords. See `services/auth.ts`,
`services/session.ts`, `middleware/auth.ts`.

- **Roles are `buyer`, `designer`, `admin`.** `admin` comes *only* from the
  `ADMIN_EMAILS` env whitelist — it is never accepted from a request body.
- **Logging in never rewrites an existing user's buyer/designer role.** That
  role is chosen once at signup and owns the link to their profile and
  portfolio.
- **Session TTL and cookie `maxAge` are both derived from `SESSION_TTL_MS`.**
  If you change one, change it there — a mismatch silently 401s users who still
  hold a cookie the browser considers valid.
- Sessions store `sha256(jwt)`, never the raw token. Middleware checks the
  signature **and** that the session is unrevoked, or logout would be cosmetic.
- **`GET /api/auth/me` answers 200 with `user: null` when signed out.**
  Anonymous browsing is a first-class flow, so "nobody" is an answer, not an
  error. A cookie that is present but invalid or revoked still 401s. Keep this
  shape for any other endpoint an anonymous visitor hits on page load.
- **Validate `returnTo` on both sides** with the existing helpers
  (`safeReturnTo`). Relative paths only — reject protocol-relative URLs like
  `//evil.example`, which a leading-slash check lets through.
- Guard routes by putting them in an encapsulated scope with `requireRole(...)`
  as an `onRequest` hook. A Fastify v5 async hook must **return** the reply to
  halt the lifecycle; awaiting `reply.send()` alone lets the handler run and
  send twice.
- Local dev and E2E use `DANGEROUS_BYPASS_EMAIL_MAGIC_LINK=true`, which returns
  the link in the response instead of emailing it. It is ignored in production.
- The frontend's `AuthProvider` boot check defers to an explicit sign-in or
  sign-out, because on `/verify` it races the sign-in and would otherwise
  overwrite a fresh session with `null`. Preserve that guard.

## Build the state you need, not the state you imagine

`inside` is pre-launch. Every speculative branch is a thing that must be
reasoned about, tested around and migrated later, in service of a workflow
nobody has committed to — and it makes a pivot more expensive exactly when
pivoting should still be cheap.

What this looked like in practice: `pitches.status` shipped with six values —
`sent`, `read`, `shortlisted`, `accepted`, `declined`, `withdrawn` — and **no
code set or read a single one of them**. There was only a create route; no
transition existed. Meanwhile `draft`, the one state the product actually
wanted, was not among them. `briefs.status` had `awarded`, which nothing could
produce, guarded by three branches defending against an impossible condition.

Rules:

- **A state earns its place when something can put a record into it and
  something else behaves differently because of it.** Until then it is a
  comment pretending to be a constraint.
- **Do not add a status column "for later".** Later has different requirements
  than the ones you are imagining, and by then the value is in the schema, the
  types, the validators and half the tests.
- **Prefer a boolean or a nullable timestamp to an enum** when there are two
  real states. `submitted_at IS NULL` says everything a `draft`/`submitted`
  pair does, with nothing left to invent.
- **Resist workflow coupling.** A bid knows about its brief. It does not need
  to know about shortlisting, awarding, or a buyer's decision process that has
  not been designed.
- **Idempotent beats stateful.** "Start a bid" and "continue my draft" are the
  same intent, so they are the same endpoint returning the same row — the UI
  does not have to know which state it is in, and there is no third state to
  get stuck in.

## Never assert what you have not verified

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

## Theming

MUI, three-state light / dark / auto, persisted to `localStorage['theme-mode']`.

- One source of truth: `ThemeModeContext`. Components read it via
  `useThemeMode()`. Never keep a second copy of the mode in local state.
- `auto` subscribes to `matchMedia`, so a live OS theme change is followed
  without a reload. Keep that.
- A blocking script in `public/index.html` sets the body class pre-paint to
  avoid a flash. It must read the same key the app writes.
- The current palette is a restrained neutral placeholder. The real editorial
  identity is a separate ticket — don't scatter hardcoded colours in
  components; extend `app/theme.ts`.

## Ports

| | Cloudflared | Fly.io | E2E |
|---|---|---|---|
| Frontend | 4060 | 5060 (reserved) | 4160 |
| Backend | 4061 | 5061 (reserved) | 4161 |

Cloudflared ingress for `inside.seanmizen.com` **must stay above** the
`*.seanmizen.com` wildcard in `apps/cloudflared/config.yml`, or the wildcard
swallows it and serves seanmizen.com instead.
