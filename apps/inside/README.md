# inside

`inside.seanmizen.com` — a marketplace for architects and interior designers.
Designers sell themselves, their projects and their portfolio. Homeowners and
project managers browse and get in touch. Positioning is high-brow and luxury.

## Ports

| | Cloudflared |
|---|---|
| Frontend | 4060 |
| Backend | 4061 |

## Running it

```bash
cp inside-fe/.env.example inside-fe/.env
cp inside-be/.env.example inside-be/.env

yarn inside              # from the monorepo root, or:
yarn workspace inside start

yarn workspace inside start:docker   # dev containers, hot reload
yarn workspace inside prod:docker    # production build, detached
yarn workspace inside down
```

Type-check both sides with `yarn workspace inside test:types`.

## Demo data

A fresh database is empty, which makes discovery and the portfolio pages
impossible to review. Fill it:

```bash
yarn workspace inside seed
```

Six designer profiles covering every approval status (draft, pending, approved,
rejected), portfolio projects with real generated images, two buyers, three
briefs and a bid. Images go through the actual `services/images.ts` pipeline, so
the tests exercise variants and `srcset` rather than faking them with rows
pointing at files that do not exist.

It is **idempotent** — run it as often as you like — and it **refuses to run
when `NODE_ENV=production`**, because it writes fabricated accounts and doing
that to real data would be destructive.

Every seeded address ends in `@inside.test`, a reserved TLD that can never
receive mail. Sign in as any of them: with no SMTP configured the sign-in link
appears directly on `/login`.

## Layout

- `inside-fe` — React 19 + RSBuild + MUI (light/dark/auto) + TanStack Query
- `inside-be` — Bun + Fastify + SQLite (`bun:sqlite`), all routes under `/api`
- `shared/types.ts` — types both sides import as `@shared/types`

## Notes

**Bun is the runtime only.** Package management is Yarn 4 — never `bun install`
or `bun build`.

**Data** is SQLite in a file next to the runner (`DB_PATH`, a named volume in
Docker). Schema changes are additive `NNN_*.sql` files in
`inside-be/src/migrations/`, applied on boot inside a transaction and tracked
by presence in `schema_migrations` — so a migration merged out of order still
runs.

**Assets** go through `StorageProvider` (`inside-be/src/services/storage/`).
Local disk today. The S3 swap is a new provider plus `STORAGE_TYPE=s3`, with
nothing above it changing. Image resizing lives in `services/images.ts`, above
the provider, so the provider stays a pure blob store.

## Deployment

Two targets, and they are not peers.

**Cloudflared (home server, 4060/4061) is the real deployment.** The SQLite
file and the uploads directory are named Docker volumes there, so they survive
rebuilds. This is where the data lives.

> **`SITE_NAME` lives on the host, not in the repo.** It is `inside.space`, and
> the deployed `.env` on the production server (asus) needs the same value. `.env.example` carries it
> for a fresh checkout only. A stale `SITE_NAME` signs every magic-link email
> with the old name, and nothing in CI can see that.

The production image runs the backend's TypeScript source directly (see
`inside-be/dockerfile`). Do not add a bundling step. Bundling breaks two
things: `runMigrations` finds its `.sql` files relative to its own module path,
and `sharp` ships a native binary that a bundler cannot inline.
