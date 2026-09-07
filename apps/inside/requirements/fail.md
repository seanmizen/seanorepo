# REQ-FAIL — What the app does when something breaks

Failure *surfaces*: the render crash, the lost connection, the control that
lets a visitor try again.

Separate from `REQ-STATE-*`, which governs whether a surface is honest about
which of loading / loaded / failed it is in. These are about what the failed
case actually looks like, and whether it is a dead end.

Introduced across #178 and #216, on the machinery #214 provided.

---

## REQ-FAIL-001 — A render crash is themed, logged and recoverable

- **Status:** active
- **Source:** sean
- **Origin:** #178
- **Type:** quality
- **Priority:** P2
- **Statement:** Where a render error is caught, the app shall present a themed
  fallback offering a way to continue.
- **Rationale:** The boundary rendered a bare `<div>Something went wrong.</div>`
  and was mounted OUTSIDE `ThemeProvider`, so a visitor on a dark theme got an
  unstyled white box. It never reset, so one transient crash ended the session
  until a manual browser refresh. And it had no `componentDidCatch`, so the
  error and its component stack were lost entirely — the one moment you most
  want a record is the one that produced none.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/failure-surfaces.spec.ts` › "is themed, announced, and recoverable"
- **Relations:** none

## REQ-FAIL-002 — Losing the network is said once, not once per page

- **Status:** active
- **Source:** sean
- **Origin:** #216
- **Type:** quality
- **Priority:** P2
- **Statement:** While the browser reports no connection, the app shall show a
  single application-level notice.
- **Rationale:** Without one, going offline produced an error *storm*: every
  request in flight failed separately and each surface said, individually, that
  the thing being looked for did not exist. Six honest-looking messages, all
  wrong, for one cause — and the visitor is left believing the site has lost
  their data rather than that their train went into a tunnel.

  Driven by TanStack's `onlineManager` rather than a bare `navigator.onLine`
  listener, so the banner and the query layer cannot disagree: the same value
  decides both what is displayed and whether queries are paused.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/failure-surfaces.spec.ts` › "says so once, at app level, rather than once per failed page"
  - Test — `apps/inside/inside-fe/tests/e2e/failure-surfaces.spec.ts` › "recovers without a manual refresh"
- **Relations:** refines REQ-STATE-001

## REQ-FAIL-003 — A failure offers a control that actually retries

- **Status:** active
- **Source:** sean
- **Origin:** #216
- **Type:** functional
- **Priority:** P2
- **Statement:** Where a request has failed, the surface shall offer a control
  that re-issues it.
- **Rationale:** The app contained three "Try again." strings and no retry.
  All three were prose inside an alert, instructing the visitor to re-click
  something themselves; `refetch` was not called from any component in the
  codebase. Telling somebody to try again while giving them nothing to press is
  worse than saying nothing, because it implies a control exists.

  It matters more since REQ-NET-006 stopped retrying timeouts automatically:
  failing fast is only the better trade if the visitor can choose to wait.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/failure-surfaces.spec.ts` › "the retry button refetches, and succeeds once the server does"
- **Relations:** depends-on REQ-NET-006

## REQ-FAIL-004 — A route crash never shows a stack trace

- **Status:** active
- **Source:** sean
- **Origin:** #178
- **Type:** constraint
- **Priority:** P1
- **Statement:** The router shall render the app's own fallback for a render
  error inside a route.
- **Rationale:** React Router catches a render error inside a route **before**
  any React error boundary above the router sees it. Without an `errorElement`
  it renders its own fallback — a page headed "Unexpected Application Error!"
  carrying the exception message and a full stack trace, in production, to
  whoever tripped it.

  That is the frontend twin of the leak REQ-NET-008 closed on the backend, and
  it was found the same way: by writing a test that deliberately crashed a
  page and looking at what a visitor would actually see.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/failure-surfaces.spec.ts` › "is themed, announced, and recoverable"
- **Relations:** refines REQ-FAIL-001
