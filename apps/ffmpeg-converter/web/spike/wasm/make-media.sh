#!/usr/bin/env bash
# Makes the spike media in $1. Needs ffmpeg 7.1 or later on PATH.
set -euo pipefail
d="${1:?usage: make-media.sh <dir>}"; mkdir -p "$d"; cd "$d"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
[ -f iphone.mov ] || ff -f lavfi -i testsrc2=s=1920x1080:r=30:d=20 -f lavfi -i sine=f=440:d=20 -c:v libx265 -tag:v hvc1 -preset ultrafast -c:a aac iphone.mov
[ -f big.mp4 ] || ff -f lavfi -i testsrc2=s=1280x720:r=30:d=60 -f lavfi -i sine=f=500:d=60 -c:v libx264 -crf 12 -c:a aac -b:a 256k big.mp4
[ -f clip.mkv ] || ff -f lavfi -i testsrc2=s=640x360:r=25:d=5 -f lavfi -i sine=d=5 -c:v libx264 -c:a libopus clip.mkv
[ -f voice.wav ] || ff -f lavfi -i sine=f=600:d=8 voice.wav
[ -f logo.png ] || ff -f lavfi -i "color=c=red@0.0:s=200x100,format=rgba" -vf "drawbox=x=50:y=25:w=100:h=50:color=blue@1:t=fill" -frames:v 1 logo.png
[ -f photo.webp ] || ff -f lavfi -i testsrc2=s=800x600 -frames:v 1 -c:v libwebp photo.webp
# A real iPhone photo (a grid of 48 HEVC tiles). ffmpeg cannot write HEIC.
[ -f iphone-image1.heic ] || curl -sfL -o iphone-image1.heic https://github.com/tigranbs/test-heic-images/raw/master/image1.heic
# Size-limit files: constant 40 Mbit/s, so the size follows the length.
for mb in 250 500 1000 1500 1900 3000; do
  f="size-${mb}mb.mp4"; [ -f "$f" ] && continue
  secs=$(( mb * 8 / 40 ))
  ff -f lavfi -i "testsrc2=s=1280x720:r=30:d=${secs}" -f lavfi -i "sine=d=${secs}" \
    -c:v libx264 -preset ultrafast -b:v 40M -minrate 40M -maxrate 40M -bufsize 4M \
    -x264-params nal-hrd=cbr -c:a aac "$f"
done
