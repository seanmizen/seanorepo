# AUTOCLAUDE — Agent Fleet Setup Guide

How to recreate the seanorepo autonomous agent pipeline from scratch.

## Architecture

```
Sean (CEO) → "I want X"
  ↓
Dispatch (COO skill) → creates issue, launches worker
  ↓
Worker (developer agent) → does work, opens PR, runs IGNITION PHASE
  ↓
Ignition → reviews open PRs, merges passing ones, dispatches next ready issue
  ↓
Next worker → cycle continues until backlog is empty
  ↓
Standup (PM, hourly cron) → starter motor, restarts engine if it stalled
```

## Prerequisites

- macOS with Claude Code desktop app
- `gh` CLI authenticated: `gh auth login`
- Yarn 4 via corepack: `corepack enable && corepack prepare`

## 1. Settings — `~/.claude/settings.json`

```json
{
  "model": "opus",
  "permissions": {
    "defaultMode": "acceptEdits",
    "allow": [
      "Bash(*)",
      "WebFetch(*)",
      "WebSearch(*)",
      "Read(*)",
      "Write(*)",
      "Edit(*)",
      "Glob(*)",
      "Grep(*)",
      "Agent(*)",
      "TodoWrite(*)",
      "NotebookEdit(*)",
      "Skill(*)"
    ]
  }
}
```

Why: `bypassPermissions` is CLI-only (needs `--dangerously-skip-permissions`). The desktop app needs explicit allow rules per tool type. `Bash(*)` is the critical one — without it, every shell command prompts.

## 2. Skills

### `/dispatch [issue-number]` — COO

**Location:** `~/.claude/skills/dispatch/SKILL.md`

What it does:
1. Reads the GitHub issue
2. Validates it has acceptance criteria
3. Marks it `in-progress`
4. Launches a worker agent in an isolated worktree
5. Worker does the work, opens a PR
6. Worker runs the IGNITION PHASE (reviews other PRs, dispatches next issue)

Key design: the worker prompt includes an IGNITION PHASE — after opening its PR, every worker reviews open PRs, merges passing ones, and dispatches the next `ready` issue. This makes the engine self-sustaining.

### `/standup` — PM (starter motor)

**Location:** `~/.claude/skills/standup/SKILL.md`

What it does:
1. Takes a pipeline snapshot (open PRs, in-progress issues, ready issues)
2. Reviews and merges open PRs
3. Dispatches ready issues (respecting WIP limit of 3-5)
4. Flags stuck work
5. Does nothing if the engine is already turning

Scheduled hourly as a fallback. The ignition phase in each worker is the primary engine; standup only fires if the chain broke.

## 3. Scheduled Tasks

### Standup (hourly)

Created via:
```
Scheduled task "standup" with cron "17 * * * *"
Prompt: "Run /standup — check the seanorepo pipeline..."
```

Recreate with the `mcp__scheduled-tasks__create_scheduled_task` tool or via the Claude Code sidebar.

## 4. GitHub Setup

### Labels

Run `create-issues.sh` at repo root (creates all labels with `--force`), or manually:

**Priority:** `P0` (red), `P1` (orange), `P2` (yellow)
**Process:** `meta`, `pipeline`, `clash-test`, `in-progress`, `backlog`, `ready`, `idea`, `regression`
**Type:** `enhancement`, `chore`, `infra`, `docs`
**Project:** `seanmizen.com`, `swindowzig`, `converter`, `carolinemizen.art`, `planning-poker`

### Project Board

GitHub Projects kanban: Idea, Backlog, Ready, In Progress, In Review, Merged, Done.
Created at: https://github.com/users/seanmizen/projects/1/views/1

### Repo Settings

Squash-merge only (disable merge commits and rebase merging in repo settings).

## 5. Conventions

All documented in `CLAUDE.md` under `## Agile Process`:

- **Branch:** `SEAN-{number}/{short-description}`
- **Commit:** `[SEAN-{number}] {type}: {description}`
- **PR title:** `[SEAN-{number}] {type}: {description}`
- **Squash commit:** `[SEAN-{number}] {type}: {description} (#{pr_number})`
- **Types:** feat, fix, chore, docs, refactor, test, style, perf, ci

## 6. The Engine Model

The pipeline is an internal combustion engine:

- **Fuel:** GitHub Issues labelled `ready`
- **Ignition:** Each worker's post-PR ignition phase (review PRs, dispatch next issue)
- **Combustion cycle:** Worker → PR → review → merge → dispatch next → Worker → ...
- **Starter motor:** Hourly standup cron job, restarts the cycle if it stalled
- **Kill switch:** No `ready` issues + no open PRs = engine idle

The chain is self-sustaining. Each agent's last act is to advance the pipeline. The hourly cron is insurance, not the primary mechanism.

## 7. Bootstrapping from Zero

```bash
# 1. Install settings
cp AUTOCLAUDE-settings.json ~/.claude/settings.json

# 2. Install skills
mkdir -p ~/.claude/skills/dispatch ~/.claude/skills/standup
# Copy SKILL.md files from this repo's docs/autoclaude/ or recreate from this doc

# 3. Auth GitHub
gh auth login

# 4. Create labels + issues
bash create-issues.sh

# 5. Create project board
gh project create --title "Seanorepo" --owner seanmizen

# 6. Schedule standup
# In Claude Code: "Schedule a standup task that runs hourly"

# 7. Start the engine
# In Claude Code: "/dispatch 7" (or whatever the first ready issue is)
```

## 8. File Locations

```
~/.claude/settings.json                     — permissions + model
~/.claude/skills/dispatch/SKILL.md          — COO dispatch skill
~/.claude/skills/standup/SKILL.md           — PM standup skill
~/.claude/scheduled-tasks/standup/SKILL.md  — hourly cron config
seanorepo/CLAUDE.md                         — conventions + agile process
seanorepo/AUTOCLAUDE.md                     — this file
seanorepo/create-issues.sh                  — label + issue bootstrap
seanorepo/docs/archive/seanorepo-agile-blueprint.md — original methodology
```
