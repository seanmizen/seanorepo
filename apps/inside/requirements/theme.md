# REQ-THEME — Light, dark and auto

Three-state theming, persisted to `localStorage['theme-mode']`. Added with the
scaffold in #143.

Only two requirements here, both for things that are quietly breakable. The
rest of the theming rules — one source of truth in `ThemeModeContext`, no
hardcoded colours in components — are ordinary code review matters and stay as
prose in `apps/inside/CLAUDE.md`.

---

## REQ-THEME-001 — Auto follows the OS until the visitor chooses

- **Status:** active
- **Source:** sean
- **Origin:** #143
- **Type:** functional
- **Priority:** P3
- **Statement:** While the theme mode is auto, the app shall follow the
  operating system's colour scheme, including a change made while the page is
  open.
- **Rationale:** Auto is the default, so this is what most visitors get.
  Following the OS only at load looks correct in every test that reloads and
  wrong for the one case that matters — a machine flipping to dark on schedule
  while someone is reading. An explicit light or dark choice is never
  overridden by the OS afterwards; that is what makes it explicit.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/theme.spec.ts` › "follows a live OS theme change while on auto"
  - Test — `apps/inside/inside-fe/tests/e2e/theme.spec.ts` › "an explicit choice is not overridden by the OS"
- **Relations:** none

## REQ-THEME-002 — The first paint is already the right theme

- **Status:** active
- **Source:** sean
- **Origin:** #143
- **Type:** quality
- **Priority:** P2
- **Statement:** The app shall render its first paint in the visitor's current
  theme, without displaying another theme first.
- **Rationale:** A dark-mode visitor flashed a white page is the most
  noticeable defect in the app, and it happens on every navigation until it is
  fixed. Avoiding it needs a blocking script in `public/index.html` that runs
  before paint — which means the stored theme is read by that script and
  written by React, two places that must agree on the storage key. Nothing
  connects them but this requirement: rename the key in one place and the flash
  returns silently, with every other theme test still passing.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/theme.spec.ts` › "does not flash the wrong theme before hydrating"
- **Relations:** none
