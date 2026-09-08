# REQ-DATA — Schema, migrations, storage and vocabulary

SQLite kept next to the runner, migrated forward only. Introduced in #145,
constraint-tested in #150, storage abstracted in #143 and #154.

---

## REQ-DATA-001 — Migrations are additive

- **Status:** active
- **Source:** sean
- **Origin:** #145
- **Type:** constraint
- **Priority:** P0
- **Statement:** A schema change shall be made by adding a new numbered
  migration rather than by editing one already applied.
- **Rationale:** The runner tracks migrations by presence rather than by a
  high-water mark, so editing an applied file changes the schema on a fresh
  database while leaving every existing one untouched. The two then diverge
  permanently, and nothing reports it: production keeps the old shape, CI keeps
  passing against the new one, and the difference only surfaces as a confusing
  runtime error much later.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/migrations.test.ts` › "applies the baseline schema to a fresh database"
  - Test — `apps/inside/inside-be/src/tests/migrations.test.ts` › "records what it applied"
- **Relations:** none

## REQ-DATA-002 — Re-running migrations changes nothing

- **Status:** active
- **Source:** sean
- **Origin:** #145
- **Type:** constraint
- **Priority:** P1
- **Statement:** The migration runner shall apply nothing on a second run
  against an already-migrated database.
- **Rationale:** Migrations run on every boot, and Docker restarts the app on
  deploy, on crash and on a server reboot. A runner that is not
  idempotent turns an ordinary restart into a schema change. Each file's DDL
  and its tracking row land in one transaction, so a crash midway
  cannot leave a migration half-applied but recorded.
- **Verification:** Test — `apps/inside/inside-be/src/tests/migrations.test.ts` › "is idempotent — a second run applies nothing"
- **Relations:** none

## REQ-DATA-003 — Constraints are enforced by the database

- **Status:** active
- **Source:** sean
- **Origin:** #150
- **Type:** constraint
- **Priority:** P0
- **Statement:** Every domain invariant expressible as a schema constraint
  shall be enforced by the database rather than only in application code.
- **Rationale:** Application-level checks hold only for the code paths that
  remember them, and this app already has several writers — HTTP controllers,
  the seed script, and migrations themselves. A `CHECK` or foreign key holds
  for all of them, including code written later by someone who never read the
  rule. This is what makes REQ-PRODUCT-002's approval gate structural: a new
  discovery query cannot expose a draft profile, because a profile cannot exist
  in an approved state without being approved. Constraint tests must prove the
  constraint actually bites by inserting bad data and expecting a throw —
  `PRAGMA foreign_keys` is per-connection, so a test that forgets to set it
  proves nothing.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/domain-schema.test.ts` › "covers every CHECK constraint in the migrations"
  - Test — `apps/inside/inside-be/src/tests/domain-schema.test.ts` › "orphan foreign keys are rejected"
  - Test — `apps/inside/inside-be/src/tests/migrations.test.ts` › "enforces foreign keys when the pragma is on"
- **Relations:** none

## REQ-DATA-004 — Stored assets are reached only through the provider

- **Status:** active
- **Source:** sean
- **Origin:** #154
- **Type:** constraint
- **Priority:** P1
- **Statement:** Application code shall read and write stored assets only
  through the `StorageProvider` interface.
- **Rationale:** Storage is local disk now and object storage later, and that
  swap is only cheap while every filesystem call sits behind one interface. A
  controller that touches `fs` directly is a second implementation nobody will
  find when the swap happens. Image resizing lives *above* the provider so the
  provider stays a pure blob store — which is what keeps the future
  implementation to one new file rather than a reimplementation of the
  resizing rules too.
- **Verification:**
  - Test — `apps/inside/inside-be/src/tests/storage.test.ts` › "upload returns a storage path and a public url"
  - Test — `apps/inside/inside-be/src/tests/storage.test.ts` › "getUrl matches the url returned by upload"
- **Relations:** none

## REQ-DATA-005 — One vocabulary everywhere

- **Status:** active
- **Source:** sean
- **Origin:** #189
- **Type:** constraint
- **Priority:** P1
- **Statement:** A domain concept shall carry the same name in the database,
  the API, the routes, the code and the UI copy.
- **Rationale:** Split vocabularies are where bugs and onboarding confusion
  breed, and this one was paid for: "project" meant both a designer's portfolio
  piece and a client's job, and disambiguating it cost a whole rename ticket.
  Two words are therefore banned outright — bare "project" (say
  `portfolio_project` or `brief`) and "pitch" (a designer places a `bid`). The
  cost of the rule is a slightly longer name. The cost of breaking it is
  another #189.
- **Verification:** Inspection — the term table in `apps/inside/CLAUDE.md`, checked when reviewing any change that introduces a domain noun. No automated check exists. A linter rule over identifiers and copy would be the way to make this enforceable rather than aspirational.
- **Relations:** none
