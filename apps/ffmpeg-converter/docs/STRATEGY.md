# ffmpeg-converter — product strategy

Direct answers to Sean's two questions: **where does simplicity win** and **where do
fractal options give an edge / drive repeat customers**. Then the concrete bets: the
flagship headline conversions, the progressive-disclosure panel, the preset + command
display, and the WASM-or-server tier.

Grounded in [COMPETITORS.md](./COMPETITORS.md). Read that first for the numbers.

---

## TL;DR

1. **Simplicity wins on first-use.** A drop zone that accepts any file, auto-suggests
   the right 1–3 target formats, and starts converting before the user has read the
   page, beats every competitor on their landing page.
2. **Fractal options win on second-use.** Power users come back for tools that let them
   tweak the guts and remember their settings. Progressive disclosure + shareable URL
   presets + a live ffmpeg command display is a combination no competitor has.
3. **Tier it by file size.** Small files (<~100 MB) go through ffmpeg.wasm in the
   browser — instant, private, free to run. Big files or codecs WASM can't handle fall
   through to the Go backend. The footer honestly says which tier the current job is on.
4. **Repeat-customer hooks** are all localStorage + URL state, **no login required**:
   preset library, bookmarkable conversion URLs, batch queue memory, "copy as shell
   command."

## Where does simplicity win?

Every one of the server-side SaaS competitors is **drowning their landing page**:

- **CloudConvert** — hero carousel, engine selector, login CTA, enterprise CTA, pricing
  link, feature grid. Drop zone is below the fold on a narrow laptop.
- **Zamzar** — 4-step wizard ("1. Add files. 2. Choose format. 3. Enter email. 4. Convert.").
  Email-before-conversion is a dealbreaker.
- **FreeConvert** — ads, banner ads, interstitial ads, "processing…" ads, "download in 3… 2… 1…"
  ads. Free tier is generous but every interaction costs a page refresh.
- **Convertio** — cleanest of the SaaS incumbents (drop zone on top), but the results
  page still shows an ad rail.
- **Online-Convert** — 2010 HTML, no drag-drop, format picker is a nested dropdown.
- **Media.io** — modal asking for an account before the file has even uploaded.

**The simplicity play:** treat the landing page as a single interaction — drop, convert,
download. No hero images, no explainer text above the fold, no "learn more." Specifically:

- **Single giant drop zone above the fold** that doubles as the click-to-browse target.
- **Auto-detect the file type on drop** (by extension + magic bytes, both cheap in JS)
  and show the 3–4 most likely target formats as big buttons. Clicking a button starts
  the conversion **immediately** with sensible defaults. No second page, no modal,
  no confirmation.
- **Stream the result back.** As soon as the job is done, trigger the download and show
  the result row with a re-download button. No "your file is ready, click here" page.
- **No login, ever.** No email gate, no account prompt. LocalStorage is the only
  persistence and you can wipe it with a button.
- **No ads, no nag modals, no upsell.** The whole site fits in one HTML page + one CSS
  file + one JS bundle. Load time is the one metric that can't be faked.

The specific competitor friction to avoid, one by one:

| Competitor      | Friction to NOT copy                                     |
| --------------- | -------------------------------------------------------- |
| Zamzar          | Email-before-download gate                               |
| Media.io        | "Daily credits" login wall                               |
| FreeConvert     | Interstitial and download-countdown ads                  |
| CloudConvert    | Paywalled above ~25 MB (we should be quietly generous)   |
| VEED / Clipchamp| Full timeline editor when the user just wants a format   |
| Online-Convert  | Nested dropdowns for format selection                    |
| Convertio       | Result page ad rail                                      |

## Where do fractal options give an edge?

Power users come back when a tool **respects them**. ffmpeg is the opposite of simple —
it has ~1500 flags and even professional video editors shell out to it rather than reimplement
it. The users most likely to repeat-visit this site are:

- Developers who need a one-off transcode at 3am and don't want to remember `-crf 28`.
- Video podcasters stripping audio, normalising loudness, and re-muxing to MP4.
- Streamers making GIFs, thumbnails, and contact sheets.
- People cutting clips for Discord/X/Bluesky (100 MB limits → bitrate tweaking).

