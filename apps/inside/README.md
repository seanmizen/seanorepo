# inside

`inside.seanmizen.com` — a marketplace for architects and interior designers.
Designers sell themselves, their projects and their portfolio; homeowners and
project managers browse and get in touch. Positioning is high-brow and luxury.

## Ports

| | Cloudflared | Fly.io (reserved) |
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
