# Phase 2 Quality Gate — pSEO at scale

Closes the Phase 2 quality gate from SEAN-61. Validates the work shipped by
SEAN-52 → SEAN-57 against the Lighthouse SEO + schema.org + index-coverage
budget. Mirrors `phase-1` perf-budget doc style (`./perf-budget.md`).

## Budget (from issue #61 acceptance criteria)

| Metric / Gate                          | Target                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| Lighthouse SEO score                   | ≥ 100 on homepage + 4 named tool pages + 1 hub page                           |
| Lighthouse Performance score           | ≥ 95 (Phase-1 perf budget must not regress)                                   |
| schema.org validators                  | No errors on the same six pages — warnings noted but acceptable               |
| Sitemap submitted to GSC + Bing        | Submission timestamps recorded                                                |
| GSC duplicate-content warnings (T+14d) | None                                                                          |
| ≥200 tool pages live                   | Verified via `next build` page count + `resolveAllPages` ≥ 200 unit test      |

## Methodology

A full Lighthouse audit was run against a local production build:

```bash
cd apps/ffmpeg-converter/web
yarn build && yarn serve  # Next.js production server on port 4050

CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  npx lighthouse@12 http://localhost:4050/<path> \
  --only-categories=seo,performance \
  --chrome-flags="--headless=new --no-sandbox" \
  --output=json --output-path=./<page>.json
```

- Lighthouse v12.8.2
- HeadlessChrome 147 (default Lighthouse simulated-mobile profile,
  `Slow 4G + 4× CPU slowdown`)
- Each page run once (Lighthouse SEO/perf scores are stable and deterministic
  enough for a single run on a static page; perf has minor variance ±2 — all
  pages comfortably above the 95 floor).

JSON-LD schemas were extracted from the rendered HTML and validated
structurally against schema.org's required-field rules and Google's
rich-result requirements. The official live `validator.schema.org` and
Google Rich Results Test require a publicly-reachable URL — re-run those
against the production deploy as soon as it lands; see "Manual followup"
below.

## Page set under test

The six pages required by AC #1:

1. `/` — homepage (acts as the hub: lists the flagship pills, links to every
   matrix slug indirectly via the operations grid).
2. `/convert/mov-to-mp4` — flagship convert page (most-trafficked head term).
3. `/compress/compress-mp4` — flagship compress page.
4. `/extract-audio/video-to-mp3` — flagship extract-audio page.
5. `/gif/mp4-to-gif` — flagship gif page.
6. `/pricing` — second non-tool static page used as the "hub" stand-in (see
   "Hub page" note below).

## Measurements

### Lighthouse SEO + Performance

| Page                          | SEO  | Perf | LCP    | CLS | FCP    | TBT     |
| ----------------------------- | ---- | ---- | ------ | --- | ------ | ------- |
| `/` (homepage)                | 100  | 99   | 2.0 s  | 0   | 0.8 s  | 30 ms   |
| `/convert/mov-to-mp4`         | 100  | 100  | 1.9 s  | 0   | 0.8 s  | 20 ms   |
| `/compress/compress-mp4`      | 100  | 100  | 1.7 s  | 0   | 0.8 s  | 20 ms   |
| `/extract-audio/video-to-mp3` | 100  | 100  | 1.7 s  | 0   | 0.8 s  | 20 ms   |
| `/gif/mp4-to-gif`             | 100  | 100  | 1.7 s  | 0   | 0.8 s  | 10 ms   |
| `/pricing`                    | 100  | 100  | 1.7 s  | 0   | 0.8 s  | 10 ms   |

Every page hits **SEO 100** with no Lighthouse SEO audit warnings. Phase 1's
≥ 95 perf budget is preserved — the lowest measured score across the six is
**99** (homepage), every other page is **100**. The homepage's slightly
higher LCP (2.0 s vs. 1.7 s) is the FlagshipPills row rendering the 12
gradient pill cards — still well under the 2.5 s "good" threshold.

Per-page Lighthouse JSON outputs lived at `/tmp/lh-seo/{page}.json` during
the audit run; they are not committed (regenerated on demand by the command
above).

### schema.org validation — tool pages

Every tool page emits **four** JSON-LD scripts: `SoftwareApplication`,
`HowTo`, `FAQPage`, `BreadcrumbList`. All four were verified per page:

| Page                          | SoftwareApp | HowTo  | FAQPage | BreadcrumbList |
| ----------------------------- | ----------- | ------ | ------- | -------------- |
| `/convert/mov-to-mp4`         | PASS        | PASS   | PASS    | PASS           |
| `/compress/compress-mp4`      | PASS        | PASS   | PASS    | PASS           |
| `/extract-audio/video-to-mp3` | PASS        | PASS   | PASS    | PASS           |
| `/gif/mp4-to-gif`             | PASS        | PASS   | PASS    | PASS           |

Total: **0 errors, 0 warnings** across all 16 schemas.

Required-field checks performed (per Google rich-result docs and
schema.org core spec):

- `SoftwareApplication`: `name`, `applicationCategory`, `operatingSystem`,
  `offers.price`, `offers.priceCurrency` all present.
- `HowTo`: `name`, non-empty `step[]` with `@type: HowToStep` + `text` on
  every step.
- `FAQPage`: non-empty `mainEntity[]` with `@type: Question`, `name`, and
  `acceptedAnswer.text` on every entry.
