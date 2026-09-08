# REQ-PRODUCT — Locked product decisions

The decisions that define what `inside` *is*, rather than how we build it.
These are the stakeholder-level requirements everything else serves. The rest
of this directory refines or depends on them.

Do not relitigate these without asking Sean. That instruction has lived in
`apps/inside/CLAUDE.md` since we scaffolded the app — what it lacked was a
handle to cite, a record of who decided, and anything proving the app still
honours them.

---

## REQ-PRODUCT-001 — Buyers browse without an account

- **Status:** active
- **Source:** sean
- **Origin:** #143
- **Type:** constraint
- **Priority:** P0
- **Statement:** An anonymous visitor shall be able to reach every public
  discovery surface — the designer list, a designer profile and a portfolio
  piece — without signing in.
- **Rationale:** The marketplace is worth nothing to a homeowner who cannot see
  who is on it, and a sign-in wall in front of discovery is the fastest way to
  lose them. Anonymous browsing is therefore a first-class flow rather than a
  degraded one, which is why "nobody" has to be a valid answer everywhere a
  page asks who the visitor is — see REQ-AUTH-005.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/discovery.spec.ts` › "lists approved studios to an anonymous visitor"
  - Test — `apps/inside/inside-fe/tests/e2e/discovery.spec.ts` › "shows the studio, its bio and its published work"
- **Relations:** depends-on REQ-AUTH-005

## REQ-PRODUCT-002 — A designer is unlisted until an admin approves them

- **Status:** active
- **Source:** sean
- **Origin:** #157
- **Type:** constraint
- **Priority:** P0
- **Statement:** A designer profile shall be excluded from every public surface
  until an administrator has approved it.
- **Rationale:** Designers self-signup, so the approval gate is the only thing
  standing between an open signup form and the public directory. Positioning is
  high-brow and curated. An unreviewed profile appearing publicly damages that
  directly and is not recoverable by deleting it afterwards. The gate is
  enforced in the schema rather than only in query code — a profile defaults to
  draft — so a new query written later cannot accidentally expose one.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/domain-schema.test.ts` › "a new profile defaults to draft, not publicly visible"
  - Test — `apps/inside/inside-fe/tests/e2e/discovery.spec.ts` › "never shows an unapproved studio"
  - Test — `apps/inside/inside-fe/tests/e2e/admin-approval.spec.ts` › "an approved designer becomes publicly visible"
- **Relations:** depends-on REQ-DATA-003

## REQ-PRODUCT-003 — Sign-up is asked for at the point of value

- **Status:** active
- **Source:** sean
- **Origin:** #184
- **Type:** constraint
- **Priority:** P2
- **Statement:** The app shall invite a visitor to create an account only
  alongside something worth having an account for, and never as a condition of
  browsing.
- **Rationale:** The counterpart to REQ-PRODUCT-001, and the reason that
  requirement does not simply mean "delay the wall". We ask a buyer to sign
  up when they want to save a designer or send an enquiry — at which point the
  account has an obvious purpose — rather than on arrival, when it has none.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/homepage-cta.spec.ts` › "invites a signed-out visitor to create an account"
  - Test — `apps/inside/inside-fe/tests/e2e/homepage-cta.spec.ts` › "is not shown to someone already signed in"
- **Relations:** refines REQ-PRODUCT-001
