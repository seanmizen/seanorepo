# ffmpeg-converter web-spa (legacy reference)

> **Status:** Legacy reference SPA. **Not the production frontend.**
>
> The Next.js app in `../web/` (Phase 1 of the phased build plan) supersedes this directory.
> See [`../phased-spec.md`](../phased-spec.md) for the full plan and the role this SPA plays
> as reference material during the migration.
>
> Read this README to understand the original drop-zone UI, URL-state preset model, and
> Go-backend contract — those patterns port into the Next.js app component-by-component.
> Do not extend this SPA with new features; new work belongs in `../web/`.

Frontend for the ffmpeg-converter site. A single-page drop-zone + preset UI that posts
multipart uploads to the Go backend next door in `apps/ffmpeg-converter/`.

**This is not deployed.** The `prod:docker` / Fly.io / Cloudflared wiring is
intentionally missing — Sean will set that up after review.

## What it is

- A static SPA: one HTML file, one CSS file, a handful of vanilla-TS modules.
- Zero framework, zero transitive dependencies, zero build artifact on disk.
- Served in dev via a tiny Bun script that transpiles `.ts` on the fly and
  proxies `/api/*` to the Go backend — same-origin, no CORS.
- If the Go backend is offline the proxy falls back to an in-memory mock so the
  frontend still renders and you can click around.

## How to run it

```bash
# From apps/ffmpeg-converter/web-spa:
bun run dev.ts

# …or from anywhere in the monorepo:
bun run apps/ffmpeg-converter/web-spa/dev.ts
```

Then open <http://localhost:4040>.

That's the whole dev loop. No install, no bundler, no watcher.

### Optional: run the Go backend in parallel

```bash
# In another terminal:
cd apps/ffmpeg-converter
go run .
# → listens on :9876
```

With the backend running, `/api/*` calls land on the real converter. Without it, they
hit the mock (returns a fake `job_id` that doesn't download anything — just enough
to exercise the UI).

### Env vars for the dev server

| var           | default                    | meaning                                 |
| ------------- | -------------------------- | --------------------------------------- |
| `PORT`        | `4040`                     | dev server port                         |
| `BACKEND_URL` | `http://localhost:9876`    | where to proxy `/api/*`                 |

## File tree

```
apps/ffmpeg-converter/web-spa/
├── README.md          ← you are here
├── package.json       ← single script: `bun run dev.ts`
├── tsconfig.json      ← strict, for editor/type-check only (Bun transpiles at runtime)
├── dev.ts             ← Bun dev server: static + /api proxy + mock fallback
├── index.html         ← single HTML page, loads /src/app.ts as a module
└── src/
    ├── app.ts         ← DOM wiring: drop zone, panel, queue, events
    ├── style.css      ← dark/light theme via CSS vars, matches seanmizen.com
    ├── copy.ts        ← headline, subheadline, bullets, FAQ, competitor table
    ├── ops.ts         ← flagship 12 presets + full 50-op catalogue (mirrors ops.go)
    ├── ffmpeg-cmd.ts  ← builds the live ffmpeg CLI string shown in the panel
    └── url-state.ts   ← URL ⇄ state, localStorage preset library
```

## How the frontend talks to the backend

```
Browser                 Bun dev server            Go backend
  │                         │                         │
  │  POST /api/convert      │                         │
  │ ──────────────────────▶ │                         │
  │                         │   POST /convert         │
  │                         │ ──────────────────────▶ │
  │                         │   200 {job_id, …}       │
  │                         │ ◀────────────────────── │
  │  200 {job_id, …}        │                         │
  │ ◀────────────────────── │                         │
  │                         │                         │
  │  GET /api/jobs/{id}/output
  │ ──────────────────────▶ │ ──────────────────────▶ │  (ServeFile)
  │ ◀────────────────────── │ ◀────────────────────── │
```

All the URLs in the frontend are `/api/...` — the Bun dev server strips the `/api`
prefix and forwards everything to `BACKEND_URL`. In production you'd do the same thing
in nginx.

## Design choices you might question

- **No React.** A single-page app this small is faster to write and faster to load as
  vanilla TS + DOM. `seanmizen.com` uses React + RSBuild but that's because it has
  routing and Three.js. This is a one-page tool.
- **No bundler.** Bun's transpiler handles `.ts` on the fly. For production you'd pre-
  build once with `bun build ./src/app.ts` and serve the result, but for dev the cost
  is negligible.
