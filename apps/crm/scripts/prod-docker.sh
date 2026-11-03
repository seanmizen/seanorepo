#!/usr/bin/env bash
# prod-docker.sh: builds the crm prod image and starts crm and its
# Litestream sidecar. It also starts the demo (crm-demo and its sidecar)
# when apps/crm/.env.demo exists.
#
# Where: the web box (asus), through `yarn prod:docker` in deploy.sh. Also
#        your own computer, before a release.
# When:  after each release, and each time you run `yarn prod:docker`.
# Why:   the demo needs its own env file. Without the file, the demo
#        profile is off, the demo does not start, and prod does not change.
#
# The build output is at debug (run_quiet in scripts/log.sh, REQ-SERVER-019).
#
# Usage: yarn workspace crm prod:docker
set -euo pipefail

cd "$(dirname "$0")/.."
LOG_TAG=crm
# shellcheck source=../../../scripts/log.sh
. ../../scripts/log.sh

profiles=(--profile prod)
if [ -f .env.demo ]; then
  profiles+=(--profile demo)
else
  log_info "apps/crm/.env.demo does not exist. The demo is off."
fi

BUILD_TARGET=prod run_quiet docker compose "${profiles[@]}" up --build --detach
