# Spike: conversion on the visitor's device (ffmpeg WASM)

Can the browser run the conversion, so that the file never leaves the
device? This spike measured ffmpeg.wasm against the server path, for the
same conversions and the same settings as the site (`web/src/tools.ts`).

The harness is in `web/spike/wasm/`. See "Run it again" at the end.

## Answer

- **Audio and images: yes.** Local conversion is as fast as the server,
  and it needs no upload. For these, local is better for the user and
  cheaper for us.
- **Video: only as a choice.** Local video conversion is about 7 times
  slower than the server with 4 threads, and 15 to 17 times slower with 1
  thread. The server stays the default for video.
- **HEIC: no.** The WASM build is ffmpeg 5.1.4. HEIC needs 7.1 or later.

## What we measured

Desktop: 8 cores, 16 GB, Chromium. Native is ffmpeg 8.1 on the same
machine. Times are conversion only. The server path also has upload and
download time.

| Conversion                          | Native | WASM, 4 threads | WASM, 1 thread |
| ----------------------------------- | -----: | --------------: | -------------: |
| MOV to MP4 (iPhone HEVC 1080p, 20 s) |  3.7 s |   25.7 s (7×)   |   63.0 s (17×) |
| MKV to MP4 (360p, 5 s)              |  0.2 s |          0.7 s  |          1.8 s |
| Compress video (720p, 60 s)         |  5.4 s |   34.9 s (6.5×) |   80.1 s (15×) |
| Trim video (5 s of a 720p video)    |  0.9 s |          3.3 s  |          8.7 s |
| MP4 to GIF (4 s, 480 wide)          |  2.6 s |          3.2 s  |          9.4 s |
| MP4 to MP3 (60 s)                   |  0.3 s |          0.4 s  |          0.4 s |
| WAV to MP3 (8 s)                    |  0.1 s |          0.1 s  |          0.1 s |
| PNG to JPG, WebP to JPG             | <0.1 s |         <0.1 s  |         <0.1 s |
| HEIC to JPG (iPhone, 48 tiles)      |  0.3 s |          fails  |          fails |

### When local video is faster

The server path is upload + conversion + download. Local video is
faster when the upload takes longer than the extra conversion time. For
the 20 s iPhone clip (8.8 MB), local with 4 threads needs 22 s more than
native. The upload takes longer than 22 s when the connection uploads
slower than about 3 Mbit/s. That happens on a weak mobile connection. It
does not happen on most home broadband.

### File size

| Input size | Copied into WASM memory | Mounted from the file picker |
| ---------- | ----------------------- | ---------------------------- |
| 250 MB to 1.9 GB | works (both cores)  | works                        |
| 3 GB       | fails: the browser cannot load it into one buffer | works (audio from 3 GB in 20 s) |

Mount the picked file (`ffmpeg.mount('WORKERFS', { files: [file] })`) and
do not copy it. Then the input size has no practical limit on a desktop.
The output stays in WASM memory, so a very large output (over about 2 GB)
can still fail.

### The download

The WASM core is 32 MB, 10 MB with gzip. The visitor downloads it once.
The browser caches it after that. The first local conversion is 10 MB of
download slower than the numbers above.

## What we did not measure: phones

We tried to model a phone with Chrome's CPU throttle (4× slower). It
changed nothing, because the throttle slows only the page's main thread,
and ffmpeg.wasm runs in Web Workers. So there are no phone numbers.

Measure on a real mid-range Android phone and a real iPhone before
launch. Until then, do not offer local video on phones. Audio and images
are small jobs, so they are safe to offer.

## Detection: can this browser do it?

Show the local option only when all of these are true:

- `WebAssembly` exists, and the SIMD test in `web/spike/wasm/bench.js`
  (`detect()`) passes. The core needs SIMD.
- For the 4-thread core: `crossOriginIsolated === true` and
  `SharedArrayBuffer` exists. Without them, use the 1-thread core.
- For video: the device is not a phone, until we have phone numbers.
  `navigator.hardwareConcurrency` and `navigator.deviceMemory` help (not in
  Safari).
- The conversion is not HEIC.

## Headers the site needs

- **1-thread core:** no headers.
- **4-thread core:** every page that runs it needs
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`. Without them,
  `SharedArrayBuffer` does not exist and the core fails to load
  ("SharedArrayBuffer is not defined"). These headers block cross-origin
  resources that do not send `Cross-Origin-Resource-Policy`. The site has
  none today. Keep it that way, or serve the core from our own origin.

## Traps found

- **Thread deadlock.** With the 4-thread core, `-threads 8` (the automatic
  value on an 8-core machine) hangs forever. `-threads 4` or fewer works.
  Always pass `-threads 4` or fewer.
- **A failed job kills the instance.** After ffmpeg aborts, that FFmpeg
  instance is dead. Call `terminate()` and load a new one.
- **No cancel.** A running `exec` cannot stop. To cancel, terminate the
  worker and load again.
- **Old ffmpeg.** The WASM build is 5.1.4, and the server has 8.1. Results
  can differ, and new formats (HEIC) fail.
- **Licence.** The core is built with `--enable-gpl` (x264 and x265). The
  site then distributes a GPL binary to every visitor. Show the licence,
  and link to the exact source of `@ffmpeg/core`.

## The memetic-defence table

From [`MEMETIC-DEFENCE.md`](./MEMETIC-DEFENCE.md), filled in with these
numbers.

| Question                        | Server path                   | On this device                          |
| ------------------------------- | ----------------------------- | --------------------------------------- |
| Time: 8.8 MB phone video to MP4 | upload + 3.7 s + download     | 25.7 s (4 threads), 63 s (1 thread), plus 10 MB core download the first time |
| Time: audio or image            | upload + under 0.5 s + download | under 0.5 s, no upload                 |
| Time on a mid-range phone       | same as above                 | not measured                            |
| Largest file that works         | 2 GB (site limit)             | 3 GB tested with a mounted file         |
| Where the file goes             | our server, deleted after 1 hour | stays on the device                  |
| Battery and heat                | none on the device            | 7 to 17 times the CPU time for video    |
| Cost to us per conversion       | server CPU and bandwidth      | none after the core download            |

### What the table changes

The five lines give a split answer:

- **Audio and images:** both sides gain (line 1). Local finishes first, so
  local is the default (the "Default" rule). No special button: it is
  simply how these conversions work. The page says "Your file stays on
  your device", because that is true and it matters to people.
- **Video:** the user pays in time and battery, and we save server cost.
  So the server stays the default, and the local path is a choice. Its
  name and words from `MEMETIC-DEFENCE.md` pass with these numbers:
  "Convert on this device". Next to it: "Private: your file never leaves
  your device. About 7 times slower on this computer." Use the real
  measured factor for the visitor's device class, not a flattering one.
- **Price:** free. Local conversion costs us less, so a price fails the
  reversal test.

## Next steps

1. Measure local video on a real mid-range Android phone and an iPhone.
2. Build local conversion for audio and images (1-thread core, no
   headers), with the server as the fallback.
3. Then add "Convert on this device" for video on desktops, with the
   4-thread core and the two headers.
4. Add the GPL notice and the source link before any of it ships.

## Run it again

```bash
cd apps/ffmpeg-converter/web/spike/wasm
./make-media.sh ../../../data/spike-media     # needs ffmpeg 7.1+
node serve.mjs ../../../data/spike-media &     # ISOLATE=0 drops the headers
node run.mjs ../../../data/spike-media         # speed table
node limits.mjs                                # size table
```
