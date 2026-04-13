# Dispatch Playbook

Operational playbook for the Dispatch role (COO) in seanorepo. This document covers every
routine operation with exact `gh` CLI commands. A fresh Dispatch instance should be able to
operate the fleet cold using only this file.

## Mental Model

Dispatch is the orchestrator, not the doer. Workers handle code changes. Dispatch handles
the pipeline: intake, prioritisation, assignment, monitoring, and retros.

**Engine model**: each worker has an _ignition phase_ that auto-advances the pipeline when
it finishes (reviews open PRs, merges passing ones, dispatches the next ready issue). Dispatch
is needed for three things:

1. **Cold start** -- kicking the engine when no workers are running.
2. **Intake** -- turning Sean's raw ideas into well-formed tickets.
3. **Exception handling** -- unsticking workers, enforcing WIP limits, running retros.

---

## 1. Creating Tickets from Raw Ideas

When Sean says "I want X", create a GitHub issue with the standard template.

### Command

```bash
gh issue create --repo seanmizen/seanorepo \
  --title "{concise title}" \
  --label "backlog" \
  --body "$(cat <<'EOF'
## Context
{One paragraph explaining why this matters.}

## Acceptance Criteria
- [ ] {Criterion 1}
- [ ] {Criterion 2}
- [ ] {Criterion 3}

## Files Likely Touched
- {path/to/file} ({create | modify})

## Priority
{P0 | P1 | P2}

## Notes
{Any extra context, links, or constraints.}
EOF
)"
```

### Rules

- **Always** add the `backlog` label on creation.
- **Always** include at least one acceptance criterion. If Sean's idea is vague, ask
  clarifying questions before creating the ticket.
- Add a priority label (`P0`, `P1`, or `P2`) matching the priority in the body.
- Add a category label if appropriate (`meta`, `docs`, `feat`, `fix`, `infra`).

### Adding priority and category labels

```bash
gh issue edit {number} --repo seanmizen/seanorepo --add-label "P1" --add-label "feat"
```

---

## 2. Promoting Backlog to Ready

A backlog issue becomes ready when it has everything a worker needs to start immediately.

### Checklist before promoting

1. **Acceptance criteria** -- at least 2-3 concrete, checkable items.
2. **Files Likely Touched** -- list the files or directories the worker should look at.
3. **Priority** -- P0, P1, or P2 set in the body and as a label.
4. **No blockers** -- the issue does not depend on another in-progress issue.

### Command

```bash
gh issue edit {number} --repo seanmizen/seanorepo \
  --add-label "ready" \
  --remove-label "backlog"
```

### Batch promotion

To promote multiple issues at once:

```bash
for n in 14 15 16; do
  gh issue edit "$n" --repo seanmizen/seanorepo --add-label "ready" --remove-label "backlog"
done
```

---

## 3. Assigning to Agents

### Step 3a: Check WIP limits

Before dispatching, count in-progress issues:

```bash
gh issue list --repo seanmizen/seanorepo \
  --label "in-progress" --state open \
  --json number --jq 'length'
```

If the count is **3 or more**, do not dispatch. Wait for workers to finish. The hard cap is 5;
the soft target is 3.

### Step 3b: Pick the highest-priority ready issue

```bash
gh issue list --repo seanmizen/seanorepo \
  --label "ready" --state open \
  --json number,title,labels \
  --jq 'sort_by(.labels | map(select(.name | startswith("P"))) | .[0].name) | .[0]'
```

Or simply:

```bash
gh issue list --repo seanmizen/seanorepo \
  --label "ready" --state open \
  --json number,title,labels
```

Then pick the highest priority (P0 > P1 > P2) manually.

### Step 3c: Mark as in-progress

```bash
gh issue edit {number} --repo seanmizen/seanorepo \
  --add-label "in-progress" \
  --remove-label "ready"
```

### Step 3d: Launch the worker

Use the `/dispatch` skill:

```
/dispatch {number}
```

This reads the issue, validates it, builds the worker prompt (including the WORKFLOW,
IGNITION PHASE, and RULES blocks), and launches a worker agent in an isolated worktree.

### Manual dispatch (if the skill is unavailable)

Read the issue:

```bash
gh issue view {number} --repo seanmizen/seanorepo --json number,title,body,labels
```

Then launch an Agent with `isolation: "worktree"` and the full worker prompt. The prompt
must include:

1. The issue title and body (verbatim).
2. Branch name: `SEAN-{number}/{short-desc}`.
3. Commit format: `[SEAN-{number}] {type}: {description}`.
4. The WORKFLOW block (branch creation, work, yarn fix, commit, push, PR, label update).
5. The IGNITION PHASE block (PR review + next-issue dispatch).
6. The RULES block (scope discipline, no --no-verify, no push to main, Yarn 4 only).

---

