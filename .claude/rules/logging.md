---
paths:
  - "**/*.sh"
  - "utils/debbie/**"
  - "apps/*/*-be/src/**"
  - "apps/*/backend/**"
  - "apps/ffmpeg-converter/*.go"
---

# Logging

Everything in the repo logs to journald or to stdout. Each line has a level,
so a reader can hide the noise and keep the story. Nothing is thrown away.

## The levels

| Level | Use it for |
|---|---|
| `error` | A failure. Also the last 30 lines of the output of the tool that failed. |
| `warn` | A thing that is wrong but does not stop the job. |
| `info` | Our own messages: started, skipped, deployed, done. |
| `debug` | Tool output (docker build, yarn, git, apt, curl progress), and one line for each request. |

- A failure always repeats its context at `error`. Nobody must change the
  level to find out why something failed.
- One `info` line for each request is too many. Per-request access logs are
  at `debug`.

## Shell scripts under systemd

journald reads a priority prefix at the start of each line: `<3>` error,
`<4>` warning, `<6>` info, `<7>` debug (`SyslogLevelPrefix=`, on by default).
A line with no prefix is at info.

Source `scripts/log.sh` and use its functions. Do not write your own `log()`.

```bash
LOG_TAG=deploy                     # default: the script name without .sh
. "$(dirname "${BASH_SOURCE[0]}")/../../scripts/log.sh"   # the path from your script

log_info "deploying ${sha:0:7}"
log_warn "container $name has no compose label"
log_err "the LAN edge did not start"
log_debug "up to date - nothing to do"
run_quiet yarn install --immutable  # output at debug. On a failure: the last 30 lines at error
```

- `run_quiet <cmd...>` returns the exit status of the command. A line that has
  a prefix already keeps it, so a script in `run_quiet` can write its own
  `info` lines.
- Each tool that prints build or progress output runs in `run_quiet`, or sends
  its output to `/dev/null`. `payload/assert.sh` checks this for the deploy
  path (REQ-SERVER-019).
- On a terminal, the lines get no prefix, and the tool output prints as
  before.

Read the deploy log on a server:

```bash
journalctl -u custom-deploy.service -p info -f     # the deploy's own lines
journalctl -u custom-deploy.service -p debug -f    # also the tool output
journalctl -u custom-deploy.service -p err -b      # only the failures, this boot
journalctl -u custom-release-poll.service -p info  # the checkouts that moved
```

## Apps

An app reads one env var at startup: `LOG_LEVEL` (`error`, `warn`, `info` or
`debug`. The default is `info`). Each other value stops the app at startup.
Document the variable in the env table of the app README.

## Who uses the rule

An app or script adopts the rule when you next change it. Do not change all
of them at once.

| Part | State |
|---|---|
| `utils/debbie/2026-09-17/services/deploy.sh` | yes |
| `utils/debbie/2026-09-17/services/release-poll.sh` | yes |
| `scripts/prod-docker-all.sh` (`yarn prod:docker`) | yes |
| `apps/crm/scripts/prod-docker.sh` | yes |
| crm-be (`LOG_LEVEL`, requests at debug) | yes |
| `utils/debbie/2026-09-17/services/host-tools.sh` | not yet |
| `utils/debbie/2026-09-17/services/vendor-upgrade.sh` | not yet |
| `utils/debbie/2026-09-17/services/net-failover.sh` | not yet |
| `utils/debbie/2026-09-17/services/lan-names.sh` | not yet |
| `utils/debbie/2026-09-17/payload/setup-server-environment.sh` | not yet |
| inside-be | not yet |
| caroline-be | not yet |
| cous-be | not yet |
| planning-poker backend | not yet |
| seanscards backend | not yet |
| ffmpeg-converter (Go) | not yet |
