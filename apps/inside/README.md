# inside

`inside.seanmizen.com` — a marketplace for architects and interior designers.
Designers sell themselves, their projects and their portfolio; homeowners and
project managers browse and get in touch. Positioning is high-brow and luxury.

## Ports

| | Cloudflared | Fly.io |
|---|---|---|
| Frontend | 4060 | 5060 |
| Backend | 4061 | 5061 |

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
variants and `srcset` are exercised rather than faked with rows pointing at
files that do not exist.

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
Local disk today; the S3 swap is a new provider plus `STORAGE_TYPE=s3`, with
nothing above it changing. Image resizing lives in `services/images.ts`, above
the provider, so the provider stays a pure blob store.

## Deployment

Two targets, and they are not peers.

**Cloudflared (home server, 4060/4061) is the real deployment.** The SQLite
file and the uploads directory are named Docker volumes there, so they survive
rebuilds. This is where the data lives.

**Fly.io (5060/5061) is a stateless mirror.** No Fly volume is attached, so the
database and every uploaded asset are lost on each deploy or machine restart —
`auto_stop_machines` is on, so that is often. The app boots, migrates an empty
schema and serves; it just does not remember anything.

That is a deliberate choice, not an oversight:

- The Fly image is one container shared by every site in the monorepo
  (`utils/fly-io/dockerfile`). A volume attaches to a single machine in a
  single region, so adding one for `inside` would pin the whole stack.
- `carolinemizen.art`, the other app here with a CMS and large uploads, is
  already deployed the same way.
- Nothing on Fly is the source of truth. If `inside` ever needs durable cloud
  storage, the answer is the S3 swap the `StorageProvider` interface is already
  shaped for, plus a hosted database — not a Fly volume.

Fly needs two secrets, or the backend refuses to boot (by design — see
`requireSecret` in `inside-be/src/index.ts`):

```bash
fly secrets set JWT_SECRET=... COOKIE_SECRET=...
```

The Fly build runs the backend's TypeScript directly rather than bundling it,
matching `inside-be/dockerfile`. Bundling breaks two things: `runMigrations`
resolves its `.sql` files relative to its own module path, and `sharp` ships a
native binary that cannot be inlined.
