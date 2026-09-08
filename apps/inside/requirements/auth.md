# REQ-AUTH — Authentication, sessions and roles

Magic link only. There are no passwords. Introduced in #149.

This is the highest-stakes area in the app, and the one where a silent
regression is least likely to be noticed by looking at the screen — a session
that is not really revoked, or a role that can be self-assigned, both look
exactly like a working sign-in. Hence the density of requirements here relative
to everywhere else.

---

## REQ-AUTH-001 — Authentication is by magic link alone

- **Status:** active
- **Source:** sean
- **Origin:** #149
- **Type:** constraint
- **Priority:** P0
- **Statement:** The system shall accept no credential for authentication
  other than an emailed single-use link.
- **Rationale:** No password means no password to store, leak, reset or get
  wrong. The cost is an email round-trip on every sign-in, which we accepted
  deliberately. Adding a password field later is not a small addition — it
  reintroduces every storage and reset concern this avoids — so it is a
  decision to reopen explicitly rather than drift into.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/auth.spec.ts` › "a new buyer can sign in end to end"
- **Relations:** none

## REQ-AUTH-002 — A magic-link token is single-use

- **Status:** active
- **Source:** sean
- **Origin:** #149
- **Type:** constraint
- **Priority:** P0
- **Statement:** The system shall reject a magic-link token that has already
  been redeemed.
- **Rationale:** The link travels through email. People forward it and archive
  it, it syncs to other devices, and intermediaries scan it. A replayable link is
  therefore a durable credential sitting in an inbox rather than a momentary
  one. Expiry alone does not close this: a token replayed inside its window is
  still a second sign-in nobody asked for.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/auth.test.ts` › "a token cannot be used twice"
  - Test — `apps/inside/inside-fe/tests/e2e/auth.spec.ts` › "a token cannot be reused"
- **Relations:** none

## REQ-AUTH-003 — Signing in never rewrites an existing role

- **Status:** active
- **Source:** sean
- **Origin:** #149
- **Type:** constraint
- **Priority:** P1
- **Statement:** When an existing account signs in, the system shall leave its
  buyer or designer role unchanged.
- **Rationale:** The role is chosen once at signup and owns the link to a
  designer's profile and portfolio. Letting a later sign-in carry a role in its
  payload would mean a designer who signs in from a buyer-flavoured link
  silently becomes a buyer and loses the route to their own work. The signup
  server honours the payload's role exactly once, for an account that does not
  yet exist.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/auth.test.ts` › "logging in again never rewrites an existing role"
  - Test — `apps/inside/inside-fe/tests/e2e/auth.spec.ts` › "a designer keeps the designer role"
- **Relations:** none

## REQ-AUTH-004 — Admin comes from the environment, never from a request

- **Status:** active
- **Source:** sean
- **Origin:** #149
- **Type:** constraint
- **Priority:** P0
- **Statement:** The system shall grant the admin role only to an address
  present in the `ADMIN_EMAILS` whitelist.
- **Rationale:** Admin is the role that approves designers and therefore
  controls what the public sees. A role accepted from a request body is a role
  an attacker can ask for, and signup is an unauthenticated endpoint — so the
  whitelist is the only acceptable source. This is a privilege boundary, not a
  configuration convenience.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/auth.test.ts` › "admin comes from the whitelist, not the request"
  - Test — `apps/inside/inside-be/src/tests/auth.test.ts` › "admin cannot be self-assigned via the signup payload"
  - Test — `apps/inside/inside-fe/tests/e2e/admin-approval.spec.ts` › "a signed-in buyer is bounced off every admin route"
- **Relations:** none

## REQ-AUTH-005 — "Nobody" is an answer, not an error

- **Status:** active
- **Source:** sean
- **Origin:** #149
- **Type:** functional
- **Priority:** P1
- **Statement:** When no session is present, `GET /api/auth/me` shall answer
  200 with a null user rather than an authentication error.
