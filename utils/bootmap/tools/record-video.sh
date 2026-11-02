#!/usr/bin/env bash
# Record a trace to an MP4, as a real screen shows it: only the framebuffer.
#
#   tools/record-video.sh <trace.json> <out.mp4> [WxH] [key=value ...]
#
# `bootmap video` renders 60 frames a second of boot time, and ffmpeg
# encodes them (H.264, yuv420p, so every player can show it). ffmpeg comes
# from the local ffmpeg-converter image (apps/ffmpeg-converter), because the
# host has none. Set FFMPEG_IMAGE to use another image.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRACE="$1"
OUT="$2"
SIZE="${3:-1920x1080}"
shift $(( $# >= 3 ? 3 : $# ))
IMAGE="${FFMPEG_IMAGE:-ffmpeg-converter-backend:latest}"
FPS=60

(cd "$ROOT" && zig build -Doptimize=ReleaseFast)
OUT_DIR="$(cd "$(dirname "$OUT")" && pwd)"
"$ROOT/zig-out/bin/bootmap" video "$TRACE" --fps "$FPS" --size "$SIZE" "$@" |
    docker run -i --rm --user "$(id -u):$(id -g)" -v "$OUT_DIR:/out" --entrypoint ffmpeg "$IMAGE" \
        -hide_banner -loglevel error -y \
        -f rawvideo -pix_fmt rgb24 -s "$SIZE" -r "$FPS" -i - \
        -c:v libx264 -preset slow -crf 14 -tune animation -pix_fmt yuv420p \
        -movflags +faststart "/out/$(basename "$OUT")"
echo "record-video: $OUT"
