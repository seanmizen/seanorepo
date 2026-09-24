# ffmpeg-converter

Sean's Converter (seansconverter.com): convert video, audio and images in
one click. Read [`docs/STRATEGY.md`](./docs/STRATEGY.md) before you change
the site.

Runs on asus behind the Cloudflare tunnel. `yarn release` deploys it with the
other sites.

## Deployment

| Piece | Where |
| ----- | ----- |
| Frontend | `web/dockerfile`, port 4050 |
| Backend | `dockerfile` (Go on Debian 13, with ffmpeg and libheif), port 4051 |
| Data | the `converter_data` volume: uploads, outputs, the billing DB |
| Tunnel | `apps/cloudflared/config.yml`: `/api/*` to 4051, the rest to 4050 |
| DNS | `infra/cloudflare/seansconverter_com.tf` |

Local check of the production images:

```bash
cd apps/ffmpeg-converter
BUILD_TARGET=prod docker compose --profile prod up --build --detach
SERVER=http://localhost:4051 bash test/run_all.sh
bash ../../scripts/test-deployment.sh
```

HEIC: Debian's ffmpeg 7.1 reads only one tile of an iPhone photo, so the
image ops decode HEIC with libheif's `heif-dec` first (`withHEIFDecode` in
`ops.go`). The service warns at start when it has neither `heif-dec` nor
ffmpeg 8.

| Path     | What it is                                                     |
| -------- | -------------------------------------------------------------- |
| `./`     | Go HTTP service. It runs ffmpeg. Documented below.             |
| `./web/` | Next.js site. One static page per conversion, `/api/*` proxies to Go. |

Run both: `yarn converter` from the repo root. Tests: `go test ./...` here,
`yarn workspace ffmpeg-converter-next test` for the tool list, and
`yarn workspace ffmpeg-converter-next test:e2e` for the browser flow (it
needs the Go server and ffmpeg).

## Requirements

- Go 1.22+
- `ffmpeg` on `PATH` (tested with Homebrew ffmpeg 8.1 on macOS)
- `ffprobe` (optional — only a couple of ops care)
- `curl` + `bash` for the test suite

The server fails fast at boot if `ffmpeg` isn't on PATH.

## Running the server

```bash
cd apps/ffmpeg-converter
go run .
# → ffmpeg-converter listening on :9876
```

Env:

| var             | default  | meaning                                          |
| --------------- | -------- | ------------------------------------------------ |
| `PORT`          | `9876`   | HTTP listen port                                 |
| `DATA_DIR`      | `./data` | where uploads and outputs are stored             |
| `FILE_TTL`      | `1h`     | job files are deleted after this time            |
| `MAX_UPLOAD_MB` | `2048`   | largest request body for `/convert`              |
| `MAX_JOBS`      | `2`      | async jobs that run ffmpeg at the same time      |
| `UPLOAD_CHUNK_BYTES` | `33554432` | largest chunk of a chunked upload (32 MiB) |

Data dir is `.gitignore`d and wiped by the test runner each run. The server
also deletes each job directory `FILE_TTL` after its last change. The website
promises this to users.

## HTTP API

```
GET  /health                # {ok, ops count, service, time}
GET  /ops                   # list of all registered operations
POST /convert               # multipart form — see below
GET  /jobs/{id}             # JSON status for a job
GET  /jobs/{id}/output      # download the converted file
```

### Chunked uploads

Cloudflare (Free plan) refuses a request body over 100 MB, and the site
sends every file through it. So the site uploads in chunks:

```
POST /uploads                -> 201 {"upload_id": "...", "chunk_size": 33554432}
PUT  /uploads/{id}/{n}       -> 204   (chunk n, 0-based, at most chunk_size bytes)
POST /convert  upload_id=... chunks=N filename=...  (instead of a multipart file)
```

A repeat of a chunk replaces it, so a client retries a failed chunk. A chunk
over `chunk_size` gets 413, and so does the chunk that takes the upload over
`MAX_UPLOAD_MB`. `/convert` joins chunks 0 to N-1 (400 if one is missing) and
removes the upload. The one-hour sweep removes an abandoned upload.

### POST /convert

Multipart form:

- `op` (required) — operation name (see list below).
- `file` (required, repeatable) — input file(s). Ops like `concat` and
  `timelapse` take multiple.
- Any other form fields are passed as op-specific args (`width=64`,
  `timestamp=00:00:00.5`, etc.).

With `async=1`, the server saves the upload, answers `202` with the
`job_id` and status `pending`, and runs the job in the background. Poll
`GET /jobs/{id}` until the status is `done` or `error`. The website uses
this, because a proxy such as Cloudflare closes a response after 100 s.

