#!/usr/bin/env bash
# 51_error_cases.sh — verifies every documented HTTP error path.
#
# Tests:
#   400  missing 'op' field
#   400  unknown op name
#   400  no file when file required
#   400  too few files (concat needs ≥2)
#   404  GET /jobs/<nonexistent>
#   404  GET /jobs/<nonexistent>/output
#   405  GET /convert (only POST allowed)
#   422  ffmpeg failure (send garbage bytes as video input)
#   422  empty input file

set -euo pipefail
source "$(dirname "$0")/_lib.sh"

LABEL="51_error_cases"

# ── helpers ───────────────────────────────────────────────────────────────────

# check_status <label> <expected_code> <actual_code> [body]
check_status() {
    local label="$1" want="$2" got="$3" body="${4:-}"
    if [[ "$got" -ne "$want" ]]; then
        printf '  \033[31mFAIL\033[0m %s: expected HTTP %d, got %d\n' "$label" "$want" "$got" >&2
        [[ -n "$body" ]] && printf '       body: %s\n' "$body" >&2
        exit 1
    fi
}

# check_field <label> <needle> <haystack>
check_field() {
    local label="$1" needle="$2" haystack="$3"
    if ! grep -q "$needle" <<<"$haystack"; then
        printf '  \033[31mFAIL\033[0m %s: expected %q in response, got: %s\n' \
            "$label" "$needle" "$haystack" >&2
        exit 1
    fi
}

# http_status_only <...curl args>
# Returns just the HTTP status code.
http_status_only() {
    curl -sS -o /dev/null -w '%{http_code}' "$@"
}

# ── 400: missing op ───────────────────────────────────────────────────────────
{
    in="$IN_DIR/51_dummy.jpg"
    gen_tiny_image "$in" green

    resp="$(curl -sS -X POST "$SERVER/convert" -F "file=@${in}")"
    got="$(curl -sS -X POST "$SERVER/convert" \
        -F "file=@${in}" -o /dev/null -w '%{http_code}')"
    check_status "missing_op" 400 "$got" "$resp"
    check_field  "missing_op_msg" "missing" \
        "$(curl -sS -X POST "$SERVER/convert" -F "file=@${in}")"
    printf '  \033[32mPASS\033[0m %-40s 400 missing op\n' "51_missing_op"
}

# ── 400: unknown op ───────────────────────────────────────────────────────────
{
    in="$IN_DIR/51_dummy2.jpg"
    gen_tiny_image "$in" red

    resp="$(curl -sS -X POST "$SERVER/convert" \
        -F "op=does_not_exist_xyz" -F "file=@${in}")"
    got="$(curl -sS -X POST "$SERVER/convert" \
        -F "op=does_not_exist_xyz" -F "file=@${in}" \
        -o /dev/null -w '%{http_code}')"
    check_status "unknown_op" 400 "$got" "$resp"
    check_field  "unknown_op_msg" "unknown op" "$resp"
    printf '  \033[32mPASS\033[0m %-40s 400 unknown op\n' "51_unknown_op"
}

# ── 400: no file ──────────────────────────────────────────────────────────────
{
    resp="$(curl -sS -X POST "$SERVER/convert" -F "op=image_to_jpg")"
    got="$(curl -sS -X POST "$SERVER/convert" \
        -F "op=image_to_jpg" -o /dev/null -w '%{http_code}')"
    check_status "no_file" 400 "$got" "$resp"
    printf '  \033[32mPASS\033[0m %-40s 400 no file\n' "51_no_file"
}

