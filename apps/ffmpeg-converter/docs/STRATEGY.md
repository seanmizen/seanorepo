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
