#!/usr/bin/env bash
# 52_concurrent.sh — verifies the server handles concurrent conversions safely.
#
# Fires N conversions in parallel (different ops) and asserts every one
# produces a valid, non-empty output with a unique job ID.
#
# This exercises:
#   - JobTracker RWMutex correctness
#   - Store.PrepareJobDir isolation (no cross-job file collisions)
#   - Correct status=done in all responses despite concurrent execution

set -euo pipefail
source "$(dirname "$0")/_lib.sh"

LABEL="52_concurrent"
N=8  # number of parallel conversions

# ── generate shared inputs ────────────────────────────────────────────────────
vid="$IN_DIR/52_vid.mp4"
aud="$IN_DIR/52_aud.wav"
img="$IN_DIR/52_img.png"
gen_tiny_video "$vid" green 1
gen_tiny_audio "$aud" 440 1
gen_tiny_image "$img" blue

# ── fire parallel conversions ─────────────────────────────────────────────────
# Use different ops to stress different code paths simultaneously.
# Deliberately avoid ops that require optional ffmpeg features
# (webp encoder, drawtext, libaom-av1) to keep the test portable.
ops_and_inputs=(
    "image_to_jpg:$img:.jpg"
    "image_to_png:$img:.png"
    "grayscale:$img:.png"
    "blur:$img:.png"
    "sharpen:$img:.png"
    "image_resize:$img:.jpg"
    "audio_mp3:$aud:.mp3"
    "audio_flac:$aud:.flac"
)

job_ids_file="$IN_DIR/52_job_ids.txt"
errors_file="$IN_DIR/52_errors.txt"
> "$job_ids_file"
> "$errors_file"

pids=()
out_files=()

for i in "${!ops_and_inputs[@]}"; do
    IFS=: read -r op input ext <<<"${ops_and_inputs[$i]}"
    out="$(out_file 52 "concurrent_${i}_${op}" "$ext")"
    out_files+=("$out")

    # Run each conversion as a background job.
    (
        resp="$(curl -sS -X POST "$SERVER/convert" \
            -F "op=${op}" \
            -F "file=@${input}")"

        if ! grep -q '"status":"done"' <<<"$resp"; then
            printf 'ERR job %d op=%s resp=%s\n' "$i" "$op" "$resp" >> "$errors_file"
            exit 1
        fi

        # Extract and record job_id for uniqueness check.
        job_id="$(printf '%s' "$resp" | sed -n 's/.*"job_id":"\([^"]*\)".*/\1/p')"
        printf '%s\n' "$job_id" >> "$job_ids_file"

        # Download the output.
        url_path="$(printf '%s' "$resp" | sed -n 's/.*"output":"\([^"]*\)".*/\1/p')"
        curl -sS -o "$out" "$SERVER$url_path"
        if [[ ! -s "$out" ]]; then
            printf 'ERR job %d op=%s output empty\n' "$i" "$op" >> "$errors_file"
            exit 1
        fi
    ) &
    pids+=($!)
done

# Wait for all background jobs.
failed=0
for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
        failed=$((failed + 1))
    fi
done

# ── check for errors ──────────────────────────────────────────────────────────
if [[ -s "$errors_file" ]]; then
    echo "concurrent conversion errors:" >&2
    cat "$errors_file" >&2
    exit 1
fi

if [[ "$failed" -gt 0 ]]; then
    printf 'FAIL: %d of %d concurrent jobs failed\n' "$failed" "$N" >&2
    exit 1
fi

# ── verify all job IDs are unique ─────────────────────────────────────────────
total_ids="$(wc -l < "$job_ids_file" | tr -d ' ')"
unique_ids="$(sort -u "$job_ids_file" | wc -l | tr -d ' ')"

if [[ "$total_ids" -ne "$N" ]]; then
    printf 'FAIL: expected %d job IDs, got %d\n' "$N" "$total_ids" >&2
    exit 1
fi
if [[ "$unique_ids" -ne "$N" ]]; then
    printf 'FAIL: expected %d unique job IDs, got %d (collision!)\n' "$N" "$unique_ids" >&2
    cat "$job_ids_file" >&2
    exit 1
fi

# ── verify all output files are non-empty ─────────────────────────────────────
total_bytes=0
for f in "${out_files[@]}"; do
    if [[ ! -s "$f" ]]; then
        printf 'FAIL: output file is empty: %s\n' "$f" >&2
        exit 1
    fi
    bytes="$(wc -c < "$f" | tr -d ' ')"
    total_bytes=$((total_bytes + bytes))
done

printf '  \033[32mPASS\033[0m %-40s %d jobs, %d unique IDs, %d bytes total\n' \
    "$LABEL" "$N" "$unique_ids" "$total_bytes"
