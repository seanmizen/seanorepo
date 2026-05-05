# Sean's Converter — Phased Build Plan

> Working delivery doc. Turns the vision in [`spec-2026-05-05.md`](./spec-2026-05-05.md) into ticket-sized phases, accounting for what already exists in this directory. Hand this to a ticket-writing agent.

## Reference reading (in priority order)

- [`spec-2026-05-05.md`](./spec-2026-05-05.md) — vision, non-negotiables, voice, URL architecture, schema list, anti-goals. Source of truth for the *why*.
- [`docs/STRATEGY.md`](./docs/STRATEGY.md) — simplicity vs fractal-options tradeoff, the 12 flagship presets, repeat-customer hooks, wasm-vs-server tiering rules.
- [`docs/COMPETITORS.md`](./docs/COMPETITORS.md) — competitor numbers; source for the comparison table.
- [`README.md`](./README.md) — current Go service shape and op registry.
- [`web-spa/README.md`](./web-spa/README.md) — current vanilla-TS SPA, kept as reference once Phase 0 lands.

## Architecture: a surprisingly good single-machine forever

This is a **single-machine product**. Not "until we scale", not "single-machine for now" — single-machine as the architecture. The whole product runs on the Cloudflared home server: one Go binary, one SQLite file, one `./data` directory. The phased plan below contains zero "prepare for scale" tickets.

Why this is the right architecture and stays the right architecture:

- **SEO timeline buys us years.** Programmatic-SEO sites take 6–18 months to start ranking on long-tail. We have multiple years of runway before traffic even *could* force a re-architecture. By then we'll know exactly which bottleneck to break, if any.
- **ffmpeg is CPU-bound, not network-bound.** A single beefy machine eats thousands of jobs/day without sweating. We're cooking pixels, not shuffling RPCs.
- **Operations simplicity is a moat.** Cloudconvert et al. burn engineering time on infra that doesn't differentiate. We don't. Every hour not spent on Redis cluster topology is an hour spent shipping recipes and pSEO pages.
- **Backups are `cp seans-converter.db ./backup/`.** That's the whole disaster-recovery plan.

**Where this doc disagrees with [`spec-2026-05-05.md`](./spec-2026-05-05.md) on hosting/persistence/scale, this doc wins.** The dated spec preserves the vision (three doors, no watermark, MCP, AEO). Stack choices in §4 of that doc — Postgres, Redis, S3, Vercel, Fly worker fleet — are superseded by the architecture above.

We revisit this only when measured load on the home server forces it. Not before. Not "just in case".

## Locked decisions

These do not get re-litigated per phase. Push back via a new spec revision if needed.

- **Brand:** Sean's Converter. Domain: `seansconverter.com`. Port scheme: `4050` (FE) / `4051` (BE) on Cloudflared. No rename to "Reel" or other placeholder.
- **Engine:** existing Go service (`main.go`, `handler.go`, `ops.go`, `jobs.go`, `store.go`) is the worker. 50 ops + the test harness in `test/` stay. We extend, not replace.
- **Frontend stack:** Next.js 15 (App Router) + Tailwind. Static generation for pSEO. The vanilla-TS SPA in `web/` becomes reference material; the Next.js app supersedes it.
- **Engine lane order:** server lane first (already works). Wasm second, after MCP and API ship.
- **Auth posture:** anonymous free tier — no login to convert. Pro tier uses email-link auth (Auth.js — local DB-backed, no third-party dependency).
- **Payments:** Stripe. Existing scaffolding in `billing_db.go`, `billing_handler.go`, `billing_e2e_test.go` is preserved and wired into the Next.js dashboard.
- **Persistence:** SQLite. One file, WAL mode. Tables: `users`, `api_keys`, `jobs`, `usage_events`. Replaces the in-memory job tracker.
- **Job queue:** in-process. A bounded goroutine worker pool reads ready rows from the `jobs` table. No Redis, no Asynq, no MinIO, no separate queue daemon.
- **Storage:** local disk under `./data/`, swept on a 1-hour TTL. No S3, no R2, no abstract provider interface — one implementation, the right one.
- **Hosting:** Cloudflared on the home server. That is the deploy target.

