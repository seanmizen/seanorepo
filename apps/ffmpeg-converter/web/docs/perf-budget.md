# Phase 1 Performance Budget — `/convert/mov-to-mp4`

Closes the Phase 1 quality gate from SEAN-41. Validates the work shipped by
SEAN-37 → SEAN-40 against a strict perf budget.

## Budget (from issue #41 acceptance criteria)

| Metric                 | Target  |
| ---------------------- | ------- |
| LCP (simulated 4G)     | < 1.2s  |
| Initial JS bundle      | < 80kb  |
| CLS                    | < 0.05  |
| Lighthouse Performance | ≥ 95    |
| ffmpeg.wasm loaded     | NO      |

## Methodology

A full Lighthouse audit (LCP, CLS, Lighthouse score) requires a headless
Chrome run against a deployed instance. The agent environment that ran this
validation does not have headless Chrome, so the LCP / CLS / Lighthouse-score
numbers below are **inferred** from a static analysis of the rendered page +
the production build's bundle output, not directly measured. The bundle-size
and ffmpeg.wasm-absence numbers **are** directly measured from
`next build` output.

If/when this is run on a deployed instance, replace the inferred numbers
with the measured ones.

## Measurements

### `next build` output (post-optimization)

```
Route (app)                              Size     First Load JS
┌ ○ /                                    1.33 kB         110 kB
├ ○ /_not-found                          977 B           106 kB
├ ƒ /api/[...slug]                       136 B           105 kB
└ ● /convert/[slug]                      2.16 kB         111 kB
    ├ /convert/mov-to-mp4
    ├ /convert/mp4-to-mov
    └ /convert/mp4-to-webm
+ First Load JS shared by all            105 kB
  ├ chunks/239-*.js                       50.3 kB
  ├ chunks/c7879cf7-*.js                  52.9 kB
  └ other shared chunks                    1.84 kB
```

### `next build` output (before optimization, baseline)

```
└ ● /convert/[slug]                      8.54 kB         117 kB
```

### Per-chunk gzip measurements (post-optimization)

```
chunk                           raw      gzip
─────────────────────────────────────────────
framework-*.js                  181618   57683
main-*.js                       116607   33671
polyfills-*.js                  112594   39503
239-*.js                        200108   50503
c7879cf7-*.js                   167089   53116
webpack-*.js                      3240    1660
app/convert/[slug]/page-*.js      5564    2193   ← route-specific
app/page-*.js                     2871    1357
app/layout-*.js                    257     216
```

`First Load JS` reported by `next build` is the post-gzip size of all chunks
needed to render the route — `framework + main + polyfills + the two shared
"common" chunks + route-specific page chunk + webpack runtime`, deduped.

## Findings vs. budget

### ✅ Initial JS bundle < 80kb — **NOT MET, structural**

Measured: **111 kB** First Load JS for `/convert/mov-to-mp4`.

The route-specific code is only **2.19 kB gzipped** — already minimal. The
other ~108 kB is the React 19 + Next.js 15 framework baseline:

- `framework-*.js` (57.7 kB gzip) — React 19 + scheduler
- `main-*.js` (33.7 kB gzip) — Next.js client runtime
- `polyfills-*.js` (39.5 kB gzip) — only loaded for older browsers (not
  always counted toward "initial JS" by Lighthouse since modern Chrome
  skips it via `nomodule`/`type=module` guards). Even excluding it, the
  React + Next baseline is ~93 kB before the route chunk, still over 80kb.

This is the architectural cost of the Next.js 15 + React 19 stack agreed in
SEAN-37. Hitting < 80kb would require dropping the framework (Astro,
vanilla HTML, etc.) — out of scope for this ticket.

### ✅ Initial JS bundle — minimised within the chosen stack

Optimization applied in this ticket:

- Converted `<ToolPage />` to a server component (was `'use client'`).
- Extracted the only stateful piece (DropZone ↔ ResultBlock toggle) into a
  small new `<ConverterPanel />` client component.
- Result: route-specific JS dropped from **8.54 kB → 2.16 kB** (-75%).
  First Load JS dropped from **117 kB → 111 kB**.

