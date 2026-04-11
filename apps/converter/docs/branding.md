# Branding

## Decision

**Name: Sean's Converter.**
**Domain: `seansconverter.com`.**
**Product mark: the lowercase `s` lockup from `apps/seanmizen.com/public/`** — same visual parent as Sean's personal site, explicitly reused as a brand family mark.

Rationale: eponymous branding keeps the converter in Sean's personal project family (alongside seanmizen.com, carolinemizen.art, seanscards, etc.), and the domain is the literal answer to "what is this thing" — no explanation needed. "Transmute" and the other candidates below were considered and rejected; Sean's call.

**Nomenclature rules for all code and docs:**

- In URLs, the operative word is **`convert`** (per [`CLAUDE.md`](../CLAUDE.md) Directive 1).
- In prose and UI copy, the product is **"Sean's Converter"**. Short form: **"Converter"**. Do not invent alternate brand words.
- In JSON-LD, OG tags, HTML `<title>`, meta `name` fields: always **"Sean's Converter"**.
- Canonical host: **`https://seansconverter.com`**. No subdomain for the API — if we ever split, it's `api.seansconverter.com`.
- Page title pattern: **`Convert {X} to {Y} online — Sean's Converter`**.

All of the above is isolated to `apps/converter/frontend/src/lib/brand.ts` so a future rename is a single file change.

---

## Assets Harvested from seanmizen.com

Copied from `apps/seanmizen.com/public/`:

- `favicon.ico`
- `favicon-16x16.png`
- `favicon-32x32.png`
- `apple-touch-icon.png`
- `android-chrome-192x192.png`
- `android-chrome-512x512.png`
- `site.webmanifest` (with `name` field rewritten to "Sean's Converter")

Still missing, not blocking:

- OG image / social card (1200×630 PNG) — Sean will draft before the Show HN post
- Dedicated SVG logo (as opposed to raster favicon) — nice-to-have, not required

---

## Candidates considered and rejected (historical)

Kept for the record in case Sean ever wants to revisit. Do not reference these as current branding.

<details>
<summary>Show candidates</summary>

### Transmute ❌ REJECTED
Considered: one word, alchemy metaphor. Rejected by Sean: "Transmute sucks."

### Pipefile, Convex, Shiftr, Fmtly, Unbox, Recast, Distill
Considered as invented product names to separate the tool from Sean's personal brand. Rejected in favour of eponymous branding — the reverse argument (keeping it in the Sean family) won.

</details>
