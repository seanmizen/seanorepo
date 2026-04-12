# Online file converter — competitive landscape

Field research for the ffmpeg-converter site. Collected April 2026 via WebSearch and
vendor pricing pages. Numbers are fresh as of the pages that day; they'll drift — spot-check
before quoting in marketing copy.

Three broad camps:

1. **Server-side SaaS** — CloudConvert, Zamzar, FreeConvert, Convertio, Online-Convert,
   Media.io. Upload → server transcodes → download. Freemium with aggressive caps and a
   monthly subscription.
2. **Editor-adjacent** — VEED, Clipchamp. Conversion is a byproduct of a video-editor
   free tier, priced on the editor, not on bytes.
3. **Browser-native (WASM)** — ffmpeg.wasm, ffmpeg-web, a handful of indie sites. File
   never leaves the device, but slow and memory-bound.

## One-paragraph summaries

### CloudConvert
The 800-lb gorilla of "convert any file to any file." 200+ formats across audio, video,
document, ebook, archive, image, spreadsheet, presentation. The free tier is deliberately
hostile: 25 conversion minutes/day with ~25 MB/file, 10 conversions/day. Real users pay
either pay-as-you-go ($8 for 100 minute-credits, no expiry) or subscription ($12–99/month).
They have a well-documented API and they target B2B — this is their moat, not the consumer
site. UX is clean but cluttered with settings, options, and an "engine" selector that power
users love and first-timers find intimidating.

### Zamzar
The "I converted a PDF in 2008" incumbent. Free tier is the worst of the bunch: 2 files/24h,
50 MB total. Plans start at $9/mo (Basic: 200 MB/file, unlimited conversions) up to $25/mo
(Business). They lean on email delivery ("we'll email you when it's done") which felt
cutting-edge in 2006 and now screams "old web." Their differentiator is a real business API
with an enterprise-grade contract, used by things like form-processing pipelines. Consumer
side is underinvested.

### FreeConvert
Most generous free tier: 1 GB file size limit, up to 10 files/day for audio/image/docs,
4–5/day for video, 5 min/file processing cap. Ads and upsell on every page. Paid plans
remove ads, raise caps, unlock batch. It's the "good enough, just get out of my way"
option, and it's heavily SEO'd — you probably landed on it via a "mp4 to gif" Google
search.

### Convertio
Clean UI, 100 MB/file free, 10 conversions per 24 h, 10 conversion minutes/day, 2 concurrent.
No login needed for the free tier. Premium is $25.99/mo unlimited. They have an OCR
product bolted on and a Chrome extension. The UX win: drag-drop works on the landing page
with zero chrome in the way. Their Achilles heel: the ads on the result page are rougher
than competitors.

### Online-Convert.com
Old-school, looks like 2010 crawled back. Free tier is 100 MB/file, 3 conversions/day.
Paid plans start around $7/mo. Value-add: exposes a lot of format-specific options
(bitrate, sample rate, DPI, codec) right on the landing page — the closest any of these
get to "show the ffmpeg flags." Not pretty, but hackers appreciate it.

### Media.io (Wondershare)
Credit-economy freemium: 5 "credits" to start, daily top-ups, 720p cap, watermark. The
conversion tool is a loss leader for their UniConverter desktop app and a growing suite
of "AI" tools (upscaler, background remover). You click through 3 upsells to get to a
download. Repeat-customer play is "come back daily for free credits."

### VEED.io
Video-editor first, conversion is a side door. Free tier: 720p, 10-min max, VEED watermark,
2 GB storage. Paid: $12/mo Lite (1080p, no watermark, 25 min), $24/mo Pro (120 min, all
AI tools). The killer feature is the timeline editor and AI subtitles — converting a file
feels like an afterthought. **Best competitor to study for editor-adjacent UX.**

### Clipchamp (Microsoft)
Free forever (1080p, no watermark, as of their 2024 relaunch post-acquisition). Bundled
into Windows 11. Hard to compete with "free 1080p no-watermark" on the editor side,
BUT — it's a full editor, not a converter. It doesn't do "paste a YouTube URL and give me
a GIF in 3 seconds." It's slower to first result and locks you into an editing flow.

### HandBrake Online (handbrake-online.com)
Third-party, not official HandBrake. Small indie: upload, compress, download. Focused
specifically on "make this video smaller for email/Discord." Tight scope, which is
actually a UX win — no decisions. Downside: compression-only, no format flexibility.
Shows that a narrow-scope converter can live alongside the big players.