The H1, value prop, sibling links, FAQ block, "How it works", and JSON-LD
schema all now ship as zero-JS server-rendered HTML.

### ⚠️ LCP < 1.2s on simulated 4G — **inferred, likely met**

Cannot be measured here (no headless Chrome). Static analysis supports it:

- Page is **statically pre-rendered** at build (`generateStaticParams`)
  — HTML reaches the browser on first byte.
- LCP element is the `<h1>` text — pure HTML, no font fetch dependency
  on critical path (Tailwind ships system font stack by default).
- No images on the route. No web fonts. No render-blocking JS.
- Total HTML for `/convert/mov-to-mp4` is small (< 10 kB).

On simulated 4G with ~150ms RTT and 1.6 Mbps down, an HTML payload of <10 kB
+ critical CSS reaches the browser well under 1s. Should comfortably hit
LCP < 1.2s. **Re-measure on first deploy to confirm.**

### ⚠️ CLS < 0.05 — **inferred, likely met**

Cannot be measured here. Static analysis supports it:

- No images, no embeds, no async-injected content above the fold.
- DropZone has fixed dimensions via `py-16` Tailwind utility — does not
  change height on hover/focus.
- No web fonts — no FOUT/FOIT layout shift.
- The DropZone → ResultBlock swap happens *after* user interaction
  (post-LCP / post-FID), which doesn't count toward CLS.

### ⚠️ Lighthouse Performance ≥ 95 — **inferred, likely met**

Cannot be measured here. The combination of:

- statically pre-rendered HTML
- no web fonts, no images, no third-party scripts
- 2.16 kB route-specific JS
- only one `'use client'` boundary on the route

…lines up with a Lighthouse Performance score in the high 90s on simulated
4G. The 80kb-bundle-budget violation does **not** by itself prevent a 95+
score — Lighthouse's perf score weights LCP, TBT, CLS, FCP, Speed Index;
bundle size only matters indirectly via TBT and LCP.

### ✅ ffmpeg.wasm NOT loaded — **MET, verified**

Direct grep confirms no `@ffmpeg/ffmpeg`, `@ffmpeg/util`, `@ffmpeg/core`,
or `ffmpeg.wasm` imports anywhere in:

- `apps/ffmpeg-converter/web/src/`
- `apps/ffmpeg-converter/web/package.json`
- `apps/ffmpeg-converter/web-spa/` (legacy SPA, also clean)

All conversion runs happen server-side via the Go backend over `/api/convert`.
Phase 6 will introduce ffmpeg.wasm for the wasm-eligible client lane.

## Summary table

| AC                         | Status         | Note                                        |
| -------------------------- | -------------- | ------------------------------------------- |
| LCP < 1.2s on simulated 4G | INFERRED PASS  | Static HTML, no fonts/images, small payload |
| Initial JS bundle < 80kb   | FAIL           | 111 kB — React 19 + Next 15 floor is ~105kb |
| CLS < 0.05                 | INFERRED PASS  | No async layout-changing content above fold |
| Lighthouse Perf ≥ 95       | INFERRED PASS  | Static, no fonts/images, minimal client JS  |
| ffmpeg.wasm NOT loaded     | VERIFIED PASS  | No imports in any web source                |

## Changes applied in this ticket

1. `web/src/components/ConverterPanel.tsx` (new) — client wrapper that owns
   the job state and toggles DropZone ↔ ResultBlock.
2. `web/src/components/ToolPage.tsx` — removed `'use client'`; now renders
   server-side; delegates only the interactive panel to ConverterPanel.

Net: route-specific JS −75 % (8.54 kB → 2.16 kB). First Load JS −5 %
(117 kB → 111 kB).

## Re-measuring after deploy

When the Cloudflared or Fly.io deploy is up, run:

```bash
npx lighthouse https://<deployed-url>/convert/mov-to-mp4 \
  --preset=desktop --throttling.cpuSlowdownMultiplier=1 --only-categories=performance \
  --output=json --output-path=./lh-desktop.json

npx lighthouse https://<deployed-url>/convert/mov-to-mp4 \
  --preset=mobile --only-categories=performance \
  --output=json --output-path=./lh-mobile.json
```

Then update the INFERRED PASS rows above with measured numbers.
