# Workflow: Creating a New Ticket

Reference: [AGENTS.md](../../AGENTS.md) for conventions.

## Checklist

1. Identify the correct issue template:
   - Feature/enhancement → `feature.yml`
   - Bug/regression → `bug.yml`
   - Maintenance/refactor → `chore.yml`

2. Create the issue via `gh`:
   ```bash
   gh issue create --repo seanmizen/seanorepo \
     --title "{short description}" \
     --body "$(cat <<'EOF'
   ## Context
   {why this work is needed}

   ## Acceptance Criteria
   - [ ] {done condition 1}
   - [ ] {done condition 2}

   ## Files Likely Touched
   - `{path/to/file}` (create/modify)

   ## Priority
   P{0-3}
   EOF
   )" \
     --label "backlog"
   ```

3. Confirm the issue was created and has:
   - `backlog` label
   - Acceptance Criteria checklist
   - Priority field (`P0`–`P3`)
   - Files Likely Touched section

4. If the issue is ready to be worked on immediately, move it to `ready`:
   ```bash
   gh issue edit {number} --repo seanmizen/seanorepo \
     --add-label "ready" --remove-label "backlog"
   ```