## What exists today (preserve, don't rewrite)

- Go HTTP service, 50 ops registered, sync `/convert`, in-memory `jobs.go` tracker.
- Stripe scaffolding: subscription checkout, token packs, customer portal, webhook handler.
- E2E test harness: `e2e_test.go`, `billing_e2e_test.go`, and the numbered `test/*.sh` scripts that generate inputs via `lavfi`. **Don't break these.**
- Vanilla-TS SPA: drop zone, URL-state presets, billing UI, theme toggle, comparison table copy. Logic ports into the Next.js app component-by-component.
- `docs/STRATEGY.md` and `docs/COMPETITORS.md` — research that Phases 1–7 reference repeatedly.

## What we're explicitly NOT building (from spec §15)

Don't let scope drift back in via tickets. If you find yourself writing one of these, stop:

- Desktop app, mobile app.
- AI features (auto-captions, scene detection, upscale, background-remove).
- Timeline editor (VEED/Clipchamp territory).
- PDF / document conversion (CloudConvert/Zamzar territory).
- Community / forum (GitHub Discussions is enough).
- Any "AI-powered" / crypto / NFT marketing copy.

---

## Phase 0 — Repo prep (~2 tickets)

**Goal:** make space for the Next.js app without breaking the working SPA.

**Deliverables**

- Rename `apps/ffmpeg-converter/web/` → `apps/ffmpeg-converter/web-spa/`. Update package.json scripts (`yarn start`, `bun run dev.ts` paths) and the top-level `yarn` shortcut if any.
- Update `web-spa/README.md` header to flag it as legacy reference, point readers to `phased-spec.md`.
- Update root `apps/ffmpeg-converter/README.md` with the new layout: `web-spa/` (reference), `web/` (Next.js, coming next phase), Go backend (root).

**Done when:** `yarn start` from `apps/ffmpeg-converter/` still runs FE+BE; existing E2E tests pass unchanged.

**Out of scope:** any new functionality, any Next.js code.

---

## Phase 1 — Next.js skeleton + ops matrix + first tool page (~5 tickets)

**Goal:** prove the new stack end-to-end with one working pSEO page. Everything else generalises from this template.

**Deliverables**

- New `apps/ffmpeg-converter/web/` (Next.js 15 App Router, TypeScript, Tailwind). Dev port `4050`. Production build clean. Dockerfile with `dev` and `prod` targets following the monorepo pattern.
- Typed operations matrix at `web/src/ops/matrix.ts`. One row per (operation, input, output, params). Covers a **curated subset** of the 50 Go ops — see spec §6 for the schema. Source of truth for page generation. Generation code rejects nonsensical combos (e.g. `mp3-to-mov`).
- One pSEO tool page: `/convert/mov-to-mp4`. Full layout per spec §7.2: H1, value prop, drop zone, result block (download + ffmpeg command + copy button + reverse link), three sibling links, FAQ block, "How it works".
- Page template extracted as a React component (`<ToolPage row={...} />`). Phase 2 calls it 200 times.
- `/api/*` proxy in Next.js rewrites to the existing Go backend on `:9876`. Same-origin, no CORS. Mock fallback when backend is offline (mirror `web-spa/dev.ts` behaviour).
- Homepage (`/`) per spec §7.1: drop zone above the fold, 12-flagship pill row from `STRATEGY.md`, three-card row, footer with `/llms.txt` link (file ships in Phase 5; link is fine to add now).
- Performance budget validated on the tool page: LCP <1.2s on 4G, JS <80kb initial, CLS <0.05, Lighthouse Performance ≥95. ffmpeg.wasm is **not** loaded yet — wait for Phase 6.

**Done when:** dropping a `.mov` on the homepage routes to `/convert/mov-to-mp4`; that page converts the file end-to-end against the Go backend; Lighthouse on the tool page meets the budget.

**Out of scope:** the other 199 tool pages (Phase 2), wasm (Phase 6), pricing UI (Phase 4), persistence changes (Phase 3), MCP (Phase 5), schema.org (Phase 2).

---

## Phase 2 — pSEO at scale (~6 tickets)

**Goal:** ≥200 indexable static tool pages. SEO clock starts.

**Deliverables**

