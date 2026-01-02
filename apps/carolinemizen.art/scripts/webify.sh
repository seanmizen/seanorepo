#!/usr/bin/env bash
set -euo pipefail

# Converts all MOV files in the current directory to MP4 (H.264, no audio), and JPG files to WebP.
# Outputs to a specified directory (default: ./web).
# Usage:
#   cd ~/Desktop && ./webify.sh            # outputs to ./web
#   cd ~/Desktop && ./webify.sh /web       # outputs to /web (needs write permission)
#   ./webify.sh /web --anim-webp          # MOV -> animated webp instead of mp4
#
# Defaults: MOV->MP4 (H.264, no audio), JPG->WebP

out_dir="${1:-web}"
mode="${2:-}" # optional: --anim-webp

mkdir -p "$out_dir"

command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg not found"; exit 1; }

shopt -s nullglob

# MOV -> MP4 (or animated WebP)
for f in *.MOV *.mov; do
  base="${f%.*}"
  if [[ "$mode" == "--anim-webp" ]]; then
    ffmpeg -hide_banner -loglevel error -y -i "$f" -an \
      -vf "fps=30,scale='min(1920,iw)':-2:flags=lanczos" \
      -loop 0 -c:v libwebp -q:v 80 -compression_level 6 \
      "$out_dir/${base}.webp"
  else
    ffmpeg -hide_banner -loglevel error -y -i "$f" \
      -map 0:v:0 -an \
      -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
      -c:v libx264 -preset slow -crf 18 \
      -pix_fmt yuv420p -movflags +faststart \
      "$out_dir/${base}.mp4"
  fi
done

# JPG -> WebP
for f in *.JPG *.jpg; do
  base="${f%.*}"
  ffmpeg -hide_banner -loglevel error -y -i "$f" \
    -c:v libwebp -q:v 82 -compression_level 6 \
    "$out_dir/${base}.webp"
done

echo "Done -> $out_dir"
