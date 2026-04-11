# Converter — Engineering Directives

This file is **agent-authoritative**: any Claude session working in `apps/converter/` must read it and treat the rules below as baseline constraints. These override general instincts. If a directive here conflicts with what feels natural, the directive wins.

---

## Directive 1: URLs are ad copy, not file paths

### The conversation this came from

> **Branding Manager:** When a user searches on Google, they type "convert mp4 to gif". Not "mp4 to gif" — "**convert** mp4 to gif". The verb is the whole query. If our URL is `/mp4-to-gif`, the slug misses the operative word. Our competitors (CloudConvert, FreeConvert, Zamzar) all lead with the verb — that's not an accident, it's where the ranking signal lives.
>
> **Lead Engineer:** I hear you. My concern is that URL structure is also internal taxonomy — `/convert/mp4-to-gif` reads like a section of the site with a child resource. Verb-prefixed flat slugs (`/convert-mp4-to-gif`) collapse that hierarchy. If we add `/compress-mp4` later, those are siblings of `/convert-mp4-to-gif` at the same URL depth, which is philosophically odd — conversion and compression aren't peers in the tree.
>
> **BM:** They're peers in the user's head. That's what matters. A user doesn't think "I need a conversion tool, specifically an mp4-to-gif one" — they think "I need to convert mp4 to gif." We're selling an answer to a sentence, not a slot in a taxonomy.
>
> **LE:** Fine. But we need a rule so this doesn't drift. And it needs to carve out the API — I'm not renaming `POST /api/jobs` to `/api/create-a-job`. REST stays REST.
>
> **BM:** Agreed. User-facing routes are ad copy. Machine-facing routes are plumbing. Two different audiences, two different rules.

**Conclusion**: Every user-facing route is named as if it were a Google search query. Every machine-facing route follows REST. The URL is the first thing a person reads — and often the only thing they read before clicking.

**Final call: flat form wins.** `/convert-mp4-to-gif`, not `/convert/mp4-to-gif`. The whole Google query lives in a single slug, no nesting. This is locked.

### The rule

**Every user-facing route MUST begin with an action verb that matches a real search query.**

This includes:
- Feature pages (conversion pairs, compression, resizing, trimming, etc.)
- Landing pages created for SEO
- Share-safe canonical URLs shown in the browser

This does NOT include:
- `/api/*` — REST noun routes stay as they are (`/api/jobs`, `/api/formats`)
- `/health`, `/robots.txt`, `/sitemap.xml`, `/llms.txt` — infrastructure paths
- Internal static assets

### Approved patterns

Use flat, single-segment slugs. Do **not** nest under `/convert/...`.

| Operation | Pattern | Example |
|---|---|---|
| Format conversion | `/convert-{in}-to-{out}` | `/convert-mp4-to-gif` |
| Compression | `/compress-{format}` | `/compress-mp4` |
| Resizing | `/resize-{format}` | `/resize-png` |
| Trimming | `/trim-{format}` | `/trim-mp3` |
| Cropping | `/crop-{format}` | `/crop-jpg` |
| Merging | `/merge-{format}` | `/merge-pdf` |
| Extraction | `/extract-{noun}-from-{format}` | `/extract-audio-from-mp4` |

Rules for the slug:
- Lowercase only.
- Hyphens between words, never underscores or camelCase.
- The first word is always a verb.
- The format names match user expectations (`jpg` not `jpeg`; `mp4` not `m4v`) — use whatever users actually search for, not whatever is technically accurate.

### Home and canonical routes

- `/` — brand landing page, shows the generic drag-and-drop tool.
- `/convert` — **redirect** (301) to `/`. Someone who remembers "that convert site" and types `/convert` shouldn't hit a 404.
- Every `/convert-*` page has a canonical link tag back to itself. No cross-canonicalisation to the homepage — each pair page must rank on its own merit.

### Applying this to new work

Before implementing any new user-facing feature, the first artifact is the slug. Write it down. If it doesn't start with a verb that a user would type into Google, rewrite it before you write a single line of code. URL first, code second.

When generating the sitemap, the high-value entries are the `/convert-*` slugs. Do not include the homepage as the only indexable page.

When writing internal links (nav, footer, related-tools blocks), link to the verb-prefixed slugs directly. Do not link to `/` with query params like `?from=mp4&to=gif` — that creates one page Google sees, not thirty.

---

## Directive 2: Backend is Go, runtime is ffmpeg

The root `CLAUDE.md` says "Bun is RUNTIME ONLY" for other apps. Converter is the exception: the backend is Go, the runtime binary is `ffmpeg`. Do not rewrite the backend in Bun or Node to match the rest of the monorepo — the performance profile (streaming uploads, process-per-job, bounded worker pool) is why Go was chosen.

When adding a new converter (imagemagick, pandoc, yt-dlp, etc.), register it behind the `converter.Converter` interface in `backend/internal/converter/`. Do not add a second backend service. One Go binary, many converters.

---

## Directive 3: Docs live alongside the code

The four docs in `apps/converter/docs/` (`architecture.md`, `branding.md`, `seo.md`, `monetisation.md`) are load-bearing — they contain decisions, not just notes. When you change behaviour that contradicts a doc, update the doc in the same commit. Do not leave docs stale.