## 4. Monitoring Progress

### 4a: Pipeline snapshot

Run this to see the full state of the pipeline:

```bash
echo "=== OPEN PRs ==="
gh pr list --repo seanmizen/seanorepo --state open \
  --json number,title,mergeable,headRefName,labels

echo "=== IN-PROGRESS ==="
gh issue list --repo seanmizen/seanorepo --label "in-progress" --state open \
  --json number,title

echo "=== IN-REVIEW ==="
gh issue list --repo seanmizen/seanorepo --label "in-review" --state open \
  --json number,title

echo "=== READY ==="
gh issue list --repo seanmizen/seanorepo --label "ready" --state open \
  --json number,title

echo "=== BACKLOG ==="
gh issue list --repo seanmizen/seanorepo --label "backlog" --state open \
  --json number,title
```

### 4b: Check if a worker has pushed a branch

```bash
git ls-remote --heads origin | grep "SEAN-{number}"
```

If the issue is `in-progress` but no branch exists, the worker may be stuck.

### 4c: Check recent commits on a worker branch

```bash
gh pr list --repo seanmizen/seanorepo --state open \
  --json number,headRefName,updatedAt \
  --jq '.[] | select(.headRefName | startswith("SEAN-{number}"))'
```

---

## 5. Handling Stuck Agents

A worker is considered stuck if:

- It has been `in-progress` for a long time with no branch pushed.
- Its PR has not been updated recently.
- Its PR has merge conflicts.

### 5a: Comment asking for status

```bash
gh issue comment {number} --repo seanmizen/seanorepo \
  --body "Status check: this issue has been in-progress with no recent activity. Flagging for review."
```

### 5b: Reset and re-dispatch

If the worker is truly dead, reset the issue and re-dispatch:

```bash
# Remove in-progress, put back to ready
gh issue edit {number} --repo seanmizen/seanorepo \
  --add-label "ready" \
  --remove-label "in-progress" \
  --remove-label "in-review"
```

Then dispatch again (Step 3).

### 5c: Close a stale PR

If a worker left a broken PR behind:

```bash
gh pr close {pr_number} --repo seanmizen/seanorepo \
  --comment "Closing stale PR. Issue will be re-dispatched."
```

### 5d: Handle merge conflicts on a PR

```bash
# Check mergeable status
gh pr view {pr_number} --repo seanmizen/seanorepo --json mergeable

# If CONFLICTING, launch a resolver agent in a worktree to rebase and resolve
# Or comment on the PR:
gh pr comment {pr_number} --repo seanmizen/seanorepo \
  --body "This PR has merge conflicts with main. Needs rebase."
```

### 5e: Create a follow-up issue

If partial work was done but the issue cannot be completed as-is:

```bash
gh issue create --repo seanmizen/seanorepo \
  --title "Follow-up: {original title}" \
  --label "ready" \
  --body "$(cat <<'EOF'
## Context
Follow-up to #{original_number} which was partially completed.
{Describe what was done and what remains.}

## Acceptance Criteria
- [ ] {Remaining criterion 1}
- [ ] {Remaining criterion 2}

## Files Likely Touched
- {files}

## Priority
{same as original}
EOF
)"
```

---

## 6. Reviewing and Merging PRs

This is normally handled by the ignition phase of workers, but Dispatch may need to do it
during cold starts or exception handling.

### 6a: List open PRs

```bash
gh pr list --repo seanmizen/seanorepo --state open \
  --json number,title,mergeable,headRefName,labels
```

### 6b: Review a PR diff

```bash
gh pr diff {pr_number} --repo seanmizen/seanorepo
```

Check the diff against the linked issue's acceptance criteria. Verify:

- All acceptance criteria are met.
- No unrelated changes are included.
- Code follows project conventions (Yarn 4, Biome formatting, etc.).

### 6c: Merge a passing PR

```bash
gh pr merge {pr_number} --repo seanmizen/seanorepo --squash
```

### 6d: Request changes on a PR

```bash
gh pr comment {pr_number} --repo seanmizen/seanorepo \
  --body "Changes requested:
- {issue 1}
- {issue 2}
"
```

---

## 7. Running Retros

Run a retrospective every ~10 closed tickets. This surfaces patterns and improves the
pipeline.

### 7a: Count closed tickets since last retro

```bash
gh issue list --repo seanmizen/seanorepo --state closed \
  --json number,closedAt \
  --jq '[.[] | select(.closedAt > "{last_retro_date}")] | length'
```

Or simply list recent closed issues:

```bash
gh issue list --repo seanmizen/seanorepo --state closed \
  --limit 15 --json number,title,closedAt,labels
```

### 7b: Gather metrics

**Throughput**: count of issues closed in the period.

```bash
gh issue list --repo seanmizen/seanorepo --state closed \
  --json number,closedAt \
  --jq '[.[] | select(.closedAt > "{period_start}")] | length'
```

