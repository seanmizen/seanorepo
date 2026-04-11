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

- [ ] Add `react-router` and route skeletons per the CLAUDE.md Directive 1 URL pattern: `/`, `/convert-mp4-to-gif`, `/convert-wav-to-mp3`, etc. Each route pre-selects the conversion pair and embeds the same tool component
- [ ] Generate 5 initial `/convert-*` landing pages as actual routes (not query params) — start with the pairs listed in `docs/seo.md` week-1 priorities
- [ ] Inject `WebApplication` + `HowTo` JSON-LD per page in the RSBuild HTML template
- [ ] Create `public/llms.txt` and serve it at `/llms.txt` — content template is in `docs/seo.md`
- [ ] Sitemap.xml generation from the route list at build time
- [ ] `favicon.svg` — waiting on branding lock-in 🔒
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

## Branding & Domain 🔒

- [ ] Pick the name — top rec in `docs/branding.md` is **Transmute**, but this is Sean's call
- [ ] Register the domain. Check availability of `.dev` first (likely free), `.io` second
- [ ] Wordmark / logo draft — sans-serif, two-arrow transform icon per branding doc
- [ ] Favicon (SVG, dark + light variant)
- [ ] Update all placeholder domains in docs once locked in — currently `yourdomain.com` / `transmute.dev` as examples

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

## Open questions for Sean

These block multiple TODOs above — answering them unlocks work:

1. 🔒 **Home server arch**: arm64 or x86_64? Affects Dockerfile platform, binary builds, CPU-count tuning for `WORKERS`
2. 🔒 **Brand name**: Transmute or something else? Everything downstream (domain, logo, JSON-LD `name` field, social cards) waits on this
3. 🔒 **Canonical home route**: I defaulted to `/` being canonical with `/convert` → `/` redirect. If the brand name is itself a noun, we might want `/convert` as canonical instead — let me know if you want to flip it
4. 🔒 **Free tier shape**: 5/day by IP, or 10/day by cookie+IP? IP is harder to circumvent but rougher on shared networks (offices, libraries)
