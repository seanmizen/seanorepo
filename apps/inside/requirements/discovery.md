# REQ-DISCOVERY — What the public can see, and how they find it

The buyer-facing surfaces: the designer list, filtering, profiles and portfolio
pieces. API in #156, pages in #160, filter contract in #190.

Visibility here is an authorisation concern, not a presentation one — the first
two requirements below are about what the server refuses to serve, not about
what the list happens to render.

---

## REQ-DISCOVERY-001 — An unapproved profile is unreachable, not merely unlisted

- **Status:** superseded
- **Source:** sean
- **Origin:** #156
- **Type:** constraint
- **Priority:** P0
- **Statement:** The system shall refuse to serve an unapproved designer
  profile even when its slug is requested directly.
- **Rationale:** Omitting a profile from the list is a presentation choice.
  Refusing to serve it is the actual control. The server derives slugs from
  studio names, which makes them guessable, and a designer awaiting review has every
  reason to share their own URL — so "not in the list" would leave the profile
  publicly readable to anyone who tried. This is the requirement that makes
  REQ-PRODUCT-002 mean something, rather than describing a default sort order.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/discovery.spec.ts` › "an unapproved studio is unreachable by guessing its slug"
  - Test — `apps/inside/inside-be/src/tests/domain-schema.test.ts` › "a new profile is invisible to a discovery-shaped query"
- **Relations:**
  - refines REQ-PRODUCT-002
  - superseded-by REQ-DISCOVERY-004

## REQ-DISCOVERY-002 — Unpublished work is not served

- **Status:** active
- **Source:** sean
- **Origin:** #153
- **Type:** constraint
- **Priority:** P1
- **Statement:** The system shall exclude an unpublished portfolio piece from
  every public response, including a direct request for it.
- **Rationale:** A separate gate from REQ-DISCOVERY-001 and easy to conflate
  with it: an approved designer may still have work in progress. Draft work is
  unfinished by definition — wrong images, placeholder copy, a client who has
  not agreed to be named — and publishing it early is a reputational cost borne
  by the designer, not by us.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/discovery.spec.ts` › "hides unpublished work"
  - Test — `apps/inside/inside-fe/tests/e2e/discovery.spec.ts` › "an unpublished piece is not reachable"
- **Relations:** none

## REQ-DISCOVERY-003 — Filter state lives in the URL

- **Status:** active
- **Source:** sean
- **Origin:** #190
- **Type:** constraint
- **Priority:** P2
- **Statement:** The discovery filters shall take their state from the URL, so
  that the same URL reproduces the same view.
- **Rationale:** A filtered search is the thing a buyer wants to send to a
  partner, keep in a tab, or come back to tomorrow, and none of that works if
  the state lives in component memory. Making the URL the source rather than a
  mirror is what stops the two drifting: there is no second copy to fall out of
  step, a nonsense value in the URL degrades instead of blanking the page, and
  filter changes replace history entries rather than piling up a back button
  the visitor has to press eleven times.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/filters.spec.ts` › "the URL drives the state, not the other way round"
  - Test — `apps/inside/inside-fe/tests/e2e/discovery.spec.ts` › "a filtered URL reproduces the same view when shared"
  - Test — `apps/inside/inside-fe/tests/e2e/filters.spec.ts` › "a nonsense filter in the URL does not blank the page"
- **Relations:** none

## REQ-DISCOVERY-004 — An unapproved profile is served to its owner and to nobody else

- **Status:** active
- **Source:** sean
- **Origin:** #249
- **Type:** constraint
- **Priority:** P0
- **Statement:** The system shall refuse to serve an unapproved designer profile to
  every requester except the designer that profile belongs to.
- **Rationale:** REQ-DISCOVERY-001 was right about the control and incomplete about
  who it binds. Refusing the slug outright is what makes REQ-PRODUCT-002 mean
  something rather than describing a sort order — but it also refuses the one person
  who has to reach the page, because a designer builds the profile that earns the
  approval. That was invisible while the editor lived at a second address. Retiring
  `/me` removes the second address, so the owner reaches their profile at its own.

  Nothing changes for anyone else. Slugs are derived from studio names and are
  therefore guessable, so "absent from the list" would still leave an unapproved
  profile readable to whoever tried the URL. The identity of the requester is the
  only thing that changes the answer, and it comes from the session — never from a
  path or body parameter, the same rule REQ-AUTH-004 applies to roles.

  The owner's view is not a preview of a public page. It IS the page, with an edit
  affordance, which is the whole reason for putting editing at the public URL: one
  representation, so there is no second one to drift.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/designers.test.ts` › "an unapproved profile 404s for an anonymous visitor"
  - Test — `apps/inside/inside-be/src/tests/designers.test.ts` › "the same slug serves for the designer who owns it"
  - Test — `apps/inside/inside-be/src/tests/designers.test.ts` › "the same slug 404s for a DIFFERENT signed-in designer"
- **Relations:** supersedes REQ-DISCOVERY-001
