# REQ-DEPLOY — How code reaches the server

What has to be true for a commit to become a running site. These requirements
describe the mechanism that `2026-09-17/` implements, and the evidence below
cites the files of that generation.

`REQ-SERVER-*` describes the host. These requirements describe what the host
does with the repository.

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
  eventually asks why their fix is not live. That is the accepted trade: a
  confusing question is better than an unintended deploy.
- **Verification:**
  - Inspection — `utils/debbie/2026-09-17/services/release-poll.sh` checks out
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
    the check skips, and does not pass, while the checkout has no
    `origin/release` ref. That is the case before the first `yarn release`
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

  Polling reverses the direction. The host makes an outbound request every two
  minutes and compares the remote SHA with the checkout. Nothing needs to
  reach in. The cost is up to two minutes of latency on every deploy. For a
  personal site, that cost does not matter.

  Two units share one clock. `custom-release-poll` fetches and checks out
  `release` on every machine, and it touches nothing that runs. After every
  poll it triggers `custom-deploy`. That unit compares the checkout and the
  boot id with its marker. It deploys only on a machine with the webserver
  role (`/etc/seanorepo/roles/webserver`, from `ROLE_WEBSERVER`, off when
  unset, per `REQ-SERVER-014`). The deploy has no timer of its own, so it can
  never start while the poller writes a checkout.
- **Verification:**
  - Inspection — `utils/debbie/2026-09-17/services/custom-release-poll.timer`
    starts the release poll two minutes after the last one, and three minutes
    after boot
  - Inspection — `utils/debbie/2026-09-17/services/release-poll.sh` compares
    `git ls-remote` against `HEAD` and checks out on a difference. It keeps no
    marker
  - Inspection — `utils/debbie/2026-09-17/services/deploy.sh` compares `HEAD`
    against a marker recording the deployed SHA and the boot id it was deployed
    under, and never dereferences the recorded SHA, so a marker left by a
    force-pushed or rebuilt `release` cannot wedge it
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "custom-release-poll.timer
    enabled"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "custom-release-poll.timer
    active"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the timer polls every two
    minutes" — the two-minute period is the latency bound that this
    requirement accepts in exchange for no inbound port, so the check asserts it
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
    runs from the checkout, and the checkout is on `release`. A checkout at a
    commit older than this generation cannot have the file. So the check first
    asks the commit on disk, with `git cat-file -e
    HEAD:utils/debbie/2026-09-17/services/deploy.sh`. When the answer is no, it
    skips and names that commit and that path. It runs, and can fail, exactly
    when the commit says the file must be there. A green run in which it
    skipped does not verify the deploy path of this requirement. It verifies
    only the timer, the interval, the unit ownership and the sudoers boundary
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

  The release poller owns the checkout, and it takes the same lock. While a
  deploy holds the lock, the poller leaves the checkout alone and tries again
  on the next tick.
- **Verification:**
  - Inspection — `utils/debbie/2026-09-17/services/deploy.sh` takes `flock -n`
    on a file descriptor before doing any work, so the kernel releases the lock
    on every exit path including SIGKILL and the unit's `TimeoutStartSec`
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "a second deploy exits
    cleanly while one holds the lock" — the check tests behaviour and does not
    grep for `flock`. It holds a lock and then runs `deploy.sh` against it.
    `deploy.sh` must exit 0 and say why. It must not block, queue or proceed
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
- **Rationale:** The command that starts the sites in production must be the
  command that a person can run by hand when a deploy goes wrong at midnight.
  A separate orchestration path that only the timer uses is a second system.
  Nobody debugs it until it fails.

  For this reason a person can run the deploy from an SSH session with
  `./deploy.sh --force`. The poller is only a thin wrapper around it.
- **Verification:**
  - Inspection — `utils/debbie/2026-09-17/services/deploy.sh` runs
    `yarn install --immutable` then `yarn prod:docker`
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "docker info works as srv
    without sudo"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "docker compose plugin
    present"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "node installed"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "yarn is apt's yarnpkg"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "corepack is not installed"
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

  This is one of the two places where the deploy needs root. The sudoers
  drop-in grants exactly two commands: a restart of the tunnel unit and a
  restart of the tcp-getter unit. It grants no general privilege.
- **Verification:**
  - Inspection — `utils/debbie/2026-09-17/payload/setup-server-environment.sh` writes
    the sudoers drop-in. It grants the deploy user `systemctl restart` of the
    tunnel unit and of the tcp-getter unit, and nothing else
  - Inspection — `utils/debbie/2026-09-17/services/deploy.sh` diffs the last
    deployed SHA (from the marker) against `HEAD` with a pathspec, and does not
    pipe into `grep`. It restarts when it cannot prove the config unchanged:
    on a first recorded deploy, or when the previous commit is absent from the
    object store
  - Inspection — `utils/debbie/2026-09-17/payload/setup-server-environment.sh` writes the
    drop-in to a temporary path, validates it with `visudo -c`, and installs it
    mode 0440 root:root only once it parses
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "every rule is a single
    systemctl restart of a single unit" — each grant is matched whole against an
    anchored pattern, so nothing can be appended to it
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "sudoers drop-in has exactly
    two rules"
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
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "every unit deploy.sh
    restarts is a unit sudo permits" — the drop-in and `deploy.sh` name each unit
    separately, and a rename that moves only one of them would fail exactly
    once, on the change it was needed for
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

  This is a requirement because the omission looks like an oversight. A
  reader who tidies the deploy script could reasonably add `git clean -fdx` to
  make checkouts deterministic. This requirement forbids that failure.
- **Verification:**
  - Inspection — `utils/debbie/2026-09-17/services/deploy.sh` carries a comment
    stating that the absence of `git clean` is deliberate
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "no git clean anywhere in
    the deploy path" — the check asserts an absence in the DEPLOYED script, so
    it catches the tidy-up before and after it ships
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "deploy.sh says why there is
    no git clean" — somebody will tidy away an unexplained absence, so the
    check also asserts the explanation
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "no git clean in the release
    poller" — the release poller does the checkout
- **Relations:** depends-on REQ-DEPLOY-004

## REQ-DEPLOY-007 — Every machine installs the host tools that match its checkout

- **Status:** active
- **Source:** sean
- **Origin:** #436
- **Type:** functional
- **Priority:** P2
- **Statement:** After each successful release poll, every target machine,
  whatever its roles, shall install the `image-to-ascii` binary built from the
  `utils/image-to-ascii` tree in its own checkout, with no Go toolchain on the
  machine.
- **Rationale:** The login animation runs this binary on every machine, and
  the spec files it reads come from the checkout. A binary from another
  version of the source could reject a spec or draw it differently. CI builds
  once per tree hash, so the machine can name the exact build it needs. The
  deploy unit runs only on a webserver, so the install has its own unit. The
  CI workflow that publishes the builds is
  `.github/workflows/image-to-ascii-release.yml`.
- **Verification:**
  - Inspection — `utils/debbie/2026-09-17/services/host-tools.sh` downloads the
    release tagged with the checkout's tree hash, checks it against
    `SHA256SUMS`, and does nothing when the installed build matches
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "the release poller
    triggers the host tools"
  - Test — `utils/debbie/2026-09-17/payload/assert.sh` › "custom-host-tools.service
    runs as $DEPLOY_USER, with no role condition"
- **Relations:** depends-on REQ-DEPLOY-002
