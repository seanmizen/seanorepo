# Claude Code Desktop App — Auto-Approve Bash Commands

## The Problem

`"defaultMode": "bypassPermissions"` is a **CLI-only mode** that requires a startup flag (`--dangerously-skip-permissions`). The desktop app ignores it and prompts for every command.

`"defaultMode": "acceptEdits"` only auto-approves **file edits**, not bash commands.

## The Fix

In `~/.claude/settings.json` (user-level settings), add `Bash(*)` to the allow list:

```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "allow": [
      "Bash(*)"
    ]
  }
}
```

This auto-approves all bash commands in the desktop app. No restart needed — takes effect immediately.

## Settings File Locations

- **User-level:** `~/.claude/settings.json` — applies to all projects
- **Project-level:** `<repo>/.claude/settings.json` — checked into git, shared with team
- **Project-local:** `<repo>/.claude/settings.local.json` — gitignored, per-machine overrides

The `Bash(*)` wildcard in user-level settings is sufficient. No need to duplicate it in project or local settings.
