# REQ-DEPLOY — How code reaches debbie

What has to be true for a commit to become a running site. These describe the
mechanism that `2025-10-08b/` implements today and that `2026-09-17/` has not
yet rebuilt — the directory is what production runs, and it is the reference,
not the specification.

Written before the rebuild rather than after it, so the rebuild has something
to answer to. `REQ-SERVER-*` describes the host; these describe what the host
does with the repository.

Introduced in #273.

---

## REQ-DEPLOY-001 — Production tracks a branch that only moves deliberately

- **Status:** active
- **Source:** sean
- **Origin:** #273
- **Type:** constraint
- **Priority:** P0
- **Statement:** The host shall deploy the `release` branch and no other.
- **Rationale:** Merging to `main` happens many times a day, often from an
  agent, and a merge is not a decision to ship. Separating the two means a
  deploy is an explicit act — `yarn release` fast-forwards `origin/release` to
  `main` from a clean tree — and that a bad merge does not reach the public
  until someone chooses to promote it.

  The cost is that `main` and production can silently diverge, and somebody
  eventually wonders why their fix is not live. That is the accepted trade: a
  confusing question beats an unintended deploy.
- **Verification:**
  - Inspection — `utils/debbie/2025-10-08b/scripts/deploy.sh` checks out
    `$RELEASE_BRANCH`, which defaults to `release`
- **Relations:** none

## REQ-DEPLOY-002 — A deploy needs no access to the host

- **Status:** active
- **Source:** sean
- **Origin:** #273
- **Type:** functional
- **Priority:** P0
- **Statement:** When `origin/release` moves, the host shall notice and deploy
  the new commit without an inbound connection.
- **Rationale:** The host sits behind a home router with no forwarded ports —
  that is `REQ-SERVER-002`. A push-based deploy would need either an open port
  or a hosted runner holding credentials to the box, and both are a standing
  way in that nothing audits.

  Polling inverts it: the host makes an outbound request every two minutes and
  compares the remote SHA to what it last deployed. Nothing needs to reach in.
  The cost is up to two minutes of latency on every deploy, which for a
  personal site is not a cost at all.
- **Verification:**
  - Inspection — `utils/debbie/2025-10-08b/services/deploy-poll-custom.timer`
  - Inspection — `utils/debbie/2025-10-08b/scripts/deploy.sh` compares
    `git ls-remote` against a recorded marker
- **Relations:** depends-on REQ-DEPLOY-001

## REQ-DEPLOY-003 — Two deploys cannot run at once

- **Status:** active
- **Source:** sean
- **Origin:** #273
- **Type:** constraint
- **Priority:** P1
- **Statement:** While a deploy is in progress, the host shall not begin
  another.
- **Rationale:** The poller fires every two minutes and a deploy takes longer
  than that whenever images rebuild. Without a lock, a slow deploy is joined by
  a second one running `git checkout -f` underneath it, and the result is a
  working tree that matches no commit.
- **Verification:**
  - Inspection — `utils/debbie/2025-10-08b/scripts/deploy.sh` takes
    `$DEPLOY_LOCK_FILE` before doing any work
- **Relations:** depends-on REQ-DEPLOY-002

## REQ-DEPLOY-004 — A deploy is the same command a human would run

- **Status:** active
- **Source:** sean
- **Origin:** #273
- **Type:** constraint
- **Priority:** P1
- **Statement:** The host shall deploy by running `yarn prod:docker`.
- **Rationale:** The thing that starts the sites in production has to be the
  thing that can be run by hand when a deploy has gone wrong at midnight. A
  separate orchestration path that only the timer exercises is a second system
  that is never debugged until it fails.

  This is what makes the deploy runnable from an SSH session with
  `./deploy.sh --force`, and why the poller is a thin wrapper rather than the
  mechanism.
- **Verification:**
  - Inspection — `utils/debbie/2025-10-08b/scripts/deploy.sh` runs
    `yarn install --immutable` then `yarn prod:docker`
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "docker info works as srv
    without sudo"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "docker compose plugin
    present"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "node 20 installed"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "yarn is corepack's shim,
    not a global npm install"
  - Test — `utils/debbie/2026-09-17/vm/assert.sh` › "yarn --version matches the
    repo's packageManager"
- **Relations:** depends-on REQ-DEPLOY-002

## REQ-DEPLOY-005 — The tunnel restarts only when its own configuration changes

- **Status:** active
- **Source:** sean
- **Origin:** #273
- **Type:** constraint
- **Priority:** P2
- **Statement:** Where a deploy changes `apps/cloudflared/config.yml`, the host
  shall restart the tunnel service.
- **Rationale:** Restarting the tunnel drops every in-flight request, so doing
  it on every deploy makes each deploy a brief outage for no reason. Ingress
  rules are the only thing the tunnel reads from the repository, so a diff
  against that one path is a sufficient trigger.

  This is also the only place the deploy needs root, which is why the sudoers
  drop-in grants exactly one command rather than general privilege.
- **Verification:**
  - Inspection — `utils/debbie/2025-10-08b/scripts/deploy.sh` diffs the old and
    new SHA for `$CLOUDFLARED_CONFIG` before restarting
  - Inspection — `utils/debbie/2025-10-08b/setup/sudoers-seanorepo-deploy`
- **Relations:** depends-on REQ-DEPLOY-004

## REQ-DEPLOY-006 — A deploy leaves untracked credentials alone

- **Status:** active
- **Source:** sean
- **Origin:** #273
- **Type:** constraint
- **Priority:** P0
- **Statement:** The host shall not delete untracked files from the working
  tree during a deploy.
- **Rationale:** `apps/cloudflared/credentials/` is gitignored and holds the
  tunnel's credentials file, which exists only on the host. A `git clean` in the
  deploy path would remove it, the tunnel would fail to start on its next
  restart, and every site would go down with no change to the repository to
  explain why.

  Recorded as a requirement because the omission looks like an oversight. A
  future reader tidying up the deploy script would reasonably add `git clean
  -fdx` to make checkouts deterministic, and that is the failure this forbids.
- **Verification:**
  - Inspection — `utils/debbie/2025-10-08b/scripts/deploy.sh` carries a comment
    stating that the absence of `git clean` is deliberate
- **Relations:** depends-on REQ-DEPLOY-004