These users will appreciate options. The trap is showing them **all** the options at
once (CloudConvert's sin — every dialog has 30 fields).

The pattern: **progressive disclosure with cascading reveal**. Each choice unlocks the
next layer of *relevant* choices, not a wall of 200 flags.

### The progressive disclosure layer cake

```
Layer 0 — Drop zone
  "Drop a file here or click to browse."

Layer 1 — Target format (auto-shown on drop)
  8 big buttons: MP4, WebM, GIF, MP3, JPG, PNG, WAV, MKV
  + "More..." disclosure

Layer 2 — Preset (auto-shown after format picked, one click default)
  • "For Discord (10 MB)"  — bitrate-targeted
  • "For web (balanced)"   — sensible default, what we'd pick
  • "Maximum quality"      — CRF 18, no trickery
  • "Advanced..."           — disclosure chevron

Layer 3 — Advanced panel (hidden behind chevron)
  Grouped by video / audio / filters:
    Video:  codec ▾    CRF slider    bitrate    fps
    Audio:  codec ▾    bitrate       sample rate channels
    Filters: resize    crop  trim  rotate  flip  speed  normalize

Layer 4 — The ffmpeg command
  A read-only terminal line at the bottom of the panel,
  updating live as the user tweaks. One-click copy button.
  "If you prefer your own flags, use this as a starting point."
```

Crucially, **layers 3 and 4 collapse by default** on first visit. After the first time
a user opens the advanced panel, we remember that preference in localStorage and show it
expanded on their next visit. Fractal means layer N only unlocks options that are
*relevant given the choices made in layers < N* — e.g. "bitrate" only appears after you
pick a codec that supports bitrate targeting, "CRF" only for x264/x265/VP9, "pix_fmt"
only for power users who toggled a "show everything" checkbox.

### Repeat-customer hooks

All of these are localStorage + URL state. No login.

1. **Bookmarkable URL presets.** Every choice in the panel is mirrored into a URL query
   string: `/?op=transcode_webm&crf=28&audio=opus&fps=30`. Share the URL → the
   recipient gets the same preset pre-loaded. Bookmark it → you've got a one-click
   personal tool. **None of the competitors do this.**
2. **Saved preset library.** "Save this config as..." → stored in localStorage. Next
   visit, the saved presets appear as additional buttons next to the built-ins. Named
   by the user. Export/import as JSON.
3. **Batch queue that remembers.** Drop 10 files → they all use the same config you
   set on the first file. Next session, the last-used config is preselected.
4. **Undo last preset change.** Most tools let you edit a setting but not revert. One
   keystroke undo — power-user signal.
5. **"Copy as ffmpeg command"** — copies the full CLI string to clipboard, including
   input/output paths with placeholders. Lets a user take the output and run it
   themselves.
6. **"Copy as curl"** — copies the exact `curl -F ...` that would hit our backend. Turns
   the site into an ad-hoc API explorer for the Go service.
7. **Drag-out download.** When a job finishes, the result row is draggable into Finder /
   Desktop / an email compose window. Small, delightful, no one does it.

## Flagship 8–12 headline conversions

Based on what the top competitors show on their own landing pages + what Sean's audience
(developer-ish, content-adjacent) actually runs. Twelve, laid out as two rows of six:

| # | Button label          | Op                  | Why it's a headline                                          |
|---|-----------------------|---------------------|--------------------------------------------------------------|
| 1 | **MP4 → WebM**        | `transcode_webm`    | Most-searched conversion; browser-native format              |
| 2 | **MOV → MP4**         | `transcode`         | iPhone → anything-else; top Google search for iOS users      |
| 3 | **MP4 → GIF**         | `gif_from_video`    | Discord, X, Bluesky clip-sharing                             |
| 4 | **Video → MP3**       | `audio_mp3`         | Podcast rip, YouTube audio-only                              |
| 5 | **Shrink for Discord**| `change_bitrate`    | Targets 10 MB; the HandBrake-Online niche                    |
| 6 | **Grab a thumbnail**  | `thumbnail`         | One frame at a timestamp; blog/CMS workflow                  |
| 7 | **Trim a clip**       | `trim`              | Top power-user action; 30 s clip in 3 s                      |
| 8 | **Resize**            | `resize`            | "Make this fit X by Y"                                       |
| 9 | **Image → WebP**      | `image_to_webp`     | Web perf workflow                                            |
|10 | **HEIC/PNG → JPG**    | `image_to_jpg`      | Sending photos via email/Slack                               |
|11 | **Normalise audio**   | `normalize_audio`   | EBU R128, podcast-friendly, differentiator                   |
|12 | **Contact sheet**     | `contact_sheet`     | NxM grid of frames; fun, shareable, memorable                |

Why these twelve:

- They cover **4/4 of the ffmpeg-converter categories** (video, audio, image, special).
- Each maps to **one existing op in `ops.go`** — no new backend code needed for v1.
- They're the conversions that **every competitor's homepage screams about**, plus two
  that none of them do well (normalise audio, contact sheet) as differentiators.
- They fit **one row of six on desktop**, wrapping to 2×6 on tablet, 3×4 on phone.

Everything else in the 50-op registry is reachable via the "More..." disclosure on
layer 1, grouped by category. That way the landing page doesn't lie — the advanced user
can still do all 50 — but the casual user sees the 12 most useful ones first.

## WASM + server tiering

The backend in `apps/ffmpeg-converter/` is ready. ffmpeg.wasm is a few kilobytes of
binding code away. **Tier the site explicitly** and tell the user which lane they're in.

| File size / op           | Lane       | Why                                                                         |
| ------------------------ | ---------- | --------------------------------------------------------------------------- |
| < 50 MB audio/image      | WASM       | Instant, private, free to run, no server round trip                         |
| < 50 MB short video      | WASM       | Works fine, slightly slower than native                                     |
| 50 MB – 500 MB video     | Server     | Browser memory ceiling; server transcodes faster                            |
| > 500 MB                 | Server     | WASM will OOM                                                               |
| Anything with `libaom`, `libass`, or `drawtext` | Server (if backend has it) | WASM builds usually lack these      |
| Anything with `libvpx-vp9` `deadline=good`      | Server    | Too slow in WASM                                                            |
| Streams / live           | Server     | WASM doesn't support streaming input                                        |

The footer changes to reflect the actual lane the *current* job is on:

- WASM lane: **"Your file never leaves your device."**
- Server lane: **"Files auto-delete one hour after conversion."**

**v1 decision:** ship the server lane first (backend is done), leave WASM as a post-v1
TODO with the hooks in place. The strategy doc commits to the hybrid; the code can
land it in two phases without rewriting the UI.

## Adaptive panel — input-type detection over URL-as-constraint

The pSEO landing-page model gives us a per-conversion URL (`/convert/mov-to-mp4`,
`/gif/mp4-to-gif`, `/convert/heic-to-jpg`) — and Google ranks each one for the
exact phrase. That's load-bearing for traffic and we keep it. **What we drop is
the assumption that the URL is allowed to *gate* the panel.** Today every slug
page sets `<input accept=".mov,.MOV">` (or whatever the row's `inputFormats`
declare) and the browser silently rejects everything else; drop a `.mov` on
`/convert/mp4-to-gif` and nothing happens. From the user's point of view the
page is broken. From Google's point of view the page is fine.

The fix: **the URL is a hint, not a gate**. The drop zone accepts any file. The
panel detects the input type from the dropped file (extension + magic bytes)
and adapts its op + chip row in place. The URL is silently updated via
`history.replaceState` so refresh / share-link / back-button still work, but
the upload state and the File object never reset. No `router.push`, no remount,
no second drop.

This belongs in the strategy doc rather than as a one-off bug-fix because it
is the load-bearing model for everything that follows: the gif preset chips
(#92), URL-state (#93), saved presets (#94), and the Advanced panel (#95) all
assume the panel knows what input it's working with. Today they assume the URL
told them. From this point on they assume the panel detected it.

### What happens when

The four cases the panel must handle, in order from "do nothing" to "rare":

1. **Detected input matches the URL slug.** The dominant case — user landed on
   `/convert/mov-to-mp4` and dropped a `.mov`. Nothing changes. The chip row
   shows the slug's hinted output as the active chip. URL stays as-is.

2. **Detected input is in the same category, different format.** User landed on
   `/convert/mp4-to-gif` and dropped a `.mov`. Both are video; both can become
   gif. The panel silently flips its input op from `mp4` to `mov` (looking up
   the row that handles `mov → gif` — `MATRIX_BY_SLUG['mov-to-gif']`, falling
   back to a multi-input row like `video-to-gif` if no direct slug exists).
   The chip row continues to offer gif as the active chip plus mp4 / webm /
   mkv as alternative outputs. URL is rewritten to `/convert/mov-to-gif` via
   `history.replaceState` — silent, no scroll jump, the page metadata (h1,
   title, FAQ) does NOT re-render because Next.js doesn't re-render server
   components on `replaceState`. We accept the metadata drift: the user only
   ever sees the panel from this point on, and the chip row is the source of
   truth for what's running. SEO content stays whatever the original slug
   shipped — fine, because the SEO arrival was for the *intent*, and the
   intent (video → gif) hasn't changed.

3. **Detected input crosses category.** User landed on `/convert/mp4-to-gif`
   (video page) and dropped a `.png`. PNG can't become a video gif. The chip
   row reorganises to show valid PNG conversions: jpg / webp / avif. The panel
   picks the most popular valid output for that input as the new active chip
   (per the existing `PREFERRED_TARGET_BY_EXT` table in `route-for-file.ts`,
   which already ranks targets by demand — png defaults to webp). The page's
   surrounding shell (h1, value prop, FAQ, "How it works") stays whatever the
   original slug shipped — we don't try to mutate the page metadata in
   response to a drop. The user is in the panel; the panel is now correct.
   The h1 saying "MP4 to GIF" while the panel converts a PNG to WebP is a
   small contradiction we accept in exchange for the no-reset guarantee.
   `history.replaceState` rewrites the URL to the now-correct slug
   (`/convert/png-to-webp`) so refresh / share-link land them in the right
   place next time.

4. **No valid conversions for this input.** Very rare with our matrix — a
   `.zip`, a `.exe`, a `.docx`. The panel surfaces a friendly message
   ("We don't support `.zip` files yet — try video, audio, or images.")
   plus a "Clear and try another file" button. The original SEO slug page
   shell stays put. We never throw the user out of the panel.

### How the chip row composes

The chip row is the surface for this whole feature. The principle is simple:

> The chip row's options are always sourced from `validOutputsFor(detectedInputType)`,
> not hardcoded per-slug.

`outputsForExt(ext)` already exists (added in #79) — it scans the matrix for
every `convert` / `image-convert` row that accepts the given input and returns
the union of output formats with a default flag. The slug-page `<ToolPage />`
currently bypasses this and renders a pure `<ConverterPanel />` because the
slug locked the input. After this change, slug-page panels also mount a chip
row (the same component the homepage uses today via `<HeroDrop />`'s
`<RunningPanel />`), populated from the *detected* input. On first paint —
before the user drops a file — the chip row uses the slug's input as a
synthetic detection so the page doesn't render a different layout pre- and
post-drop.

When the detected input doesn't support the URL's hinted output (case 3
above), the panel falls back to the most popular valid output for that input
(per `PREFERRED_TARGET_BY_EXT`). This is the same logic the homepage uses
today; we just lift it onto the slug pages.

### How this threads through existing features

- **#79 format-picker chip row** — already supports the "swap output mid-flight"
  flow on the homepage. The slug-page version is the same component, sourced
  from the detected input rather than the original slug. The two converge.
- **#92 gif preset chips** — the gif page is a special case: the chip row
  is gif-specific (Smooth / Compact / Tiny). When a non-video file lands on
  a gif page, `<GifPresetPanel />` cedes to the generic chip row + a
  `<ConverterPanel />` mount for the new operation. The gif chips only render
  when the detected input is video (or animated-image). Fall-through, not
  overlay.
- **#93 URL-state** — the `parseUrlState` whitelist is per-operation. When
  the panel switches operation in response to a cross-category drop, the
  whitelist switches too. Any URL params from the previous slug that aren't
  in the new whitelist are silently dropped. This is fine — a `?fps=24`
  param hanging off `/convert/mp4-to-gif` is meaningless for `/convert/png-to-webp`,
  and silently dropping it is preferable to forwarding nonsense to the
  backend.
- **#94 saved presets** — already keyed per-operation. A user's saved gif
  presets don't pollute the chip row when they drop a png on a gif page;
  the saved-presets bar reads the *current* operation, which has already
  flipped to `image-convert`. No code change needed in the preset module
  for this to work — it falls out of the operation-switch model.
- **#95 Advanced panel** — only renders for `operation === 'convert'`. The
  same pattern: when the panel switches op, the Advanced disclosure either
  appears (cross-category drop landed on a `convert` row) or disappears
  (drop landed on `image-convert` / `gif` / etc). The `showAdvancedPanel`
  prop becomes a function of the *detected* operation, not the slug's.

### URL-update mechanics

`history.replaceState` only — never `router.push`, never `router.replace`.
The reasons:

- `router.push` triggers a full Next.js client-side route transition,
  which remounts the page including the panel — losing the File object.
- `router.replace` does the same, just without adding a history entry.
- `history.replaceState` rewrites the URL bar without telling Next.js
  anything, so React state (including the in-panel `<DropZone />`'s
  File reference) survives intact.

Trade-off: the page metadata (h1, title, JSON-LD) doesn't re-render after
the URL update. We accept this because the alternative (full route
transition) violates constraint #3 (no upload reset). The chip row is the
in-page source of truth for what's running; the surrounding shell is the
SEO landing-page artifact, and once the user has interacted, the shell's
job is done.

The URL update fires once per detected-input change — not on every chip
click within the same input. Picking a different output chip (mp4 → webm)
on a `mov` upload updates the slug from `mov-to-mp4` to `mov-to-webm`;
dropping a fresh `.png` afterwards updates again to `png-to-webp`. Refresh
at any point lands on the correct slug.

### What this is not

- It is not a SPA-wide router rewrite. The URL update is `history.replaceState`,
  scoped to the current page's path segment. Other links in the app still
  navigate via `<Link />` and Next.js routing.
- It is not a content-mutation feature. The h1, value prop, FAQ, and
  "How it works" text do not adapt to the dropped file. They stay whatever
  the original slug shipped. The *panel* adapts; the *page* does not.
- It is not magic-byte detection (yet). Phase 1 detects from the file
  extension only — the same data the homepage `routeForFile` already uses.
  Magic-byte sniffing is a phase-2 hardening hook for files with wrong
  extensions; it's not load-bearing for this feature and lives in its own
  ticket if/when it ships.

## Anti-goals

Things we deliberately do NOT build:

- **No login / no accounts.** The moment we add auth we're in Zamzar's category and
  the URL-preset strategy breaks.
- **No timeline editor.** VEED/Clipchamp own that. We are not an editor.
- **No AI features (subtitles, upscale, remove-background).** Media.io owns that and
  it's a different product.
- **No "convert to PDF."** PDF wants LibreOffice, not ffmpeg. Different tool.
- **No document formats.** CloudConvert and Zamzar covered that in 2009. Unwinnable.
- **No enterprise SLAs, tickets, or dashboards.** Zamzar/CloudConvert Business tiers.
  If a user needs that they're not our customer.

## What to measure

If this ships and Sean wants to prove it's working:

- **Time to first download.** Seconds from drop to file saved. Target: <3 s for audio,
  <10 s for 30-second video.
- **Repeat visits per browser (localStorage key age).** The preset library is the
  repeat-customer hook; if nobody's saving presets, it's not working.
- **URL-preset share count.** Every time someone lands on a URL with query params, log
  it. That's a word-of-mouth signal.
- **Advanced-panel open rate.** If it's <5 %, the simple flow is winning and we should
  invest more there. If it's >40 %, power users are our audience and we should promote
  the panel to layer 2.

None of these need a tracking pixel — they can live in localStorage + one anonymous
counter endpoint on the Go backend.

## Decision records

### SEAN-81 — homepage drop fires conversion immediately

**Status:** locked, 2026-05-08.

**Question:** when a file is dropped on the homepage (post-#75 in-place flow,
post-#79 format picker), should the conversion fire automatically using the
inferred default output format, or should the picker stage gate the upload
until the user clicks Convert?

**Decision:** auto-fire. The homepage drop zone runs the conversion immediately
on drop using `routeForFile`'s preferred-target table (mov→mp4, mp4→webm,
png→webp, heic→jpg, audio→wav). The picker becomes a non-blocking affordance
shown alongside the converting/result UI: a "Converting to .X — change format?"
chip row + Cancel button. Picking a different chip aborts the in-flight request
and re-fires with the new row (panel remounts on `row.slug` key change, the
in-flight `fetch` is cancelled by `AbortController` cleanup).

**Why:** the homepage is the impatient-arrival path. Someone who lands on `/`
and drops a `.mov` overwhelmingly wants the canonical default (`.mp4`). Forcing
a third tap (drop → click chip → click Convert) for everyone, just so the
minority who want `.webm` instead of `.mp4` can re-pick, inverts the
probability. The two-step happy path ("drop, download") is what the strategy
TL;DR (line 12 above) commits to: "starts converting before the user has read
the page". The picker remains for the minority — visible and one-tap — but
doesn't gate the majority case.

**SEO arrivals are unaffected.** Slug pages (`/convert/mov-to-mp4`,
`/compress/compress-mp4`, etc.) keep their existing input-locked drop zone
with no picker — the slug owns intent. This decision is homepage-only.

**Cancel semantics.** The "Cancel" button on the converting banner aborts the
in-flight upload via `AbortController` and returns the user to the empty hero
drop zone (same state as a fresh page load). The "Change format" chips abort
the in-flight upload AND re-fire with the picked row's `goOp` and output ext —
no re-drop required, the same File object is reused.

**Trade-offs accepted:**

- The user who wanted `.webm` from a `.mov` will see the conversion start as
  `.mp4` first, then re-pick. Wasted server-side compute is bounded by the
  abort window — typically sub-second on the click. The Go backend handles
  cancellation cleanly (`fetch` abort closes the multipart stream; `jobs.go`
  cleans up partial uploads on connection close).
- Edge case: very fast conversions (small files, thumbnails) might complete
  before the user reads the "change format" affordance. Acceptable — they
  still got a working download in the default format, "Try another file" on
  the result block lets them re-do it.

**Files:**

- `apps/ffmpeg-converter/web/src/components/HeroDrop.tsx` — drops the picking
  stage; adds the converting-state banner with chips + cancel.
- `apps/ffmpeg-converter/web/src/components/DropZone.tsx` — passes
  `AbortSignal` through to `submitConversion`; aborts on unmount.
- `apps/ffmpeg-converter/web/src/components/submit-conversion.ts` — accepts
  optional `signal: AbortSignal`.
- `apps/ffmpeg-converter/web/src/components/__tests__/HeroDrop.test.ts` —
  asserts drop fires exactly one request with no intermediate click.

**Re-revisit if:** time-to-first-download metrics show >5 % of homepage drops
get cancelled in the first second (suggests users were going somewhere else
and the auto-fire is wasting their bandwidth + ours). At that point, flip to
a 1-click confirm gate (single button per format, no separate Convert button)
and re-measure.

### SEAN-92 — gif preset chips + customise disclosure

**Status:** locked, 2026-05-08.

**Question:** GIF is the operation with the richest size/quality knob set —
fps, width, dither, palette size, trim — and the one users tinker with most
(Discord 8 MB ceilings, Bluesky 50 MB, Slack quirks). Until #92 every
`/gif/[slug]` page hard-coded `fps=10, width=480, default dither, 256
colours` with no user controls. Should the gif tool pages expose all of
those knobs at once (CloudConvert-style 30-field dialog), none of them
(status quo), or stage the disclosure?

**Decision:** progressive disclosure with a three-chip preset row (Smooth /
Compact / Tiny) shown immediately below the converter panel, plus an
optional "Customize" `<details>` panel revealing fps chips
(10/15/20/24/30), width chips (240/320/480/640), and start + duration trim
sliders. The default chip is Smooth (480p, matching the post-#91 width
default). Picking any chip — preset OR fps/width override — re-keys the
inner `<ConverterPanel />`, which unmounts the old `<DropZone />` and fires
its `AbortController` cleanup, cancelling the in-flight upload before
mounting a fresh panel with the new args. Same SEAN-79/-81 abort pattern
the homepage chip row uses.

**Why this shape rather than the layer-cake from §"Progressive disclosure":**

- The full 4-layer cake (drop → format → preset → advanced → command)
  belongs to the homepage flow where the user hasn't picked an op yet.
  Slug pages already locked the op and the output format via the URL —
  the only remaining axes are the gif-specific knobs.
- Three named presets cover the dominant Discord/Slack/Bluesky use cases
  without forcing the user to read about palette quantisation. The
  customise panel is for the second-use power user — it stays collapsed
  by default.
- `<details>` is a real HTML element, so it works without JS state and
  composes cleanly with the rest of the server-rendered page. We could
  promote it to a remembered preference in localStorage later (the
  STRATEGY.md repeat-customer hooks list) without restructuring.

**The live ffmpeg command preview** is the dev-funnel hook from STRATEGY
§1 in concrete form: `renderGifFfmpegCommand(inputExt, effectivePreset)`
re-runs on every state change and the new command is forwarded to
`<ConverterPanel />`'s existing `ffmpegCommand` prop, which surfaces it on
the result block with a copy button. Dev users can paste the exact command
we just ran into their own terminal — same args, same filter graph.

**Backend extension:** `gif_from_video` in `ops.go` reads `width`, `fps`,
`dither`, `max_colors`, `start`, `duration` from the multipart form. All
default to the legacy values (480, 10, sierra2_4a, 256, no trim) so callers
that don't pass an override see the same output as before. Trim is wired as
input-side `-ss` / `-t` (not as a filter), so the palettegen pass samples
only the trimmed window — otherwise the GIF gets quantised against frames
the user can't see.

**Out of scope for v1:**

- **Dither method UI** — sticks to default `sierra2_4a` for Smooth/Compact,
  `none` for Tiny. The Tiny chip's hard-edge look is the point of the
  preset (smaller files, no dithering noise on flat backgrounds).
- **Max-colours UI** — sticks to 256. Dropping below 256 helps file size
  on cartoonish content but tanks photo-derived clips. Add later if
  Discord-size feedback shows demand.
- **Reverse / boomerang** — separate op, separate pSEO page.
- **Speed** — same; `change_speed` already has its own slug template.

**Files:**

- `apps/ffmpeg-converter/web/src/components/GifPresetPanel.tsx` — new
  client wrapper around `<ConverterPanel />`, owns the chip + customise
  state and re-renders the live ffmpeg command.
- `apps/ffmpeg-converter/web/src/components/ToolPage.tsx` — branches on
  `row.operation === 'gif'` to mount `<GifPresetPanel />` instead of the
  plain `<ConverterPanel />`.
- `apps/ffmpeg-converter/web/src/components/converter-row-args.ts` —
  `buildExtraArgs` forwards the new `width`/`dither`/`maxColors`/
  `trimStartSec`/`trimDurationSec` fields when present on the row preset.
- `apps/ffmpeg-converter/web/src/ops/types.ts` — `OperationPreset`
  extended with the new fields.
- `apps/ffmpeg-converter/ops.go` — `gif_from_video` reads the six fields
  from `extraArgs` with backward-compatible defaults.
- `apps/ffmpeg-converter/e2e_test.go` — per-preset width + fps assertions
  via ffprobe.

**Re-revisit if:** advanced-panel open rate (the `<details>` element in
GifPresetPanel) sits above 40 % across gif pages — at that point the panel
has earned promotion to default-open + remembered-in-localStorage. Or if
preset-chip metrics show one chip dominating: collapse to that as the
single default and demote the others to the customise panel.

### SEAN-95 — Advanced disclosure control set

**Status:** locked, 2026-05-08.

**Question:** which knobs ship in the Layer-3 Advanced disclosure on
`/convert/[slug]` video pages, and which stay behind the "Show everything"
power-user toggle?

**Decision:** the disclosure renders six controls in this order:

1. **CRF slider** (0–51, default 23) — the canonical libx264/libx265/VP9
   quality knob. Disabled when bitrate is set; the label flips to "Quality
   (CRF) — overridden by bitrate" so the user understands why the slider
   greyed out.
2. **Video bitrate** text input (e.g. `2M`, `500k`) — overrides CRF when set.
   Wins over CRF on the backend; the displayed ffmpeg command drops the
   `-crf` flag and inserts `-b:v X` so copy-paste reflects the actual encode.
3. **Encoder preset** dropdown (`ultrafast` … `veryslow`).
4. **FPS** text input — leave blank for source rate.
5. **Audio bitrate** text input.
6. **Show everything** checkbox (Layer-3+ toggle, persisted in localStorage)
   — when on, reveals a 7th control:
7. **Video codec** dropdown (`libx264` / `libx265` / `libvpx-vp9` /
   `libaom-av1` / `mpeg4`, default = format-appropriate auto). Hidden by
   default because the format → codec mapping is correct 95 % of the time
   and exposing a wrong-codec footgun (e.g. `libvpx-vp9` into an `.mp4`
   container) on the casual flow burns the user.

**Persistence:** disclosure expanded-state is stored in `localStorage` under
`ffmpegConverter:advancedPanelExpanded`. Power users get the panel pre-
expanded on subsequent visits. The "Show everything" toggle uses
`ffmpegConverter:advancedPanelShowAll`. URL state per #93 carries the actual
control values — share-links round-trip cleanly. Default values stay out of
the URL so the URL stays minimal until the user customises something.

**Why these six (not eight, not three):** the strategy doc's Layer-3 sketch
calls out video codec, CRF, bitrate, fps, audio bitrate, sample rate,
channels, plus the filters block. Sample rate and channels are out — they're
audio-mastering decisions the wrong audience for a "convert MOV to MP4"
visit. The filters block (resize/crop/trim/rotate/flip/speed/normalize) is
out — those each have their own slug pages already (`/resize`, `/trim`,
etc.), and stuffing them into a per-format Advanced panel duplicates the
decision tree. Codec gets the power-user toggle because the format-appropriate
default is correct for the load-bearing slug (mov-to-mp4 should not let a
user pick libvpx-vp9 in one tap).

**Out of scope (per ticket Notes):** pix_fmt, profile/level, two-pass
encoding, lookahead, GOP. These are deeper-than-Layer-3 flags and belong
either behind "Show everything" if/when we add them or in a future Layer-4
"raw ffmpeg flags" textarea.

**Backend coupling:** the `transcode`, `transcode_webm`, `transcode_mkv` ops
in `ops.go` route through shared `runTranscode` / `runTranscodeVPx` helpers
that read `crf`, `bitrate`, `preset`, `fps`, `audio_bitrate`, `codec` from
`OpContext.Args`. Bitrate beats CRF when both are present (the panel
disables the slider in that case so it's not surprising). Unknown codec
strings fall through to ffmpeg's own validation — the panel only exposes
the five we know work.

**Files:**

- `apps/ffmpeg-converter/web/src/components/AdvancedPanel.tsx` — the
  disclosure component.
- `apps/ffmpeg-converter/web/src/components/ConverterPanel.tsx` — wires the
  panel below the dropzone for `operation === 'convert'` rows.
- `apps/ffmpeg-converter/web/src/components/ToolPage.tsx` — passes
  `showAdvancedPanel` + `advancedDefaults` from the matrix row.
- `apps/ffmpeg-converter/web/src/components/url-state.ts` — adds `bitrate`
  and `codec` to the `convert` whitelist; extends `applyUrlToFfmpegCommand`
  to substitute CRF / preset / bitrate / audio_bitrate into the displayed
  command.
- `apps/ffmpeg-converter/web/src/components/converter-row-args.ts` —
  forwards `videoBitrate` / `videoCodec` preset hints.
- `apps/ffmpeg-converter/web/src/ops/types.ts` — `OperationPreset` extension
  for `videoBitrate` and `videoCodec`.
- `apps/ffmpeg-converter/ops.go` — `runTranscode` / `runTranscodeVPx`
  helpers; `transcode` / `transcode_webm` / `transcode_mkv` use them.

**Re-revisit if:** the Advanced-panel open rate (per the metrics list above)
exceeds 40 %. At that threshold the strategy doc says "promote the panel to
layer 2" — i.e. show it expanded by default for everyone, not just users who
opened it once. Below 5 % the simple flow is winning and we should consider
collapsing the codec/preset distinction further.

### SEAN-103 — dropped accept= attribute, panel detects input type and adapts in place

**Status:** locked, 2026-05-08.

**Question:** the slug pages (`/convert/mp4-to-gif`, `/convert/mov-to-gif`,
`/convert/heic-to-jpg`, …) each set `<input accept>` to the row's declared
`inputFormats`. Drop a `.mov` on `/convert/mp4-to-gif` and the browser
silently rejects the file — the page looks broken, even though the matrix
has a perfectly good `mov-to-gif` row two slugs over. Should the file
picker keep enforcing the slug's input declaration (status quo, SEO-clean
but UX-broken on cross-arrival), drop the picker constraint and reroute
the user via `router.push` to the correct slug (loses the File object —
the SEAN-75 bug we fixed last week, just on the slug pages instead of the
homepage), or drop the picker constraint AND adapt in place without
navigation?

**Decision:** adapt in place. The drop zone (and `<input accept>`) accepts
any file. On drop, the panel runs `detectInputType(file)` (extension-based,
mirrors `extOf` + `EXT_TO_FORMAT` from `route-for-file.ts`) and either:

1. **Match** — uses the slug's row as-is (the dominant case).
2. **Same-category mismatch** (`mov` dropped on a `mp4-to-X` page where X
   has a `mov-to-X` row) — silently swaps to that row, keeps the same
   output format, fires the conversion. Chip row reflects the swap.
3. **Cross-category mismatch** (`png` dropped on a video page where PNG
   has matrix coverage) — switches the panel's operation entirely
   (`convert` → `image-convert`), uses `PREFERRED_TARGET_BY_EXT` for the
   default output, fires the conversion. Page shell (h1 / FAQ / "How it
   works") stays. Chip row reorganises to PNG's valid outputs.
4. **No matrix coverage** — friendly message + "Clear and try another
   file" button. Panel state preserved until user clears.

URL is updated via `history.replaceState` only — never `router.push`.
This is the *only* way to preserve React state including the File object
in the panel; Next.js client-side route transitions remount the page.

**Why:** the URL slug is a load-bearing SEO artefact (Google ranks
`mov-to-mp4` separately from `mp4-to-mov` and we keep that). But within
the panel, the URL is a *hint about the user's intent* — not a
*constraint on the file they're allowed to drop*. The slug-arrival
audience (Google → landing page → drop) overlaps almost completely with
people who think "I want a gif from this video", and the specific source
extension is a detail the panel can figure out. Forcing the user to find
the *exact* slug for their input format inverts the demand: people search
"mp4 to gif" because that's the *most-known* video-to-gif phrase, not
because they always have an `.mp4`. Lifting that lock is pure UX win, and
the SEO pages still rank for the canonical phrase.

**Why not router.push to the correct slug:** that's the SEAN-75 bug
pattern — the File object lives in component state, the route transition
remounts the page, the file is gone. We solved this on the homepage by
running the conversion in place; the slug pages get the same treatment.

**Why not magic-byte sniffing:** extension is enough for v1. Magic-byte
detection is a phase-2 hardening for users who saved a `.png` as
`.jpg` (real but rare); it composes cleanly on top of this decision and
ships in its own ticket if/when needed.

**SEO arrivals are unaffected.** The slug pages still render whatever
h1 / FAQ / metadata they always rendered. Google still indexes them. The
only thing that changes is what happens *after* the user drops a file
that doesn't match the slug — instead of the picker silently rejecting
the file, the panel adapts and runs the conversion the user actually
wanted.

**Trade-offs accepted:**

- **Page-shell drift after a cross-category drop.** Drop a `.png` on a
  `/convert/mp4-to-gif` page and the h1 still says "MP4 to GIF" while the
  panel converts PNG to WebP. We accept this. The chip row is the in-page
  source of truth for what's running; the page shell is the SEO artefact,
  and once the user has interacted, the shell's job is done. The
  `replaceState` URL update means refresh / share-link land on the
  correct slug next time.
- **URL-state whitelist switching.** When the panel changes operation
  mid-flow, any URL params from the previous slug's whitelist that aren't
  in the new whitelist are silently dropped. This is correct (a `?fps=24`
  hanging off a video URL is meaningless for an image conversion) but
  could surprise a user who shared a URL with custom args expecting them
  to round-trip across an op switch. Acceptable — the shared URL still
  rehydrates correctly when the recipient drops the *matching* file
  type.
- **One File, one panel.** Dropping a fresh file replaces the previous
  one — but no automatic clear, no automatic reset. The user explicitly
  re-drops or clicks "Try another file" to start over.

**Files:**

- `apps/ffmpeg-converter/web/src/components/DropZone.tsx` — drop the
  `accept` prop forwarding into `<input>`. Add `detectInputType(file)`
  helper (or import from `route-for-file.ts`).
- `apps/ffmpeg-converter/web/src/components/HeroDrop.tsx` — already
  doesn't set `accept`; double-check there's no remaining type guard
  on drop.
- `apps/ffmpeg-converter/web/src/components/ConverterPanel.tsx` — accept
  detected-input state, swap row + extraArgs + ffmpegCommand when input
  changes, fire `history.replaceState` to update the URL.
- `apps/ffmpeg-converter/web/src/components/ToolPage.tsx` — pass slug
  defaults but no longer treat them as authoritative; mount the chip row
  alongside the panel for non-gif operations too.
- `apps/ffmpeg-converter/web/src/components/route-for-file.ts` — already
  exports the lookup helpers (`matrixRowForFile`, `outputsForExt`); the
  panel re-uses them rather than duplicating logic.
- `apps/ffmpeg-converter/web/src/components/url-state.ts` — no API change
  needed; the existing per-operation whitelist machinery handles the
  switch.
- `apps/ffmpeg-converter/web/src/components/__tests__/` — new tests for
  drop-mismatch behaviour on slug pages.

**Re-revisit if:** the page-shell drift turns into a real complaint
(user reports landing on `/convert/mp4-to-gif`, dropping a png, getting
a webp result, then being confused by the FAQ). At that point we either
(a) suppress the page-shell content after a category-switch detection
and replace it with a generic "Converting your image…" heading, or
(b) re-trigger a soft Next.js navigation that preserves the File via a
sessionStorage handoff. Both are bigger changes; we don't ship them
preemptively.

### SEAN-121 — picker is operation-first; every shipped capability is visible

**Status:** locked, 2026-05-09. Overturns parts of SEAN-79 / SEAN-103 /
SEAN-106 (see "what changed" below).

**Question:** SEAN-79 introduced an output-format picker on the homepage
drop zone. SEAN-106 extracted it into `<OutputFormatChips />` and reused
it on every slug page. Both filtered the picker's data source —
`outputsForExt(ext)` — to `convert` and `image-convert` rows only:

> "The picker hides extract-audio / gif / compress — those are different
> intents, not different output formats of the convert intent."

That choice read sensibly per-ticket but compounded into a picker that
hid roughly 60 % of the converter's shipped capability from the user
mid-task. Drop a `.mov` and the chip row offered MP4/3GP/AVI/FLV/M2TS/
M4V/MKV/MPEG/MTS/OGV/TS/VOB/WEBM/WMV — but no GIF, no audio extract, no
compress, no trim, no thumbnail, no contact-sheet, even though every one
of those is a shipped operation with matrix rows that accept video
input. Sean's reaction on first encounter: *"where on earth is GIF?"*

The bug surface was one filter line; the framing it implied was bigger.
"Different intents vs different output formats of the same intent" was
the locked principle. It was wrong. Users don't think in operations —
they think in *what they want done with this file*. The picker had to
either model that mental model or stay broken.

**Decision:** picker is operation-first. The picker entry surface (the
new `<CapabilitiesPicker />`) renders one chip per *shipped operation
that accepts the dropped file's media kind*. Picking an op with a
single output runs that op directly. Picking an op with multiple
outputs reveals a small format sub-picker. Format chips remain — they
just live underneath the operation chip, not above it.

**What changed in code:**

- `outputsForExt()`'s `operation === 'convert' || operation === 'image-convert'`
  filter is gone. Same function still exists as a back-compat shim —
  but its scope is documented as "the convert family's output formats"
  (the same-operation format-swap path inside `<HeroDrop />`'s
  `<RunningPanel />` uses it). Net new helpers:
  - `capabilitiesForExt(ext)` — every operation + every format, grouped.
    The new picker's data source.
  - `outputsForOperation(ext, op)` — the format sub-picker's data source.
- `<CapabilitiesPicker />` replaces `<OutputFormatChips />` as the entry
  surface in both `<HeroDrop />` and `<ConverterPanel />`. The widget
  is composite chips: a primary button (runs the op with the default /
  active format) and a chevron toggle (reveals the format sub-picker).
  Single-output ops render as a one-click chip with no chevron.
  `<OutputFormatChips />` itself is removed — every call site moved to
  the new picker.
- `handleCapabilityPick` replaces `handleChipPick` in both components.
  The handler signature gained an `operation` field so a chip click can
  swap the operation in addition to the format. URL update via
  `history.replaceState` honours the path the new (op, format) pair
  resolves to via `pathForSlug`.

**What stayed the same:**

- Page shell (h1, FAQ, How-it-works) does NOT mutate when the user
  picks a different op via the picker. Same trade-off accepted in
  SEAN-107: the chip row is the in-page source of truth for what's
  running; the page shell is the SEO artefact and once the user
  has interacted, its job is done. Refresh / share-link land on the
  correct slug next time via `replaceState`.
- URL is a hint, not a gate (SEAN-103). The picker doesn't gate by
  slug. URL updates only when the user picks something that maps to
  a real route.
- No regression on SEAN-105 / SEAN-106 / SEAN-107: detection-on-drop,
  in-place adaptation, no remount, no upload reset, no `router.push`.
  The picker rework lives on top of the adaptive panel; it doesn't
  replace it.
- The advanced disclosure (SEAN-95), the saved presets bar (SEAN-94),
  the GIF preset chips (SEAN-92), and the friendly fallback (SEAN-108)
  all compose underneath the new picker unchanged.

**Verification anchor:** GIF specifically must be one click from any
video drop on any tool page. The `gif` matrix rows always output `gif`
(single output), so the gif capability has exactly one output and the
chip runs the op directly without a sub-picker reveal. The
`CapabilitiesPicker.test.ts` suite pins this contract for every video
format the matrix accepts as gif input.

**Why not a different mental model (e.g. dropdown menu, modal):** the
chip-row pattern is already established for format swapping (SEAN-79,
SEAN-106). Composite chips (verb + dropdown trigger) keep the same
visual language, so the picker reads as "more of the same" rather than
a UI rewrite. The format sub-picker reveal is a small dropdown anchored
to the parent chip, not a modal — it doesn't steal focus or block the
rest of the panel.

**Why not auto-switch the operation based on input ext:** the picker's
job is to surface choice, not infer it. Auto-switching from `convert`
to `gif` because the user dropped a `.mov` would be a confident guess
about intent the user hasn't expressed yet — exactly the framing the
old picker got wrong, just inverted. The default operation on drop
remains the slug's declared op (SEO arrival respects the URL); the
picker exists so the user can pivot without re-dropping.

**Trade-offs accepted:**

- **The picker is wider on video inputs than on image / audio inputs.**
  A video drop surfaces 7-8 ops; an image drop surfaces 1-2; an audio
  drop surfaces 1. This is honest reflection of matrix coverage and
  not a UX problem — fewer chips for narrower inputs is correct. Once
  audio-to-audio convert rows ship the audio picker grows naturally.
- **The format sub-picker uses an inline dropdown, not a flat
  expansion.** Flat expansion would consume vertical space proportional
  to the number of ops with multiple outputs (`convert` alone has
  10+ format outputs for `mov`). The dropdown bounds the picker
  height to one row of chips on every input ext.
- **Single-output ops use a verb label (`Compress`, `Trim`, `Make GIF`)
  rather than `Compress (MP4)` / `Trim (MP4)`.** The output format is
  obvious for ops that round-trip the input format; surfacing it on
  the chip would be visual noise. Multi-output ops show the active
  format in the chip label so the user always knows which run is one
  click away.

**Files:**

- `apps/ffmpeg-converter/web/src/components/route-for-file.ts` — drops
  the operation filter from `outputsForExt`; adds `capabilitiesForExt`
  and `outputsForOperation`.
- `apps/ffmpeg-converter/web/src/components/CapabilitiesPicker.tsx` —
  new component. Replaces `<OutputFormatChips />` as the picker entry
  surface.
- `apps/ffmpeg-converter/web/src/components/OutputFormatChips.tsx` —
  removed; every call site moved to `<CapabilitiesPicker />`.
- `apps/ffmpeg-converter/web/src/components/ConverterPanel.tsx` —
  swaps `slugChipRow` for `slugCapabilitiesPicker`; renames
  `handleChipPick` to `handleCapabilityPick` with the new signature.
- `apps/ffmpeg-converter/web/src/components/HeroDrop.tsx` — same
  swap inside `<RunningPanel />`; the file's `OutputFormatChips`
  import is replaced with `CapabilitiesPicker`.
- `apps/ffmpeg-converter/web/src/components/__tests__/CapabilitiesPicker.test.ts` —
  new test suite pinning the operation-first contract (gif appears for
  every video drop, png surfaces image-convert, audio surfaces
  normalize-audio, every returned row has a real route).

**Re-revisit if:** the picker grows past ~10 chips on common inputs,
or the format sub-picker dropdown's hover-toggle becomes a friction
point on touch. Both are measurable in the UX harness. At ~10 chips
we'd start grouping by media-kind ("Video", "Image", "Audio") with
collapsing sections; today the linear chip row is fine.
