#!/usr/bin/env bash
# Generate tiny deterministic media fixtures for the Playwright suite.
#
# Mirrors the convention from `apps/ffmpeg-converter/test/_lib.sh`:
# every input is synthesised on demand via ffmpeg's `lavfi` source so we
# never check binary blobs into git. Outputs land in the directory next to
# this script (`tests/fixtures/`).
#
# Each fixture is intentionally tiny (1 second, 128x72) — the suite cares
# about correct routing/handling, not codec quality.
#
# Run via: `yarn test:fixtures` (from apps/ffmpeg-converter/web/) or invoke
# this script directly.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "make-fixtures.sh: ffmpeg not on PATH; install via 'brew install ffmpeg'" >&2
    exit 1
fi

# tiny.mov — H.264 in a QuickTime container (1s, 128x72, blue, +sine audio).
ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=blue:s=128x72:r=15:d=1" \
    -f lavfi -i "sine=frequency=440:sample_rate=16000:duration=1" \
    -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p \
    -c:a aac -b:a 32k \
    -shortest "$DIR/tiny.mov"

# tiny.mp4 — H.264 in MP4 container.
ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=red:s=128x72:r=15:d=1" \
    -f lavfi -i "sine=frequency=440:sample_rate=16000:duration=1" \
    -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p \
    -c:a aac -b:a 32k \
    -shortest "$DIR/tiny.mp4"

# tiny.webm — VP9 + Opus in WebM container.
ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=green:s=128x72:r=15:d=1" \
    -f lavfi -i "sine=frequency=440:sample_rate=16000:duration=1" \
    -c:v libvpx-vp9 -b:v 100k -row-mt 1 -deadline realtime -cpu-used 8 \
    -c:a libopus -b:a 32k \
    -shortest "$DIR/tiny.webm"

# tiny.gif — animated gif from the testsrc pattern (1s, 64x36, 10fps).
ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc=size=64x36:rate=10:duration=1" \
    -vf "fps=10,scale=64:36:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" \
    "$DIR/tiny.gif"

# broken.mp4 — invalid MP4. Just a few bytes of garbage with the .mp4
# extension. Used by the error-states spec to exercise the "we couldn't
# decode that" path.
printf 'NOT_AN_MP4_DELIBERATELY_BROKEN_FOR_TEST_FIXTURE' >"$DIR/broken.mp4"

# tiny.png — single-frame red square. Used for image-handling cases.
ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=red:s=64x64:d=0.1" -frames:v 1 "$DIR/tiny.png"

# tiny.jpg — single-frame blue square (for cross-image conversion tests).
ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=blue:s=64x64:d=0.1" -frames:v 1 "$DIR/tiny.jpg"

echo "fixtures generated in $DIR:"
ls -la "$DIR" | grep -E '\.(mov|mp4|webm|gif|png|jpg)$' || true
