#!/usr/bin/env bash
# prod-docker-all.test.sh: tests prod-docker-all.sh with a fake checkout and a
# yarn shim. It starts no container.
#
# Where: your own computer or a webserver, from any directory.
# When:  after a change to prod-docker-all.sh.
# Why:   a failed workspace must not stop the others (REQ-SERVER-018).
#
# Usage: bash scripts/prod-docker-all.test.sh   (exit 0 when every check passes)
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
t="$(mktemp -d)"
trap 'rm -rf "$t"' EXIT
fail=0
check() { if eval "$2"; then echo "  ok   $1"; else echo "  FAIL $1"; fail=1; fi; }

# The fake checkout. apps/a depends on apps/b, so b runs first although the
# list has a first. seanscards and apps/c (no prod:docker) do not run.
mkdir -p "$t/repo/scripts" "$t/bin"
cp "$here/prod-docker-all.sh" "$t/repo/scripts/"
for w in a b c seanscards; do
    mkdir -p "$t/repo/apps/$w"
    if [ "$w" = c ]; then echo '{}'; else echo '{"scripts":{"prod:docker":"x"}}'; fi > "$t/repo/apps/$w/package.json"
done
echo '{"scripts":{"prod:docker":"x"}}' > "$t/repo/package.json"

# The yarn shim. `workspace <name> run prod:docker` records the name, and
# fails when the name is in $FAIL.
cat > "$t/bin/yarn" << EOF
#!/bin/sh
if [ "\$1" = workspaces ]; then
    printf '%s\n' \\
        '{"location":".","name":"root","workspaceDependencies":[]}' \\
        '{"location":"apps/a","name":"a","workspaceDependencies":["apps/b"]}' \\
        '{"location":"apps/b","name":"b","workspaceDependencies":[]}' \\
        '{"location":"apps/c","name":"c","workspaceDependencies":[]}' \\
        '{"location":"apps/seanscards","name":"seanscards","workspaceDependencies":[]}'
    exit 0
fi
echo "\$2" >> "$t/calls"
case " \$FAIL " in *" \$2 "*) exit 1 ;; esac
EOF
chmod +x "$t/bin/yarn"

run() { : > "$t/calls"; FAIL="$1" PATH="$t/bin:$PATH" "$t/repo/scripts/prod-docker-all.sh" > "$t/out" 2>&1; }

echo "prod-docker-all.sh"
run "b"; rc=$?
check "the first workspace fails, the second still runs" '[ "$(tr "\n" " " < "$t/calls")" = "b a " ]'
check "a failure exits 1" '[ "$rc" = 1 ]'
check "one line for each failed workspace" \
    '[ "$(grep -c FAILED "$t/out")" = 1 ] && grep -q "FAILED b" "$t/out"'
run ""; rc=$?
check "no failure exits 0" '[ "$rc" = 0 ] && ! grep -q FAILED "$t/out"'
exit "$fail"