Without `async`, the response is synchronous:

```json
{
  "job_id":     "8d4c…",
  "status":     "done",
  "op":         "thumbnail",
  "output":     "/jobs/8d4c…/output",
  "local_path": "/abs/path/to/data/8d4c…/out.jpg"
}
```

Errors come back as `{"error": "…"}` with the last couple of KB of ffmpeg
stderr stapled on.

Jobs live in an in-memory `map[jobID]*Job` — there's no database, no queue,
no retry. Restart the process and history goes away.

## Operations

The registry is defined in `ops.go`. Current scenarios:

**video (22)** — transcode (mp4), transcode_webm, transcode_mkv, resize,
h264_to_h265, change_framerate, change_bitrate, trim, concat, watermark,
thumbnail, contact_sheet, speed, reverse, crop, rotate, flip, loop,
subtitles_burn, subtitles_soft, pad_aspect, timelapse

**audio (15)** — audio_mp3, audio_opus, audio_aac, audio_flac, extract_audio,
normalize_audio, audio_trim, audio_fade, audio_concat, stereo_to_mono,
audio_bitrate, time_stretch, pitch_shift, spectrogram, waveform_png

**image (10)** — image_resize, image_to_jpg, image_to_png, image_to_webp,
image_to_avif, gif_from_video, gif_from_images, blur, sharpen, grayscale

**special (3)** — youtube_preview, meme_overlay, silence_trim

Total: **50 registered operations**.

## Test suite

Scripts in `test/` are numbered so they sort chronologically. Each one:

1. Generates its own input via `ffmpeg lavfi` sources (testsrc / sine /
   color) — **no binary fixtures in git**.
2. Uploads to the running server via `curl -F`.
3. Downloads the result into `test/out/NN_name.ext`.
4. Prints a `PASS` line with the output size.

Run everything:

```bash
bash test/run_all.sh
```

`run_all.sh` builds the server, boots it on `$PORT`, runs every
`[0-9][0-9]_*.sh` in order, and prints a summary. Ffmpeg features that the
local build doesn't support (e.g. `drawtext`, `subtitles`, `libwebp`,
`libaom-av1`) are detected with `has_filter` / `has_encoder` and the affected
tests `SKIP` gracefully.

Env switches:

- `FAST=1 bash test/run_all.sh` — stop on first failure
- `KEEP=1 bash test/run_all.sh` — leave the server running afterwards
- `SERVER=http://somewhere:1234 bash test/run_all.sh` — hit an external instance instead of starting one

### Expected output sizes

On my macOS laptop (Homebrew ffmpeg 8.1):

- `test/out/` → ~776 KB (46 produced files)
- `test/in/`  → ~940 KB (synthetic inputs)

Durations are all ≤ 2 s, dimensions ≤ 128 px. Everything is ephemeral and
gitignored.

### Ffmpeg features that refused (on my install)

The Homebrew ffmpeg build I tested against is compiled without a few things;
the tests detect this and skip rather than fail. If your build has them,
they run:

| feature      | test             | why                        |
| ------------ | ---------------- | -------------------------- |
| `drawtext`   | 48_meme_overlay  | needs `--enable-libfreetype` |
| `subtitles`  | 19_subtitles_burn_in | needs `--enable-libass`  |
| `libwebp`    | 41_image_to_webp | needs `--enable-libwebp`   |
| `libaom-av1` | 50_image_to_avif | needs `--enable-libaom`    |

(The ops themselves are still registered — a client that knows its ffmpeg
build has these can still call them.)

## File layout

```
apps/ffmpeg-converter/
├── main.go         # HTTP server + boot checks
├── handler.go      # /health, /ops, /convert, /jobs/{id}[/output]
├── ops.go          # the 50-op registry
├── jobs.go         # in-memory job tracker
├── store.go        # per-job upload/output directory helpers
├── fs.go           # tiny file utilities
├── go.mod
├── README.md
├── .gitignore      # data/, test/in/, test/out/, binaries
├── data/           # runtime (gitignored)
└── test/
    ├── _lib.sh             # shared test helpers (gen_*, convert, has_filter, skip)
    ├── run_all.sh          # orchestrator
    ├── 01_health_check.sh
    ├── 02_transcode_mp4_to_webm.sh
    ├── … 50 numbered tests …
    ├── 50_image_to_avif.sh
    ├── in/                 # synthetic inputs (gitignored)
    └── out/                # produced artifacts (gitignored)
```
