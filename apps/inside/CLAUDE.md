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

"Project" is overloaded here. Keep these straight:

| Term | Means |
|---|---|
| `projects` | a designer's completed work, shown in their portfolio |
| `briefs` | a homeowner's posted job, which designers pitch on |
| `pitches` | a designer's response to a brief |

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

### Bar for new work

- New API route → an `app.inject()` test for the happy path, the auth failure,
  and at least one validation failure.
- New migration → tests for fresh apply, idempotency on reboot, and every new
  `CHECK`/FK constraint.
- New user-facing flow → an E2E spec walking it as a user would.
- New shared module (storage, images, email) → contract tests written against
  the interface, not the implementation, so a future provider passes unchanged.

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
