#!/usr/bin/env bash
# Shared helpers for the numbered ffmpeg-converter test scripts.
#
# Each test script sources this file, calls `gen_* ` helpers to create tiny
# deterministic inputs, then calls `convert` to hit the local server.
#
# Env:
#   SERVER  — URL of the running ffmpeg-converter (default http://localhost:9876)
#   TEST_DIR — directory of this script (set by lib)

set -euo pipefail

SERVER="${SERVER:-http://localhost:9876}"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[1]:-$0}")" && pwd)"
IN_DIR="$TEST_DIR/in"
OUT_DIR="$TEST_DIR/out"
mkdir -p "$IN_DIR" "$OUT_DIR"

# Given a numeric prefix (e.g. "03") and a slug ("extract_audio_mp3"),
# returns a consistent file name rooted in $OUT_DIR.
out_file() {
    local prefix="$1"; shift
    local slug="$1";   shift
    local ext="$1";    shift
    printf '%s/%s_%s%s' "$OUT_DIR" "$prefix" "$slug" "$ext"
}

# Generate a 1-second 128x72 synthetic video with test pattern + sine audio.
# Usage: gen_tiny_video /path/to/out.mp4 [color=blue] [duration=1]
gen_tiny_video() {
    local out="$1"; shift
    local color="${1:-blue}"; shift || true
    local dur="${1:-1}"; shift || true
    ffmpeg -hide_banner -loglevel error -y \
        -f lavfi -i "color=c=${color}:s=128x72:r=15:d=${dur}" \
        -f lavfi -i "sine=frequency=440:sample_rate=16000:duration=${dur}" \
        -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p \
        -c:a aac -b:a 32k \
        -shortest "$out"
}

# Same, but with ffmpeg's smpte testsrc pattern (useful for reverse tests).
gen_testsrc_video() {
    local out="$1"; shift
    local dur="${1:-1}"; shift || true
    ffmpeg -hide_banner -loglevel error -y \
        -f lavfi -i "testsrc=size=128x72:rate=15:duration=${dur}" \
        -f lavfi -i "sine=frequency=660:sample_rate=16000:duration=${dur}" \
        -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p \
        -c:a aac -b:a 32k \
        -shortest "$out"
}

gen_tiny_audio() {
    local out="$1"; shift
    local freq="${1:-440}"; shift || true
    local dur="${1:-1}"; shift || true
    ffmpeg -hide_banner -loglevel error -y \
        -f lavfi -i "sine=frequency=${freq}:sample_rate=16000:duration=${dur}" \
        -c:a pcm_s16le "$out"
}

gen_tiny_image() {
    local out="$1"; shift
    local color="${1:-red}"; shift || true
    ffmpeg -hide_banner -loglevel error -y \
        -f lavfi -i "color=c=${color}:s=128x72:d=0.1" -frames:v 1 "$out"
}

gen_tiny_png_with_text() {
    # Drawtext isn't compiled into the homebrew ffmpeg build, so this helper
    # falls back to drawbox rectangles — the tests only care that the image
    # has some internal structure, not the literal text.
    local out="$1"; shift
    local _label="${1:-HELLO}"; shift || true
    ffmpeg -hide_banner -loglevel error -y \
        -f lavfi -i "color=c=white:s=128x72:d=0.1" \
        -vf "drawbox=x=10:y=10:w=40:h=20:color=black:t=fill,drawbox=x=60:y=30:w=50:h=30:color=red:t=fill" \
        -frames:v 1 "$out"
}

# has_filter <name> — returns 0 if the named ffmpeg filter is compiled in.
has_filter() {
    ffmpeg -hide_banner -filters 2>/dev/null | awk '{print $2}' | grep -qx "$1"
}

# has_encoder <name> — returns 0 if the named encoder is compiled in.
has_encoder() {
    ffmpeg -hide_banner -encoders 2>/dev/null | awk 'NR>10 {print $2}' | grep -qx "$1"
}

# skip <label> <reason> — print a SKIP line and exit 0.
skip() {
    local label="$1"; shift
    local reason="$*"
    printf '  \033[33mSKIP\033[0m %-40s %s\n' "$label" "$reason"
    exit 0
}

gen_srt() {
    local out="$1"; shift
    cat > "$out" <<'SRT'
1
00:00:00,100 --> 00:00:00,800
hello from the test suite

SRT
}

# convert <op> <out_path> <input_path>...  [-- key=val key=val]
# The "--" separator is optional; anything after it is passed as form fields.
convert() {
    local op="$1"; shift
    local dest="$1"; shift

    local files=()
    local kvs=()
    local saw_sep=0
    for arg in "$@"; do
        if [[ "$arg" == "--" ]]; then
            saw_sep=1; continue
        fi
        if (( saw_sep )); then
            kvs+=("$arg")
        else
            files+=("$arg")
        fi
    done

    local curl_args=(-sS -X POST "$SERVER/convert" -F "op=${op}")
    if (( ${#files[@]} > 0 )); then
        for f in "${files[@]}"; do
            curl_args+=(-F "file=@${f}")
        done
    fi
    if (( ${#kvs[@]} > 0 )); then
        for kv in "${kvs[@]}"; do
            curl_args+=(-F "${kv}")
        done
    fi

    local resp
    resp="$(curl "${curl_args[@]}")"
    if ! grep -q '"status":"done"' <<<"$resp"; then
        echo "CONVERT FAILED: op=$op" >&2
        echo "$resp" >&2
        return 1
    fi

    # Parse the output URL path (simple sed — avoids pulling in jq).
    local url_path
    url_path="$(printf '%s' "$resp" | sed -n 's/.*"output":"\([^"]*\)".*/\1/p')"
    if [[ -z "$url_path" ]]; then
        echo "no output path in response: $resp" >&2
        return 1
    fi
    curl -sS -o "$dest" "$SERVER$url_path"
    if [[ ! -s "$dest" ]]; then
        echo "downloaded output is empty: $dest" >&2
        return 1
    fi
}

# Report pass for a test with its output size.
pass() {
    local label="$1"; shift
    local file="$1"; shift
    local bytes
    bytes="$(wc -c < "$file" | tr -d ' ')"
    printf '  \033[32mPASS\033[0m %-40s %10s bytes  %s\n' "$label" "$bytes" "$file"
}
