#!/usr/bin/env bash
# ============================================================
# create-issues.sh — Bootstrap seanorepo GitHub Issues
# Run: gh auth login && bash create-issues.sh
# ============================================================
set -e

REPO="seanmizen/seanorepo"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

echo "==> Creating labels..."

gh label create "P0"          --repo "$REPO" --color "B60205" --description "Critical — do first" --force
gh label create "P1"          --repo "$REPO" --color "D93F0B" --description "High priority" --force
gh label create "P2"          --repo "$REPO" --color "E4E669" --description "Medium priority" --force
gh label create "meta"        --repo "$REPO" --color "0075CA" --description "Process/pipeline work" --force
gh label create "pipeline"    --repo "$REPO" --color "0075CA" --description "CI/CD and automation" --force
gh label create "clash-test"  --repo "$REPO" --color "5319E7" --description "Intentional merge conflict test" --force
gh label create "in-progress" --repo "$REPO" --color "FBCA04" --description "Agent actively working" --force
gh label create "backlog"     --repo "$REPO" --color "C2E0C6" --description "Scoped but not ready" --force
gh label create "ready"       --repo "$REPO" --color "0E8A16" --description "Fully specced — agent can start" --force
gh label create "idea"        --repo "$REPO" --color "F9D0C4" --description "Raw brain dump" --force
gh label create "regression"  --repo "$REPO" --color "B60205" --description "Introduced a regression" --force
gh label create "enhancement" --repo "$REPO" --color "84B6EB" --description "New feature or improvement" --force
gh label create "chore"       --repo "$REPO" --color "E4E669" --description "Maintenance / housekeeping" --force
gh label create "infra"       --repo "$REPO" --color "C5DEF5" --description "Monorepo-wide tooling / CI" --force
gh label create "seanmizen.com"     --repo "$REPO" --color "BFD4F2" --description "" --force
gh label create "swindowzig"        --repo "$REPO" --color "BFD4F2" --description "" --force
gh label create "converter"         --repo "$REPO" --color "BFD4F2" --description "" --force
gh label create "carolinemizen.art" --repo "$REPO" --color "BFD4F2" --description "" --force
gh label create "planning-poker"    --repo "$REPO" --color "BFD4F2" --description "" --force

echo ""
echo "==> Labels created. Creating issues..."
echo ""

# ============================================================
# ISSUE 1 — P0: GitHub Project board
# ============================================================
cat > "$TMP" << 'BODY'
## Context
The agile blueprint selects GitHub Projects + Issues as the tracking tool. Before any agent work can
be tracked properly, the board and label taxonomy must exist. This is the prerequisite for every
other pipeline issue.

## Acceptance Criteria
- [ ] GitHub Project board named "Seanorepo" exists and is linked to this repo
- [ ] Columns created: **Idea, Backlog, Ready, In Progress, In Review, Merged, Done**
- [ ] All sub-project labels exist: `seanmizen.com`, `swindowzig`, `converter`, `carolinemizen.art`, `planning-poker`, `infra`
- [ ] All standard labels exist: `bug`, `feature`, `chore`, `docs`, `priority/high`, `priority/medium`, `priority/low`, `idea`, `regression`, `in-progress`, `backlog`, `ready`
- [ ] Board is set as the default project for new issues

## Files Likely Touched
- GitHub repo settings (no local files)
- Optionally: `.github/labels.yml` for label config-as-code

## Priority
P0

## Notes
This must be completed before any other issues enter "In Progress". Run via `gh project create` and `gh label create`.
BODY
gh issue create \
  --repo "$REPO" \
  --title "Set up GitHub Project board with kanban columns and labels" \
  --label "meta,pipeline,P0" \
  --body-file "$TMP"
echo "Issue 1 created."

# ============================================================
# ISSUE 2 — P1: AGENTS.md
# ============================================================
cat > "$TMP" << 'BODY'
## Context
Workers (Claude Code agents) need a single authoritative reference for how to pick up, work on, and
close issues. Without this, every agent session requires re-reading the full blueprint or relying on
CLAUDE.md conventions. AGENTS.md is the agent-facing SOP.