# ── 400: too few files (concat needs ≥2) ──────────────────────────────────────
{
    in="$IN_DIR/51_only.mp4"
    gen_tiny_video "$in" blue 1

    resp="$(curl -sS -X POST "$SERVER/convert" \
        -F "op=concat" -F "file=@${in}")"
    got="$(curl -sS -X POST "$SERVER/convert" \
        -F "op=concat" -F "file=@${in}" \
        -o /dev/null -w '%{http_code}')"
    check_status "too_few_files" 400 "$got" "$resp"
    check_field  "too_few_files_msg" "requires at least 2" "$resp"
    printf '  \033[32mPASS\033[0m %-40s 400 too few files (concat)\n' "51_too_few_files"
}

# ── 404: unknown job ──────────────────────────────────────────────────────────
{
    got="$(http_status_only "$SERVER/jobs/nonexistent-job-id-abc123")"
    check_status "job_not_found" 404 "$got"
    printf '  \033[32mPASS\033[0m %-40s 404 unknown job\n' "51_job_not_found"
}

# ── 404: unknown job output ───────────────────────────────────────────────────
{
    got="$(http_status_only "$SERVER/jobs/nonexistent-job-id-abc123/output")"
    check_status "job_output_not_found" 404 "$got"
    printf '  \033[32mPASS\033[0m %-40s 404 unknown job/output\n' "51_job_output_not_found"
}

# ── 405: GET /convert ─────────────────────────────────────────────────────────
{
    got="$(http_status_only "$SERVER/convert")"
    check_status "convert_get_405" 405 "$got"
    printf '  \033[32mPASS\033[0m %-40s 405 GET /convert\n' "51_convert_get_405"
}

# ── job status shape ──────────────────────────────────────────────────────────
{
    in="$IN_DIR/51_forjobcheck.jpg"
    gen_tiny_image "$in" blue

    resp="$(curl -sS -X POST "$SERVER/convert" \
        -F "op=image_to_jpg" -F "file=@${in}")"
    if ! grep -q '"status":"done"' <<<"$resp"; then
        echo "51_job_status: server did not complete job; resp: $resp" >&2
        exit 1
    fi
    job_id="$(printf '%s' "$resp" | sed -n 's/.*"job_id":"\([^"]*\)".*/\1/p')"

    job_resp="$(curl -sS "$SERVER/jobs/${job_id}")"
    check_field "job_status_has_id"     '"id"'           "$job_resp"
    check_field "job_status_has_status" '"status":"done"' "$job_resp"
    check_field "job_status_has_op"     '"op"'           "$job_resp"
    printf '  \033[32mPASS\033[0m %-40s job status shape correct\n' "51_job_status_shape"
}

# ── 422: ffmpeg failure (garbage input file) ──────────────────────────────────
{
    garbage="$IN_DIR/51_garbage.mp4"
    dd if=/dev/urandom bs=512 count=1 of="$garbage" 2>/dev/null

    resp="$(curl -sS -X POST "$SERVER/convert" \
        -F "op=transcode" -F "file=@${garbage}")"
    got="$(curl -sS -X POST "$SERVER/convert" \
        -F "op=transcode" -F "file=@${garbage}" \
        -o /dev/null -w '%{http_code}')"
    check_status "ffmpeg_failure" 422 "$got" "$resp"
    check_field  "ffmpeg_failure_error" '"error"' "$resp"
    printf '  \033[32mPASS\033[0m %-40s 422 ffmpeg failure\n' "51_ffmpeg_failure"
}

# ── 422: empty file ───────────────────────────────────────────────────────────
{
    empty="$IN_DIR/51_empty.mp4"
    : > "$empty"  # zero-byte file

    resp="$(curl -sS -X POST "$SERVER/convert" \
        -F "op=transcode" -F "file=@${empty}")"
    got="$(curl -sS -X POST "$SERVER/convert" \
        -F "op=transcode" -F "file=@${empty}" \
        -o /dev/null -w '%{http_code}')"
    check_status "empty_file" 422 "$got" "$resp"
    printf '  \033[32mPASS\033[0m %-40s 422 empty input file\n' "51_empty_file"
}

printf '  \033[32mPASS\033[0m %-40s all error cases\n' "$LABEL"
