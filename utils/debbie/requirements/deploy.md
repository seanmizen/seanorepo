# REQ-DEPLOY — How code reaches debbie

What has to be true for a commit to become a running site. These describe the
mechanism that `2026-09-17/` implements. It was first built in
`archive/2025-10-08b/`, and the Inspection evidence below still cites that
generation.

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
  - Inspection — `utils/debbie/archive/2025-10-08b/scripts/deploy.sh` checks out
    `$RELEASE_BRANCH`, which defaults to `release`
  - Inspection — `utils/debbie/2026-09-17/payload/setup-server-environment.sh` checks out
    `$RELEASE_BRANCH` after cloning, and never creates the branch when it is
    absent
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "checkout exists at
    /home/srv/projects/seanorepo"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "every file under
    /home/srv/projects/seanorepo is owned by srv"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "origin is the only remote,
    and is seanorepo"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "srv can reach origin with
    no credential"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "HEAD is on release" —
    skipped, not passed, on a machine provisioned before the first `yarn release`,
    because until then the branch does not exist
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
  or a hosted runner holding credentials to the machine, and both are a standing
  way in that nothing audits.

  Polling inverts it: the host makes an outbound request every two minutes and
  compares the remote SHA to what it last deployed. Nothing needs to reach in.
  The cost is up to two minutes of latency on every deploy, which for a
  personal site is not a cost at all.

  Since #307 this is two units with one clock. `custom-release-poll` fetches
  and checks out `release` on every machine and touches nothing that runs;
  after every poll it triggers `custom-deploy`, which compares the checkout and
  the boot id with its marker and deploys only on a machine with the webserver
  role (`/etc/seanorepo/roles/webserver`, from `ROLE_WEBSERVER`; unset is off,
  #329). The deploy has no timer of its own, so it
  can never start while a checkout is being written.
- **Verification:**
  - Inspection — `utils/debbie/archive/2025-10-08b/services/deploy-poll-custom.timer`
  - Inspection — `utils/debbie/archive/2025-10-08b/scripts/deploy.sh` compares
    `git ls-remote` against a recorded marker
  - Inspection — `utils/debbie/2026-09-17/services/release-poll.sh` compares
    `git ls-remote` against `HEAD` and checks out on a difference; no marker
  - Inspection — `utils/debbie/2026-09-17/services/deploy.sh` compares `HEAD`
    against a marker recording the deployed SHA and the boot id it was deployed
    under, and never dereferences the recorded SHA, so a marker left by a
    force-pushed or rebuilt `release` cannot wedge it
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "custom-release-poll.timer
    enabled"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "custom-release-poll.timer
    active"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the timer polls every two
    minutes" — the two-minute period is the latency bound this requirement
    trades for needing no inbound port, so it is asserted rather than assumed
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "custom-release-poll.service
    is timer-owned (static)"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "custom-deploy.service is not
    on a timer"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the release poller triggers
    the deploy"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the deploy runs only on a
    machine with the webserver role"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "without the webserver role a
    triggered deploy runs nothing"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the release poller moves the
    checkout and touches no service" — behaviour, against a scratch origin with
    every service command shimmed: a machine that does not serve still tracks
    `release`, and tracking it runs nothing
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the deploy runs once per
    checkout and again after a reboot"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "deploy.sh present and
    executable" — **conditional, and the condition is the claim.** `deploy.sh`
    is run from the checkout, and the checkout is on `release`, so a machine
    provisioned before this generation shipped cannot have the file at all.
    The check therefore asks the commit on disk first — `git cat-file -e
    HEAD:utils/debbie/2026-09-17/services/deploy.sh` — and skips, naming that
    commit and that path, when the answer is no. It runs, and can fail, exactly
    when the commit says the file should be there. A green run in which it
    skipped does not verify this requirement's deploy path; it verifies the
    timer, the interval, the unit ownership and the sudoers boundary only
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

  Since #307 the checkout is the release poller's, and it takes the same lock:
  while a deploy holds it, the poller leaves the checkout alone and tries again
  on the next tick.
- **Verification:**
  - Inspection — `utils/debbie/archive/2025-10-08b/scripts/deploy.sh` takes
    `$DEPLOY_LOCK_FILE` before doing any work
  - Inspection — `utils/debbie/2026-09-17/services/deploy.sh` takes `flock -n`
    on a file descriptor before doing any work, so the kernel releases the lock
    on every exit path including SIGKILL and the unit's `TimeoutStartSec`
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "a second deploy exits
    cleanly while one holds the lock" — asserted as behaviour, not as a grep
    for `flock`: a lock is held and `deploy.sh` is then run against it, and it
    must exit 0 and say why rather than block, queue or proceed
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "a release poll leaves the
    checkout alone while a deploy holds the lock"
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
  - Inspection — `utils/debbie/archive/2025-10-08b/scripts/deploy.sh` runs
    `yarn install --immutable` then `yarn prod:docker`
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "docker info works as srv
    without sudo"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "docker compose plugin
    present"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "node 20 installed"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "yarn is corepack's shim,
    not a global npm install"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "yarn --version matches the
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
  - Inspection — `utils/debbie/archive/2025-10-08b/scripts/deploy.sh` diffs the old and
    new SHA for `$CLOUDFLARED_CONFIG` before restarting
  - Inspection — `utils/debbie/archive/2025-10-08b/setup/sudoers-seanorepo-deploy`
  - Inspection — `utils/debbie/2026-09-17/services/deploy.sh` diffs the last
    deployed SHA (the marker, since #307) against `HEAD`
    with a pathspec rather than piping into `grep`, and restarts when it cannot
    prove the config unchanged — a first recorded deploy, or a previous commit
    no longer in the object store
  - Inspection — `utils/debbie/2026-09-17/payload/setup-server-environment.sh` writes the
    drop-in to a temporary path, validates it with `visudo -c`, and installs it
    mode 0440 root:root only once it parses
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the one rule is a single
    systemctl restart of a single unit" — the grant is matched whole against an
    anchored pattern, so nothing can be appended to it
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "sudoers drop-in has exactly
    one rule"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "sudoers drop-in grants no
    wildcard"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "sudoers drop-in grants no
    command list"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "sudoers drop-in does not
    grant ALL as a command"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "sudoers drop-in is mode 440"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "sudoers drop-in is owned by
    root:root"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "sudoers drop-in parses"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the unit deploy.sh restarts
    is the unit sudo permits" — the drop-in and `deploy.sh` name the unit
    separately, and a rename that moves only one of them would fail exactly
    once, on the ingress change it was needed for
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
  - Inspection — `utils/debbie/archive/2025-10-08b/scripts/deploy.sh` carries a comment
    stating that the absence of `git clean` is deliberate
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "no git clean anywhere in
    the deploy path" — asserted as an absence, against the DEPLOYED script, so
    it catches the tidy-up after it has shipped as well as before
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "deploy.sh says why there is
    no git clean" — an unexplained absence is what gets tidied away, so the
    explanation is asserted too
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "no git clean in the release
    poller" — since #307 the checkout happens there
- **Relations:** depends-on REQ-DEPLOY-004