- Generate every valid (op × from × to) combination from the matrix. Coverage target: convert (15 video × 14 video) + extract-audio (15 video × 6 audio) + compress (15 video) + gif (15 → gif) + size-targeted compress (`mp4-under-25mb`, `mp4-under-8mb`, `mp4-under-100mb`). Spec §6.
- Schema.org per page: `SoftwareApplication`, `HowTo`, `FAQPage`, `BreadcrumbList`. JSON-LD blocks generated from the matrix row.
- Hub pages: `/convert`, `/compress`, `/extract-audio`, `/trim`, `/resize`, `/gif`, each listing every variant.
- `sitemap.xml` auto-generated from the matrix. `robots.txt` explicitly allows `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `CCBot`.
- Per-page OG image (op + formats) generated at build time. Twitter card meta.
- Internal linking: every page links to ≥3 siblings (the spec's reverse + adjacent + compress trio).
- 301 redirects for misspellings (`mp4tomov`, `mp-4-to-mov`, `convert-mp4-mov`) to the canonical slug.
- Submission to Google Search Console + Bing Webmaster Tools.
- Per-page word count: 250–600 unique words (template + per-op variation, no spun filler).

**Done when:** ≥200 tool pages live, sitemap submitted, every page passes Lighthouse SEO ≥100 and the schema validators, no duplicate-content warnings in GSC after 14 days.

**Out of scope:** cookbook recipes (Phase 7), localisation (Phase 8), the `/ffmpeg-commands` cheatsheet (Phase 7).

---

## Phase 3 — SQLite-backed jobs + in-process worker pool (~3 tickets)

**Goal:** the in-memory job tracker becomes durable. The single Go binary handles its own queue and concurrency. No new daemons.

**Deliverables**

- SQLite schema + migrations (`golang-migrate` or `embed` + init SQL — DECIDE during ticket-writing). Tables: `users`, `api_keys`, `jobs`, `usage_events`. WAL mode. One file at `./data/seans-converter.db`.
- `jobs` table replaces `jobs.go`'s in-memory map. Columns: `id`, `op`, `status` (`queued`/`running`/`done`/`error`/`dead`), `attempts`, `next_attempt_at`, `error`, `ffmpeg_command`, `input_path`, `output_path`, `created_at`, `updated_at`, `expires_at`.
- In-process goroutine worker pool. Concurrency bounded by `WORKERS` env (default 4). Each worker polls SQLite for `status='queued' AND next_attempt_at <= now()`, claims a row via `UPDATE … WHERE status='queued'` in a transaction, runs ffmpeg, updates the row.
- Retry / dead-letter handled in the same table: increment `attempts`, set `next_attempt_at = now() + backoff`, flip to `status='dead'` after N attempts.
- Async API contract: `POST /convert` enqueues and returns `202 { job_id, status_url }`. `GET /jobs/:id` returns `{status, download_url?, ffmpeg_command, error?}`.
- Sweep goroutine, ticking every 10 minutes: delete files in `./data/` past `expires_at`, prune `jobs` rows older than 24h. No cron, no separate process.
- Existing E2E tests adapted to the async flow without losing coverage. Synchronous `/convert` shim kept only as long as the SPA still uses it; deleted once the Next.js app is the sole client.

**Done when:** `kill -9` mid-job and restart resumes that job; 50 concurrent submissions stay under memory budget with no SQLite lock contention; the sweep clears artifacts on schedule.

**Out of scope:** anything multi-process or multi-machine. REST API for external devs (Phase 4). MCP (Phase 5).

---

## Phase 4 — REST API + Pro tier UI (~5 tickets)

**Goal:** devs use the service via API. Pro tier is buyable end-to-end. Stripe scaffolding gets wired into the new frontend.

**Deliverables**

- Versioned REST API per spec §11: `POST /v1/jobs`, `GET /v1/jobs/:id`, `GET /v1/usage`. Bearer auth via API key. `Idempotency-Key` header support. Standard JSON errors `{error: {code, message}}` with proper HTTP codes.
- Dashboard at `/dashboard`: API key creation/rotation/revoke, usage-this-month, plan, upgrade button. Wired to existing `billing_handler.go` endpoints.
- `/docs/api` page: sidebar nav, code samples in curl + JS + Python + Go for every endpoint, equivalent ffmpeg command shown for each op (the dev-funnel hook).
- `/pricing` page per spec §7.6 — three columns (Free / Pro £10/mo / API metered).
- Auth.js wired against the SQLite users table. Email-link only for Pro. Free remains anonymous.
- Stripe webhook handler tested against test-mode live webhooks. Token-pack flow confirmed working through the new dashboard.
- Per-key rate limits enforced in-process against the `usage_events` table. Cloudflare's existing tunnel handles abuse-level edge limiting at no extra setup cost.

**Done when:** a dev can sign up via email link, get an API key, hit `/v1/jobs` with curl, see usage tick up. A buyer can upgrade to Pro via Stripe checkout and see new limits applied without re-auth.

**Out of scope:** MCP (Phase 5), wasm (Phase 6).

---

## Phase 5 — MCP server + AEO surfaces (~4 tickets)

**Goal:** AI assistants find Sean's Converter natively. The agent door of the three-doors thesis.

**Deliverables**

- New workspace `apps/seans-converter-mcp/` implementing the MCP server. Tools: `convert_video(file, target_format, options?)`, `compress_video(file, target_size_mb)`, `extract_audio(file, target_format)`, `trim_video(file, start, end)`, `video_to_gif(file, fps?, scale?)`. Calls REST API (Phase 4) under the hood with a service API key.
- Mirror to a public GitHub repo, MIT licence. README is marketing: Claude Desktop install screenshot, JSON config blocks for Claude Desktop / Cursor / other MCP clients, example prompts.
- `/docs/mcp` page on the main site: install block (one-click for Claude Desktop where supported), tool list with the descriptions the LLM sees, example prompts, privacy note, link to the GitHub repo.
- `/llms.txt` and `/llms-full.txt` at root, generated from the operations matrix per spec §10. `/llms-full.txt` enumerates every tool page and (once Phase 7 lands) every recipe.
- Submission to MCP directories: Smithery, awesome-mcp lists, the official MCP server directory.

**Done when:** Claude Desktop installs the server with one config paste; running `convert_video` on a sample MOV through Claude downloads a working MP4; `/llms.txt` validates against the convention.

**Out of scope:** content marketing pushes (Phase 7), wasm (Phase 6).

---

## Phase 6 — Wasm in-browser lane (~3 tickets)

**Goal:** small files never leave the device. Deliver on the privacy promise wherever cheap.

**Deliverables**

- `@ffmpeg/ffmpeg` LGPL build wired into the tool-page component. Lazy-loaded on first user interaction (drop or click) — never on page load. Protects the LCP budget from Phase 1.
- Tier router per `STRATEGY.md` table: file <50MB AND op supports wasm AND codec doesn't need libaom/libass/drawtext → wasm; otherwise → server.
- Footer copy adapts based on the lane the current job is on: "Your file never leaves your device" (wasm) vs "Files auto-delete one hour after conversion" (server). Spec §3 phrases are load-bearing — use them verbatim.
- Graceful fallback: if wasm OOMs or fails, surface a "Switch to server" button rather than an error.
- Initial subset: `mp4-to-gif`, `mp4-to-mp3`, `mp4-to-webm`. Expand by op as bundle size and reliability allow.
- Tested on a real low-end Android (~£100 phone budget per spec §13).

**Done when:** the three subset ops work entirely in-browser on a mid-range phone; the fallback path works when wasm bails.

**Out of scope:** wasm builds of every codec — the matrix is curated. H.264 encode in particular stays server-side until codec licensing is reviewed.

---

## Phase 7 — Content moat (rolling, ~10 tickets, no hard end date)

**Goal:** earn backlinks and LLM citations. Compounds Phases 2 and 5. Not on the critical path — runs in parallel from Phase 2 onward.

**Deliverables**

- 30 cookbook recipes at `/cookbook/[slug]` per spec §7.3. Each one: H1, why-you'd-want-this, command + copy button, plain-English flag walkthrough, try-it widget, variations, internal links to related tool pages.
- `/cookbook` index page.
- `/ffmpeg-commands` — canonical ffmpeg cheatsheet. Every command has a `[try it]` link to a tool page. **Phase 4 multiplier, not foundation.** Don't ship before the pSEO pages are pulling traffic.
- Comparison pages: `/compare/cloudconvert`, `/compare/zamzar`, `/compare/handbrake`. Honest, factual, sourced from `docs/COMPETITORS.md`.
- Stack Overflow presence: 50 ffmpeg answers over 6 months. Link to recipes only when genuinely the best answer.
- Reddit presence: r/ffmpeg, r/VideoEditing, r/webdev — show up, be useful, don't spam.

**Done when:** measured by referrers in analytics, not ticket count. This phase doesn't "complete" — it runs continuously.

**Out of scope:** localisation (Phase 8).

---

## Phase 8 — Expansion (~6 tickets, gated on real traffic)

**Goal:** scale once the engine is proven. Don't pre-empt — wait for analytics to justify.

**Deliverables**

- pSEO matrix expansion to 500+ pages. Add long-tail (more size-targeted compress, more resolution-targeted resize).
- Localise top 20 pages to ES, DE, FR, PT-BR — only if traffic data justifies it. Hreflang done properly.
- Server-sent events for progress on long encodes. Progress bar in the UI.
- Drag-out download (`dataTransfer.setData('DownloadURL', ...)`) — small delight from `STRATEGY.md`.
- Optional CLI tool — only if API customers ask for it.
- Accept URL input ("paste a YouTube link" / "paste an MP4 URL") — backend `source=url` branch.

**Done when:** measured against spec §14's 12-month metrics: 50k organic sessions/mo, top-3 for 50+ long-tail queries, £10k MRR, cited by name in ChatGPT/Claude.

---

## Plan of action

1. **Now (this commit):** `new-spec.md` renamed to `spec-2026-05-05.md`. This file is the working delivery doc. The dated spec is the immutable vision; this file is the moving plan.
2. **Next session:** spawn a ticket-writing agent. Scope: Phase 0 + Phase 1 only. Each deliverable above maps to roughly one ticket — split if obviously bigger (e.g. "Postgres schema" might be schema + migration tooling). Do not write tickets past Phase 1 yet — let the plan absorb learnings before committing more.
3. **Per-phase rules:**
   - One phase = one GitHub Project milestone.
   - Tickets follow `SEAN-{number}/{short-description}` and the existing issue templates in `.github/ISSUE_TEMPLATE/`.
   - WIP cap of 3–5 in-progress per the agile blueprint.
   - Out-of-scope discoveries → new issues, not expanded tickets.
4. **Phase ordering:**
   - Linear: Phase 0 → 1 → 2 → 3 → 4. Each depends on the previous.
   - Parallelisable: Phase 5 (MCP) can run alongside Phase 3 if a second worker is free, since it consumes Phase 4's API and that's the only hard dep — sequence with Phase 4.
   - Phase 6 (wasm) waits for Phase 4.
   - Phase 7 (content) starts the moment Phase 2 ships.
   - Phase 8 is gated on Phase 7 + 12 weeks of analytics data.
5. **Priority guidance for the ticket writer:**
   - Phase 0–1: P0/P1.
   - Phase 2–4: P1.
   - Phase 5–6: P2.
   - Phase 7: P3 (rolling).
   - Phase 8: P3 (post-data).

## Notes for the ticket-writing agent

- Each ticket needs the standard fields per `CLAUDE.md`: **Context**, **Acceptance Criteria** (checklist), **Files Likely Touched**, **Priority** (P0–P3), and a **Phase** tag (e.g. `phase-1`).
- For Phase 1 tickets, "Files Likely Touched" should reference the *new* Next.js layout (`apps/ffmpeg-converter/web/...`), not the legacy SPA paths.
- Where this doc says "DECIDE" (auth provider, S3 provider in prod), file a discrete decision ticket rather than letting the implementing ticket make the call silently.
- Don't ticket-write past the next phase. The plan is allowed to drift mid-phase as we learn — write Phase 2 tickets only once Phase 1 is in PR review.
- The 12 flagship presets and the WASM tier table from `STRATEGY.md` are load-bearing — link to those sections from the relevant tickets rather than restating.
