#!/usr/bin/env bash
# Run every numbered test in order.
#
# By default, starts a local instance of the server on $PORT (9876 by default),
# runs the whole suite against it, then shuts the server down and prints a
# per-test pass/fail summary plus the total bytes of output produced.
#
# Env:
#   PORT=9876           listen port
#   SERVER=http://...   hit an already-running instance instead
#   FAST=1              stop at the first failing test (otherwise keep going)
#   KEEP=1              leave the server running after the suite (useful for poking)

set -uo pipefail

TEST_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$TEST_DIR/.." && pwd)"

PORT="${PORT:-9876}"
export PORT
SERVER="${SERVER:-http://localhost:$PORT}"
export SERVER

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; RESET=$'\033[0m'

server_pid=""
server_log="$TEST_DIR/server.log"

start_server() {
    echo "${BOLD}→ building server${RESET}"
    ( cd "$APP_DIR" && go build -o "$TEST_DIR/.ffmpeg-converter" . )

    echo "${BOLD}→ starting server on :$PORT${RESET}"
    ( cd "$APP_DIR" && PORT="$PORT" DATA_DIR="$APP_DIR/data" "$TEST_DIR/.ffmpeg-converter" ) \
        > "$server_log" 2>&1 &
    server_pid=$!

    # Poll /health until it comes up (max ~5s).
    for _ in $(seq 1 50); do
        if curl -fsS "$SERVER/health" >/dev/null 2>&1; then
            echo "${GREEN}  ready${RESET}"
            return 0
        fi
        sleep 0.1
    done
    echo "${RED}server failed to start; log:${RESET}"
    cat "$server_log"
    return 1
}

stop_server() {
    if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
        kill "$server_pid" 2>/dev/null || true
        wait "$server_pid" 2>/dev/null || true
    fi
}

# If SERVER was overridden, skip starting our own.
if [[ "$SERVER" == "http://localhost:$PORT" ]]; then
    start_server || exit 1
    trap 'if [[ -z "${KEEP:-}" ]]; then stop_server; fi' EXIT
fi

# Clean old outputs so the totals are accurate.
rm -rf "$TEST_DIR/out" "$TEST_DIR/in" "$APP_DIR/data"
mkdir -p "$TEST_DIR/out" "$TEST_DIR/in"

echo
echo "${BOLD}→ running tests${RESET}"
echo

passed=0
failed=0
skipped=0
failures=()

shopt -s nullglob
scripts=("$TEST_DIR"/[0-9][0-9]_*.sh)

for s in "${scripts[@]}"; do
    name="$(basename "$s")"
    # Capture output to detect SKIP vs PASS without double-printing.
    output="$(bash "$s" 2>&1)" && rc=0 || rc=$?
    echo "$output"
    if (( rc != 0 )); then
        failed=$((failed + 1))
        failures+=("$name")
        printf '  %sFAIL%s %s\n' "$RED" "$RESET" "$name"
        if [[ -n "${FAST:-}" ]]; then break; fi
    elif [[ "$output" == *"SKIP"* ]]; then
        skipped=$((skipped + 1))
    else
        passed=$((passed + 1))
    fi
done

echo
echo "${BOLD}→ summary${RESET}"
out_size="$(du -sh "$TEST_DIR/out" 2>/dev/null | awk '{print $1}')"
in_size="$(du -sh "$TEST_DIR/in" 2>/dev/null | awk '{print $1}')"
total=$((passed + failed + skipped))
printf '  tests run   : %d\n' "$total"
printf '  %spassed%s      : %d\n' "$GREEN" "$RESET" "$passed"
printf '  %sfailed%s      : %d\n' "$RED" "$RESET" "$failed"
printf '  %sskipped%s     : %d\n' "$YELLOW" "$RESET" "$skipped"
printf '  out/ bytes  : %s\n' "$out_size"
printf '  in/  bytes  : %s\n' "$in_size"

if (( failed > 0 )); then
    echo
    echo "${RED}failed scripts:${RESET}"
    for f in "${failures[@]}"; do echo "  - $f"; done
    exit 1
fi

exit 0
