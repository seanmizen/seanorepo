#!/bin/bash

# Feeds gitconfig.txt into your global git config.
#
# Idempotent: it sets a key only when the value differs, and it never touches
# a key that gitconfig.txt does not name. It prints "set <key>" for each key
# that it changed, so a second run prints nothing.

# Set working directory to this script's location
cd "$(dirname "$0")" || exit 1

# The "|| [[ -n $key ]]" also reads a last line without a newline.
while IFS='=' read -r key val || [[ -n "$key" ]]; do
  [[ -z "$key" || -z "$val" || "$key" == \#* ]] && continue
  if [[ "$(git config --global --get "$key")" != "$val" ]]; then
    git config --global "$key" "$val"
    echo "set $key"
  fi
done < gitconfig.txt
