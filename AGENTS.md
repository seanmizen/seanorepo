# AGENTS.md — Agent SOP

Standard operating procedure for Claude Code agents working on issues in this repo.
Concise reference. Follow exactly.

---

## Ticket Lifecycle

```
Backlog → Ready → In Progress → In Review → Merged → Done
```

### State Transitions (gh CLI)

**Pick up a ready issue:**
```bash
gh issue edit {number} --repo seanmizen/seanorepo --add-label "in-progress" --remove-label "ready"
```

**Open a PR (moves to In Review):**
```bash
gh pr create --repo seanmizen/seanorepo \
  --title "[SEAN-{number}] {type}: {description}" \
  --body "Closes #{number}

## Summary
- ...

## Test plan
- [ ] ...
"
gh issue edit {number} --repo seanmizen/seanorepo --add-label "in-review" --remove-label "in-progress"
```

**Merge (Merged → Done auto-closes on merge):**
```bash
gh pr merge {pr_number} --repo seanmizen/seanorepo --squash --auto
```

Squash message format: `[SEAN-{number}] {type}: {description} (#{pr_number})`

---

## Branch Naming

```
SEAN-{number}/{short-description}
```

- Lowercase, hyphenated, max 5 words
- Must include ticket ref

**Valid:** `SEAN-42/fix-hover-flicker`, `SEAN-7/add-avif-support`
**Invalid:** `fix-hover-flicker` (no ref), `SEAN-42` (no description), `SEAN-42/Fix-Hover` (uppercase)

```bash
git checkout -b SEAN-{number}/{short-description}
git push -u origin SEAN-{number}/{short-description}
```

---

## Commit Message Format

```
[SEAN-{number}] {type}: {description}

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

**Valid types:** `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`, `ci`

**Never use `--no-verify`.**

---

## Before Opening a PR

- [ ] Run `yarn fix` from monorepo root
- [ ] Run `tsc --noEmit` in any TypeScript backend project you touched
- [ ] Fix all lint, format, and type errors

---

## Out-of-Scope Work

If you discover work that is outside the current issue:

1. Create a new GitHub Issue:
   ```bash
   gh issue create --repo seanmizen/seanorepo \
     --title "{short description}" \
     --body "{details}" \
     --label "backlog"
   ```
2. Do NOT do that work in the current branch.
3. Continue with the current issue only.

---

## Merge Conflicts

If your branch has a merge conflict:

1. Identify conflicting files: `git status`
2. Resolve by incorporating **both** sides of the conflict. Do not discard either side.
3. Stage resolved files: `git add {files}`
4. Continue: `git rebase --continue` or `git merge --continue`
5. Push: `git push`

If you cannot resolve without understanding the other branch's intent:
- Comment on the PR describing the conflict
- Do NOT force-push discarding changes

---

## Ignition Phase (after every PR)

After your PR is open, run these steps before exiting:

### 1. Review open PRs
```bash
gh pr list --repo seanmizen/seanorepo --state open --json number,title,mergeable,labels,headRefName
```

For each open PR:
- If `mergeable == "CONFLICTING"`: comment on the PR noting the conflict. Do NOT attempt to fix (different worktree).
- Otherwise: review the diff vs issue acceptance criteria:
  ```bash
  gh pr diff {pr_number} --repo seanmizen/seanorepo
  ```
  - If correct: `gh pr merge {pr_number} --repo seanmizen/seanorepo --squash --auto`
  - If wrong: comment with what needs fixing

### 2. Dispatch next ready issue
```bash
gh issue list --repo seanmizen/seanorepo --label "ready" --state open \
  --json number,title,labels --jq '.[0]'
```

If a ready issue exists:
```bash
gh issue edit {number} --repo seanmizen/seanorepo --add-label "in-progress" --remove-label "ready"
```
Then launch a new worker agent for it (use the Agent tool with `isolation: "worktree"`).

If no ready issues: stop. The engine is idle.

---

## Rules Summary

- One ticket = one branch = one PR
- Never push to `main` directly
- Never use `bun install` or `npm install` — use Yarn 4
- WIP limit: max 3–5 issues `in-progress` concurrently
- Always run the Ignition Phase — it keeps the engine running
