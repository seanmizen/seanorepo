# REQ-QUALITY — How the app is tested

Conventions that decide whether a test can fail for the right reason.

Separate from `REQ-FAIL-*`, which is about what a failure looks like to a
visitor. These are about whether the suite can tell one state from another —
and, as REQ-QUALITY-001 shows, the two are not as separate as they sound.

---

## REQ-QUALITY-001 — One suffix, one meaning

- **Status:** active
- **Source:** sean
- **Origin:** #217
- **Type:** constraint
- **Priority:** P3
- **Statement:** Each test id shall mark exactly one condition, with its
  suffix naming which.
- **Rationale:** A testing convention with a user-facing consequence, which is
  why it is a requirement rather than a style note.

  `-missing` drifted into meaning "any failure", and pages rendered it as
  `severity="info"`, so six pages told a visitor a studio was "not listed" when
  the real answer was that the backend was down — the defect REQ-NET-007 had to
  fix. The naming did not cause that, but it recorded and normalised it: once
  we call every failure *missing*, writing "not listed" is the natural next
  thing to do.

  `portfolio-empty` marked both a genuinely empty list and a 404, so a test
  asserting it could not say which it had caught. A test that cannot fail for
  the right reason is not worth much more than no test.

  Documented in `apps/inside/CLAUDE.md` so somebody applies it while writing a
  page, rather than sweeping afterwards.
- **Verification:**
  - Test — `requirements/check-test-ids.mjs`, run in CI by `.github/workflows/inside-check.yml` over every `data-testid`/`testId` under `apps/inside/inside-fe/src`. Catches a `-missing`/`-empty` id gated by an unnarrowed `isError` (the #231 shape), an id reused across non-exclusive branches, and a suffix outside the reserved vocabulary. Whether the copy inside an alert is honest stays Inspection — #234.
  - Test — `requirements/check-test-ids.test.mjs`, run with `node --test`. Reintroduces the #231 shape as a fixture and asserts the checker fails on it. A check that cannot fail this way could silently stop catching what it was built for.
  - Test — `apps/inside/inside-fe/tests/e2e/failure-surfaces.spec.ts` › "a 404 is the missing piece, in its own right"
  - Test — `apps/inside/inside-fe/tests/e2e/failure-surfaces.spec.ts` › "a 500 is a failure, not a deletion"
- **Relations:** refines REQ-NET-007