- **Mock fallback in the dev server.** Lets the frontend render even when the Go
  backend isn't running, so Sean can click around in the morning without waiting for
  `go build`. The mock returns a synthetic job that "succeeds" with no output file.
- **Dark mode by default.** Matches `seanmizen.com`. Light mode is on the theme toggle.
- **URL state is the source of truth.** Every option change updates `?op=...&arg=...`.
  Bookmark the URL → one-click personal tool. Copy the URL → share the preset. No
  login required.

## What it does (feature list)

- Drag-and-drop or click-to-browse file picker
- Auto-suggest: highlights recommended preset buttons based on dropped file extension
- 12 flagship preset buttons (see `STRATEGY.md` for why those twelve)
- Disclosure to all 50 ops, grouped by category
- Progressive-disclosure panel: preset chips → advanced field grid → live command
- Live **ffmpeg** command line, mirrored from what the backend will run, copy button
- Live **curl** command that would produce the same job, copy button
- Job queue with per-file status (pending / running / done / error) and re-download
- Save preset → localStorage → appears as a chip on your next visit
- Copy shareable URL → every option is in the query string
- Dark / light theme toggle, persisted to localStorage
- FAQ section and competitor-comparison table (honest numbers, sourced in COMPETITORS.md)

## Dependencies on the Go backend branch

The UI assumes the API shape from `apps/ffmpeg-converter/` (the other agent's branch).
Specifically:

- `GET /health` → `{status, ops, service, time}`
- `GET /ops` → `[{name, category, description, output_ext}, …]`
- `POST /convert` → multipart form (`op`, `file[]`, any extra form fields as args)
  → returns `{job_id, status, op, output, local_path}`
- `GET /jobs/{id}/output` → serves the converted file

If any of those shapes change, update `src/app.ts` (`runConversion`) and
`src/ffmpeg-cmd.ts` (`buildCurlCmd`) to match.

## ⚠ Deploy is not wired

**Do not** run `yarn prod:docker` or `docker push` on this. There is no `dockerfile`,
no docker-compose service, no Fly.io config, no Cloudflared entry. Sean will add those
after reviewing.

When the time comes, the production story is:

1. Pre-build: `bun build ./src/app.ts --outdir=dist`
2. Serve `index.html` + `dist/` + `src/style.css` from nginx or a static CDN
3. nginx `/api/*` proxies to the Go backend container
4. Same dual 4xxx / 5xxx port scheme as the rest of the monorepo

## TODO — post-v1 follow-ups

Things explicitly left out of the first cut:

- [ ] **ffmpeg.wasm client-side lane** — small files stay in the browser, never upload.
      Hooks are in place; `dev.ts` proxy logic and `src/app.ts` job runner both have a
      single choke point (`runConversion`) that can branch by file size.
- [ ] **Polling `/jobs/{id}`** for long-running jobs — currently `POST /convert` is
      synchronous, so the queue row goes pending → running → done on a single request.
      When the backend grows async support, start polling here.
- [ ] **Preset library UI upgrade** — currently a flat list of chips. Group by category,
      add rename, add JSON export/import.
- [ ] **Drag-out download** — the "delightful" feature from the strategy doc. Needs the
      `dataTransfer.setData('DownloadURL', ...)` trick on the queue row.
- [ ] **Keyboard shortcuts** — `⌘K` to focus drop zone, `⌘Enter` to run, `⌘Z` to undo
      last preset change. The URL-state undo stack is one `window.history` call away.
- [ ] **Server-sent events for progress** — backend would need to emit, but a progress
      bar on long encodes is a big UX win.
- [ ] **Accept URL input** — "paste a YouTube link" or "paste a URL to an MP4." Backend
      would need a `source=url` branch that shells out to `curl -o` before ffmpeg.
- [ ] **Real e2e test** — dev server + go backend + a Playwright script that drops
      a tiny synthetic file and verifies the download. `apps/ffmpeg-converter/test/`
      already has lavfi-generated inputs we could reuse.
- [ ] **Batch queue memory** — remember the last preset the user used in localStorage
      so a fresh drop lands in the same config.

## See also

- [`../phased-spec.md`](../phased-spec.md) — phased build plan; explains why this SPA is
  reference material and where the Next.js replacement lives.
- `../docs/COMPETITORS.md` — field research on the online-converter landscape.
- `../docs/STRATEGY.md` — answers to "where does simplicity win" and "where does
  fractal options give an edge".
- `../README.md` — the Go backend.
