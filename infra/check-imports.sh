#!/usr/bin/env bash
# Checks that every resource in every stack has an import block, and that
# every import block names a resource.
#
# Why: the state is a local cache, not in git. With one import block for
#      each resource, one apply rebuilds a lost or old state. A resource
#      without a block makes the next apply from an empty state try to
#      create it again.
# When: CI (infra-check.yml), and after an apply that created a resource.
#
# Usage: infra/check-imports.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
status=0
for dir in "$here"/*/; do
  [ -f "$dir/versions.tf" ] || continue
  stack="$(basename "$dir")"
  resources="$(sed -nE 's/^resource "([^"]+)" "([^"]+)".*/\1.\2/p' "$dir"/*.tf | sort)"
  imports="$(sed -nE 's/^[[:space:]]*to[[:space:]]*=[[:space:]]*([A-Za-z0-9_.-]+).*/\1/p' "$dir"/*.tf | sort)"
  missing="$(comm -23 <(echo "$resources") <(echo "$imports"))"
  orphans="$(comm -13 <(echo "$resources") <(echo "$imports"))"
  for r in $missing; do
    echo "infra/$stack: resource $r has no import block. Add one to imports.tf with the ID from ./tofu state show $r." >&2
    status=1
  done
  for r in $orphans; do
    echo "infra/$stack: import block for $r has no resource. Remove the block." >&2
    status=1
  done
  [ -n "$missing$orphans" ] || echo "infra/$stack: $(echo "$resources" | grep -c .) resources, each with an import block"
done
exit "$status"
