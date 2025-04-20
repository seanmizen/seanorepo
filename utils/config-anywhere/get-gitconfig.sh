#!/bin/bash

# Feeds gitconfig.txt into your global git config

# Set working directory to this script's location
cd "$(dirname "$0")" || exit 1

while IFS='=' read -r key val; do
  [[ -z "$key" || -z "$val" ]] && continue
  current=$(git config --global --get "$key")
  [[ "$current" != "$val" ]] && git config --global "$key" "$val"
done < gitconfig.txt
