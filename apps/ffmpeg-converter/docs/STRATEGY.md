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
