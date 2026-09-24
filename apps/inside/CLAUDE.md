# CLAUDE.md — `inside`

Guidance for agents working in `apps/inside`. This file covers this app only.
The monorepo-wide rules in the root `CLAUDE.md` still apply.

## What this app is

`inside.seanmizen.com` — "Etsy for interior designers". A marketplace where
architects and interior designers sell themselves, their projects and their
portfolio, and where homeowners and building project managers find them.
Positioning is **high-brow, luxury**: image-first, restrained, editorial.

### Locked product decisions

Do not relitigate these without asking Sean.

- Both sides have accounts. Buyers can browse **fully anonymously**
  (`REQ-PRODUCT-001`) and are only asked to sign up at the point of value
  ("sign up to save this profile") — `REQ-PRODUCT-003`.
- Designers self-signup but stay **unlisted until admin-approved**
  (`REQ-PRODUCT-002`), enforced in the schema (`REQ-DATA-003`) and on direct
  slug access, with the one exception that the profile's own owner can always
  reach it (`REQ-DISCOVERY-004`).
- Two connection directions: buyer → designer **enquiries**, and
  **post-a-project** where a buyer posts a brief and designers pitch.
- Assets go through a storage abstraction: local disk now, S3 later
  (`REQ-DATA-004`).
- Site data is SQLite, kept right next to the runner. Barebones.

> Requirements live in [`requirements/`](./requirements/), and CI validates
> them. This prose explains. The requirement binds. When the two disagree, the
> requirement is right — see [`requirements/README.md`](../../requirements/README.md).

### Vocabulary

**One vocabulary, everywhere** (`REQ-DATA-005`) — database, API, routes, code
and UI copy. Split vocabularies are where bugs and onboarding confusion breed,
so a new concept gets its name decided once and used identically in all five
places.

| Term | Means |
|---|---|
| `portfolio_projects` | a designer's completed work, shown in their portfolio |
| `briefs` | a homeowner's posted job, which designers bid on |
| `bids` | a designer's response to a brief |
| `work_type` | the kind of work: kitchen, extension, new build … |
| `designers` / `buyers` | the two sides of the marketplace |

Two words are deliberately absent. **Never write "project" alone** — it meant
both a designer's portfolio piece and a client's job, which is exactly the
ambiguity that cost us a rename. Say `portfolio_project` or `brief`. And
**Never write "pitch"** — a designer places a `bid`.

Public URL shape:

| Purpose | URL |
|---|---|
| Designer profile | `/designers/:slug` |
| Portfolio piece | `/designers/:slug/portfolio/:slug` |
| Client brief | `/briefs/:slug` |
| A bid (private) | `/bids` |

## Layout

```
inside-fe/   React 19 + RSBuild + MUI + TanStack Query   (port 4060)
inside-be/   Bun + Fastify + SQLite, all routes /api      (port 4061)
shared/      types both sides import as @shared/types
```

## Testing standard

**A feature ticket is not done without tests.** Every PR that adds or changes
behaviour must add unit tests, E2E tests, or both — and they must pass before
merge. CI (`.github/workflows/inside-check.yml`) enforces this on every PR
touching `apps/inside`.

### Commands

| Command | Runs |
|---|---|
| `yarn workspace inside test` | types + unit. Fast, no browser. Run this constantly. |
| `yarn workspace inside test:types` | `tsc --noEmit` on **both** FE and BE |
| `yarn workspace inside test:unit` | backend `bun test` |
| `yarn workspace inside test:e2e` | Playwright against a real FE + BE |
| `yarn workspace inside test:axe` | axe WCAG 2.1 AA scan of every route, light and dark |
| `yarn workspace inside test:all` | everything |
| `yarn workspace inside seed` | fill an empty database with demo data |

More rules load only when you touch matching files:

- `.claude/rules/inside-testing.md`: what to test where, and the test id
  conventions (`REQ-QUALITY-001`). Loads for tests and for frontend components.