- **Rationale:** Anonymous browsing is a first-class flow (REQ-PRODUCT-001), so
  every page asks who the visitor is on load, and for most visitors the honest
  answer is nobody. Answering 401 would make the normal case an error, which
  pushes every caller into treating a routine state as a failure — and error
  handling written for a state that happens constantly gets loosened until it
  stops catching the real thing. A cookie that is present but forged or revoked
  still fails.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/auth.test.ts` › "/me answers 200 with a null user when signed out"
  - Test — `apps/inside/inside-be/src/tests/auth.test.ts` › "/me still rejects a token that is present but forged"
- **Relations:** none

## REQ-AUTH-006 — Signing out revokes the session on the server

- **Status:** active
- **Source:** sean
- **Origin:** #149
- **Type:** constraint
- **Priority:** P0
- **Statement:** The system shall revoke a session server-side on sign-out, so
  that a token issued before it is refused afterwards.
- **Rationale:** Clearing the cookie only removes the browser's copy. Anyone
  who captured the token still holds a working credential, so a sign-out that
  does not revoke is cosmetic — and worst for exactly the person who most needs
  it, someone signing out on a shared machine. Middleware therefore checks both
  the signature and that the session is unrevoked.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/auth.test.ts` › "logout revokes the session server-side"
  - Test — `apps/inside/inside-fe/tests/e2e/auth.spec.ts` › "signing out ends the session"
- **Relations:** none

## REQ-AUTH-007 — A return path must be relative

- **Status:** active
- **Source:** sean
- **Origin:** #149
- **Type:** constraint
- **Priority:** P1
- **Statement:** The system shall reject any `returnTo` value that is not a
  relative path.
- **Rationale:** `returnTo` is a redirect target carried through an
  unauthenticated flow, which makes it an open-redirect vector: a link that
  looks like a genuine `inside` sign-in but lands on an attacker's page,
  arriving with all the trust of an email the user asked for. A leading-slash
  check is not enough on its own, because `//evil.example` passes it and is
  protocol-relative. Checked on both sides, since the client-side check is a
  convenience and the server's is the control.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/auth.spec.ts` › "a returnTo pointing off-site is ignored"
- **Relations:** none

## REQ-AUTH-008 — A session that ends says so

- **Status:** active
- **Source:** sean
- **Origin:** #215
- **Type:** functional
- **Priority:** P1
- **Statement:** Where a request is refused for want of a valid session, the
  app shall sign the visitor out and tell them why they are being asked to sign
  in again.
- **Rationale:** Nothing in the app read a 401. A session ending mid-flow —
  expired, or signed out from another browser — surfaced as whatever generic
  error the page happened to own, while the header still showed the visitor
  signed in and `ProtectedRoute` still admitted them. They kept pressing Save
  against a red box that would never go away.

  A login page with no explanation reads as the site having dropped them on
  purpose. The honest answer — the session expired, or was
  ended elsewhere — is also the one that says what to do next.

  This depends on REQ-AUTH-005 being true: `/api/auth/me` answers 200 with a
  null user when signed out and 401 only for a cookie that is present but
  revoked. Without that distinction, an ordinary anonymous visitor would be
  told their session ended, which is the same class of lie in the opposite
  direction.

  **The honest limit:** the app learns that a session ended on the next
  authenticated request, not the instant somebody revokes it. Nothing polls, and
  nothing should — the alternative is a heartbeat asking "am I still here?"
  forever, spending requests to learn something the next real request will say
  for free. A page that makes no authenticated call keeps its stale session
  until one does.

  A transport failure is deliberately NOT treated as a sign-out. It says
  nothing about the session, so claiming one ended would assert something
  unverified (REQ-STATE-003). The offline banner covers that case honestly.
- **Verification:**
  - Test — `apps/inside/inside-fe/tests/e2e/auth.spec.ts` › "says why, rather than bouncing to login in silence"
  - Test — `apps/inside/inside-fe/tests/e2e/auth.spec.ts` › "the next authenticated request ends the session, without a reload"
  - Test — `apps/inside/inside-fe/tests/e2e/auth.spec.ts` › "an ordinary anonymous visitor is not told a session ended"
- **Relations:** depends-on REQ-AUTH-005
