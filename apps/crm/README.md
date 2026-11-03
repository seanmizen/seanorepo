# crm

A homebrew CRM for a solo developer who sells software services door to door.
It keeps contacts, visits, the pipeline and the GDPR records. Stripe keeps the
billing. The app is a skeleton: `GET /` shows a placeholder page with the
health result, and `GET /api/health` returns `{ "ok": true }`. The design is in
[docs/001-guiding-design.md](docs/001-guiding-design.md).

```bash
yarn workspace crm start           # http://localhost:4100
yarn workspace crm start:docker    # the same, in a dev container
yarn workspace crm test:types
yarn workspace crm-be test
```

## Layout

- `crm-be` renders every page with React on the server
  (`renderToStaticMarkup`). Bun runs the TSX directly, with no build step.
  It serves the pages, the API under `/api`, and the crm-fe build at
  `/static/`, all on port 4100.
- `crm-be/src/routes/` holds one file for each URL. Each file holds the
  Fastify route and its page component. `crm-be/src/index.ts` registers them.
- `crm-be/src/render.tsx` holds `renderPage()`. It adds the doctype, the
  `<head>`, and the asset tags from `crm-fe/dist/manifest.json`.
- `crm-fe` holds only what the browser runs: `src/main.css` and `src/main.ts`.
  It has no React. Rsbuild builds them to `crm-fe/dist` with hashed names and
  a manifest.
- `shared` holds the API types.

`yarn workspace crm start` builds crm-fe once. Then Rsbuild builds crm-fe in
watch mode and Bun runs crm-be in watch mode. `yarn workspace crm-be test`
also builds crm-fe first, because the test of `/` reads the manifest.

## Page rules

- The browser runs no React.
- Every page works as raw HTML, with no CSS and no JavaScript.
- Biome fails on `dangerouslySetInnerHTML` under `apps/crm` (see the
  `overrides` in the root `biome.json`).

`DB_PATH` sets the SQLite file. The default is `crm-be/data/crm.db`, which git
ignores.
