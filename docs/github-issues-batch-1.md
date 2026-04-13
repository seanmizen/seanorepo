# GitHub Issues — Batch 1 (Agile Bootstrap)

**Repo:** seanmizen/seanorepo
**Generated:** 2026-04-13
**Source:** `seanorepo-agile-blueprint.md`

---

## Issue List

| # | Title | Labels | Priority |
|---|-------|--------|----------|
| 1 | Set up GitHub Project board with kanban columns and labels | `meta` `pipeline` | P0 |
| 2 | Create AGENTS.md documenting how Claude Code agents interact with the issue tracker | `meta` `docs` | P1 |
| 3 | Standardize GitHub issue templates for agent-created and human-created issues | `meta` `pipeline` | P1 |
| 4 | Add GitHub Actions CI: auto-label PRs and manage stale issues | `meta` `pipeline` `infra` | P2 |
| 5 ⚠️ | **[CLASH A]** Add branch naming and commit message conventions to CLAUDE.md | `clash-test` `enhancement` | P1 |
| 6 ⚠️ | **[CLASH B]** Add ticket lifecycle and squash-merge policy to CLAUDE.md | `clash-test` `enhancement` | P1 |
| 7 | Install Husky and commitlint at monorepo root in warn-only mode | `infra` `enhancement` | P1 |
| 8 | Create .claude/workflows/ agent SOP reference documents | `docs` | P2 |
| 9 | Write Dispatch orchestrator playbook with exact gh CLI commands for each lifecycle op | `meta` `docs` | P1 |
| 10 | Audit existing branches, retroactively create issues, delete stale branches | `chore` `infra` | P1 |

---

## Clash Test Pair

**Issues 5 and 6 are the deliberate clash test.**

Both issues target `CLAUDE.md`, specifically the **`## Development Patterns`** section:

- **Issue 5** inserts: `### Branch Naming Convention` + `### Commit Message Convention` subsections
- **Issue 6** inserts: `### Ticket Lifecycle` + `### Squash-Merge Policy` subsections

Both workers are told to insert at the END of `## Development Patterns`, before the next `##` heading.
One agent will open a PR that merges cleanly; the second agent will hit a merge conflict and must
resolve it by incorporating both sets of changes into a single coherent section.

Filter by label: `clash-test`

---

## Labels Created by the Script

### Priority
- `P0` — Critical, do first
- `P1` — High priority
- `P2` — Medium priority

### Process
- `meta` — Process/pipeline work
- `pipeline` — CI/CD and automation
- `clash-test` — Intentional merge conflict test
- `in-progress` — Agent actively working
- `backlog` — Scoped but not ready
- `ready` — Fully specced, agent can start
- `idea` — Raw brain dump
- `regression` — Introduced a regression

### Type
- `enhancement`
- `chore`
- `infra`

### Sub-project
- `seanmizen.com`
- `swindowzig`
- `converter`
- `carolinemizen.art`
- `planning-poker`

---

## Recommended Work Order

```
1 (P0) → unblocks all other issues (board + labels must exist)
2 + 3 + 9 in parallel (docs/meta, no file conflicts)
5 + 6 in parallel (CLASH TEST — assign to two different agents simultaneously)
7 (after board is up so it can be tracked)
4 + 8 + 10 in any order
```

---

## How to Run

```bash
gh auth login
bash create-issues.sh
```

View all issues: https://github.com/seanmizen/seanorepo/issues
View clash pair: https://github.com/seanmizen/seanorepo/labels/clash-test
