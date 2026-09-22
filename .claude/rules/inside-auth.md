---
paths:
  - "apps/inside/inside-be/**"
  - "apps/inside/inside-fe/src/**/*auth*"
  - "apps/inside/inside-fe/src/**/*Auth*"
---

# inside: auth

Read with `apps/inside/CLAUDE.md`.

## Auth — `REQ-AUTH-001` … `REQ-AUTH-007`

Magic link only. There are no passwords. See `services/auth.ts`,
`services/session.ts`, `middleware/auth.ts`.

- **Roles are `buyer`, `designer`, `admin`.** `admin` comes *only* from the
  `ADMIN_EMAILS` env whitelist — it is never accepted from a request body.
- **Logging in never rewrites an existing user's buyer/designer role.** That
  role is chosen once at signup and owns the link to their profile and
  portfolio.
- **Session TTL and cookie `maxAge` are both derived from `SESSION_TTL_MS`.**
  If you change one, change it there — a mismatch silently 401s users who still
  hold a cookie the browser considers valid.
- Sessions store `sha256(jwt)`, never the raw token. Middleware checks the
  signature **and** that the session is unrevoked, or logout would be cosmetic.
- **`GET /api/auth/me` answers 200 with `user: null` when signed out.**
  Anonymous browsing is a first-class flow, so "nobody" is an answer, not an
  error. A cookie that is present but invalid or revoked still 401s. Keep this
  shape for any other endpoint an anonymous visitor hits on page load.
- **Validate `returnTo` on both sides** with the existing helpers
  (`safeReturnTo`). Relative paths only — reject protocol-relative URLs like
  `//evil.example`, which a leading-slash check lets through.
- Guard routes by putting them in an encapsulated scope with `requireRole(...)`
  as an `onRequest` hook. A Fastify v5 async hook must **return** the reply to
  halt the lifecycle. Awaiting `reply.send()` alone lets the handler run and
  send twice.
- Local dev and E2E use `DANGEROUS_BYPASS_EMAIL_MAGIC_LINK=true`, which returns
  the link in the response instead of emailing it. Production ignores it.
- The frontend's `AuthProvider` boot check defers to an explicit sign-in or
  sign-out, because on `/verify` it races the sign-in and would otherwise
  overwrite a fresh session with `null`. Preserve that guard.
