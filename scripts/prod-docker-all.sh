#!/usr/bin/env bash
# prod-docker-all.sh: runs `prod:docker` in each workspace that has that script.
#
# Where: the root of the checkout, through `yarn prod:docker`. deploy.sh runs
#        it on a webserver. You can run it on your own computer.
# When:  at each deploy, and each time you run `yarn prod:docker`.
# Why:   `yarn workspaces foreach` stops at the first workspace that fails. A
#        failed app must not stop the other apps (REQ-SERVER-018), and
#        `yarn prod:docker` stays the one command for a deploy (REQ-DEPLOY-004).
#
# The order is the order of `foreach -At`: the workspace list order, with each
# workspace after the workspaces in its `dependencies`. seanscards is not run.
# At the end the script prints one line for each failed workspace and exits 1.
#
# The build output of each workspace is at debug, and its last 30 lines are at
# error when it fails (run_quiet, REQ-SERVER-019). Each app that started gets
# one info line.
set -uo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=log.sh
. scripts/log.sh

order="$(yarn workspaces list --json --verbose | node -e '
const fs = require("node:fs");
const all = fs.readFileSync(0, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const has = (w) => w.location !== "." && w.name !== "seanscards" &&
  JSON.parse(fs.readFileSync(`${w.location}/package.json`, "utf8")).scripts?.["prod:docker"];
let todo = all.filter(has);
const done = new Set();
while (todo.length) {
  const next = todo.find((w) => w.workspaceDependencies.every((d) => done.has(d) || !todo.some((t) => t.location === d)));
  if (!next) throw new Error(`dependency cycle: ${todo.map((w) => w.name)}`);
  console.log(next.name);
  done.add(next.location);
  todo = todo.filter((w) => w !== next);
}
')" || { log_err "could not read the workspace list"; exit 1; }

failed=""
for ws in $order; do
    if run_quiet yarn workspace "$ws" run prod:docker; then
        log_info "$ws started"
    else
        failed="$failed $ws"
    fi
done

for ws in $failed; do
    log_err "FAILED $ws"
done
[ -z "$failed" ]
