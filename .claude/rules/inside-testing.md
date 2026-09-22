---
paths:
  - "apps/inside/**/tests/**"
  - "apps/inside/**/*.test.ts"
  - "apps/inside/**/*.spec.ts"
  - "apps/inside/inside-fe/src/**/*.tsx"
  - "apps/inside/scripts/**"
---

# inside: testing

Read with `apps/inside/CLAUDE.md`.

### What to test where

**Backend unit/integration** — `inside-be/src/tests/*.test.ts`, `bun test`.

- **Suites share one process, one server and one database.** `bun test` runs
  every file in a single process, and the modules under test capture their
  config at import — `services/storage/index.ts` reads `UPLOADS_PATH` on
  import, `src/index.ts` builds the Fastify instance on import. Those imports
  stay cached, so giving a suite its own environment isolates nothing. It only
  decides which suite's settings win.
- Get the server with `await getApp()` from `./setup` — already migrated and
  ready. Call `getTestEnv()` if you only need paths. Both memoise their result.
- **Never call `app.close()` in a suite.** Every suite shares one instance, so closing
  it breaks every other suite. Teardown happens once at process exit.
- **Keep suites independent by using unique data, not a clean database.**
  `uniqueEmail()` is in `./setup`. Do the same for filenames and slugs. Never
  write a test that assumes a table is empty, and never bulk-mutate shared
  state — a query like `UPDATE sessions SET expires_at = ...` with no `WHERE`
  will sign out accounts other suites are mid-way through using. Scope every
  write to the row you created.
- Anything imported from `src/` must be imported *after* `getTestEnv()` or
  `getApp()` has run, so that call sets the env first. Use a top-level
  `await import(...)`.
- Tests must never create `database.db` or `uploads/` in the repo. CI fails if
  a run leaves artefacts behind, and a leak means your setup is wrong.
- Drive HTTP with `app.inject()`, not a real listening port. `src/index.ts`
  exports `app` without listening precisely for this.
- Schema work must assert constraints **actually bite** — insert a bad enum
  value and an orphan FK and expect a throw. `PRAGMA foreign_keys` is
  per-connection, so set it on your test connection.

### Test id conventions — `REQ-QUALITY-001`

One suffix, one meaning. The convention drifted once and became actively
misleading: `-missing` came to mean "any failure" and rendered as
`severity="info"`, so a page told a visitor a studio was unlisted when the
backend was down. `portfolio-empty` marked both a genuinely empty list and a
404, so a test asserting it could not tell which it had caught.

| Suffix | Means |
|---|---|
| `-loading` | A request is in flight. |
| `-empty` | A request succeeded and there is genuinely nothing. |
| `-missing` | This specific record does not exist. Only where the page knows that, not "something failed". |
| `-failure` | A request failed. Cause unknown to the surface — `describeFailure` decides the wording. |

No id may mark two conditions. If you need to distinguish a load failure from
an action failure on the same page, they are two ids
(`portfolio-load-failure`, `portfolio-action-failure`), not one used twice.

Every surface that can fail, be empty, or be pending needs one — including the
pending state. `apps/inside/CLAUDE.md` already says "test the in-flight state".
An untestable in-flight state is the same rule broken one step earlier.

**Enforced by `apps/inside/scripts/check-test-ids.mjs`, in CI on every PR touching
`apps/inside`** (REQ-QUALITY-001). It parses every `data-testid`/`testId`
under `inside-fe/src` and fails on:

- A `-missing` or `-empty` id rendered from a branch that tests `isError`
  without also narrowing on a specific status (e.g. `error instanceof
  ApiError && error.status === 404`). This is the #231 shape. The check
  catches it mechanically, not whoever happens to review the diff.
- The same id used at locations that are not mutually exclusive branches of
  one condition. A link-vs-text ternary for one crumb is fine. The same id on
  two unrelated surfaces is not.
- A `testId` handed to `FailureNotice`/`FailureAlert` that does not end
  `-failure`. Both are failure surfaces by construction.
- A suffix that reads as one of the four above but isn't — `-error` where
  `-failure` was meant, `-gone` where `-missing` was meant, and so on.

What it does **not** and cannot check: whether the words inside the alert are
honest. That stays a matter for review.

**False positive?** Add a comment containing `test-id-lint-ignore` and the
reason, on the same line as the attribute or the line above it:

```tsx
{/* test-id-lint-ignore: a render crash, not a query state (REQ-FAIL-001) */}
<Alert severity="error" data-testid="render-error">
```

`error-boundary.tsx` uses this for exactly that reason — a render crash is
REQ-FAIL-001's territory, not this suffix vocabulary's.

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