### ffmpeg.wasm / ffmpegwasm.netlify.app / ffmpeg-web
The category the ffmpeg-converter site actually belongs to on the privacy axis.
**File never leaves the browser.** Caveats: 5–10× slower than native ffmpeg, ~500 MB
browser memory ceiling, multi-threaded support still experimental, no streaming inputs.
Practical rule of thumb: **works for audio and small/short video; chokes on anything over
~200 MB or >30 seconds of HD video**. Most public demos are developer-facing ("look, it
works!"), not productized.

## Comparison matrix

| Service                | Free file cap  | Free count/day          | Login req'd   | Paid entry        | API?  | Killer UX trick                                        |
| ---------------------- | -------------- | ----------------------- | ------------- | ----------------- | ----- | ------------------------------------------------------ |
| **CloudConvert**       | 25 MB          | 10 conv, 25 min total   | No (free)     | $8 PAYG / $12 mo  | Yes   | "Engine" selector (libreoffice vs microsoft etc.)      |
| **Zamzar**             | 50 MB          | 2 files/24 h            | No            | $9/mo             | Yes   | Email-me-when-done; massive format list                |
| **FreeConvert**        | 1 GB           | 10 (audio/img/doc) / 4–5 video, 20 total conv min | No | $9.99/mo | No (consumer) | Highest free ceiling; ads pay for it          |
| **Convertio**          | 100 MB         | 10 conv, 10 min total   | No            | $25.99/mo         | Yes   | Clean landing page; zero-chrome drop zone              |
| **Online-Convert**     | 100 MB         | 3/day                   | No            | ~$7/mo            | Yes   | Format-specific options right on landing (codec, DPI)  |
| **Media.io**           | credit-gated   | 5 credits then daily    | Yes (for credits) | PAYG / sub    | No    | "Daily free credits" return hook; AI tool upsell       |
| **VEED.io**            | 1 GB / 10 min  | unlimited (watermarked) | Yes           | $12/mo            | Yes   | Real timeline editor; AI subtitles in 80+ languages    |
| **Clipchamp**          | unlimited      | unlimited (1080p free)  | Microsoft acct | $free / MS 365   | No    | No watermark at 1080p; bundled with Windows 11         |
| **HandBrake Online**   | unclear        | unclear                 | No            | N/A (free)        | No    | Compression-only, tightest scope of the list           |
| **ffmpeg.wasm (demos)**| browser RAM (~500 MB) | unlimited        | No            | N/A               | N/A   | **File never leaves the device**; open-source          |

## Observations you can steal for the strategy

1. **The free-tier caps are the product.** All of the server-side SaaS vendors are really
   selling "bytes transcoded" — their pricing is metered on file-minutes, not features.
   A site that offers **generous or unmetered free conversions for small files** (because
   the cost is borne by the client, ffmpeg.wasm) is structurally cheaper to run than any
   of them and can undercut the whole category on the low end.

2. **Landing-page friction is the #1 complaint.** Convertio wins on "drag and drop, no
   chrome." Everyone else has ads, banners, upsells, and nag-modals. The unfair-advantage
   move: open to a drop zone, make the conversion start before the user has time to
   read anything.

3. **No one shows the ffmpeg command.** None of the SaaS vendors expose the underlying
   flags — they all want you to trust their black box. For the technical audience (Sean's
   audience), showing the exact ffmpeg command being run is both an honesty signal and a
   learning moment. Online-Convert is the closest and they don't go all the way.

4. **Editor-adjacent is a different market.** VEED/Clipchamp are not converters, they are
   editors where conversion falls out. Don't try to beat them at editor UX — beat them on
   "I just need to change the format, don't make me load a timeline."

5. **Power users are underserved.** CloudConvert has the most options but buries them in
   modal dialogs. Online-Convert exposes them but looks like 2010. A **progressive
   disclosure** approach ("simple by default, everything if you want it") has no current
   winner in the category.

6. **The hybrid WASM+server pitch is open.** No one advertises "tiny files stay on your
   device, big files go to the server — your choice." That's a real privacy + speed
   story and the ffmpeg-converter backend + ffmpeg.wasm frontend is perfectly set up to
   deliver it.

## Sources

- [CloudConvert pricing](https://cloudconvert.com/pricing)
- [CloudConvert — 200+ formats](https://cloudconvert.com/)
- [Zamzar pricing](https://secure.zamzar.com/signup/)
- [Zamzar FAQ — file limits](https://www.zamzar.com/faq/)
- [FreeConvert pricing](https://www.freeconvert.com/pricing)
- [Convertio free tier limits](https://support.convertio.co/hc/en-us/articles/360004386774-Free-tier-limit-for-file-conversions)
- [Convertio pricing](https://convertio.co/pricing/)
- [Online-Convert pricing](https://www.online-convert.com/pricing)
- [Media.io landing](https://www.media.io/)
- [VEED pricing](https://www.veed.io/pricing)
- [Clipchamp pricing](https://clipchamp.com/en/pricing/)
- [HandBrake Online (third-party)](https://handbrake-online.com/)
- [ffmpeg.wasm project](https://github.com/ffmpegwasm/ffmpeg.wasm)
- [ffmpeg.wasm demo](https://ffmpegwasm.netlify.app/)
- [ffmpeg-web (open source UI)](https://github.com/dinoosauro/ffmpeg-web)
- ["I tried pure-browser conversion" — dev.to post](https://dev.to/digitalofen/i-tried-running-file-conversion-fully-in-the-browser-wasm-libreoffice-ffmpeg-57mh)
