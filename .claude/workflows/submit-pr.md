# Workflow: Submitting a PR

Reference: [AGENTS.md](../../AGENTS.md) for conventions.

## Checklist

1. Run code quality checks from monorepo root:
   ```bash
   yarn fix
   ```

2. If you touched a TypeScript backend project, check for type errors:
   ```bash
   tsc --noEmit
   ```

3. Stage and commit with the correct message format:
   ```bash
   git add {files}
   git commit -m "[SEAN-{number}] {type}: {description}

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
   ```
   - Never use `--no-verify`

4. Push the branch:
   ```bash
   git push -u origin SEAN-{number}/{short-description}
   ```

5. Open a PR against `main`:
   ```bash
   gh pr create --repo seanmizen/seanorepo \
     --title "[SEAN-{number}] {type}: {description}" \
     --body "$(cat <<'EOF'
   Closes #{number}

   ## Summary
   - {key change 1}
   - {key change 2}

   ## Test plan
   - [ ] {test step 1}
   - [ ] {test step 2}
   EOF
   )"
   ```

6. Move the issue to `in-review`:
   ```bash
   gh issue edit {number} --repo seanmizen/seanorepo \
     --add-label "in-review" --remove-label "in-progress"
   ```

7. Run the Ignition Phase (see AGENTS.md) — review open PRs and dispatch the next ready issue.
