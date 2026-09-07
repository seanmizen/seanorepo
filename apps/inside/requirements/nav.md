# REQ-NAV — Routing and navigation

Routes are declared as data in `inside-fe/src/app/routes.ts`. The router, the
breadcrumb and the guard that polices both are all built from that one table.

Introduced in #176; crumb naming corrected in #200.

---

## REQ-NAV-001 — No dead intermediate paths

- **Status:** active
- **Source:** sean
- **Origin:** #176
- **Type:** constraint
- **Priority:** P1
- **Statement:** Every ancestor path of every declared route shall itself be a
  declared route that resolves to a real page.
- **Rationale:** The breadcrumb renders every intermediate segment as a link,
  so an ancestor that 404s is a broken link the app is offering the visitor
  itself. This is a rule about route *design*, not about the breadcrumb: no
  ticket may introduce a nested URL without also providing its parent —
  `/designers/:slug` may not exist without `/designers`. The guard is driven
  off the route table rather than a hand-maintained list, so a nested route
  added without its parent fails without anyone touching the test. The
  forbidden workaround is hiding the crumb; the fix is adding the page.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/navigation.spec.ts` › "every ancestor of every route is itself a declared route"
  - Test — `apps/inside/inside-fe/tests/e2e/navigation.spec.ts` › "the guard catches a nested route with no parent"
- **Relations:** none

## REQ-NAV-002 — A crumb is a link only where a route serves it

- **Status:** active
- **Source:** sean
- **Origin:** #176
- **Type:** constraint
- **Priority:** P2
- **Statement:** The breadcrumb shall render an intermediate crumb as inert
  text wherever no declared route serves that path.
- **Rationale:** The counterpart to REQ-NAV-001, covering the paths that rule
  cannot reach. REQ-NAV-001 guarantees the ancestors of *declared* routes
  resolve; this one covers a URL nobody declared, where the app must not
  fabricate an invitation into a 404 out of the segments it happens to find.
  Together they mean the app never offers a link it cannot honour.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/navigation.spec.ts` › "renders the 404 page and never offers a dead link"
- **Relations:** depends-on REQ-NAV-004

## REQ-NAV-003 — A crumb shows the most specific name available

- **Status:** active
- **Source:** sean
- **Origin:** #200
- **Type:** functional
- **Priority:** P2
- **Statement:** The breadcrumb shall label each crumb with the most specific
  name available to it: a real name supplied at runtime, then a route label for
  a static segment, then the humanised URL segment.
- **Rationale:** A route label is fixed per route, so on a parameterised path it
  is identical for every instance — `/designers/:slug` labelled "studio" reads
  the same for every studio, which tells the visitor nothing and is strictly
  worse than the slug already in the URL. Names are therefore keyed by path
  rather than by "the current page", so a nested page can name its ancestors:
  a portfolio piece knows the studio it belongs to. A crumb is never blank, and
  never a placeholder where something concrete exists.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/navigation.spec.ts` › "a nested portfolio piece names its whole trail"
  - Test — `apps/inside/inside-fe/tests/e2e/navigation.spec.ts` › "degrades to the slug, never to a placeholder"
- **Relations:** depends-on REQ-NAV-004

## REQ-NAV-004 — The trail is rendered once, for every route

- **Status:** active
- **Source:** sean
- **Origin:** #176
- **Type:** constraint
- **Priority:** P3
- **Statement:** The root layout shall render the breadcrumb for every route,
  without a page opting in.
- **Rationale:** What makes REQ-NAV-001's guarantee hold for routes added
  later. If a page had to opt in, the first route someone forgot to opt in
  would lose its trail silently, and the guard — which reads the route table —
  would still pass. Rendering it once from the layout means a new route gets
  the trail by existing.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/navigation.spec.ts` › "reads \"home › account\" on the signed-in account page"
- **Relations:** none
