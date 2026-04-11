# SEO Action Plan — AI-First 2026

## How Conversion Queries Are Answered Now

The landscape has shifted:

- **Google zero-click**: "convert mp4 to webm" shows a featured snippet with CloudConvert/Zamzar inline — you're competing against established names for this SERP real estate
- **LLM chat answers**: ChatGPT/Claude answer "how do I convert X to Y?" with either CLI commands (`ffmpeg -i input.mp4 output.webm`) or recommend known web tools by name
- **Perplexity / AI search**: Scrapes tool pages and summarises them — structured data and clear prose matter here

The old playbook (keyword stuff H1 tags, get backlinks from blog directories) still works but is declining. The new playbook is about being **cited by AI systems**.

---

## Part 1: Technical SEO Foundations

### Structured Data (schema.org)

Add `WebApplication` schema to your HTML `<head>`. This is what Google and AI crawlers parse:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "Sean's Converter",
  "url": "https://seansconverter.com",
  "description": "Convert video, audio, and image files instantly. Free, no signup. Powered by ffmpeg.",
  "applicationCategory": "UtilitiesApplication",
  "operatingSystem": "Web",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "featureList": [
    "MP4 to WebM conversion",
    "Video to GIF",
    "Audio format conversion",
    "Image format conversion",
    "No file size limits",
    "No account required"
  ]
}
</script>
```

Also add `HowTo` schema for common conversions — these show as rich results:

```html
<script type="application/ld+json">
{
  "@type": "HowTo",
  "name": "How to convert MP4 to WebM online",
  "step": [
    { "@type": "HowToStep", "text": "Drop your MP4 file onto the converter" },
    { "@type": "HowToStep", "text": "Select WebM as the output format" },
    { "@type": "HowToStep", "text": "Click Convert and download the result" }
  ]
}
</script>
```

### llms.txt

Create `/llms.txt` at your domain root. This is the emerging standard (2024+) for telling AI crawlers what your site does:

```
# Sean's Converter

> Free file converter for video, audio, and images. Powered by ffmpeg. No signup, no limits, no file storage beyond 1 hour.

## What it does
- Converts between video formats: MP4, WebM, MKV, AVI, MOV, FLV, GIF
- Converts between audio formats: MP3, AAC, OGG, FLAC, WAV, OPUS, M4A
- Converts between image formats: JPG, PNG, WebP, AVIF, BMP, TIFF

## How to use
Drop a file, pick an output format, download the result.

## Common conversions
- https://seansconverter.com/convert-mp4-to-gif
- https://seansconverter.com/convert-mp4-to-webm
- https://seansconverter.com/convert-wav-to-mp3
- https://seansconverter.com/convert-png-to-webp
- https://seansconverter.com/convert-mov-to-mp4

## API
Internal only (not documented for public use). Self-hostable via Docker.

