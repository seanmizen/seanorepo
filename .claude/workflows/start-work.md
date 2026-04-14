# Workflow: Starting Work on a Ticket

Reference: [AGENTS.md](../../AGENTS.md) for conventions.

## Checklist

1. Check WIP limit — no more than 3–5 issues `in-progress` at once:
   ```bash
   gh issue list --repo seanmizen/seanorepo --label "in-progress" --state open
   ```

2. Move the issue from `ready` to `in-progress`:
   ```bash
   gh issue edit {number} --repo seanmizen/seanorepo \
     --add-label "in-progress" --remove-label "ready"
   ```

3. Create a branch from `main` using the correct naming convention:
   ```bash
   git checkout main && git pull
   git checkout -b SEAN-{number}/{short-description}
   ```
   - Lowercase, hyphenated, max 5 words
   - Must include ticket ref (e.g. `SEAN-42/fix-hover-flicker`)

4. Read the issue acceptance criteria carefully before writing any code.

5. Do NOT start any out-of-scope work discovered during implementation — create a new issue instead (see AGENTS.md).