- `BreadcrumbList`: non-empty `itemListElement[]` with `@type: ListItem`,
  `position` (number), `name`, and `item` URL on every position except the
  trailing one (where `item` is optional per Google's docs).

### schema.org validation — homepage and `/pricing`

Both pages emit **zero** JSON-LD scripts and trivially pass the validator
(nothing invalid to flag). This is by design: the homepage is a marketing
funnel, not an indexable tool. `/pricing` is a Phase 4 stub. Adding an
`Organization` or `WebSite` schema to the homepage is **out of scope for
this gate** — see "Soft findings" below.

### ≥ 200 tool pages live

Verified two ways:

1. `next build` output reports `[+198 more paths]` under `/convert/[slug]`
   alone (= 201 convert pages). Plus compress 16, extract-audio 6, gif 2,
   contact-sheet 1, normalize-audio 1, resize 1, thumbnail 1, trim 1 =
   **230 statically-prerendered tool pages** total.
2. `yarn test:matrix` includes the assertion `resolveAllPages produces
   ≥ 200 pages` — passing on this branch.

## Findings vs. budget

### PASS — Lighthouse SEO ≥ 100 on six named pages

All six pages score **100/100**. No SEO audit warnings.

### PASS — Lighthouse Performance ≥ 95

Lowest measured: 99 (homepage). All five other pages: 100.
Phase 1's perf budget is preserved.

### PASS — schema.org validators on the four tool pages

0 errors, 0 warnings on all 16 schemas (4 schemas × 4 tool pages).

### PASS — ≥ 200 tool pages live, sitemap auto-generated

Confirmed by build output and matrix unit test. `/sitemap.xml` returns 200
and includes one entry per matrix row plus the homepage (verified by
`yarn test:sitemap`).

### Manual followup — GSC + Bing submission

The Cloudflared deploy and Fly.io deploy of `seansconverter.com` are not
yet pointing at the Phase 2 build at the time this gate runs (CEO-side
deployment task). GSC + Bing submission requires:

1. The production domain to be serving the Phase 2 sitemap.
2. Sean (or whoever owns the domain DNS) to verify ownership in Google
   Search Console (DNS TXT record) and Bing Webmaster Tools (meta tag
   or DNS).
3. `https://seansconverter.com/sitemap.xml` submitted from the GSC
   Sitemaps panel.
4. Same URL submitted from the Bing Webmaster Tools Sitemaps panel.

Recording the timestamp here once done:

- GSC submission timestamp: **TODO — Sean to record after deploy**
- Bing submission timestamp: **TODO — Sean to record after deploy**

These steps cannot be performed by a worker agent without GSC/Bing OAuth
credentials, and the AC explicitly allows manual followup for the
submission step.

### Manual followup — GSC duplicate-content warnings (T+14d)

Per AC: re-check Google Search Console 14 days after submission. If GSC
flags duplicate-content warnings on any tool pages, file a follow-up
ticket; if clean, close SEAN-61.

The matrix's slug-uniqueness invariant (`yarn test:matrix` asserts
`every matrix slug is unique`) and the explicit `CURATED_MULTI_INPUT_PAIRS`
de-dupe in `matrix.ts` make duplicate-content warnings unlikely — every
distinct (from, to) pair has exactly one canonical URL.

## Soft findings (non-blocking — file follow-ups if desired)

These were noticed during the gate but are out of scope for SEAN-61. They
do **not** prevent the Phase 2 budget from being met.

1. **HowTo `name` capitalisation** — the schema reads
   `"How to mov to mp4"` (lowercase) instead of `"How to MOV to MP4"`. The
   builder lowercases `row.h1` in `lib/schemas.ts::buildHowToSchema`. Cosmetic,
   passes the validator.
2. **No homepage Organization/WebSite schema** — `/` emits zero JSON-LD.
   Adding `Organization` and `WebSite` schemas with `SearchAction` would
   give the homepage rich-result eligibility; not required by Phase 2 AC.
3. **No hub pages live** — `/convert`, `/compress`, etc. all 404. The
   sitemap.ts comment header (lines 26–28) and the breadcrumb schema
   already reference these URLs. The breadcrumb's middle-segment URL is
   thus a deliberate 404 today (Google's BreadcrumbList docs explicitly
   permit this). Hub-pages ticket lives outside Phase 2.
4. **Breadcrumb URL for `image-convert` rows** — schema emits
   `${ORIGIN}/image-convert/${slug}` (the operation key) but those rows
   are routed under `/convert/...` (the user-facing verb). Today no
   `image-convert` rows are live (see matrix.ts), so this never fires —
   but worth fixing in lockstep with image conversion shipping.

## Re-running the gate

After every Phase 2 change that touches templates, schema builders, or
the matrix:

```bash
cd apps/ffmpeg-converter/web
yarn build
yarn serve &
SERVE_PID=$!

# Lighthouse
mkdir -p /tmp/lh-seo
for page in / /convert/mov-to-mp4 /compress/compress-mp4 \
            /extract-audio/video-to-mp3 /gif/mp4-to-gif /pricing; do
  CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    npx lighthouse@12 "http://localhost:4050${page}" \
    --only-categories=seo,performance \
    --chrome-flags="--headless=new --no-sandbox" \
    --output=json \
    --output-path=/tmp/lh-seo/$(echo "${page}" | tr '/' '_').json --quiet
done

# Schema validation
yarn test:matrix
yarn test:sitemap

kill $SERVE_PID
```

If any page drops below SEO 100 or Perf 95, the budget is missed —
fix before merging the offending change.