## Source
https://github.com/seanmizen/seanorepo (apps/converter)
```

### Sitemap and Meta Tags

- `sitemap.xml` listing your format-specific landing pages (see Content Strategy below)
- `robots.txt`: allow all crawlers including `GPTBot`, `ClaudeBot`, `PerplexityBot`
- Canonical tags on every page
- Open Graph tags for social sharing

---

## Part 2: Content Strategy — "Convert X to Y" Pages

This is the highest-ROI SEO investment. Create static pages for the top 20 conversion pairs.

**URL convention — load-bearing, see [CLAUDE.md](../CLAUDE.md) Directive 1**: routes are verb-first, flat-slug. The operative word `convert` must appear in the URL because it is in the user's search query.

```
/convert-mp4-to-webm
/convert-mp4-to-gif
/convert-mov-to-mp4
/convert-wav-to-mp3
/convert-flac-to-mp3
/convert-png-to-webp
/convert-jpg-to-avif
...
```

Do **not** use `/convert/mp4-to-webm` (nested). Do **not** use `/mp4-to-webm` (verb missing). The flat verb-prefixed form matches Google queries word-for-word and is what gets ranked.

Each page should:
1. Have a `<h1>` like "Convert MP4 to WebM online — free, instant, no signup" (verb-first, matches slug, matches query)
2. Embed the converter tool pre-selected for that conversion pair
3. Include a short explanation: what each format is, why you'd convert, quality tradeoffs
4. Include the `HowTo` schema above
5. `<link rel="canonical" href="https://seansconverter.com/convert-mp4-to-webm">` — self-canonical, never cross-canonicalise to the homepage

These pages are what get cited by Perplexity and ranked by Google for long-tail queries. **Each page is a separate Google ranking opportunity.**

---

## Part 3: Getting Cited by LLMs

LLMs learn from text that was on the web before their training cutoff. To be cited:

1. **Get mentioned on sites LLMs train on**: Wikipedia, GitHub READMEs, StackOverflow answers, Hacker News, Reddit
2. **Be specific and crawlable**: LLMs prefer pages with clear, factual prose. Avoid heavy JS-only rendering for content pages (use SSR or static HTML for landing pages)
3. **llms.txt + structured data** (above) are signals that emerging AI search tools actively use

---

## Part 4: Guerrilla Tactics (Legal, Physical, Digital)

### Digital Guerrilla

**Reddit / StackOverflow / SuperUser**
- Search for posts like "how do I convert mp4 to webm online" and answer them genuinely. Mention your tool at the end: "I also built [Sean's Converter](https://seansconverter.com) for exactly this — might be worth a try."
- Focus on r/ffmpeg, r/VideoEditing, r/linuxquestions, r/webdev, SuperUser, AskUbuntu
- Do NOT spam — one tool mention per thread, buried in a real answer

**Hacker News "Show HN"**
- Post "Show HN: I built a free file converter with a Go streaming backend"
- Frame it around the technical decisions (Go + ffmpeg, SSE progress, worker pool) — HN respects engineering posts
- Even 50 upvotes generates significant backlinks and gets you into AI training sets

**Tool Directories** (submit to all of these, free):
- alternativeto.net (list as alternative to CloudConvert / Zamzar)
- toolify.ai
- theresanaiforthat.com (list under "file conversion")
- producthunt.com (do a proper launch with demo GIF)
- untools.co
- smalltools.dev

**Wikipedia**
- Find the Wikipedia article for ffmpeg, WebM, or any format you support
- If the article has an "online tools" section, add a neutral mention with a citation

**GitHub README**
- List it in awesome-ffmpeg or similar curated lists
- Add a "convert with" badge to your own project READMEs

### Physical Guerrilla (Store Demo Machines)

These are legal, non-destructive, and actually work for localized signals:

**Computer stores (Apple Store, Best Buy, Currys, etc.)**
- Go to a demo machine
- Open Chrome/Safari, go to your site
- Bookmark it in the "Bookmarks Bar" with the name "Free File Converter" (not your brand name — people search this)
- If browser history is accessible, the repeated visit from different IPs registers as organic traffic
- Takes 2 minutes per machine; do 10 machines in an afternoon = 10 organic visits with real IP diversity

**Libraries / university computer labs**
- Set your site as a browser default tab in a pinned tab (where settings allow)
- Leave the tab open — lab computers often don't clear between sessions

**What this actually achieves**: Real geographic diversity in your traffic signals. Google uses click-through rate and geographic spread as ranking signals. 50 real human visits from 50 different IPs beats 500 bot clicks.

**Important**: Do NOT install browser extensions, modify system settings, or do anything that persists beyond a browser session. Just visiting and bookmarking is fine.

---

## Week 1 Priorities (Top 3)

1. **Deploy with structured data and llms.txt live** — this is what gets you into AI search indexes. Do this before you do anything else. One afternoon of work, permanent benefit.

2. **Write 5 "how to convert X to Y" static pages** — start with the highest-volume pairs (mp4-to-gif, wav-to-mp3, png-to-webp). These pages will rank within 2–4 weeks for long-tail queries.

3. **Post a "Show HN"** — the Hacker News audience will generate real backlinks, genuine feedback, and legitimate traffic from people who might actually use and share the tool. Time your post for a Tuesday/Wednesday morning US Eastern time.