## Acceptance Criteria
- [ ] `AGENTS.md` exists at the monorepo root
- [ ] Covers the full ticket lifecycle: Backlog -> Ready -> In Progress -> In Review -> Merged -> Done
- [ ] Includes exact `gh` CLI commands for each state transition (add/remove labels)
- [ ] Documents branch naming convention: `SEAN-{number}/{short-description}`
- [ ] Documents commit message format: `[SEAN-{number}] {type}: {description}`
- [ ] Includes a "What to do if you discover out-of-scope work" section (create new issue, do not do it in the current branch)
- [ ] Includes a "What to do if you hit a merge conflict" section
- [ ] Referenced from root `CLAUDE.md`

## Files Likely Touched
- `AGENTS.md` (create)
- `CLAUDE.md` (add reference to AGENTS.md)

## Priority
P1

## Notes
This is for agent consumption, not human documentation. Write it as a concise checklist, not prose.
BODY
gh issue create \
  --repo "$REPO" \
  --title "Create AGENTS.md documenting how Claude Code agents interact with the issue tracker" \
  --label "meta,docs,P1" \
  --body-file "$TMP"
echo "Issue 2 created."

# ============================================================
# ISSUE 3 — P1: Issue templates
# ============================================================
cat > "$TMP" << 'BODY'
## Context
Agents and Sean need a consistent issue structure so that acceptance criteria, file lists, and
priority are always present. GitHub issue templates enforce this at creation time. Without templates,
issues drift in quality and agents may lack enough context to start work.

## Acceptance Criteria
- [ ] `.github/ISSUE_TEMPLATE/feature.yml` exists with fields: title, context, acceptance criteria, files likely touched, priority, notes
- [ ] `.github/ISSUE_TEMPLATE/bug.yml` exists with fields: title, steps to reproduce, expected vs actual, acceptance criteria, files likely touched, priority
- [ ] `.github/ISSUE_TEMPLATE/chore.yml` exists for maintenance tasks
- [ ] Each template pre-populates relevant labels
- [ ] `CLAUDE.md` or `AGENTS.md` references the template format so agents follow it when creating issues programmatically

## Files Likely Touched
- `.github/ISSUE_TEMPLATE/feature.yml` (create)
- `.github/ISSUE_TEMPLATE/bug.yml` (create)
- `.github/ISSUE_TEMPLATE/chore.yml` (create)
- `AGENTS.md` or `CLAUDE.md` (update to reference templates)

## Priority
P1

## Notes
Use GitHub YAML-based issue form templates (not the older markdown templates). See the GitHub docs
for form schema syntax. Templates should work for both human and programmatic issue creation.
BODY
gh issue create \
  --repo "$REPO" \
  --title "Standardize GitHub issue templates for agent-created and human-created issues" \
  --label "meta,pipeline,P1" \
  --body-file "$TMP"
echo "Issue 3 created."

# ============================================================
# ISSUE 4 — P2: CI auto-label + stale
# ============================================================
cat > "$TMP" << 'BODY'
## Context
As agent volume increases, manual label maintenance becomes overhead. Two automations eliminate
most of it: (1) auto-labeling PRs based on which files were changed (sub-project routing), and
(2) a stale-issue bot that flags or closes issues that have not been updated in 30 days.

## Acceptance Criteria
- [ ] `.github/workflows/label-pr.yml` exists — uses `actions/labeler` to auto-label PRs based on changed paths (e.g., changes under `apps/seanmizen*` get label `seanmizen.com`)
- [ ] `.github/labeler.yml` config file maps path globs to labels
- [ ] `.github/workflows/stale.yml` exists — uses `actions/stale@v9` to warn after 21 days, close after 30 days
- [ ] Stale workflow exempts labels: `P0`, `in-progress`, `ready`
- [ ] Both workflows are tested with a dummy PR or dry-run mode

