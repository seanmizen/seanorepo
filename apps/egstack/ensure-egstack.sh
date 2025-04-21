#!/bin/bash
set -e

REPO_DIR="../../other-repos/egstack"

if [ ! -d "$REPO_DIR" ]; then
  git clone https://github.com/seanmizen/egstack.git "$REPO_DIR"
fi

cd "$REPO_DIR"
git fetch origin
git checkout main
git pull origin main

yarn set version 4.8.0
yarn