- `.claude/rules/inside-frontend.md`: routing and navigation (`REQ-NAV-*`),
  state you have not verified (`REQ-STATE-*`), and theming (`REQ-THEME-*`).
  Loads for `inside-fe/**`.
- `.claude/rules/inside-auth.md`: magic-link auth (`REQ-AUTH-*`). Loads for
  `inside-be/**` and auth files in the frontend.

### Bar for new work

- New API route → an `app.inject()` test for the happy path, the auth failure,
  and at least one validation failure.
- New migration → tests for fresh apply, idempotency on reboot, and every new
  `CHECK`/FK constraint.
- New user-facing flow → an E2E spec walking it as a user would.
- New shared module (storage, images, email) → contract tests written against
  the interface, not the implementation, so a future provider passes unchanged.
- New route → an entry in `inside-fe/src/app/routes.ts`, plus its parent route
  if the URL is nested. See `.claude/rules/inside-frontend.md`.

## Conventions

- **Bun is the runtime only.** Package management is Yarn 4. Never
  `bun install` or `bun build`.
- **Migrations are additive.** Never edit an applied migration. Add
  `NNN_name.sql`. The runner tracks by presence (not a `MAX(version)`
  high-water mark) and wraps each file's DDL plus its tracking row in one
  transaction.
- **SQL is snake_case, TypeScript is camelCase.** Keep `shared/types.ts` in
  step with the schema.
- **Storage goes through `StorageProvider`.** Never touch the filesystem
  directly from a controller. Image resizing lives in `services/images.ts`,
  *above* the provider, so the provider stays a pure blob store and the S3 swap
  is one new file.
- **Admin routes** go inside the encapsulated scope in `controllers/index.ts`,
  which attaches the guard as an `onRequest` hook. Never bolt a guard onto an
  individual admin route — the scope makes protection structural.
- **Secrets fail hard.** `JWT_SECRET` and `COOKIE_SECRET` throw in production
  if unset or left at the dev default. Do not soften this to a warning.
- **Never commit** `.env`, `dist/`, `*.db`, or `uploads/`.
- rsbuild bakes the frontend's API base in at **build time**, through
  `source.define`. There is deliberately no runtime hostname detection — do not
  add a second strategy.

## Build the state you need, not the state you imagine

`inside` is pre-launch. Every speculative branch is a thing that must be
reasoned about, tested around and migrated later, in service of a workflow
nobody has committed to — and it makes a pivot more expensive exactly when
pivoting should still be cheap.

What this looked like in practice: `pitches.status` shipped with six values —
`sent`, `read`, `shortlisted`, `accepted`, `declined`, `withdrawn` — and **no
code set or read a single one of them**. There was only a create route. No
transition existed. Meanwhile `draft`, the one state the product actually
wanted, was not among them. `briefs.status` had `awarded`, which nothing could
produce, guarded by three branches defending against an impossible condition.

Rules:

- **A state earns its place when something can put a record into it and
  something else behaves differently because of it.** Until then it is a
  comment pretending to be a constraint.
- **Do not add a status column "for later".** Later has different requirements
  than the ones you are imagining, and by then the value is in the schema, the
  types, the validators and half the tests.
- **Prefer a boolean or a nullable timestamp to an enum** when there are two
  real states. `submitted_at IS NULL` says everything a `draft`/`submitted`
  pair does, with nothing left to invent.
- **Resist workflow coupling.** A bid knows about its brief. It does not need
  to know about shortlisting, awarding, or a buyer's decision process that
  nobody has designed yet.
- **Idempotent beats stateful.** "Start a bid" and "continue my draft" are the
  same intent, so they are the same endpoint returning the same row — the UI
  does not have to know which state it is in, and there is no third state to
  get stuck in.

## Ports

| | Cloudflared | E2E |
|---|---|---|
| Frontend | 4060 | 4160 |
| Backend | 4061 | 4161 |

Cloudflared ingress for `inside.seanmizen.com` is its own rule in
`apps/cloudflared/config.yml`. There is no `*.seanmizen.com` wildcard, so a
hostname without a rule gets a 404.