## Files Likely Touched
- `.github/workflows/label-pr.yml` (create)
- `.github/workflows/stale.yml` (create)
- `.github/labeler.yml` (create)

## Priority
P2

## Notes
The stale bot must NOT close P0 issues or issues labelled `in-progress`. Add those to the
`exempt-issue-labels` list in the stale workflow config.
BODY
gh issue create \
  --repo "$REPO" \
  --title "Add GitHub Actions CI: auto-label PRs and manage stale issues" \
  --label "meta,pipeline,infra,P2" \
  --body-file "$TMP"
echo "Issue 4 created."

# ============================================================
# ISSUE 5 — CLASH TEST A (P1) — targets CLAUDE.md
# ============================================================
cat > "$TMP" << 'BODY'
## Context
WARNING CLASH TEST: This issue deliberately targets the same file as the companion clash-test issue
(search label `clash-test` to find it). Both issues insert content into `CLAUDE.md` in the
`## Development Patterns` section. Workers must coordinate or resolve the merge conflict that
results. This is intentional — it tests the agent conflict-resolution workflow.

The root `CLAUDE.md` currently has no branch naming or commit message rules. The agile blueprint
(Section 4) specifies exact conventions that all agents must follow.

## Acceptance Criteria
- [ ] `CLAUDE.md` contains a new `### Branch Naming Convention` subsection under `## Development Patterns`
- [ ] Convention documented: `SEAN-{number}/{short-description}` (lowercase, hyphenated, max 5 words)
- [ ] Valid and invalid examples included
- [ ] `CLAUDE.md` contains a new `### Commit Message Convention` subsection under `## Development Patterns`
- [ ] Convention documented: `[SEAN-{number}] {type}: {description}` with valid types listed
- [ ] Note added: agents must NEVER use `--no-verify` to bypass hooks

## Files Likely Touched
- `CLAUDE.md` (edit — `## Development Patterns` section)

## Priority
P1

## Notes
Insert the two new subsections at the END of the `## Development Patterns` section, before the
next `##` heading. The companion clash-test issue inserts into the same location. One of the two
agents will hit a merge conflict and must resolve it by incorporating both sets of changes into
a single coherent section.
BODY
gh issue create \
  --repo "$REPO" \
  --title "[CLASH A] Add branch naming and commit message conventions to CLAUDE.md" \
  --label "clash-test,enhancement,P1" \
  --body-file "$TMP"
echo "Issue 5 (CLASH A) created."

# ============================================================
# ISSUE 6 — CLASH TEST B (P1) — targets CLAUDE.md
# ============================================================
cat > "$TMP" << 'BODY'
## Context
WARNING CLASH TEST: This issue deliberately targets the same file as the companion clash-test issue
(search label `clash-test` to find it). Both issues insert content into `CLAUDE.md` in the
`## Development Patterns` section. Workers must coordinate or resolve the merge conflict that
results. This is intentional — it tests the agent conflict-resolution workflow.

The root `CLAUDE.md` has no ticket lifecycle or merge policy guidance. Agents picking up tickets
need to know the full workflow loop: create branch, update status, open PR, squash merge, auto-close.

## Acceptance Criteria
- [ ] `CLAUDE.md` contains a new `### Ticket Lifecycle` subsection under `## Development Patterns`
- [ ] Lifecycle states documented: Idea -> Backlog -> Ready -> In Progress -> In Review -> Merged -> Done
- [ ] Agent responsibilities documented: update issue label to `in-progress` on start, `in-review` on PR open
- [ ] Scope discipline rule included: if you find out-of-scope work, create a new issue and move on
- [ ] `CLAUDE.md` contains a new `### Squash-Merge Policy` subsection under `## Development Patterns`
- [ ] Policy: always squash-merge, never merge commit or rebase-merge
- [ ] Squash commit message format: `[SEAN-{number}] {type}: {description} (#{pr_number})`

