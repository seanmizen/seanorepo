# REQ-SLUG — Public slugs and their history

Slugs address designer profiles, portfolio pieces and briefs. They are public,
shared and indexed, which is what makes them hard: a slug that changes breaks
every link already pointing at it, and a slug that cannot change traps a studio
under a name it has outgrown.

Introduced in #192.

---

## REQ-SLUG-001 — A slug, once issued, is permanent

- **Status:** active
- **Source:** sean
- **Origin:** #192
- **Type:** constraint
- **Priority:** P1
- **Statement:** Every slug an entity has ever held shall continue to resolve to
  that entity for as long as the entity exists.
- **Rationale:** A slug leaves the site the moment we create it — in an email,
  a message, a bookmark, an index. Nothing can be recalled, so a rename that
  drops the old name breaks links we cannot see and cannot fix. History means a
  rename is purely additive: one entity may accumulate twenty slugs over a
  messy edit history and all twenty keep working. Permanence outlives the
  entity too: a deleted row's slugs stay claimed, so they can never be reissued
  to something else.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/slugs.test.ts` › "an old slug still resolves after a rename"
  - Test — `apps/inside/inside-be/src/tests/slugs.test.ts` › "twenty renames keep all twenty slugs working"
  - Test — `apps/inside/inside-be/src/tests/slugs.test.ts` › "a chain of renames all resolve to the NEWEST, not the next one along"
- **Relations:** none

## REQ-SLUG-002 — A released slug is never reissued to a different entity

- **Status:** active
- **Source:** sean
- **Origin:** #192
- **Type:** constraint
- **Priority:** P0
- **Statement:** The system shall refuse to issue a slug that any other entity
  of the same type has ever held.
- **Rationale:** This is the failure that matters more than a 404. If a studio
  renames away from `north-house` and another studio is then allowed to take
  it, the site sends everyone holding the old link to the wrong studio — and
  nothing looks broken, so nobody reports it. Checking history rather than the
  live column is the difference. An entity reclaiming a slug it previously held
  is always allowed: it is already theirs.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/slugs.test.ts` › "a custom slug someone else once held is refused"
  - Test — `apps/inside/inside-be/src/tests/slugs.test.ts` › "resolving an old slug never sends a visitor to the wrong entity"
  - Test — `apps/inside/inside-be/src/tests/slugs.test.ts` › "returning to an old name is allowed — it is already yours"
- **Relations:** none

## REQ-SLUG-003 — An old slug moves the visitor to the current one

- **Status:** active
- **Source:** sean
- **Origin:** #192
- **Type:** functional
- **Priority:** P2
- **Statement:** When a page is opened by a slug that is no longer current, the
  app shall replace the address with the current one without adding a browser
  history entry.
- **Rationale:** Resolving an old slug is not enough on its own — the visitor
  keeps looking at a stale URL, which they then copy and share onward,
  extending the life of a name that has moved. A true HTTP 301 is unavailable:
  the frontend is a static SPA whose server has no database and cannot know
  the mapping, so the rewrite happens client-side.
  **Not adding a history entry is the requirement, not an implementation
  detail.** Pushing one would make Back return to the old slug, which rewrites
  forward again — a trap the visitor cannot escape. Replacing means the old
  slug never occupies an entry and Back goes where they actually came from.
  Search consolidation, which the redirect would also have done, comes from a
  `<link rel="canonical">` pointing at the current URL.
- **Verification:** Test — `apps/inside/inside-fe/tests/e2e/slugs.spec.ts` › "an old slug rewrites to the current one and Back still works"
- **Relations:** depends-on REQ-SLUG-001

## REQ-SLUG-004 — Reserved words cannot be claimed

- **Status:** active
- **Source:** sean
- **Origin:** #192
- **Type:** constraint
- **Priority:** P2
- **Statement:** The system shall refuse a user-supplied slug that matches a
  reserved word.
- **Rationale:** Slugs sit in the same URL space as real routes, so a slug like
  `admin`, `api` or `login` shadows one. The list is trivial to maintain now
  and impossible to apply retroactively: once somebody holds a reserved slug,
  REQ-SLUG-002 says it can never be taken away from them. A *derived* slug that
  happens to land on a reserved word takes a suffix rather than a refusal,
  because a
  studio genuinely called "Admin" has done nothing wrong.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/slugs.test.ts` › "a custom reserved slug is refused with a reason worth showing"
  - Test — `apps/inside/inside-be/src/tests/slugs.test.ts` › "a derived slug that lands on a reserved word is suffixed, not refused"
- **Relations:** none

## REQ-SLUG-005 — Every live slug is recorded in history

- **Status:** active
- **Source:** agent:SEAN-212
- **Origin:** #212
- **Type:** constraint
- **Priority:** P1
- **Statement:** If any entity's live slug has no matching row in `slugs`,
  then the system shall refuse to start and name every offending row.
- **Rationale:** REQ-SLUG-002 decides a slug is free by consulting `slugs`
  alone, which is correct only if every live slug is also recorded there —
  an invariant migration `005_slug_history.sql` establishes by backfilling
  and every write path since maintains via `recordSlug`. Nothing enforced it
  structurally. A row whose slug was never recorded (a pre-#192 write path, a
  hand-edited database) makes `chooseSlug` offer that slug again, and the
  second insert then dies on the entity table's own `UNIQUE` constraint — a
  500 with no useful message, discovered in #211's E2E run against a database
  that predated the slug work. Checking at boot, alongside migrations, turns
  silent drift into a loud failure naming the exact rows, before a request
  ever reaches it. Not a foreign key: `slugs` is polymorphic over three entity
  types, which SQLite cannot express as an FK target.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/slugs.test.ts` › "a live slug that bypassed recordSlug is caught by name"
  - Test — `apps/inside/inside-be/src/tests/slugs.test.ts` › "a slug recorded through the normal write path is never flagged"
  - Inspection — `apps/inside/inside-be/src/index.ts`'s `start` calls `checkSlugHistoryInvariant()` immediately after `runMigrations()`, before the server accepts a connection.
- **Relations:** depends-on REQ-SLUG-002
