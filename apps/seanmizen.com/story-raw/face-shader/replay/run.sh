#!/usr/bin/env bash
# Replay one stage: its edits, then Biome as `yarn fix` ran it, then a snapshot.
set -euo pipefail
R=/tmp/claude-1000/-home-sean-projects-seanorepo/015ead16-47ee-48d4-8977-e4a6dc3b5ee4/scratchpad/replay
W=/home/sean/projects/seanorepo-736
stage=$1
(cd "$W/apps/seanmizen.com/replay-tmp/src" && PYTHONPATH="$R" python3 "$R/$stage.py")
(cd "$W" && yarn biome check --write apps/seanmizen.com/replay-tmp/src/app apps/seanmizen.com/replay-tmp/src/components apps/seanmizen.com/replay-tmp/src/hooks apps/seanmizen.com/replay-tmp/src/index.css 2>&1 | tail -2)
mkdir -p "$R/out/$stage"
cp -r "$W/apps/seanmizen.com/replay-tmp/src/." "$R/out/$stage/"
echo "$stage snapshot taken"
