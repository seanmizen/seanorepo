# Converter — TODO

Follow-up work after the initial scaffold. Ordered roughly by priority within each section. Anything marked 🔒 is a load-bearing decision that needs Sean's input before implementation.

## Backend (Go)

- [ ] Rate limiting middleware per-IP on `POST /api/jobs` (5/min burst 3 is a sensible default)
- [ ] Fail fast at startup if `ffmpeg` / `ffprobe` are not on PATH — log the error and exit non-zero so systemd/docker restart loops surface it
- [ ] Replace `log` with `slog` for structured JSON logs (request ID, job ID, duration)
- [ ] Sanitise `downloadName` in `handler.Download` — strip path-traversal chars and control bytes from `OriginalName` before building the filename header
- [ ] Unit tests: `job.Queue` (concurrent Submit/Get), `converter.FFmpegConverter` against a fixture file, `storage.TempStore` TTL sweep
- [ ] Metrics: `/metrics` Prometheus endpoint (job counts, queue depth, p50/p95 conversion duration)
- [ ] Second converter behind the interface as a smoke test of the registry — `imagemagick` for image ops OR `yt-dlp` for URL-based downloads
- [ ] Graceful shutdown: drain in-flight jobs before exiting, currently we cancel context which kills `ffmpeg` mid-encode

## Frontend (React + RSBuild)

- [x] Add `react-router` and route skeletons per the CLAUDE.md Directive 1 URL pattern: `/`, `/convert-mp4-to-gif`, `/convert-wav-to-mp3`, etc. Each route pre-selects the conversion pair and embeds the same tool component
- [x] Generate 5 initial `/convert-*` landing pages as actual routes (not query params) — start with the pairs listed in `docs/seo.md` week-1 priorities (source of truth: `src/data/pairs.ts`)
- [x] Inject `WebApplication` (homepage) + `HowTo` + `BreadcrumbList` (pair pages) JSON-LD via `usePageMeta` hook
- [x] Create `public/llms.txt` and serve it at `/llms.txt` — content template is in `docs/seo.md`
- [ ] Serve a real 301 from `/convert` → `/` at the edge (nginx / Cloudflare). The React `<Navigate>` is a client-side fallback only — search engines won't see the redirect
- [ ] Sitemap.xml generation from the route list at build time — drive from `src/data/pairs.ts`
- [ ] `favicon.svg` — optional, raster favicons already copied from seanmizen.com
- [ ] Keyboard shortcut: `Cmd/Ctrl+U` focuses the drop zone's hidden file input
- [ ] Handle the "drag entered then left" state so the drop zone doesn't get stuck in hover style
- [ ] Error state currently shows `String(e)` — render a friendly message map instead

## Infra / Deployment

- [ ] 🔒 Home server arch — is it arm64 (Pi / Apple Silicon) or x86_64? Affects Docker buildx platform and whether we ship a native binary or a container
- [ ] Set up Cloudflare Tunnel + DNS CNAME per `docs/architecture.md`
- [ ] Write the systemd unit file (template is in `docs/architecture.md`) or commit to docker-compose for prod — pick one, don't maintain both
- [ ] Log rotation / retention policy for the backend
- [ ] Disk quota on `TEMP_DIR` partition — without this a single runaway upload could fill root
- [ ] Monitoring: ffmpeg failure rate alert (>5% over 10 min triggers a ping)

## Branding & Domain

Name and domain **locked**: Sean's Converter, `seansconverter.com`. See [`docs/branding.md`](docs/branding.md).

- [ ] Register `seansconverter.com` (if not already done)
- [ ] OG image / social card — 1200×630 PNG with the "s" mark
- [ ] Optional: vector SVG version of the "s" mark (current favicons are PNG/ICO)

## Monetisation (ship later, not week 1)

- [ ] Apply to Carbon Ads once traffic hits ~10k monthly — don't apply before that, they reject low-traffic sites and the cooldown burns your slot
- [ ] Design token pack UI (no implementation yet — keep the free tier only until there's real demand)
- [ ] Stripe webhook scaffold — schema is in `docs/monetisation.md`
- [ ] Add persistent anon-user cookie + `free_usage` table when token system is implemented
- [ ] Decide: is the free tier 5/day by IP or 10/day by cookie+IP? 🔒

## SEO (week 1 priorities, from `docs/seo.md`)

- [ ] Ship `llms.txt` + JSON-LD structured data on day 1
- [ ] Write 5 `/convert-*` landing pages
- [ ] Post "Show HN" framed around the Go streaming architecture (tuesday/wednesday morning US Eastern)
- [ ] Answer 5 Reddit / SuperUser / StackOverflow questions about format conversion, mention the tool once at the end
- [ ] Submit to alternativeto.net, theresanaiforthat.com, producthunt.com

## Resolved decisions (historical)

1. ~~🔒 Home server arch~~ → **x86_64**, portable to arm64 (no hardcoded arch). Default Docker buildx target `linux/amd64`. See `docs/architecture.md`.
2. ~~🔒 Brand name~~ → **Sean's Converter** at `seansconverter.com`. See `docs/branding.md`.
3. ~~🔒 Canonical home route~~ → `/` is canonical. `/convert` 301-redirects to `/`. Per `CLAUDE.md` Directive 1.
4. 🔒 **Free tier shape** — still open: 5/day by IP, or 10/day by cookie+IP? Not blocking until monetisation ships.