**Stuck rate**: issues that needed re-dispatch or manual intervention.

**Conflict rate**: PRs that had merge conflicts.

**Cycle time**: time from `in-progress` to merged (approximate from PR timestamps).

```bash
gh pr list --repo seanmizen/seanorepo --state merged \
  --limit 15 --json number,title,createdAt,mergedAt
```

### 7c: Create the retro issue

```bash
gh issue create --repo seanmizen/seanorepo \
  --title "RETRO-{N}: Retrospective for tickets #{first}-#{last}" \
  --label "meta" \
  --body "$(cat <<'EOF'
## Retro Period
Tickets #{first} through #{last} ({count} tickets)

## Metrics
- **Throughput**: {N} tickets closed
- **Stuck rate**: {N}/{total} issues needed re-dispatch
- **Conflict rate**: {N}/{total} PRs had merge conflicts
- **Avg cycle time**: ~{N} minutes from dispatch to merge

## What went well
- {observation}

## What went wrong
- {observation}

## Action items
- [ ] {improvement to the pipeline}
- [ ] {improvement to the pipeline}
EOF
)"
```

### 7d: Track retro number

Use the title convention `RETRO-{N}` (RETRO-1, RETRO-2, etc.). To find the last retro:

```bash
gh issue list --repo seanmizen/seanorepo --state all \
  --search "RETRO- in:title" \
  --json number,title --jq '.[0].title'
```

---

## 8. WIP Limit Enforcement

The fleet runs best with 3-5 concurrent workers. More than that causes merge conflicts
and resource contention.

### Checking current WIP

```bash
gh issue list --repo seanmizen/seanorepo \
  --label "in-progress" --state open \
  --json number --jq 'length'
```

### Rules

| WIP count | Action                                            |
| --------- | ------------------------------------------------- |
| 0         | Cold start. Dispatch up to 3 ready issues.        |
| 1-2       | Dispatch more if ready issues exist (up to cap).  |
| 3         | Soft cap. Dispatch only P0 issues.                |
| 4         | Hard warning. Do not dispatch unless P0.          |
| 5+        | Hard cap. Do not dispatch. Wait for completions.  |

### Batch cold start

When the engine is fully idle and there are multiple ready issues:

```bash
# Get the first 3 ready issues
gh issue list --repo seanmizen/seanorepo \
  --label "ready" --state open \
  --json number,title --jq '.[0:3]'
```

Then dispatch each one (Step 3).

---

## Label Reference

| Label         | Meaning                                 |
| ------------- | --------------------------------------- |
| `backlog`     | Accepted but not yet ready for work     |
| `ready`       | Fully specified, ready to be dispatched |
| `in-progress` | Worker agent is actively working on it  |
| `in-review`   | PR is open, awaiting review and merge   |
| `P0`          | Critical priority                       |
| `P1`          | High priority                           |
| `P2`          | Normal priority                         |
| `meta`        | Process/pipeline work                   |
| `docs`        | Documentation                           |
| `feat`        | Feature work                            |
| `fix`         | Bug fix                                 |
| `infra`       | Infrastructure/DevOps                   |

---

## Pipeline Flow

```
Raw idea -> backlog -> ready -> in-progress -> in-review -> merged/closed
                                    |               |
                                    v               v
                                (stuck?)      (conflicts?)
                                    |               |
                                    v               v
                              re-dispatch      resolve/rebase
```

---

## Quick Reference: Common Operations

| Operation                | Command |
| -------------------------|---------|
| Create ticket            | `gh issue create --repo seanmizen/seanorepo --title "..." --label "backlog" --body "..."` |
| Promote to ready         | `gh issue edit {n} --repo seanmizen/seanorepo --add-label "ready" --remove-label "backlog"` |
| Mark in-progress         | `gh issue edit {n} --repo seanmizen/seanorepo --add-label "in-progress" --remove-label "ready"` |
| Mark in-review           | `gh issue edit {n} --repo seanmizen/seanorepo --add-label "in-review" --remove-label "in-progress"` |
| Reset to ready           | `gh issue edit {n} --repo seanmizen/seanorepo --add-label "ready" --remove-label "in-progress" --remove-label "in-review"` |
| Check WIP count          | `gh issue list --repo seanmizen/seanorepo --label "in-progress" --state open --json number --jq 'length'` |
| Merge PR                 | `gh pr merge {n} --repo seanmizen/seanorepo --squash` |
| Close stale PR           | `gh pr close {n} --repo seanmizen/seanorepo --comment "..."` |
| Check for worker branch  | `git ls-remote --heads origin \| grep "SEAN-{n}"` |
| Full pipeline snapshot   | See Section 4a |
| Dispatch worker          | `/dispatch {n}` |