## Files Likely Touched
- `CLAUDE.md` (edit — `## Development Patterns` section)

## Priority
P1

## Notes
Insert the two new subsections at the END of the `## Development Patterns` section, before the
next `##` heading. The companion clash-test issue inserts into the same location. One of the two
agents will hit a merge conflict and must resolve it by incorporating both sets of changes into
a single coherent section.
BODY
gh issue create \
  --repo "$REPO" \
  --title "[CLASH B] Add ticket lifecycle and squash-merge policy to CLAUDE.md" \
  --label "clash-test,enhancement,P1" \
  --body-file "$TMP"
echo "Issue 6 (CLASH B) created."

# ============================================================
# ISSUE 7 — P1: Husky + commitlint
# ============================================================
cat > "$TMP" << 'BODY'
## Context
The agile blueprint specifies commit message and branch name enforcement via Husky git hooks.
Installing in warn-only mode first (Phase 1) allows existing branches to continue while new
conventions are established. Enforcement (exit 1) comes in a follow-up issue after branch cleanup.

## Acceptance Criteria
- [ ] `husky` and `@commitlint/cli` are installed as devDependencies at the monorepo root
- [ ] `.commitlintrc.js` exists at root with custom parser for `[SEAN-N] type: description` format
- [ ] Valid commit types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`, `ci`
- [ ] `.husky/commit-msg` hook rejects commits not matching the pattern (enforcing — exit 1)
- [ ] `.husky/pre-push` hook warns on bad branch names but exits 0 (warn-only, does NOT block)
- [ ] `yarn install` at root automatically installs hooks (via `prepare` script)
- [ ] `yarn fix` still passes after this change

## Files Likely Touched
- `package.json` (root — add `prepare: husky`, add devDependencies)
- `.commitlintrc.js` (create)
- `.husky/commit-msg` (create)
- `.husky/pre-push` (create)

## Priority
P1

## Notes
Use Yarn 4, NOT `npm install` or `bun install`. The monorepo uses Yarn 4 via corepack for all
package management — see CLAUDE.md "Bun is RUNTIME ONLY". The `prepare` script must use `husky`
not `husky install` (Husky v9 syntax changed). Do NOT add `--no-verify` anywhere.
BODY
gh issue create \
  --repo "$REPO" \
  --title "Install Husky and commitlint at monorepo root in warn-only mode" \
  --label "infra,enhancement,P1" \
  --body-file "$TMP"
echo "Issue 7 created."

# ============================================================
# ISSUE 8 — P2: .claude/workflows/ docs
# ============================================================
cat > "$TMP" << 'BODY'
## Context
The blueprint specifies three workflow reference documents in `.claude/workflows/` that agents can
consult at the start of each lifecycle phase. These are not enforced by tooling — they are
checklists that make agents self-sufficient without needing to re-read the full blueprint.

## Acceptance Criteria
- [ ] `.claude/workflows/new-ticket.md` exists — step-by-step for creating a well-formed issue via `gh issue create`
- [ ] `.claude/workflows/start-work.md` exists — checklist for beginning a ticket (check issue is Ready, create branch SEAN-N/desc, add `in-progress` label, update issue with agent session note)
- [ ] `.claude/workflows/submit-pr.md` exists — checklist for opening a PR (ticket ref in title, squash-ready, `yarn fix` passes, update issue to `in-review`)
- [ ] All three documents reference AGENTS.md for conventions
- [ ] Root `CLAUDE.md` has a `### Workflow References` note pointing to `.claude/workflows/`

## Files Likely Touched
- `.claude/workflows/new-ticket.md` (create)
- `.claude/workflows/start-work.md` (create)
- `.claude/workflows/submit-pr.md` (create)
- `CLAUDE.md` (add reference)

## Priority
P2

