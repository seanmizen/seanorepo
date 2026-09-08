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
  to argue for it. When a future layout collision recurs, the header yields.
  The chips do not move into flow. See REQ-CHIPS-004.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "are fixed-position, not in normal flow"
  - Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "stay put when the page scrolls"
- **Relations:** none

## REQ-CHIPS-002 — Chips anchor top-left and stack downwards

- **Status:** superseded
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
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "the chips stack in one column, anchored to a corner"
- **Relations:**
  - refines REQ-CHIPS-001
  - superseded-by REQ-CHIPS-009

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

  **Amended in #222 — the resolution changed, the requirement did not.** The
  header no longer indents at all, because in production there are no chips to
  clear (REQ-CHIPS-008) and the indent left the brand misaligned with the
  breadcrumb trail for a reason invisible to anyone looking at it. The chips
  avoid the header by living at the bottom-left instead (REQ-CHIPS-009). This
  statement holds either way, which is why it is still this requirement.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "never cover the header brand or nav"
- **Relations:** depends-on REQ-CHIPS-001

## REQ-CHIPS-005 — Chips appear on every route

- **Status:** superseded
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
- **Relations:** superseded-by REQ-CHIPS-007

## REQ-CHIPS-007 — Chips appear on every route, until the visitor says otherwise

- **Status:** superseded
- **Source:** sean
- **Origin:** #219
- **Type:** functional
- **Priority:** P3
- **Statement:** While the visitor has not hidden it, the status chip stack
  shall be rendered on every route, whether or not they are signed in.
- **Rationale:** Supersedes REQ-CHIPS-005, which was not wrong so much as
  incomplete: it assumed the card was unconditionally wanted. It is deployment
  chrome — useful to whoever runs the site, noise to everyone else — so it
  became a choice. The every-route guarantee is kept intact, because that was
  never the part in question: the card answers "which backend am I on, and is
  it up?", which is not a per-page question.

  The default is ON, deliberately. A default of OFF would mean the one person
  who needs the card has to go and find it first, which inverts who the setting
  is for. The whole card, never individual chips: which chips exist is a
  property of the deployment rather than a preference, and six switches would
  be a settings page pretending to be a feature.

  Stored per browser rather than per account, because it is a display
  preference — it has no business on the server, and it should differ between
  the laptop you develop on and the phone you demo from. The known cost: a
  signed-out visitor who dismisses the card has no in-app way back, since the
  restore control lives on the account page. Accepted rather than overlooked.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "shows the dev chip and backend chip on /"
  - Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "can be dismissed, and stays dismissed across a reload"
  - Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "can be brought back from the account page"
- **Relations:**
  - supersedes REQ-CHIPS-005
  - superseded-by REQ-CHIPS-008

## REQ-CHIPS-006 — The dev chip is shown only when the server says so

- **Status:** withdrawn
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

  **Withdrawn in #222, subsumed rather than reversed.** REQ-CHIPS-008 made the
  whole card conditional on the same server signal, so by the time this chip
  renders, the answer is already yes — the gate had no remaining observable
  effect, and a test for it could not fail. Two gates on one input is not
  defence in depth. The principle it stood for is unchanged and now lives in
  REQ-CHIPS-008: the server, never the bundle, decides what environment this
  is.
- **Verification:** Inspection — no longer separately observable. See the note below. Its intent is carried by REQ-CHIPS-008, whose tests exercise the same signal.
- **Relations:** refines REQ-CHIPS-007

## REQ-CHIPS-008 — The card exists only outside production

- **Status:** active
- **Source:** sean
- **Origin:** #222
- **Type:** constraint
- **Priority:** P1
- **Statement:** Where the server reports a production backend, the status chip
  stack shall not be rendered.
- **Rationale:** Supersedes REQ-CHIPS-007, which guaranteed the card on every
  route and was therefore wrong in the one place it mattered. The card is
  deployment chrome — which backend am I on, is it up — and a member of the
  public browsing a marketplace has no business seeing it. It was visible in
  production and noticed there, which is how this was found.

  Availability comes from the SERVER, never a build-time flag: the same
  reasoning as REQ-CHIPS-006, for a stronger reason, since this decides what
  the public sees. While the config request is in flight the card stays hidden,
  because a pending state must not be drawn as the permissive one
  (REQ-STATE-002).

  A production visitor cannot dismiss it, restore it, or find a control for it
  — the preference row on the account page appears only where the card can. A
  switch that silently does nothing is worse than no switch.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "is absent entirely when the server reports production"
  - Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "offers no preference control where the card cannot appear"
- **Relations:** supersedes REQ-CHIPS-007

## REQ-CHIPS-009 — The card sits in the bottom-left

- **Status:** active
- **Source:** sean
- **Origin:** #222
- **Type:** constraint
- **Priority:** P2
- **Statement:** The status chip stack shall be anchored to the bottom-left of
  the viewport.
- **Rationale:** Supersedes REQ-CHIPS-002. The top-left anchor forced the site
  header to indent 104-124px to clear it, which left the brand offset from the
  breadcrumb trail beneath it — visibly wrong, and for a reason that does not
  exist in production where there are no chips at all.

  Removing the indent while keeping the chips at the top would have put them on
  the brand, which is the exact trade made in #197 and reverted in #198. Moving
  the card instead satisfies REQ-CHIPS-004 with nothing yielding to it: the
  bottom-left corner is outside the reading path and has nothing to collide
  with. The theme toggle keeps the top-right, the trail keeps its tray, and the
  brand now starts flush with it.
- **Relations:** supersedes REQ-CHIPS-002
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "the chips stack in one column, anchored to a corner"
  - Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "never cover the header brand or nav"
