# REQ-CHIPS — Status chip chrome

Deployment status chips for `inside`: the floating stack at the top-left that
reports which backend the app is talking to and whether it is reachable.

Introduced in #174. `REQ-CHIPS-001` was stated in #198 after #197 broke it.

> **Scope.** This file covers the chips as *chrome* — where they sit, how they
> are composed, when they appear. What the chips are allowed to **claim** is
> governed by the "never assert what you have not verified" principle, which
> becomes `REQ-QUALITY-*` in the retrospective pass and is verified against
> this component.

---

## REQ-CHIPS-001 — Chips are fixed-position chrome

- **Status:** active
- **Source:** sean
- **Origin:** #198
- **Type:** constraint
- **Priority:** P2
- **Statement:** The status chip stack shall be rendered as fixed-position
  chrome, outside normal document flow.
- **Rationale:** In #197 the chips were moved into the site header's normal
  flow to resolve a layout collision. That silently dropped this requirement,
  because at the time it was written down nowhere — it existed only as an
  intention. #198 reverted the change and added the assertions below so the
  same trade cannot be made again without a test going red and someone having
  to argue for it. When a future layout collision recurs, the header yields;
  the chips do not move into flow. See REQ-CHIPS-004.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "are fixed-position, not in normal flow"
  - Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "stay put when the page scrolls"
- **Relations:** none

## REQ-CHIPS-002 — Chips anchor top-left and stack downwards

- **Status:** active
- **Source:** sean
- **Origin:** #174
- **Type:** constraint
- **Priority:** P3
- **Statement:** The status chip stack shall be anchored to the top-left of the
  viewport and lay its chips out vertically, each new chip appending below the
  last.
- **Rationale:** The fixed furniture has assigned corners so it stays clear of
  itself at 375px: chips top-left, theme toggle top-right, breadcrumb trail
  below the chips. Stacking downwards rather than sideways is what lets chips
  be added without renegotiating the horizontal budget shared with the header.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "the backend chip sits below the dev chip, top-left"
- **Relations:** refines REQ-CHIPS-001

## REQ-CHIPS-003 — The backdrop is translucent, the content is not

- **Status:** active
- **Source:** sean
- **Origin:** #198
- **Type:** quality
- **Priority:** P2
- **Statement:** The status chip stack shall draw a translucent background
  while keeping its own content fully opaque.
- **Rationale:** The stack floats over arbitrary page content, so it needs a
  backdrop to stay legible. Fading the *element* rather than its *background*
  fades the chip text with it — which cost the green chip its contrast (4.25:1
  against the composited ground) and defeated the purpose of having a
  legibility backdrop at all. The distinction is the requirement.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "are translucent, so content shows through"
- **Relations:** refines REQ-CHIPS-001

## REQ-CHIPS-004 — Chips never cover the header brand or navigation

- **Status:** active
- **Source:** sean
- **Origin:** #198
- **Type:** constraint
- **Priority:** P1
- **Statement:** The status chip stack shall not overlap the site header's
  brand or navigation at any supported viewport width.
- **Rationale:** Fixed chrome overlays everything beneath it, so without this
  the chips hide the brand at narrow widths. This is the collision that #197
  tried to resolve by moving the chips into flow, breaking REQ-CHIPS-001. The
  resolution recorded here is the opposite and is deliberate: the header
  reserves left padding and moves aside for the chips, not the other way round.
  Supported widths are 375, 768 and 1280.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "never cover the header brand or nav"
- **Relations:** depends-on REQ-CHIPS-001

## REQ-CHIPS-005 — Chips appear on every route

- **Status:** active
- **Source:** sean
- **Origin:** #174
- **Type:** functional
- **Priority:** P3
- **Statement:** The status chip stack shall be rendered on every route,
  whether or not a visitor is signed in.
- **Rationale:** The chips answer "which backend am I looking at, and is it
  up?", which is a question that arises anywhere in the app rather than on a
  particular page. Rendering them once in the root provider — rather than
  per-page — is what makes this hold for routes added later without anyone
  opting in.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "shows the dev chip and backend chip on /"
  - Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "shows them on a signed-in route too"
- **Relations:** none

## REQ-CHIPS-006 — The dev chip is shown only when the server says so

- **Status:** active
- **Source:** sean
- **Origin:** #174
- **Type:** constraint
- **Priority:** P1
- **Statement:** Where the server reports a non-production backend, the status
  chip stack shall show the dev chip.
- **Rationale:** The chip marks a non-production backend, so it must be driven
  by what the server actually reports rather than by a build-time flag in the
  bundle. A bundle-derived flag says what the frontend was compiled to believe,
  which is not the same claim and would show a production visitor a dev badge —
  or, worse, hide it from someone who really is on a dev backend.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "the dev chip is driven by the server, not the bundle"
- **Relations:** refines REQ-CHIPS-005
