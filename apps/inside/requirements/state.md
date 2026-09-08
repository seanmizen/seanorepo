# REQ-STATE — Never assert what you have not verified

Loading, loaded and failed are three distinct states, and every surface that
depends on a request must make clear which one it is in.

Introduced in #183, after the backend status chip rendered green with the
tooltip "API reachable" while its request was still in flight — the app telling
the visitor something it did not know. A fallback that looks identical to real
data is a lie with a happy path.

---

## REQ-STATE-001 — Three states, always distinguishable

- **Status:** active
- **Source:** sean
- **Origin:** #183
- **Type:** quality
- **Priority:** P1
- **Statement:** Every surface whose content depends on a request shall present
  loading, loaded and failed as visibly distinct states.
- **Rationale:** The parent requirement for this area. Collapsing three states
  into two always loses the same one — in-flight gets drawn as either success
  or failure, and success is the tempting choice because it needs no extra
  design work. Most netcode bugs live in the state that was never drawn, and
  they do not appear in tests that only cover success and failure.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/smoke.spec.ts` › "surfaces an unreachable backend rather than failing silently"
- **Relations:** none

## REQ-STATE-002 — A pending state never looks like a successful one

- **Status:** active
- **Source:** sean
- **Origin:** #183
- **Type:** quality
- **Priority:** P1
- **Statement:** While a request is in flight, its surface shall not present
  any indication of success.
- **Rationale:** The original failure, stated as a rule. Not green, not a
  reassuring word, not a plausible placeholder — neutral or explicitly unknown.
  A pending state dressed as success is worse than no indicator at all, because
  the visitor now has a reason to trust something nobody has checked.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "never claims the backend is reachable before a response lands"
- **Relations:**
  - refines REQ-STATE-001
  - depends-on REQ-STATE-004

## REQ-STATE-003 — Content is never invented for data that has not arrived

- **Status:** active
- **Source:** sean
- **Origin:** #183
- **Type:** quality
- **Priority:** P1
- **Statement:** A surface shall render no value in place of data it has not
  received.
- **Rationale:** `data?.x ?? 'some default'` renders a guess that is
  indistinguishable from the truth, and the visitor has no way to tell which
  one they are looking at. A skeleton while pending, and nothing rather than a
  fabrication on failure. The single exception is genuinely static branding
  that never came from the server — the site's own name is not data.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "the tagline is not invented while config is loading"
  - Test — `apps/inside/inside-fe/tests/e2e/status-chips.spec.ts` › "the page never invents a link the server did not send"
  - Test — `apps/inside/inside-fe/tests/e2e/failure-surfaces.spec.ts` › "/me says the load failed rather than inviting a setup"
  - Test — `apps/inside/inside-fe/tests/e2e/failure-surfaces.spec.ts` › "/me/profile says so rather than showing a blank new profile"
  - Test — `apps/inside/inside-fe/tests/e2e/failure-surfaces.spec.ts` › "a portfolio that failed to load is not a portfolio of nothing"
- **Relations:** refines REQ-STATE-001

## REQ-STATE-004 — One value drives every part of a presentation

- **Status:** active
- **Source:** sean
- **Origin:** #183
- **Type:** constraint
- **Priority:** P2
- **Statement:** Where a surface presents a request's status, its label, colour
  and description shall all derive from a single computed status value.
- **Rationale:** This is the mechanism that makes REQ-STATE-002 hold rather
  than merely being intended. When label, colour and tooltip each branch on the
  query separately, they will eventually disagree — which is exactly how a
  green chip acquired an "API reachable" tooltip during a pending request.
  Computing one status and mapping it to a presentation makes a contradictory
  combination unrepresentable rather than unlikely.
- **Verification:** Analysis — `apps/inside/inside-fe/src/components/status-chips.tsx` derives `'checking' | 'ok' | 'down'` once and indexes a single `BACKEND_PRESENTATION` map with it, so no caller can select label, colour and tooltip independently.
- **Relations:** refines REQ-STATE-001
