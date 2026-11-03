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
set -uo pipefail

cd "$(dirname "$0")/.."

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
')" || { echo "prod-docker-all: could not read the workspace list" >&2; exit 1; }

failed=""
for ws in $order; do
    echo "prod-docker-all: $ws"
    yarn workspace "$ws" run prod:docker || failed="$failed $ws"
done

for ws in $failed; do
    echo "prod-docker-all: FAILED $ws" >&2
done
[ -z "$failed" ]