## Notes
Each document should be a concise numbered checklist, not prose. Target: an agent can read it in
under 30 seconds and know exactly what to do next. Include exact `gh` CLI commands.
BODY
gh issue create \
  --repo "$REPO" \
  --title "Create .claude/workflows/ agent SOP reference documents" \
  --label "docs,P2" \
  --body-file "$TMP"
echo "Issue 8 created."

# ============================================================
# ISSUE 9 — P1: Dispatch playbook
# ============================================================
cat > "$TMP" << 'BODY'
## Context
Dispatch (the orchestrator / COO) needs an authoritative playbook for routing work to agents.
Without it, ticket creation and lifecycle management depend on memory or re-reading the blueprint.
The playbook is the Dispatch-facing SOP — the equivalent of AGENTS.md but for the orchestrator.

## Acceptance Criteria
- [ ] `.claude/dispatch-playbook.md` exists
- [ ] Covers: creating a ticket from a raw idea (Sean says "I want X" -> Dispatch creates issue)
- [ ] Covers: promoting a ticket from Backlog to Ready (adding acceptance criteria, files, priority)
- [ ] Covers: assigning a ticket to an agent (exact `gh issue edit` and label commands)
- [ ] Covers: monitoring progress — how to check if an agent is stuck (no commits after N hours)
- [ ] Covers: handling a stuck agent (reassign, create follow-up issue, or close and reopen)
- [ ] Covers: running a retro (every ~10 tickets — what to review, RETRO-N issue format)
- [ ] Covers: WIP limit enforcement (cap at 3-5 concurrent `in-progress` issues)
- [ ] Includes exact `gh` CLI commands for every operation

## Files Likely Touched
- `.claude/dispatch-playbook.md` (create)

## Priority
P1

## Notes
Dispatch is me (Claude, acting as COO). Write the playbook so that any future Dispatch instance
can pick it up cold and operate the full agent fleet without human intervention beyond Sean initial
feature requests.
BODY
gh issue create \
  --repo "$REPO" \
  --title "Write Dispatch orchestrator playbook with exact gh CLI commands for each lifecycle op" \
  --label "meta,docs,P1" \
  --body-file "$TMP"
echo "Issue 9 created."

# ============================================================
# ISSUE 10 — P1: Branch audit + cleanup
# ============================================================
cat > "$TMP" << 'BODY'
## Context
The repo has pre-agile branches without ticket refs (e.g., branches from the voxel engine work,
`claude/*` worktree branches). Before enforcement goes live, every active branch needs a
corresponding issue. Stale branches should be deleted. This is the clean-slate prerequisite for
flipping the pre-push hook to enforce mode.

## Acceptance Criteria
- [ ] `git branch -r` output is audited — every remote branch categorised as: active (needs issue), ready-to-merge (no issue needed), or stale (delete)
- [ ] A GitHub Issue exists for every branch with active in-progress work
- [ ] Stale branches are deleted from remote (with Sean confirmation for any uncertain ones)
- [ ] `claude/*` worktree branches are identified and either closed or noted as system-managed
- [ ] After cleanup, `git branch -r` shows only `origin/main` and properly-named branches
- [ ] Comment on this issue listing every branch actioned and what was done

## Files Likely Touched
- No local files — all git remote operations

## Priority
P1

## Notes
Do NOT delete branches without confirming with Sean first. List all branches and proposed actions
in a comment on this issue before executing any deletes. The `claude/*` branches are auto-created
by Claude Code worktrees — check if they have open PRs before deleting.
BODY
gh issue create \
  --repo "$REPO" \
  --title "Audit existing branches, retroactively create issues, delete stale branches" \
  --label "chore,infra,P1" \
  --body-file "$TMP"
echo "Issue 10 created."

echo ""
echo "==> All 10 issues created."
echo "View at: https://github.com/seanmizen/seanorepo/issues"
echo ""
echo "CLASH TEST PAIR: Issues 5 and 6 both target CLAUDE.md (## Development Patterns section)."
echo "Filter by label clash-test: https://github.com/seanmizen/seanorepo/labels/clash-test"
