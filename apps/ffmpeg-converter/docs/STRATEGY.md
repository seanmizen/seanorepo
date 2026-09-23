# Sean's Converter: product strategy

Read this before you change the site. The previous strategy asked for an
Advanced panel, a live ffmpeg command, copy-as-curl, saved presets and URL
presets. We removed all of it. Do not build it again.

## Who the visitor is

A person typed "mov to mp4" or "compress video for discord" into Google.
They have one file. They want a different file. They do not know what
ffmpeg, a codec or CRF is, and they do not want to learn.

Every decision starts from that person. An engineer who wants ffmpeg
flags is not the visitor. That engineer can run ffmpeg.

## The page

One page for each search (`/mov-to-mp4`, `/compress-video-to-10mb`). On each
page, from top to bottom:

1. The heading names the search: "MOV to MP4".
2. One plain sentence says what the page does.
3. One large button: "Choose MOV file".
4. A progress bar, then a large Download button.
5. Short questions and answers in plain English.
6. Links to related converters.

The home page has the same button. After the user chooses a file, it asks
"What do you want to do?" and shows the converters for that file.

## Rules

- **One obvious button.** No drag and drop. No drop zone.
- **Start at once.** When a converter needs no settings, the conversion
  starts when the user chooses the file.
- **Settings only when the job needs them.** Trim and GIF need a start
  and an end. Resize needs a size. Nothing else has settings.
- **Good defaults.** We choose the quality. The user never sees CRF,
  bitrate, codec or preset. The args are in `web/src/tools.ts`.
- **No technical words on the page.** No ffmpeg commands, codec flags or
  operation names. A unit test checks the page text for ffmpeg flags.
- **Honest.** The copy says that the file goes to our server and that the
  server deletes it after one hour. The Go service does that. Say "on this
  device" only for a conversion that the user chose to run on the device.
- **Server first.** The server converts by default. On video pages,
  desktop browsers also get "Convert on this device". Only that choice
  loads ffmpeg.wasm (10 MB). Audio and images always use the server.
- **A promise is a guarantee.** "Compress to 10 MB" gives a file under
  10 MB, or it shows an error. It never gives a larger file.
- **Plain errors.** Tell the user what happened and what to do next. Keep
  the raw error in the console.

## What not to add

Each item below makes the page worse for the visitor:

- Advanced panels, codec selectors, or a "show everything" option.
- Displays of ffmpeg or curl commands.
- Saved presets, preset libraries, or presets in the URL.
- Operation pickers on a page that already names its operation.
- Near-duplicate pages made to rank. Add a page only for a real search
  that the engine does well, and give it real answers.

## Money

The paid plan stays: a Pro tier and a paid API, with Stripe code in the Go
service. The free flow never shows an upsell. A paid feature must be
better for the customer, and not only cheaper for us. Local conversion in
the browser (ffmpeg WASM) is a candidate. Before you name, word or price
any premium feature, apply [`MEMETIC-DEFENCE.md`](./MEMETIC-DEFENCE.md).

## Where to look

- `web/src/tools.ts`: every page, its args and its questions.
- `web/src/components/Converter.tsx`: the flow on each page.
- `docs/COMPETITORS.md`: competitor research from April 2026.
